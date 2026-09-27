/**
 * 편집 블록의 줄 diff (`docs/sdlc/conversation-timeline/` spec FR-7).
 *
 * **입력만으로 만든다** — 렌더러는 파일에 닿지 않는다(경계 2). `old_string`/`new_string`
 * 앞뒤의 문맥이 없어 줄 번호는 없다. 규칙을 컴포넌트에서 떼어 두어 경계값(상한·자르기)을
 * 렌더링 없이 고정한다 — `usage.ts`와 같은 자리다.
 */

export interface DiffLine {
  sign: '+' | '-' | ' '
  text: string
}

export interface DiffHunk {
  lines: DiffLine[]
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
    kept.push(hunk.lines.length <= room ? hunk : { lines: hunk.lines.slice(0, room) })
    room -= hunk.lines.length
  }
  return { hunks: kept, truncated: total - max }
}
