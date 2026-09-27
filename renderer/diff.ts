import type { PatchHunk } from '@shared/events'

/**
 * 편집 블록의 줄 diff (`docs/sdlc/conversation-timeline/` spec FR-7).
 *
 * **두 길이다.** 입력만으로 만드는 것(`lineDiff`) — 렌더러는 파일에 닿지 않는다(경계 2).
 * `old_string`/`new_string` 앞뒤의 문맥이 없어 줄 번호는 없다. 그리고 CLI가 준 hunk로 만드는 것
 * (`hunksFromPatch`, `docs/sdlc/conversation-events/` spec FR-37) — 어댑터가 도구 결과의 detail에
 * 실어 둔 hunk라 줄 번호가 있다. 규칙을 컴포넌트에서 떼어 두어 경계값(상한·자르기)을 렌더링 없이
 * 고정한다 — `usage.ts`와 같은 자리다.
 */

export interface DiffLine {
  sign: '+' | '-' | ' '
  text: string
  /** 바꾸기 전 파일의 줄 번호. 번호 diff(`hunksFromPatch`)의 문맥·지운 줄만 */
  oldNo?: number
  /** 바꾼 뒤 파일의 줄 번호. 번호 diff의 문맥·더한 줄, 새 파일의 줄만 */
  newNo?: number
}

export interface DiffHunk {
  lines: DiffLine[]
  /** 번호 diff에서만 — hunk 머리의 시작 번호 */
  oldStart?: number
  newStart?: number
  /**
   * 번호 diff에서만 — 이 hunk 앞에서 건너뛴 옛 파일의 줄 수. 첫 hunk는 그 위의 줄 수다
   * (`oldStart − 1`). 0이면 앞과 붙어 있다. 화면이 `⋯ N줄` 구분선으로 그린다(spec FR-47).
   */
  gapBefore?: number
}

/**
 * LCS 표의 칸 수 상한. 두 쪽 줄 수의 곱이 이것을 넘으면 "전부 지우고 전부 추가"로
 * 떨어진다 — 렌더러의 한 프레임을 diff 계산이 먹으면 안 된다.
 *
 * 곱은 **앞뒤 공통 줄을 걷어 낸 가운데**에서 잰다. LCS가 실제로 도는 것이 그 가운데이고,
 * 걷어 낸 공통 줄은 비용 없이 문맥으로 남길 수 있다.
 */
export const MAX_DIFF_CELLS = 1_000_000

/** 한 파일에 그리는 줄 수의 상한. 나머지는 "… N줄 더"다. */
export const MAX_DIFF_LINES = 400

/**
 * 줄로 가른다. 빈 문자열은 줄이 없는 것이고, 끝의 줄바꿈 하나는 빈 줄로 세지 않는다
 * (`"a\n"`은 한 줄이다 — 그렇지 않으면 Write마다 빈 `+` 줄이 하나씩 붙는다).
 */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 가운데의 LCS diff. 지운 줄이 같은 자리의 더한 줄보다 먼저 온다. */
function lcsLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const width = m + 1
  // dp[i][j] = a[i..]와 b[j..]의 LCS 길이. 뒤에서부터 채워 앞에서부터 걷는다.
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1]! + 1
        : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ sign: ' ', text: a[i]! })
      i++
      j++
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      out.push({ sign: '-', text: a[i]! })
      i++
    } else {
      out.push({ sign: '+', text: b[j]! })
      j++
    }
  }
  for (; i < n; i++) out.push({ sign: '-', text: a[i]! })
  for (; j < m; j++) out.push({ sign: '+', text: b[j]! })
  return out
}

/** before → after의 줄 diff 한 hunk. */
export function lineDiff(before: string, after: string): DiffHunk {
  const a = splitLines(before)
  const b = splitLines(after)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle = midA.length * midB.length > MAX_DIFF_CELLS
    ? [
        ...midA.map((text): DiffLine => ({ sign: '-', text })),
        ...midB.map((text): DiffLine => ({ sign: '+', text }))
      ]
    : lcsLines(midA, midB)

  return {
    lines: [
      ...a.slice(0, start).map((text): DiffLine => ({ sign: ' ', text })),
      ...middle,
      ...a.slice(endA).map((text): DiffLine => ({ sign: ' ', text }))
    ]
  }
}

/** 더한 줄과 지운 줄. 문맥은 세지 않는다. **자르기 전 hunk로 센다** — 잘린 수는 거짓이다. */
export function diffStats(hunks: DiffHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.sign === '+') added++
      else if (line.sign === '-') removed++
    }
  }
  return { added, removed }
}

/** 그릴 줄을 `max`줄까지 남긴다. hunk 경계를 넘어 자르고, 잘린 줄 수를 함께 준다. */
export function truncateHunks(
  hunks: DiffHunk[], max: number = MAX_DIFF_LINES
): { hunks: DiffHunk[]; truncated: number } {
  const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
  if (total <= max) return { hunks, truncated: 0 }

  const kept: DiffHunk[] = []
  let room = max
  for (const hunk of hunks) {
    if (room <= 0) break
    // 머리(시작 번호·간격)는 지킨다 — 남긴 줄의 번호와 구분선이 그것을 본다.
    kept.push(hunk.lines.length <= room ? hunk : { ...hunk, lines: hunk.lines.slice(0, room) })
    room -= hunk.lines.length
  }
  return { hunks: kept, truncated: total - max }
}

/**
 * 어댑터가 실어 준 hunk(jsdiff의 structured patch 모양, `PatchHunk`)를 줄 번호가 붙은 diff로 편다
 * (`docs/sdlc/conversation-events/` spec FR-37). **LCS를 돌리지 않는다** — hunk가 이미 diff다.
 *
 * - 줄 번호는 `oldStart`·`newStart`에서 시작해 문맥(` `)은 둘 다, 지운 줄(`-`)은 옛 번호만,
 *   더한 줄(`+`)은 새 번호만 하나씩 센다.
 * - 부호가 아닌 줄(`\ No newline at end of file` 등)은 줄이 아니다 — 번호를 밀지 않게 건너뛴다.
 *   빈 문자열은 끝 공백을 걷힌 빈 문맥 줄로 읽는다.
 * - `gapBefore` — 첫 hunk는 `oldStart − 1`, 그다음은 `oldStart − (앞 oldStart + 앞 oldLines)`.
 *   음수(새 파일의 `-0,0`, 순서가 어긋난 hunk)는 0이다.
 * - 줄이 하나도 없는 hunk는 빠진다. 간격은 **보인** hunk의 끝부터 잰다 — 빠진 hunk가 덮던 줄도
 *   화면에 없으므로 구분선이 그 줄까지 세야 한다.
 *
 * 어댑터가 상한으로 잘라 둔 hunk는 머리만 믿을 수 있다(`EditFileDetail.hunksTruncated`) — 남은
 * 줄의 번호는 머리에서 세므로 맞다.
 */
export function hunksFromPatch(hunks: readonly PatchHunk[]): DiffHunk[] {
  const out: DiffHunk[] = []
  let previousEnd: number | null = null
  for (const hunk of hunks) {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    const lines: DiffLine[] = []
    for (const raw of hunk.lines) {
      const sign = raw === '' ? ' ' : raw[0]
      const text = raw.slice(1)
      if (sign === ' ') lines.push({ sign: ' ', text, oldNo: oldNo++, newNo: newNo++ })
      else if (sign === '-') lines.push({ sign: '-', text, oldNo: oldNo++ })
      else if (sign === '+') lines.push({ sign: '+', text, newNo: newNo++ })
    }
    if (lines.length === 0) continue
    const gap = previousEnd === null ? hunk.oldStart - 1 : hunk.oldStart - previousEnd
    previousEnd = hunk.oldStart + hunk.oldLines
    out.push({ lines, oldStart: hunk.oldStart, newStart: hunk.newStart, gapBefore: Math.max(0, gap) })
  }
  return out
}
