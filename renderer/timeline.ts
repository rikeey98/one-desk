import {
  isCount, type EditFileDetail, type NoticeKind, type PatchHunk, type RunEvent, type ToolDetail as ResultDetail
} from '@shared/events'
import type { AgentKind, Run } from '@shared/models'
import { AGENT_LABELS } from './agents'
import { diffStats, hunksFromPatch, lineDiff, truncateHunks, type DiffHunk } from './diff'
import { effortFieldOf } from './effort'
import { PERMISSION_LABELS } from './permission'

/**
 * 턴 하나의 이벤트를 화면 블록으로 바꾸는 규칙 (`docs/sdlc/conversation-timeline/` spec
 * FR-1~FR-11). 어댑터가 버리던 것 — 원문 출력·구조화된 세부·생각·하위 에이전트·공지 — 을 채우는
 * 규칙은 `docs/sdlc/conversation-events/` spec FR-35~42다(아래 주석의 `events FR-n`). **새 필드가
 * 없으면 전부 TL 규칙 그대로다** — 옛 로그의 턴은 그 기능 전과 같게 보인다.
 *
 * **순수 함수만 둔다.** 컴포넌트는 결과를 그리기만 한다 — `conversation.ts`·`usage.ts`처럼
 * 렌더링 없이 경계값을 고정할 수 있어야 한다. 규칙이 컴포넌트에 흩어지면 접힌 턴과 펼친
 * 턴이 같은 이벤트를 다르게 읽는다.
 *
 * **이벤트는 신뢰할 수 없는 입력이다** — `input`은 agent가 만든 아무 JSON이고, 로그는 다른
 * 버전이 쓴 것일 수 있다. 모양을 확인하지 않고 꺼내 쓰는 곳이 없어야 한다(`recordOf`·
 * `stringAt`·`readDetail`).
 */

export type ToolCategory =
  'read' | 'edit' | 'shell' | 'search' | 'web' | 'todo' | 'subagent' | 'mcp' | 'other'

/**
 * 도구 이름의 한국어 라벨과 종류 (FR-4). **키는 소문자다** — claude(`Read`)와
 * opencode(`read`)가 한 칸을 쓴다.
 *
 * 표에 없는 이름은 버리지 않는다(`toolLabelOf`). 할 일 도구도 숨기지 않는다 — one-desk에는
 * 할 일 패널이 없어, 숨기면 agent가 계획을 세운 흔적이 어디에도 남지 않는다.
 */
export const TOOL_LABELS: Record<string, { label: string; category: ToolCategory }> = {
  read: { label: '읽기', category: 'read' },
  edit: { label: '편집', category: 'edit' },
  multiedit: { label: '편집', category: 'edit' },
  write: { label: '작성', category: 'edit' },
  notebookedit: { label: '노트북 편집', category: 'edit' },
  patch: { label: '패치', category: 'edit' },
  // opencode의 여러 파일 패치 (events FR-42) — 빠지면 파일을 쓰는데도 편집 블록에 서지 않는다
  apply_patch: { label: '패치', category: 'edit' },
  bash: { label: '셸', category: 'shell' },
  // Windows의 claude 셸 (events FR-42)
  powershell: { label: '셸', category: 'shell' },
  bashoutput: { label: '셸', category: 'shell' },
  killshell: { label: '셸', category: 'shell' },
  killbash: { label: '셸', category: 'shell' },
  grep: { label: 'Grep', category: 'search' },
  glob: { label: 'Glob', category: 'search' },
  ls: { label: '목록', category: 'search' },
  list: { label: '목록', category: 'search' },
  webfetch: { label: '웹 가져오기', category: 'web' },
  websearch: { label: '웹 검색', category: 'web' },
  todowrite: { label: '할 일', category: 'todo' },
  todoread: { label: '할 일', category: 'todo' },
  taskcreate: { label: '할 일', category: 'todo' },
  taskupdate: { label: '할 일', category: 'todo' },
  taskget: { label: '할 일', category: 'todo' },
  tasklist: { label: '할 일', category: 'todo' },
  task: { label: '하위 에이전트', category: 'subagent' },
  agent: { label: '하위 에이전트', category: 'subagent' },
  skill: { label: '스킬', category: 'other' }
}

/** `mcp__<서버>__<도구>`. 서버 이름 안의 밑줄 하나는 구분자가 아니다(`claude_ai_Gmail`). */
const MCP_NAME = /^mcp__(.+?)__(.+)$/i

/** 도구 라벨 한 조각 — 화면이 종류를 보고 모양을 고른다(mcp 이름은 모노). */
export interface ToolLabel { label: string; category: ToolCategory }

export function toolLabelOf(name: string): ToolLabel {
  // Object.hasOwn — `constructor` 같은 이름이 프로토타입의 것을 집으면 안 된다.
  const key = name.toLowerCase()
  if (Object.hasOwn(TOOL_LABELS, key)) return TOOL_LABELS[key]!
  // mcp는 도구 이름만이다 — 백틱도 "호출"도 붙이지 않는다(spec §8의 5, 결정 2026-09-27). 이름을
  // 모노로 그리는 것은 화면의 몫이다: 라벨에 백틱을 담으면 렌더되지 않은 마크다운처럼 글자로 보였고,
  // 묶음 라벨이 "1 `list_issues` 호출 사용됨"으로 어색하게 읽혔다.
  const mcp = MCP_NAME.exec(name)
  if (mcp) return { label: mcp[2]!, category: 'mcp' }
  // 어댑터가 이름을 못 읽은 줄은 빈 문자열이다 — 빈 라벨은 묶음 라벨을 ", 읽기"로 만든다.
  return { label: name || '도구', category: 'other' }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 비어 있지 않은 문자열이면 그 값. 문자열이 아니면 쓰지 않는다 — 객체를 늘어놓으면 읽히지 않는다. */
function stringAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 드라이브 글자의 대소문자와 구분자를 같게 본다. 길이는 바꾸지 않는다 — 원문을 같은 자리에서 자른다. */
function comparablePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return /^[A-Za-z]:/.test(slashed) ? slashed[0]!.toLowerCase() + slashed.slice(1) : slashed
}

/**
 * 작업 디렉토리 기준 상대 경로 (FR-5). `cwd`로 시작하면 그 뒤만, 아니면 전체다.
 * **경로 경계에서만 자른다** — `/repo`가 `/repo2/a.ts`를 잘라 `2/a.ts`로 만들면 안 된다.
 * 남는 부분은 원문의 구분자 그대로다(Windows 경로는 `src\a.ts`로 보인다).
 */
function relativePath(path: string, cwd: string): string {
  const base = comparablePath(cwd).replace(/\/+$/, '')
  if (base === '') return path
  const target = comparablePath(path)
  if (!target.startsWith(`${base}/`)) return path
  const rest = path.slice(base.length + 1)
  return rest === '' ? path : rest
}

const PATH_KEYS = ['file_path', 'filePath', 'notebook_path'] as const

function pathOf(record: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const value = stringAt(record, key)
    if (value !== null) return value
  }
  return null
}

/** 부제와 그것이 파일 경로인가 — 경로는 화면이 모노로 그린다(spec §8의 7). */
function subtitleOf(input: unknown, cwd: string): { text: string; path: boolean } {
  const record = recordOf(input)
  if (!record) return { text: '', path: false }

  const todos = record['todos']
  if (Array.isArray(todos)) {
    const completed = todos.filter((todo) => recordOf(todo)?.['status'] === 'completed').length
    return { text: `${todos.length}개 중 ${completed}개 완료`, path: false }
  }

  const command = stringAt(record, 'command')
  if (command !== null) return { text: command.trim().split(/\r?\n/)[0] ?? '', path: false }

  const path = pathOf(record)
  if (path !== null) return { text: relativePath(path, cwd), path: true }

  for (const key of ['pattern', 'url', 'query', 'description', 'subject']) {
    const value = stringAt(record, key)
    if (value !== null) return { text: value, path: false }
  }
  return { text: '', path: false }
}

/**
 * 도구 한 줄의 부제 (FR-5) — `input`에서 처음 찾는 문자열이다.
 * `command`(첫 줄) → 파일 경로(상대) → `pattern` → `url` → `query` → `description` →
 * `subject`. 할 일 목록은 "N개 중 M개 완료"다. 없으면 빈 문자열이다.
 */
export function toolSubtitleOf(input: unknown, cwd: string): string {
  return subtitleOf(input, cwd).text
}

export interface ToolItem {
  /** toolUseId. 비어 있으면 `seq:<n>` */
  id: string
  name: string
  label: string
  category: ToolCategory
  subtitle: string
  /**
   * 부제가 파일 경로인가 — 화면이 경로만 모노로 그린다(spec §8의 7, 결정 2026-09-27). 한국어 Windows의
   * UI 글꼴은 `\`를 `₩`로 그려 `src₩auth.ts`로 보였다. 명령·검색어·설명은 UI 글꼴 그대로다.
   */
  subtitlePath: boolean
  input: unknown
  state: 'running' | 'done' | 'failed' | 'unknown'
  /**
   * 결과 — 원문의 **끝부분**(`tool_result.output`)이 있으면 그것, 없으면 200자 요약(옛 로그·읽기
   * 도구·빈 결과). 결과가 없으면 null (events FR-36)
   */
  output: string | null
  /** `output`이 어디서 왔나. 'summary'면 TL FR-16의 "출력 앞부분만 기록됩니다" 규칙을 쓴다 */
  outputSource: 'full' | 'summary' | null
  /** 원문에서 버린 **앞부분** 글자 수. 0이면 전부다 */
  outputTruncated: number
  /** 셸의 종료 코드. 모르면 null — claude는 실패할 때만 알려준다 */
  exitCode: number | null
  /** 셸이 끝까지 돌지 못했다. 시간 초과가 중단보다 먼저다 */
  stopped: 'timed_out' | 'interrupted' | null
  /** 검색 결과 개수 — 세부가 있으면 그것, 없으면 search 종류의 `Found N`(파일 수) */
  matches: number | null
  /** `matches`가 센 것. `matches`가 null이면 null */
  matchUnit: 'files' | 'matches' | 'lines' | null
  /** 도구가 결과를 잘랐다 — 더 있다 */
  matchesTruncated: boolean
  /** 같은 id의 권한 거부 공지가 턴 안에 있다. 거부된 호출은 실패로 끝난다 */
  denied: boolean
  /** 이 호출을 낳은 하위 에이전트 호출(claude). 메인 스레드면 null */
  parentToolUseId: string | null
  /** 하위 에이전트 호출의 결과 세부. 없으면 null */
  subagent: SubagentInfo | null
}

/** 하위 에이전트 호출이 끝나며 알려 준 것 (events FR-36). 모르는 값은 null이다 */
export interface SubagentInfo {
  /** opencode의 하위 세션 id */
  sessionId: string | null
  model: string | null
  toolCount: number | null
  durationMs: number | null
}

export interface EditFile {
  path: string
  /** cwd 기준 상대 경로 */
  displayPath: string
  created: boolean
  added: number
  /**
   * 지운 줄 수. **모르면 null** — 옛 내용을 모르는 덮어쓰기(opencode write)의 diff는 입력으로 만든 "전부
   * 추가"라 거기서 세면 −0이 된다(리뷰 반영 2026-09-27). 화면은 null이면 −M을 적지 않는다.
   */
  removed: number | null
  hunks: DiffHunk[]
  /** 그리지 않은 나머지 줄 수 — 400줄 표시 상한과 어댑터가 버린 hunk 줄(`hunksTruncated`)의 합 */
  truncated: number
  /**
   * 이 파일을 고친 도구의 id(`ToolItem.id`), 나온 순서대로. 파일 줄의 열림은 자리 순번이 아니라
   * 이것에 매단다(FR-15 다듬음) — 앞 파일이 실패로 빠져 순번이 밀려도 열어 둔 줄이 닫히거나
   * 남의 열림을 이어받지 않는다. 도구 하나가 파일 여럿을 고쳤으면(apply_patch) 두 번째 파일부터
   * `<id>#<순번>`이다 — 같은 키면 한 줄을 열 때 모두 함께 열린다.
   */
  ids: string[]
  /** hunk에 줄 번호가 있다 — 도구 결과의 세부로 만들었다 (events FR-37) */
  numbered: boolean
  /** 세부가 말한 연산. 세부가 없으면 null — 입력으로 만든 TL diff다 */
  operation: EditFileDetail['operation'] | null
  /** 덮어쓰기 전 파일 전체 — 덮어쓰기이고 CLI가 줬을 때만. 편집의 원본은 화면에 쓰지 않는다 */
  before: string | null
}

/** 공지 블록의 종류 — 해석하지 못한 원문 줄(TL), 어댑터의 공지 넷, 이 버전이 모르는 종류 */
export type NoticeBlockKind = 'raw' | NoticeKind | 'other'

export type TimelineBlock =
  | { kind: 'text'; key: string; text: string }
  /**
   * `label`은 한 줄 글자(`3 읽기, list_issues 사용됨`)이고 `labels`는 그 가운데 고유 라벨 조각이다 —
   * 화면이 mcp 이름만 모노로 그린다(spec §8의 5). 둘 다 `activityLabel`의 한 규칙에서 나온다.
   */
  | { kind: 'activity'; key: string; label: string; labels: ToolLabel[]; items: ToolItem[]; running: boolean }
  | { kind: 'edit'; key: string; files: EditFile[]; running: boolean }
  | { kind: 'tool-error'; key: string; item: ToolItem }
  | { kind: 'error'; key: string; message: string }
  /**
   * 원문 줄(`raw`)과 어댑터의 공지 (events FR-41). `text`는 화면에 그대로 나가는 한 줄이고, `lines`는
   * 원문 줄(raw만), `count`는 합친 이벤트 수(연속된 재시도·원문 줄)다.
   */
  | { kind: 'notice'; key: string; noticeKind: NoticeBlockKind; text: string; lines: string[]; count: number }
  /**
   * 생각 (events FR-40). `text`는 비어 있을 수 있다(claude는 대부분 서명만 보낸다 — §7-A).
   * `estimated`면 앞 이벤트부터 잰 추정이고, `truncated`는 버린 뒷부분 글자 수다.
   */
  | {
      kind: 'reasoning'; key: string; text: string
      durationMs: number | null; estimated: boolean; truncated: number
    }
  /**
   * 하위 에이전트 카드 (events FR-38). `blocks`는 그 호출이 낳은 이벤트를 같은 규칙으로 투영한
   * 것이고(중첩이면 카드 안의 카드), 셋은 카드 바로 안의 도구 수다(안의 카드는 하나로 센다).
   */
  | {
      kind: 'subagent'; key: string; item: ToolItem; blocks: TimelineBlock[]
      tools: number; failed: number; denied: number; running: boolean
    }

/** 접힌 턴의 활동 요약 (events FR-39) — 메인 스레드의 도구만 센다 */
export interface TurnSummary {
  tools: number
  /** 실패한 결과 중 권한 거부가 아닌 것 */
  failed: number
  /** 권한 거부 공지의 고유 호출 수(+ 호출 id 없는 공지 수) */
  denied: number
  /** 대화 압축 공지가 있었다 */
  compacted: boolean
}

export interface TurnProjection {
  blocks: TimelineBlock[]
  answer: { text: string; final: boolean } | null
  /** 넷이 전부 0·거짓이면 null */
  summary: TurnSummary | null
  /** 메인 스레드의 결과 없는 마지막 도구. 도는 턴에서만 */
  current: ToolItem | null
  /** `current`가 하위 에이전트면 그 카드 안의 결과 없는 마지막 도구 */
  currentChild: ToolItem | null
  /** 도는 중이고 턴의 마지막 이벤트(스코프를 가리지 않는다)가 재시도 공지면 그 문구 */
  retrying: string | null
  /** 창 때문에 빠진 앞 이벤트 수 — 첫 이벤트의 seq다 */
  omitted: number
}

/**
 * claude Grep의 files_with_matches 출력 첫 줄 — `Found 7 files` / `Found 1 file`.
 * 이 장비의 실제 run 로그로 확인했다(2026-09-27, spec §6 우려 3). content 모드와 Glob,
 * opencode에는 이 줄이 없다 — 그때는 개수를 그리지 않는다. **센 것은 파일이다**
 * (events §7 우려 16) — 구조화된 세부가 없는 옛 로그의 개수는 파일 수로 읽는다.
 */
const FOUND_N = /^Found (\d+) /

function matchesOf(category: ToolCategory, summary: string | null): number | null {
  if (category !== 'search' || summary === null) return null
  const found = FOUND_N.exec(summary)
  return found ? Number(found[1]) : null
}

// ── 이벤트의 새 필드 읽기 (events FR-36) ──────────────────────────────────────────
//
// 어댑터가 만든 모양이지만 로그에서 되살린 것은 다른 버전이 썼을 수 있다. **모양이 어긋나면
// 통째로 버린다** — 반쯤 맞는 세부는 거짓말을 한다(어댑터 FR-14와 같은 원칙). 버린 세부는 TL
// 규칙(요약·입력으로 만든 diff)으로 떨어질 뿐이라 화면이 깨지지 않는다.

// 개수·줄 번호·도구 수·시간은 음이 아닌 정수다 — 어댑터가 싣기 전에 보는 것과 같은 판정이다(shared의
// `isCount`, 리뷰 반영 2026-09-27). 두 자리가 다른 기준이면 어댑터를 통과한 detail이 여기서 말없이 사라진다.

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 비어 있지 않은 문자열이면 그 값. id·출처는 빈 문자열을 "없음"으로 읽는다 */
function idOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

const SEARCH_UNITS = ['files', 'matches', 'lines'] as const
const EDIT_OPERATIONS = ['edit', 'create', 'overwrite', 'delete'] as const
const BEFORE_MISSING = ['unavailable', 'too_large'] as const
const NOTICE_KINDS: readonly NoticeKind[] = ['compact', 'retry', 'permission_denied', 'model_fallback']

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function readHunk(value: unknown): PatchHunk | null {
  const hunk = recordOf(value)
  if (!hunk) return null
  const { oldStart, oldLines, newStart, newLines, lines } = hunk
  if (!isCount(oldStart) || !isCount(oldLines) || !isCount(newStart) || !isCount(newLines)) return null
  if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string')) return null
  return { oldStart, oldLines, newStart, newLines, lines: lines as string[] }
}

function readEditFile(value: unknown): EditFileDetail | null {
  const file = recordOf(value)
  if (!file) return null
  const { path, operation, hunks, hunksTruncated, added, removed, before, beforeMissing } = file
  if (typeof path !== 'string' || !oneOf(EDIT_OPERATIONS, operation)) return null
  if (!isCount(hunksTruncated) || !Array.isArray(hunks)) return null
  if (!(added === null || isCount(added)) || !(removed === null || isCount(removed))) return null
  if (!(before === null || typeof before === 'string')) return null
  if (!(beforeMissing === null || oneOf(BEFORE_MISSING, beforeMissing))) return null
  const read = hunks.map(readHunk)
  if (read.some((hunk) => hunk === null)) return null
  return {
    path, operation, hunks: read as PatchHunk[], hunksTruncated, added, removed, before, beforeMissing
  }
}

function readDetail(value: unknown): ResultDetail | null {
  const detail = recordOf(value)
  if (!detail) return null
  switch (detail['kind']) {
    case 'shell': {
      const { exitCode, interrupted, timedOut } = detail
      if (!(exitCode === null || isFiniteNumber(exitCode))) return null
      if (typeof interrupted !== 'boolean' || typeof timedOut !== 'boolean') return null
      return { kind: 'shell', exitCode, interrupted, timedOut }
    }
    case 'search': {
      const { count, unit, truncated } = detail
      if (!isCount(count) || !oneOf(SEARCH_UNITS, unit) || typeof truncated !== 'boolean') return null
      return { kind: 'search', count, unit, truncated }
    }
    case 'edit': {
      const files = detail['files']
      if (!Array.isArray(files)) return null
      const read = files.map(readEditFile)
      if (read.some((file) => file === null)) return null
      return { kind: 'edit', files: read as EditFileDetail[] }
    }
    case 'subagent': {
      const { sessionId, model, toolCount, durationMs } = detail
      if (!(sessionId === null || typeof sessionId === 'string')) return null
      if (!(model === null || typeof model === 'string')) return null
      if (!(toolCount === null || isCount(toolCount)) || !(durationMs === null || isCount(durationMs))) return null
      return { kind: 'subagent', sessionId, model, toolCount, durationMs }
    }
    default:
      return null
  }
}

/** 결과 한 줄에서 투영이 쓰는 것. 첫 훑기에서 id별로 모은다(FR-3) */
interface ResultInfo {
  ok: boolean
  summary: string | null
  /** 원문 끝부분. 없거나 비었으면 null */
  output: string | null
  outputTruncated: number
  detail: ResultDetail | null
}

function resultInfoOf(event: Extract<RunEvent, { type: 'tool_result' }>): ResultInfo {
  const output = typeof event.output === 'string' && event.output !== '' ? event.output : null
  return {
    ok: event.ok === true,
    summary: typeof event.summary === 'string' ? event.summary : null,
    output,
    outputTruncated: output !== null && isCount(event.outputTruncated) ? event.outputTruncated : 0,
    detail: readDetail(event.detail)
  }
}

/** 이 이벤트를 낳은 하위 에이전트 호출 — 출처 필드가 있는 종류에서만 */
function parentIdOf(event: RunEvent): string | null {
  return 'parentToolUseId' in event ? idOf(event.parentToolUseId) : null
}

type ToolUseEvent = Extract<RunEvent, { type: 'tool_use' }>
type NoticeEvent = Extract<RunEvent, { type: 'notice' }>

/** 편집 한 번이 남긴 것. 같은 파일끼리 합친 뒤 `EditFile`로 마감한다. */
interface EditOp {
  /** 이 편집을 한 도구의 id (`ToolItem.id`). 도구 하나가 파일 여럿이면 둘째부터 `<id>#<순번>` */
  id: string
  /** 입력이나 세부에서 읽은 경로. 모르면 빈 문자열이다 */
  path: string
  /** 경로를 모를 때 파일 줄에 보일 이름 — 도구의 부제, 그것도 없으면 라벨 */
  fallback: string
  created: boolean
  hunks: DiffHunk[]
  numbered: boolean
  operation: EditFileDetail['operation'] | null
  before: string | null
  /** 자르기 전에 센 추가·삭제 줄 수. 지운 수를 모르면 null이다(`EditFile.removed`) */
  added: number
  removed: number | null
  /** 어댑터가 상한으로 버린 hunk 줄 수 */
  hidden: number
}

/**
 * 편집 계열 입력의 모양으로 diff를 만든다 (FR-7). 모양을 모르면 경로만 — 펼칠 것이 없다.
 * 도구 이름이 아니라 **입력 모양**을 본다: claude와 opencode가 키 이름만 다르다.
 */
function inputDiffOf(input: unknown): { path: string; created: boolean; hunks: DiffHunk[] } {
  const record = recordOf(input) ?? {}
  const path = pathOf(record) ?? ''

  const edits = record['edits']
  if (Array.isArray(edits)) {
    const hunks: DiffHunk[] = []
    for (const edit of edits) {
      const one = recordOf(edit)
      if (!one) continue
      const before = one['old_string'] ?? one['oldString']
      const after = one['new_string'] ?? one['newString']
      if (typeof before === 'string' && typeof after === 'string') hunks.push(lineDiff(before, after))
    }
    return { path, created: false, hunks }
  }

  const before = record['old_string'] ?? record['oldString']
  const after = record['new_string'] ?? record['newString']
  if (typeof before === 'string' && typeof after === 'string') {
    return { path, created: false, hunks: [lineDiff(before, after)] }
  }

  const content = record['content']
  if (typeof content === 'string') {
    return { path, created: true, hunks: [lineDiff('', content)] }
  }

  return { path, created: false, hunks: [] }
}

/** 새 파일의 전부 추가 diff에 새 줄 번호 1..n을 단다 — 새 파일의 줄 번호는 안다 (events FR-37) */
function numberAsNew(hunks: DiffHunk[]): DiffHunk[] {
  let next = 1
  return hunks
    .filter((hunk) => hunk.lines.length > 0)
    .map((hunk) => {
      const newStart = next
      return {
        lines: hunk.lines.map((line) => ({ ...line, newNo: next++ })),
        newStart,
        gapBefore: 0
      }
    })
}

/**
 * 편집 한 번의 파일들 (FR-7, events FR-37).
 *
 * 결과에 편집 세부가 있으면 **그 파일들로** 만든다 — hunk에서 번호 diff를 만들고 LCS를 돌리지
 * 않는다. 세부가 없거나 파일이 비었으면 입력으로 만든 번호 없는 diff다(TL 그대로).
 *
 * 세부의 hunk가 빈 파일은 입력으로 채운다 — 도구가 파일 하나만 고쳤을 때만(입력이 어느 파일의
 * 것인지 안다): 새 파일은 입력의 내용에 새 줄 번호를 달고, hunk 없는 덮어쓰기(opencode write)는
 * 입력 diff 그대로다(번호 없음 — 옛 내용을 모른다).
 */
function editOpsOf(item: ToolItem, input: unknown, detail: ResultDetail | null): EditOp[] {
  const fallback = item.subtitle || item.label
  const typed = inputDiffOf(input)

  if (detail?.kind !== 'edit' || detail.files.length === 0) {
    const { added, removed } = diffStats(typed.hunks)
    return [{
      id: item.id, path: typed.path, fallback, created: typed.created, hunks: typed.hunks,
      numbered: false, operation: null, before: null, added, removed, hidden: 0
    }]
  }

  const single = detail.files.length === 1
  return detail.files.map((file, index) => {
    let hunks = hunksFromPatch(file.hunks)
    let numbered = hunks.length > 0
    /** 입력으로 만든 전부 추가 diff가 덮어쓰기를 대신한다 — 지운 줄은 그 diff에 없다 */
    let blindOverwrite = false
    if (hunks.length === 0 && single) {
      if (file.operation === 'create' && typed.created) {
        hunks = numberAsNew(typed.hunks)
        numbered = hunks.length > 0
      } else if (file.operation === 'overwrite') {
        hunks = typed.hunks
        blindOverwrite = true
      }
    }
    // +N −M은 세부의 값이 먼저다 — 어댑터가 상한으로 자르기 전에 센 수다(events FR-12). 옛 내용을 모르는
    // 덮어쓰기에서는 지운 수를 세지 않는다 — 입력 diff에는 지운 줄이 없어 늘 0이다(리뷰 반영 2026-09-27).
    const counted = diffStats(hunks)
    return {
      id: index === 0 ? item.id : `${item.id}#${index}`,
      path: file.path,
      fallback,
      created: file.operation === 'create',
      hunks,
      numbered,
      operation: file.operation,
      before: file.operation === 'overwrite' ? file.before : null,
      added: file.added ?? counted.added,
      removed: file.removed ?? (blindOverwrite ? null : counted.removed),
      hidden: file.hunksTruncated
    }
  })
}

type NoticeDraft = Extract<TimelineBlock, { kind: 'notice' }>
type ReasoningBlock = Extract<TimelineBlock, { kind: 'reasoning' }>

/** 만드는 중인 블록. 묶음 라벨·편집 파일·카드 안은 끝에서 마감한다. */
type Draft =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'activity'; key: string; items: ToolItem[] }
  | { kind: 'edit'; key: string; items: ToolItem[]; ops: EditOp[] }
  | { kind: 'tool-error'; key: string; item: ToolItem }
  | { kind: 'error'; key: string; message: string }
  | NoticeDraft
  | ReasoningBlock
  | { kind: 'subagent'; key: string; item: ToolItem; children: Draft[]; items: ToolItem[] }

/** 묶음 라벨 (FR-6) — 개수와 처음 나온 순서의 고유 라벨. 조각은 종류와 함께 준다(spec §8의 5). */
function activityLabel(items: ToolItem[]): { label: string; labels: ToolLabel[] } {
  const labels: ToolLabel[] = []
  for (const item of items) {
    if (!labels.some((seen) => seen.label === item.label)) {
      labels.push({ label: item.label, category: item.category })
    }
  }
  return {
    label: `${items.length} ${labels.map((piece) => piece.label).join(', ')} 사용됨`,
    labels
  }
}

function editFiles(ops: EditOp[], cwd: string): EditFile[] {
  // 같은 파일은 한 줄로 합친다. 경로를 모르는 편집은 서로 다른 것이라 합치지 않는다.
  const merged: (EditOp & { ids: string[] })[] = []
  const byPath = new Map<string, EditOp & { ids: string[] }>()
  for (const op of ops) {
    const same = op.path === '' ? undefined : byPath.get(op.path)
    if (same) {
      // 뒤 편집의 첫 hunk는 간격을 세지 않는다(리뷰 반영 2026-09-27) — 그 gapBefore는 "파일 맨 위부터"라
      // 앞 hunk와의 간격이 아니고, 번호도 앞 편집이 반영된 파일 기준이라 간격을 알 수 없다. 셈 없는
      // hunk 경계(가는 선)로 선다. 같은 편집 안의 hunk 사이는 그대로다.
      const [first, ...others] = op.hunks
      if (first) {
        const boundary: DiffHunk = { ...first }
        delete boundary.gapBefore
        same.hunks.push(boundary, ...others)
      }
      same.created ||= op.created
      // 번호가 있는 hunk가 하나라도 있으면 번호 칸을 그린다 — 번호 없는 줄은 칸이 빈다
      same.numbered ||= op.numbered
      same.before ??= op.before
      same.added += op.added
      // 한쪽이라도 모르면 합도 모른다
      same.removed = same.removed === null || op.removed === null ? null : same.removed + op.removed
      same.hidden += op.hidden
      same.ids.push(op.id)
      continue
    }
    const copy = { ...op, hunks: [...op.hunks], ids: [op.id] }
    merged.push(copy)
    if (op.path !== '') byPath.set(op.path, copy)
  }

  return merged.map((op) => {
    // +N −M은 자르기 전에 센 것이다(op.added·removed) — 잘린 수는 거짓이다.
    const { hunks, truncated } = truncateHunks(op.hunks)
    return {
      path: op.path,
      displayPath: op.path === '' ? op.fallback : relativePath(op.path, cwd),
      created: op.created,
      added: op.added,
      removed: op.removed,
      hunks,
      truncated: truncated + op.hidden,
      ids: op.ids,
      numbered: op.numbered,
      operation: op.operation,
      before: op.before
    }
  })
}

/** 블록 안에 도는 도구가 있나 — 카드의 running (events FR-38) */
function blockRunning(block: TimelineBlock): boolean {
  switch (block.kind) {
    case 'activity':
    case 'edit':
    case 'subagent':
      return block.running
    case 'tool-error':
      return block.item.state === 'running'
    default:
      return false
  }
}

/** 한 스코프의 도구 수 — 실패는 권한 거부가 아닌 것만 센다 (events FR-39) */
function tally(items: readonly ToolItem[]): { tools: number; failed: number; denied: number } {
  return {
    tools: items.length,
    failed: items.filter((item) => item.state === 'failed' && !item.denied).length,
    denied: items.filter((item) => item.denied).length
  }
}

function finish(draft: Draft, cwd: string): TimelineBlock {
  switch (draft.kind) {
    case 'activity':
      return {
        kind: 'activity', key: draft.key, ...activityLabel(draft.items),
        items: draft.items, running: draft.items.some((item) => item.state === 'running')
      }
    case 'edit':
      return {
        kind: 'edit', key: draft.key, files: editFiles(draft.ops, cwd),
        running: draft.items.some((item) => item.state === 'running')
      }
    case 'notice':
      return draft.noticeKind === 'raw'
        ? { ...draft, text: `해석하지 못한 출력 ${draft.lines.length}줄`, count: draft.lines.length }
        : draft
    case 'subagent': {
      const blocks = draft.children.map((child) => finish(child, cwd))
      const { tools, failed, denied } = tally(draft.items)
      return {
        kind: 'subagent', key: draft.key, item: draft.item, blocks, tools, failed, denied,
        running: draft.item.state === 'running' || blocks.some(blockRunning)
      }
    }
    default:
      return draft
  }
}

/** 어댑터의 공지 종류. 이 버전이 모르는 종류는 `other`다 — 글자만 그린다 (events FR-41) */
function noticeKindOf(kind: unknown): NoticeKind | 'other' {
  return oneOf(NOTICE_KINDS, kind) ? kind : 'other'
}

/** 공지 한 줄. 글자가 비면 그리지 않는다 — 빈 공지선은 아무것도 말하지 않는다 */
function noticeDraftOf(event: NoticeEvent): NoticeDraft | null {
  const text = typeof event.text === 'string' ? event.text : ''
  if (text.trim() === '') return null
  return { kind: 'notice', key: `notice:${event.seq}`, noticeKind: noticeKindOf(event.kind), text, lines: [], count: 1 }
}

/**
 * 생각 블록 (events FR-40). 시각 둘이 있으면(opencode) 정확한 시간이고, 없으면(claude) 이 이벤트의
 * 시각 − `previousAt`(같은 스코프의 바로 앞 이벤트, 첫 이벤트면 스코프의 시작)으로 추정한다.
 * 음수이거나 기준이 없으면 null이다.
 */
function reasoningOf(
  event: Extract<RunEvent, { type: 'reasoning' }>, previousAt: number | null
): ReasoningBlock {
  const exact = isFiniteNumber(event.startedAt) && isFiniteNumber(event.endedAt)
  const from = exact ? event.startedAt : previousAt
  const to = exact ? event.endedAt : event.at
  const span = from !== null && isFiniteNumber(from) && isFiniteNumber(to) ? to - from : null
  return {
    kind: 'reasoning',
    key: `reasoning:${event.seq}`,
    text: typeof event.text === 'string' ? event.text : '',
    durationMs: span !== null && span >= 0 ? span : null,
    estimated: !exact,
    truncated: isCount(event.truncated) ? event.truncated : 0
  }
}

/**
 * 턴 하나의 투영 (FR-1~FR-9, events FR-35~41). `events`는 그 run의 것이고 seq 오름차순이다.
 *
 * **두 번 훑는다** — 먼저 결과·권한 거부·호출을 id별로 모으고, 그다음 블록을 만든다(FR-3). 실패
 * 여부를 tool_use 자리에서 알아야 묶음에서 뺄 수 있다. 한 번에 훑으면 결과가 use보다 뒤에 오는
 * 보통의 순서에서 실패한 도구가 이미 묶음에 들어가 있다.
 *
 * **스코프가 있다** (events FR-38). `parentToolUseId`가 P인 이벤트는 하위 에이전트 호출 P의 카드
 * 안에서 같은 규칙으로 투영한다(중첩이면 카드 안의 카드). P가 목록에 없거나(창 때문에 앞이 잘렸다)
 * 하위 에이전트가 아니거나 조상을 따라가다 같은 id를 다시 만나면(순환) 메인에 그린다 — 버리지 않는다.
 * 공지·오류·원문 줄은 늘 메인이다. 권한 거부 공지만 막힌 도구의 줄 바로 뒤, 그 스코프에 선다.
 */
export function projectTurn(
  run: Pick<Run, 'status' | 'resultText' | 'errorMessage' | 'cwd' | 'startedAt'>,
  events: readonly RunEvent[]
): TurnProjection {
  const running = run.status === 'running'

  // ── 첫 훑기 ──
  const results = new Map<string, ResultInfo>()
  /** id별 첫 tool_use — 하위 에이전트 카드의 조상을 따라가는 데 쓴다 */
  const uses = new Map<string, ToolUseEvent>()
  /** 막힌 호출 id → 처음 온 거부 공지. 로그에는 system과 result가 두 번 알린다(events FR-19) */
  const denials = new Map<string, NoticeEvent>()
  let anonymousDenials = 0
  let compacted = false
  for (const event of events) {
    if (event.type === 'tool_result') {
      // id가 비면 짝짓지 않는다 — 어댑터가 id를 못 읽은 줄이다.
      const id = idOf(event.toolUseId)
      if (id !== null) results.set(id, resultInfoOf(event))
    } else if (event.type === 'tool_use') {
      const id = idOf(event.toolUseId)
      if (id !== null && !uses.has(id)) uses.set(id, event)
    } else if (event.type === 'notice') {
      if (event.kind === 'permission_denied') {
        const id = idOf(event.toolUseId)
        if (id === null) anonymousDenials++
        else if (!denials.has(id)) denials.set(id, event)
      } else if (event.kind === 'compact') {
        compacted = true
      }
    }
  }

  // ── 스코프 (events FR-38) ──
  const nameOf = (event: ToolUseEvent): string => (typeof event.name === 'string' ? event.name : '')
  const containers = new Set<string>()
  for (const [id, use] of uses) {
    if (toolLabelOf(nameOf(use)).category === 'subagent') containers.add(id)
  }
  const scopeMemo = new Map<string, string | null>()
  const scopeOf = (parent: string | null): string | null => {
    if (parent === null || !containers.has(parent)) return null
    const memo = scopeMemo.get(parent)
    if (memo !== undefined) return memo
    // 조상을 따라간다. 같은 id를 다시 만나면 순환이다 — 어느 카드도 메인에 닿지 않으므로 메인에 그린다.
    const seen = new Set<string>()
    let cursor: string | null = parent
    let cyclic = false
    while (cursor !== null) {
      if (seen.has(cursor)) {
        cyclic = true
        break
      }
      seen.add(cursor)
      const up: string | null = parentIdOf(uses.get(cursor)!)
      cursor = up !== null && containers.has(up) ? up : null
    }
    const scope = cyclic ? null : parent
    scopeMemo.set(parent, scope)
    return scope
  }
  const scoped = new Map<string | null, RunEvent[]>()
  for (const event of events) {
    const main = event.type === 'notice' || event.type === 'error' || event.type === 'raw'
    const scope = main ? null : scopeOf(parentIdOf(event))
    const list = scoped.get(scope)
    if (list) list.push(event)
    else scoped.set(scope, [event])
  }

  const makeItem = (event: ToolUseEvent): ToolItem => {
    const id = idOf(event.toolUseId)
    const result = id === null ? undefined : results.get(id)
    const name = nameOf(event)
    const { label, category } = toolLabelOf(name)
    const subtitle = subtitleOf(event.input, run.cwd)
    const denied = id !== null && denials.has(id)
    const detail = result?.detail ?? null
    const shell = detail?.kind === 'shell' ? detail : null
    const search = detail?.kind === 'search' ? detail : null
    const agent = detail?.kind === 'subagent' ? detail : null
    const found = search ? null : matchesOf(category, result?.summary ?? null)
    const output = result ? result.output ?? result.summary : null
    return {
      id: id ?? `seq:${event.seq}`,
      name,
      label,
      category,
      subtitle: subtitle.text,
      subtitlePath: subtitle.path,
      input: event.input,
      // 막힌 호출은 결과가 아직 없어도 돌지 않는다 — 실패다(events FR-41)
      state: result ? (result.ok ? 'done' : 'failed') : denied ? 'failed' : running ? 'running' : 'unknown',
      output,
      outputSource: output === null ? null : result?.output != null ? 'full' : 'summary',
      outputTruncated: result?.outputTruncated ?? 0,
      exitCode: shell?.exitCode ?? null,
      stopped: shell?.timedOut ? 'timed_out' : shell?.interrupted ? 'interrupted' : null,
      matches: search ? search.count : found,
      matchUnit: search ? search.unit : found !== null ? 'files' : null,
      matchesTruncated: search?.truncated ?? false,
      denied,
      parentToolUseId: parentIdOf(event),
      subagent: agent
        ? { sessionId: agent.sessionId, model: agent.model, toolCount: agent.toolCount, durationMs: agent.durationMs }
        : null
    }
  }

  const itemsByScope = new Map<string | null, ToolItem[]>()
  const placedCards = new Set<string>()
  const placedDenials = new Set<string>()

  /** 한 스코프의 블록. `startAt`은 스코프의 시작 — 첫 생각의 시간을 여기서부터 잰다(events FR-40) */
  const projectScope = (scope: string | null, startAt: number | null): { drafts: Draft[]; items: ToolItem[] } => {
    const drafts: Draft[] = []
    const items: ToolItem[] = []
    itemsByScope.set(scope, items)
    let previousAt = startAt

    for (const event of scoped.get(scope) ?? []) {
      const last = drafts[drafts.length - 1]
      switch (event.type) {
        case 'text':
          if (typeof event.text !== 'string' || event.text.trim() === '') break
          drafts.push({ kind: 'text', key: `text:${event.seq}`, text: event.text })
          break

        // text처럼 묶음을 끊는다. 답 중복 제거(FR-8)는 text 블록만 본다 — 생각은 답이 아니다.
        case 'reasoning':
          drafts.push(reasoningOf(event, previousAt))
          break

        case 'tool_use': {
          const item = makeItem(event)
          items.push(item)
          const id = idOf(event.toolUseId)

          if (item.category === 'subagent') {
            // 하위 에이전트는 묶음에 들지 않고 카드 하나다. 실패한 호출도 카드다 — 자식이 한 일이 카드
            // 안에 있어야 한다(events FR-38). 같은 id가 두 번 오면 안은 한 번만 투영한다.
            const nested = id !== null && containers.has(id) && !placedCards.has(id)
            if (nested) placedCards.add(id)
            const inner = nested ? projectScope(id, isFiniteNumber(event.at) ? event.at : null) : null
            drafts.push({
              kind: 'subagent', key: `subagent:${event.seq}`, item,
              children: inner?.drafts ?? [], items: inner?.items ?? []
            })
          } else if (item.state === 'failed' || item.denied) {
            // 실패한 편집도 여기다 — 실패한 편집의 diff는 일어나지 않은 변경이다 (FR-17).
            drafts.push({ kind: 'tool-error', key: `tool-error:${event.seq}`, item })
          } else if (item.category === 'edit') {
            const detail = id === null ? null : results.get(id)?.detail ?? null
            const ops = editOpsOf(item, event.input, detail)
            if (last?.kind === 'edit') {
              last.items.push(item)
              last.ops.push(...ops)
            } else {
              drafts.push({ kind: 'edit', key: `edit:${event.seq}`, items: [item], ops })
            }
          } else if (last?.kind === 'activity') {
            last.items.push(item)
          } else {
            drafts.push({ kind: 'activity', key: `activity:${event.seq}`, items: [item] })
          }

          // 권한 거부 공지는 막힌 도구의 줄 바로 뒤, 같은 스코프에 한 번만 선다(events FR-41).
          if (id !== null && item.denied && !placedDenials.has(id)) {
            placedDenials.add(id)
            const denial = noticeDraftOf(denials.get(id)!)
            if (denial) drafts.push(denial)
          }
          break
        }

        case 'notice': {
          const kind = noticeKindOf(event.kind)
          if (kind === 'permission_denied') {
            const id = idOf(event.toolUseId)
            // 막힌 호출이 턴 안에 있으면 그 줄 곁에 선다. 없으면 제자리에 id마다 한 번.
            if (id !== null && (uses.has(id) || placedDenials.has(id))) break
            if (id !== null) placedDenials.add(id)
          }
          const draft = noticeDraftOf(event)
          if (!draft) break
          // 연속된 재시도는 하나로 — 마지막 문구가 몇 번째인지 이미 말한다.
          if (kind === 'retry' && last?.kind === 'notice' && last.noticeKind === 'retry') {
            last.text = draft.text
            last.count += 1
          } else {
            drafts.push(draft)
          }
          break
        }

        case 'error':
          drafts.push({ kind: 'error', key: `error:${event.seq}`, message: event.message })
          break

        case 'raw':
          // 원문 줄끼리만 합친다 — 앞의 공지가 압축·재시도면 따로 선다.
          if (last?.kind === 'notice' && last.noticeKind === 'raw') last.lines.push(event.line)
          else {
            drafts.push({
              kind: 'notice', key: `notice:${event.seq}`, noticeKind: 'raw', text: '', lines: [event.line], count: 0
            })
          }
          break

        // tool_result는 첫 훑기에서 썼다. session·usage는 그리지 않는다. result도 그리지
        // 않는다 — 답은 run 행에서 온다. opencode 어댑터는 text마다 result를 합성하므로
        // 그리면 같은 글이 두 번 나온다(설계 2026-09-06 §7).
        default:
          break
      }
      if (isFiniteNumber(event.at)) previousAt = event.at
    }
    return { drafts, items }
  }

  const main = projectScope(null, run.startedAt)
  const blocks = main.drafts.map((draft) => finish(draft, run.cwd))

  const lastIndexOf = (kind: TimelineBlock['kind']): number => {
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i]!.kind === kind) return i
    return -1
  }

  // 답 칸 (FR-8). 도는 중이면 지금까지의 마지막 text, 끝났으면 run 행의 resultText뿐이다 —
  // 스토어에 기대면 앱을 다시 켠 전후로 같은 턴이 다르게 보인다(재시작하면 스토어가 빈다).
  let answer: TurnProjection['answer'] = null
  if (running) {
    const index = lastIndexOf('text')
    const block = blocks[index]
    if (block?.kind === 'text') answer = { text: block.text, final: false }
  } else if (run.status !== 'pending' && run.resultText !== null && run.resultText.trim() !== '') {
    answer = { text: run.resultText, final: true }
    // claude는 마지막 assistant 텍스트를 흘린 뒤 result에 같은 내용을 다시 담는다.
    const index = lastIndexOf('text')
    const block = blocks[index]
    if (block?.kind === 'text' && block.text.trim() === run.resultText.trim()) {
      blocks.splice(index, 1)
    }
  }

  // 오류 카드와 같은 글이 겹치지 않게 (fixes FR-13이 errorMessage를 마지막 error에서 채운다).
  if (run.status === 'failed' && run.errorMessage !== null) {
    const index = lastIndexOf('error')
    const block = blocks[index]
    if (block?.kind === 'error' && block.message.trim() === run.errorMessage.trim()) {
      blocks.splice(index, 1)
    }
  }

  // 접힌 턴의 값 (FR-9, events FR-39) — 메인 스레드의 도구만 센다. 카드는 하나로 센다.
  const { tools, failed } = tally(main.items)
  const denied = denials.size + anonymousDenials
  const summary = tools === 0 && denied === 0 && !compacted
    ? null
    : { tools, failed, denied, compacted }

  const lastRunning = (items: readonly ToolItem[] | undefined): ToolItem | null =>
    [...(items ?? [])].reverse().find((item) => item.state === 'running') ?? null
  const current = running ? lastRunning(main.items) : null
  const currentChild = current?.category === 'subagent' ? lastRunning(itemsByScope.get(current.id)) : null

  // 재시도 중 — 턴의 마지막 이벤트가 재시도 공지다. 그리지 않는 줄(session·usage·result)은 건너뛴다.
  // **스코프를 가리지 않는다**(리뷰 반영 2026-09-27 — spec FR-39는 "메인 스레드의 마지막"이었다). 재시도
  // 공지는 늘 메인 스코프에 서지만, 하위 에이전트가 도는 동안의 재시도는 자식의 API 호출이다 — 메인은
  // Agent의 결과를 기다리고, claude 2.1.280은 메인이 아닌 경로의 재시도 대기도 재시도 줄로 알린다. 그 뒤에 자식의
  // 이벤트가 오면 호출이 다시 흐르는 것이라, 메인만 보면 상태 줄이 낡은 재시도 문구에 멈춘다.
  let retrying: string | null = null
  if (running) {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!
      if (event.type === 'session' || event.type === 'usage' || event.type === 'result') continue
      if (event.type === 'notice' && event.kind === 'retry') retrying = noticeDraftOf(event)?.text ?? null
      break
    }
  }

  const first = events[0]
  return {
    blocks,
    answer,
    summary,
    current,
    currentChild,
    retrying,
    omitted: first !== undefined && isCount(first.seq) ? first.seq : 0
  }
}

/** 펼친 도구 한 줄에 보일 입력 JSON의 상한 (FR-16). 넘으면 자르고 `…`를 붙인다. */
export const MAX_INPUT_JSON = 2_000

/**
 * 도구 한 줄을 펼쳤을 때 보일 것 (FR-16). 종류마다 다르다:
 *
 * - `shell` — 명령 **전문**(부제는 첫 줄뿐이다)과 결과. 결과가 200자 요약이고(`outputSource`)
 *   `…`로 끝나면 잘린 것이다(`summarize`의 200자) — 화면이 "출력 앞부분만 기록됩니다"를 붙인다.
 * - `subagent` — 오른쪽에 붙일 `subagent_type`과 펼쳐 보일 `prompt`.
 * - `input` — mcp·그 밖의 입력을 들여쓴 JSON(`MAX_INPUT_JSON`자까지).
 *
 * 읽기·검색·웹·할 일·편집은 null이다 — 한 줄로 끝난다(OpenCode의 컴팩트 행). 편집의 diff는
 * 편집 블록(FR-18)의 몫이고, 실패한 도구는 결과 요약을 보인다(FR-17).
 *
 * *(다듬음: spec §3에 없던 export다 — 무엇을 펼쳐 보일지도 규칙이라 투영 곁에 둔다, FR-1.)*
 */
export type ToolDetail =
  | { kind: 'shell'; command: string; output: string | null; truncated: boolean }
  | { kind: 'subagent'; agentType: string | null; prompt: string | null }
  | { kind: 'input'; json: string }

/**
 * 결과가 200자 요약이고 잘렸나 (FR-16) — 화면이 "출력 앞부분만 기록됩니다"를 붙인다. `…`는 요약의
 * 표식이다(events FR-36) — 원문 끝부분(`outputSource: 'full'`)이 `…`로 끝나는 것은 잘린 것이 아니다.
 * 셸 한 줄(`toolDetailOf`)과 출력 블록(events FR-45·46·49)이 같은 규칙을 쓰도록 여기 한 곳에 둔다.
 */
export function isSummaryCut(item: ToolItem): boolean {
  return item.outputSource === 'summary' && item.output !== null && item.output.endsWith('…')
}

export function toolDetailOf(item: ToolItem): ToolDetail | null {
  const record = recordOf(item.input) ?? {}
  switch (item.category) {
    case 'shell': {
      const command = stringAt(record, 'command') ?? ''
      if (command === '' && item.output === null) return null
      return { kind: 'shell', command, output: item.output, truncated: isSummaryCut(item) }
    }
    case 'subagent':
      return {
        kind: 'subagent',
        agentType: stringAt(record, 'subagent_type'),
        prompt: stringAt(record, 'prompt')
      }
    case 'mcp':
    case 'other': {
      if (item.input === undefined) return null
      const json = JSON.stringify(item.input, null, 2) ?? ''
      if (json === '') return null
      return {
        kind: 'input',
        json: json.length > MAX_INPUT_JSON ? `${json.slice(0, MAX_INPUT_JSON)}…` : json
      }
    }
    default:
      return null
  }
}

/**
 * 턴 사이 공지 (FR-10) — 요청한 모델이나 effort가 앞 턴과 다르면 `모델 → X · effort → Y`.
 *
 * **관측값(`usage.model`)이 아니라 요청값을 비교한다.** effort는 요청값밖에 없고(CLAUDE.md),
 * 관측 모델은 턴이 끝나야 오므로 비교하면 공지가 진행 중에 떴다가 끝나며 바뀐다.
 */
export function switchNotice(
  prev: Pick<Run, 'model' | 'effort' | 'agentKind'> | null,
  next: Pick<Run, 'model' | 'effort' | 'agentKind'>
): string | null {
  if (!prev) return null
  const shown = (value: string | null): string => value || '기본값'
  const pieces: string[] = []
  if ((prev.model || null) !== (next.model || null)) pieces.push(`모델 → ${shown(next.model)}`)
  if ((prev.effort || null) !== (next.effort || null)) {
    pieces.push(`${effortFieldOf(next.agentKind).label} → ${shown(next.effort)}`)
  }
  return pieces.length > 0 ? pieces.join(' · ') : null
}

/** 소요 시간 (FR-11). 1초 미만 · N초 · M분 S초 · H시간 M분. */
export function formatDuration(ms: number): string {
  if (!(ms >= 1_000)) return '1초 미만'
  const seconds = Math.floor(ms / 1_000)
  if (seconds < 60) return `${seconds}초`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
  return `${Math.floor(seconds / 3_600)}시간 ${Math.floor((seconds % 3_600) / 60)}분`
}

function effortPiece(kind: AgentKind, effort: string | null): string | null {
  return effort ? `${effortFieldOf(kind).label} ${effort}` : null
}

/**
 * 턴 끝줄의 메타 조각 (FR-11) — agent · 모델 · 소요 시간 · effort · 권한.
 * 모르는 조각은 빠진다(구분점은 화면의 `::before`가 그리므로 남지 않는다).
 *
 * **대기 시간(createdAt → startedAt)은 넣지 않는다.** 슬롯을 기다린 시간은 agent가 쓴
 * 시간이 아니다. **중단된 턴(interrupted)도 넣지 않는다** — 도는 중에 앱이 꺼진 턴이고 끝난
 * 시각은 다음 부팅의 `reapStale`이 찍은 것이라, 꺼져 있던 시간까지 agent가 일한 것처럼 보인다
 * (다듬음 2026-09-27 — 리뷰가 찾은 것). 언제 멈췄는지는 어디에도 남지 않아 알 수 없다.
 *
 * **도는 턴도 넣지 않는다** (spec §8의 3, 결정 2026-09-27) — 경과 시간은 상태 줄이 말한다. 둘 다
 * 보이면 한 턴이 시간을 두 번 말했다. 그래서 시간은 끝난 시각(`endedAt`)까지의 것뿐이고 흐르는
 * 시계를 받지 않는다. 끝난 시각이 없으면(끝나지 않았다) 조각이 없다.
 */
export function metaPieces(run: Run): string[] {
  const model = run.usage?.model ?? run.model
  const duration = run.startedAt === null || run.endedAt === null || run.status === 'interrupted'
    ? null
    : formatDuration(run.endedAt - run.startedAt)
  return [
    AGENT_LABELS[run.agentKind],
    model || null,
    duration,
    effortPiece(run.agentKind, run.effort),
    PERMISSION_LABELS[run.permission]
  ].filter((piece): piece is string => piece !== null)
}
