import type { RunEvent } from '@shared/events'
import type { AgentKind, Run } from '@shared/models'
import { AGENT_LABELS } from './agents'
import { diffStats, lineDiff, truncateHunks, type DiffHunk } from './diff'
import { effortFieldOf } from './effort'
import { PERMISSION_LABELS } from './permission'

/**
 * 턴 하나의 이벤트를 화면 블록으로 바꾸는 규칙 (`docs/sdlc/conversation-timeline/` spec
 * FR-1~FR-11).
 *
 * **순수 함수만 둔다.** 컴포넌트는 결과를 그리기만 한다 — `conversation.ts`·`usage.ts`처럼
 * 렌더링 없이 경계값을 고정할 수 있어야 한다. 규칙이 컴포넌트에 흩어지면 접힌 턴과 펼친
 * 턴이 같은 이벤트를 다르게 읽는다.
 *
 * **이벤트는 신뢰할 수 없는 입력이다** — `input`은 agent가 만든 아무 JSON이다. 모양을
 * 확인하지 않고 꺼내 쓰는 곳이 없어야 한다(`recordOf`·`stringAt`).
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
  bash: { label: '셸', category: 'shell' },
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
  /** tool_result.summary — 200자 요약이다 */
  output: string | null
  /** search 종류에서 `Found N`을 읽었을 때만 */
  matches: number | null
}

export interface EditFile {
  path: string
  /** cwd 기준 상대 경로 */
  displayPath: string
  created: boolean
  added: number
  removed: number
  hunks: DiffHunk[]
  /** 400줄에서 자른 나머지 줄 수 */
  truncated: number
  /**
   * 이 파일을 고친 도구의 id(`ToolItem.id`), 나온 순서대로. 파일 줄의 열림은 자리 순번이 아니라
   * 이것에 매단다(FR-15 다듬음) — 앞 파일이 실패로 빠져 순번이 밀려도 열어 둔 줄이 닫히거나
   * 남의 열림을 이어받지 않는다.
   */
  ids: string[]
}

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
  | { kind: 'notice'; key: string; text: string; lines: string[] }

export interface TurnProjection {
  blocks: TimelineBlock[]
  answer: { text: string; final: boolean } | null
  summary: { tools: number; failed: number } | null
  current: ToolItem | null
}

/**
 * claude Grep의 files_with_matches 출력 첫 줄 — `Found 7 files` / `Found 1 file`.
 * 이 장비의 실제 run 로그로 확인했다(2026-09-27, spec §6 우려 3). content 모드와 Glob,
 * opencode에는 이 줄이 없다 — 그때는 개수를 그리지 않는다.
 */
const FOUND_N = /^Found (\d+) /

function matchesOf(category: ToolCategory, output: string | null): number | null {
  if (category !== 'search' || output === null) return null
  const found = FOUND_N.exec(output)
  return found ? Number(found[1]) : null
}

/** 편집 한 번이 남긴 것. 같은 파일끼리 합친 뒤 `EditFile`로 마감한다. */
interface EditOp {
  /** 이 편집을 한 도구의 id (`ToolItem.id`) */
  id: string
  /** 입력에서 읽은 경로. 모르면 빈 문자열이다 */
  path: string
  /** 경로를 모를 때 파일 줄에 보일 이름 — 도구의 부제, 그것도 없으면 라벨 */
  fallback: string
  created: boolean
  hunks: DiffHunk[]
}

/**
 * 편집 계열 입력의 모양으로 diff를 만든다 (FR-7). 모양을 모르면 경로만 — 펼칠 것이 없다.
 * 도구 이름이 아니라 **입력 모양**을 본다: claude와 opencode가 키 이름만 다르다.
 */
function editOpOf(id: string, input: unknown, fallback: string): EditOp {
  const record = recordOf(input) ?? {}
  const base = { id, path: pathOf(record) ?? '', fallback }

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
    return { ...base, created: false, hunks }
  }

  const before = record['old_string'] ?? record['oldString']
  const after = record['new_string'] ?? record['newString']
  if (typeof before === 'string' && typeof after === 'string') {
    return { ...base, created: false, hunks: [lineDiff(before, after)] }
  }

  const content = record['content']
  if (typeof content === 'string') {
    return { ...base, created: true, hunks: [lineDiff('', content)] }
  }

  return { ...base, created: false, hunks: [] }
}

/** 만드는 중인 블록. 묶음 라벨·편집 파일은 끝에서 마감한다. */
type Draft =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'activity'; key: string; items: ToolItem[] }
  | { kind: 'edit'; key: string; items: ToolItem[]; ops: EditOp[] }
  | { kind: 'tool-error'; key: string; item: ToolItem }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'notice'; key: string; lines: string[] }

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
      same.hunks.push(...op.hunks)
      same.created ||= op.created
      same.ids.push(op.id)
      continue
    }
    const copy = { ...op, hunks: [...op.hunks], ids: [op.id] }
    merged.push(copy)
    if (op.path !== '') byPath.set(op.path, copy)
  }

  return merged.map((op) => {
    // +N −M은 자르기 전 diff에서 센다 — 잘린 수는 거짓이다.
    const { added, removed } = diffStats(op.hunks)
    const { hunks, truncated } = truncateHunks(op.hunks)
    return {
      path: op.path,
      displayPath: op.path === '' ? op.fallback : relativePath(op.path, cwd),
      created: op.created,
      added,
      removed,
      hunks,
      truncated,
      ids: op.ids
    }
  })
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
      return {
        kind: 'notice', key: draft.key,
        text: `해석하지 못한 출력 ${draft.lines.length}줄`, lines: draft.lines
      }
    default:
      return draft
  }
}

/**
 * 턴 하나의 투영 (FR-1~FR-9). `events`는 그 run의 것이고 seq 오름차순이다.
 *
 * **두 번 훑는다** — 먼저 결과를 id별로 모으고, 그다음 블록을 만든다(FR-3). 실패 여부를
 * tool_use 자리에서 알아야 묶음에서 뺄 수 있다. 한 번에 훑으면 결과가 use보다 뒤에 오는
 * 보통의 순서에서 실패한 도구가 이미 묶음에 들어가 있다.
 */
export function projectTurn(
  run: Pick<Run, 'status' | 'resultText' | 'errorMessage' | 'cwd'>,
  events: readonly RunEvent[]
): TurnProjection {
  const results = new Map<string, { ok: boolean; summary: string }>()
  for (const event of events) {
    // id가 비면 짝짓지 않는다 — 어댑터가 id를 못 읽은 줄이다.
    if (event.type === 'tool_result' && event.toolUseId !== '') {
      results.set(event.toolUseId, { ok: event.ok, summary: event.summary })
    }
  }

  const running = run.status === 'running'
  const drafts: Draft[] = []
  const items: ToolItem[] = []

  for (const event of events) {
    const last = drafts[drafts.length - 1]
    switch (event.type) {
      case 'text':
        if (event.text.trim() === '') break
        drafts.push({ kind: 'text', key: `text:${event.seq}`, text: event.text })
        break

      case 'tool_use': {
        const result = event.toolUseId === '' ? undefined : results.get(event.toolUseId)
        const { label, category } = toolLabelOf(event.name)
        const output = result?.summary ?? null
        const subtitle = subtitleOf(event.input, run.cwd)
        const item: ToolItem = {
          id: event.toolUseId === '' ? `seq:${event.seq}` : event.toolUseId,
          name: event.name,
          label,
          category,
          subtitle: subtitle.text,
          subtitlePath: subtitle.path,
          input: event.input,
          state: result ? (result.ok ? 'done' : 'failed') : running ? 'running' : 'unknown',
          output,
          matches: matchesOf(category, output)
        }
        items.push(item)

        if (item.state === 'failed') {
          // 실패한 편집도 여기다 — 실패한 편집의 diff는 일어나지 않은 변경이다 (FR-17).
          drafts.push({ kind: 'tool-error', key: `tool-error:${event.seq}`, item })
        } else if (category === 'edit') {
          const op = editOpOf(item.id, event.input, item.subtitle || item.label)
          if (last?.kind === 'edit') {
            last.items.push(item)
            last.ops.push(op)
          } else {
            drafts.push({ kind: 'edit', key: `edit:${event.seq}`, items: [item], ops: [op] })
          }
        } else if (last?.kind === 'activity') {
          last.items.push(item)
        } else {
          drafts.push({ kind: 'activity', key: `activity:${event.seq}`, items: [item] })
        }
        break
      }

      case 'error':
        drafts.push({ kind: 'error', key: `error:${event.seq}`, message: event.message })
        break

      case 'raw':
        if (last?.kind === 'notice') last.lines.push(event.line)
        else drafts.push({ kind: 'notice', key: `notice:${event.seq}`, lines: [event.line] })
        break

      // tool_result는 첫 훑기에서 썼다. session·usage는 그리지 않는다. result도 그리지
      // 않는다 — 답은 run 행에서 온다. opencode 어댑터는 text마다 result를 합성하므로
      // 그리면 같은 글이 두 번 나온다(설계 2026-09-06 §7).
      default:
        break
    }
  }

  const blocks = drafts.map((draft) => finish(draft, run.cwd))

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

  const failed = items.filter((item) => item.state === 'failed').length
  const current = running
    ? [...items].reverse().find((item) => item.state === 'running') ?? null
    : null

  return {
    blocks,
    answer,
    summary: items.length > 0 ? { tools: items.length, failed } : null,
    current
  }
}

/** 펼친 도구 한 줄에 보일 입력 JSON의 상한 (FR-16). 넘으면 자르고 `…`를 붙인다. */
export const MAX_INPUT_JSON = 2_000

/**
 * 도구 한 줄을 펼쳤을 때 보일 것 (FR-16). 종류마다 다르다:
 *
 * - `shell` — 명령 **전문**(부제는 첫 줄뿐이다)과 결과 요약. 요약이 `…`로 끝나면 잘린
 *   것이다(`summarize`의 200자) — 화면이 "출력 앞부분만 기록됩니다"를 붙인다.
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

export function toolDetailOf(item: ToolItem): ToolDetail | null {
  const record = recordOf(item.input) ?? {}
  switch (item.category) {
    case 'shell': {
      const command = stringAt(record, 'command') ?? ''
      if (command === '' && item.output === null) return null
      return {
        kind: 'shell', command, output: item.output,
        truncated: item.output !== null && item.output.endsWith('…')
      }
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
