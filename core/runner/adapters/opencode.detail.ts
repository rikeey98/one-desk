/**
 * opencode의 `state.metadata`와 오류 문구를 one-desk의 detail·공지로 접는다
 * (`docs/sdlc/conversation-events/` spec FR-24·26). 어댑터 파일이 이미 길어 떼어 둔 순수 함수들이다 —
 * **opencode 방언은 이 파일과 `opencode.ts` 밖으로 나가지 않는다**(NFR-2).
 *
 * claude와 달리 **detail은 도구 이름으로 가른다**(FR-24) — opencode는 같은 줄에 이름(`part.tool`)이 있다.
 *
 * **값의 타입이 기대와 다르면 그 detail을 통째로 싣지 않는다.** 반쯤 맞는 detail은 거짓말을 한다.
 * 파싱 실패로 run을 죽이지도 않는다 — detail이 없을 뿐 요약과 출력은 그대로 남는다.
 */

import { isCount, type NoticeKind, type PatchHunk, type ToolDetail } from '@shared/events'
import { capEditFiles, type EditFileInput } from './common'

/** 공지 이벤트의 payload. 어댑터가 runId·at·messageId를 얹는다 */
export interface OpencodeNotice {
  kind: NoticeKind
  text: string
  toolUseId?: string
}

/** 타입이 어긋났다는 표식. null(=없다)과 가른다 */
const BAD = Symbol('bad')
type Bad = typeof BAD

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * 선택 필드의 개수(음이 아닌 정수 — 렌더러와 같은 판정, `isCount`). 없으면(undefined·null) null,
 * 개수가 아니면 BAD. 어댑터만 느슨하면 로그에 실린 detail이 화면에서 통째로 사라진다(리뷰 반영).
 */
function optCount(value: unknown): number | null | Bad {
  if (value === undefined || value === null) return null
  return isCount(value) ? value : BAD
}

/** 선택 필드의 문자열. 없으면 null, 문자열이 아니면 BAD */
function optStr(value: unknown): string | null | Bad {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : BAD
}

// ── unified diff → hunk ──────────────────────────────────────────────────────

/** `@@ -a,b +c,d @@` — 개수는 생략될 수 있고(그러면 1줄), 머리 뒤에 함수 문맥이 붙을 수 있다 */
const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * unified diff(`createTwoFilesPatch`의 출력)를 jsdiff hunk 모양으로 편다. opencode 전용 방언이라
 * opencode 쪽에 둔다 — claude는 이미 hunk 배열(`structuredPatch`)을 준다.
 *
 * - `Index:`·`===`·`---`·`+++` 같은 머리 줄은 hunk **밖에서만** 건너뛴다. hunk의 끝은 머리가 말한
 *   **줄 수로** 안다 — "-- 주석"을 지운 줄은 `--- 주석`이 되므로, 줄의 모양으로 머리를 가르면 본문이
 *   사라진다.
 * - `\ No newline at end of file` 줄은 뺀다(줄 수에 들지 않는다).
 * - hunk 안의 빈 줄은 빈 문맥 줄(`' '`)이다 — 끝 공백을 걷는 도구를 거치면 문맥 줄이 `''`가 된다.
 * - **모양이 깨지면 빈 배열이다** — 머리가 말한 줄 수보다 먼저 끝나거나, hunk 안에 부호가 없는 줄이
 *   있으면. 반쯤 읽은 hunk는 줄 번호를 틀리게 단다.
 */
export function parseUnifiedDiff(patch: unknown): PatchHunk[] {
  if (typeof patch !== 'string') return []
  const hunks: PatchHunk[] = []
  let current: PatchHunk | null = null
  let oldLeft = 0
  let newLeft = 0

  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (current) {
      if (line.startsWith('\\')) continue
      const sign = line === '' ? ' ' : line[0]
      if (sign === ' ') {
        oldLeft -= 1
        newLeft -= 1
      } else if (sign === '-') {
        oldLeft -= 1
      } else if (sign === '+') {
        newLeft -= 1
      } else {
        return []
      }
      if (oldLeft < 0 || newLeft < 0) return []
      current.lines.push(line === '' ? ' ' : line)
      if (oldLeft === 0 && newLeft === 0) {
        hunks.push(current)
        current = null
      }
      continue
    }

    const head = HUNK_HEAD.exec(line)
    if (!head) continue // hunk 밖의 머리 줄·No newline·빈 줄
    const oldLines = head[2] === undefined ? 1 : Number(head[2])
    const newLines = head[4] === undefined ? 1 : Number(head[4])
    const hunk: PatchHunk = {
      oldStart: Number(head[1]), oldLines, newStart: Number(head[3]), newLines, lines: []
    }
    if (oldLines === 0 && newLines === 0) {
      hunks.push(hunk)
    } else {
      current = hunk
      oldLeft = oldLines
      newLeft = newLines
    }
  }

  // 머리가 말한 줄 수를 다 채우지 못하고 끝났다
  return current ? [] : hunks
}

// ── state.metadata → detail (FR-24) ──────────────────────────────────────────

function shell(exitCode: number | null, interrupted: boolean): ToolDetail {
  // 시간 초과는 필드로 오지 않는다 — `<shell_metadata>` 꼬리로 출력에 글자로 남을 뿐이다(spec §7 우려 14)
  return { kind: 'shell', exitCode, interrupted, timedOut: false }
}

function search(count: unknown, unit: 'matches' | 'files', truncated: unknown): ToolDetail | undefined {
  return isCount(count) ? { kind: 'search', count, unit, truncated: truncated === true } : undefined
}

function inputPath(state: Record<string, unknown>): string | null {
  return str(record(state['input'])?.['filePath'])
}

/** 편집 detail 하나. 파일마다 상한(capEditFiles)을 씌운다 */
function edit(files: EditFileInput[]): ToolDetail {
  return { kind: 'edit', files: capEditFiles(files) }
}

/**
 * edit — 파일 하나. **이전 내용은 없다**: 1.18.30의 `filediff`에는 `patch`만 있다(spec §2-3).
 *
 * **hunk 줄의 본문은 파일 그대로가 아니다** — 1.18.30은 `patch`·`metadata.diff`를 화면용으로 다듬어
 * 보낸다(`trimDiff`: 문맥·추가·삭제 줄 전체에서 가장 짧은 앞 공백만큼을 걷는다). 줄 번호는 맞지만 깊게
 * 들여쓴 코드는 왼쪽으로 당겨져 있다. 걷은 폭은 어디에도 없어 되돌릴 수 없다 — apply_patch의 `patch`도
 * 같다. diff 뷰어가 이 hunk를 원본 재료로 쓰려면 따로 다뤄야 한다(spec "리뷰가 남긴 과제").
 */
function editDetail(meta: Record<string, unknown>, state: Record<string, unknown>): ToolDetail | undefined {
  const filediff = meta['filediff'] === undefined ? {} : record(meta['filediff'])
  if (!filediff) return undefined
  const file = optStr(filediff['file'])
  const added = optCount(filediff['additions'])
  const removed = optCount(filediff['deletions'])
  if (file === BAD || added === BAD || removed === BAD) return undefined
  const path = str(file) ?? inputPath(state)
  if (path === null) return undefined
  return edit([{
    path,
    operation: 'edit',
    hunks: parseUnifiedDiff(filediff['patch'] ?? meta['diff']),
    added,
    removed,
    before: null,
    beforeMissing: 'unavailable'
  }])
}

/** write — hunk가 없다. `exists`가 false일 때만 새 파일이다 */
function writeDetail(meta: Record<string, unknown>, state: Record<string, unknown>): ToolDetail | undefined {
  const filepath = optStr(meta['filepath'])
  if (filepath === BAD) return undefined
  const path = str(filepath) ?? inputPath(state)
  if (path === null) return undefined
  const create = meta['exists'] === false
  return edit([{
    path,
    operation: create ? 'create' : 'overwrite',
    hunks: [],
    added: null,
    removed: null,
    before: null,
    beforeMissing: create ? null : 'unavailable'
  }])
}

const PATCH_OPERATIONS: Record<string, EditFileInput['operation']> = { add: 'create', delete: 'delete' }

/**
 * apply_patch — `files[]`마다 파일 하나. 1.18.30 바이너리의 도구 구현이 만드는 모양이다:
 * `{filePath, relativePath, type: 'add'|'update'|'move'|'delete', patch, additions, deletions, movePath?}`.
 * **파일별 diff는 `patch` 키다**(`patch:d.diff`) — spec §2-3이 UI 데모 값에서 추정한 `diff` 키는 없다
 * (리뷰 반영 2026-09-27: `diff`만 읽던 동안은 실제 run의 hunk가 늘 비었다). 옛 모양을 위해 `diff`로
 * 되돌아간다. 옮긴 파일(`move`)은 지금 있는 자리(`movePath`)의 편집이다 — CLI의 `relativePath`도 그렇다.
 *
 * 배열이 아니거나, 항목 하나라도 모양이 다르면 — **diff 글이 없는 것 포함** — detail이 없다. 경로와
 * 수만 있고 줄이 없는 "+1 −1"은 반쯤 맞는 detail이다.
 */
function patchDetail(meta: Record<string, unknown>): ToolDetail | undefined {
  const list = meta['files']
  if (!Array.isArray(list) || list.length === 0) return undefined
  const files: EditFileInput[] = []
  for (const item of list) {
    const f = record(item)
    if (!f) return undefined
    const path = str(f['movePath']) ?? str(f['filePath']) ?? str(f['relativePath'])
    const added = optCount(f['additions'])
    const removed = optCount(f['deletions'])
    const patch = f['patch'] ?? f['diff']
    if (path === null || added === BAD || removed === BAD || typeof patch !== 'string') return undefined
    // Object.hasOwn — `constructor` 같은 값이 프로토타입의 것을 집으면 안 된다
    const type = f['type']
    const operation = typeof type === 'string' && Object.hasOwn(PATCH_OPERATIONS, type)
      ? PATCH_OPERATIONS[type]!
      : 'edit'
    files.push({
      path,
      operation,
      hunks: parseUnifiedDiff(patch),
      added,
      removed,
      before: null,
      beforeMissing: operation === 'create' ? null : 'unavailable'
    })
  }
  return edit(files)
}

/** task — 하위 세션. opencode `run`은 하위 세션의 part를 내보내지 않으므로 도구 수는 모른다(E4) */
function taskDetail(meta: Record<string, unknown>, state: Record<string, unknown>): ToolDetail | undefined {
  const sessionId = optStr(meta['sessionId'])
  const model = meta['model'] === undefined || meta['model'] === null ? {} : record(meta['model'])
  if (sessionId === BAD || !model) return undefined
  const modelId = optStr(model['modelID'])
  if (modelId === BAD) return undefined
  const time = record(state['time'])
  const start = num(time?.['start'])
  const end = num(time?.['end'])
  // 잰 시간이라 소수는 반올림한다 — 렌더러는 시간도 음이 아닌 정수로 읽는다(isCount)
  const durationMs = start !== null && end !== null && end >= start ? Math.round(end - start) : null
  return { kind: 'subagent', sessionId: str(sessionId), model: str(modelId), toolCount: null, durationMs }
}

/**
 * 도구 결과의 구조화된 세부. `state`는 `part.state` 그대로다.
 *
 * - `completed`: 도구마다 FR-24 표의 행.
 * - `error`: 셸만 싣는다 — 종료 코드가 수이거나 중단된 셸(소스 processor:599 — `interrupted`)이다.
 *   다른 도구의 실패에는 세부가 없다(`output`이 오류 글이다).
 * - `metadata`가 없으면 아무것도 싣지 않는다 — 새 파일인지 덮어쓰기인지조차 모른다.
 */
export function opencodeToolDetail(tool: string, state: Record<string, unknown>): ToolDetail | undefined {
  const meta = record(state['metadata'])
  if (!meta) return undefined
  const isShell = tool === 'bash' || tool === 'shell'

  if (state['status'] === 'error') {
    if (!isShell) return undefined
    const exit = num(meta['exit'])
    const interrupted = meta['interrupted'] === true
    return exit !== null || interrupted ? shell(exit, interrupted) : undefined
  }
  if (state['status'] !== 'completed') return undefined

  if (isShell) return shell(num(meta['exit']), meta['interrupted'] === true)
  switch (tool) {
    case 'grep': return search(meta['matches'], 'matches', meta['truncated'])
    case 'glob': return search(meta['count'], 'files', meta['truncated'])
    case 'edit': return editDetail(meta, state)
    case 'write': return writeDetail(meta, state)
    case 'apply_patch':
    case 'patch': return patchDetail(meta)
    case 'task': return taskDetail(meta, state)
    default: return undefined
  }
}

// ── 권한 거부 → 공지 (FR-26) ─────────────────────────────────────────────────

/**
 * 권한 거부의 오류 문구(1.18.30 바이너리). **CLI의 영어 문장에 기대는 판정이다** — 버전이 바뀌어
 * 문구가 달라지면 공지만 조용히 빠진다(도구 실패 줄은 그대로 남는다, spec §7 우려 13). 그래서
 * 상수로 드러내고 테스트가 픽스처의 원문으로 고정한다. 2.x는 버전 게이트가 먼저 막는다.
 */
/** `ask`로 남은 권한의 자동 거부 — 헤드리스에는 답할 사람이 없다 */
export const OPENCODE_DENIED_BY_ASK = 'The user rejected permission to use this specific tool call'
/** `deny` 규칙에 걸린 호출 */
export const OPENCODE_DENIED_BY_RULE = 'The user has specified a rule which prevents you from using this specific tool call'

/**
 * 실패한 도구의 `state.error`가 권한 거부면 공지. **문구는 여기서 만들고 화면은 그대로 그린다.**
 * 시작으로만 가른다 — 문장 가운데 섞인 것(명령어의 인자 등)은 거부가 아니다.
 */
export function opencodeDeniedNotice(tool: string, error: unknown, toolUseId: string): OpencodeNotice | null {
  if (typeof error !== 'string' || tool === '') return null
  let text: string
  if (error.startsWith(OPENCODE_DENIED_BY_ASK)) {
    text = `권한 때문에 막힘: ${tool} (묻는 권한은 헤드리스에서 자동으로 거부됩니다)`
  } else if (error.startsWith(OPENCODE_DENIED_BY_RULE)) {
    text = `권한 때문에 막힘: ${tool}`
  } else {
    return null
  }
  return toolUseId ? { kind: 'permission_denied', text, toolUseId } : { kind: 'permission_denied', text }
}
