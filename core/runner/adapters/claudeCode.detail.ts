/**
 * claude의 `tool_use_result`와 system 줄을 one-desk의 detail·공지로 접는다
 * (`docs/sdlc/conversation-events/` spec FR-13·14·18·19). 어댑터 파일이 이미 길어 떼어 둔
 * 순수 함수들이다 — **claude 방언은 이 파일과 `claudeCode.ts` 밖으로 나가지 않는다**(NFR-2).
 *
 * **detail은 도구 이름이 아니라 모양으로 가른다**(FR-14). `user` 줄에는 도구 이름이 없고(`tool_use_id`뿐)
 * `parseLine`은 앞 줄을 기억하지 않는다(NFR-3). 모양은 이름보다 튼튼하기도 하다 — `Task`/`Agent`,
 * `Bash`/`PowerShell`처럼 이름이 갈려도 모양은 같다.
 *
 * **값의 타입이 기대와 다르면 그 detail을 통째로 싣지 않는다.** 반쯤 맞는 detail은 거짓말을 한다.
 * 파싱 실패로 run을 죽이지도 않는다 — detail이 없을 뿐 요약과 출력은 그대로 남는다.
 */

import { isCount, type NoticeKind, type PatchHunk, type ToolDetail } from '@shared/events'
import { capEditFiles, type EditFileInput } from './common'

/** 공지 이벤트의 payload. 어댑터가 runId·at·messageId를 얹는다 */
export interface ClaudeNotice {
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

/** 선택 필드의 수. 없으면(undefined·null) null, 수가 아니면 BAD */
function optNum(value: unknown): number | null | Bad {
  if (value === undefined || value === null) return null
  return num(value) ?? BAD
}

/**
 * 선택 필드의 개수(음이 아닌 정수 — 렌더러와 같은 판정, `isCount`). 없으면 null, 개수가 아니면 BAD.
 * 개수·줄 번호·도구 수는 이것으로 읽는다 — 어댑터만 느슨하면 화면에서 detail이 통째로 사라진다.
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

// ── tool_result.content → 글 (FR-13) ─────────────────────────────────────────

/**
 * `tool_result.content`를 글로 편다. **모델이 본 그 글이다** — `tool_use_result.stdout`을 따로
 * 싣지 않는다(같은 글이 두 벌 된다). 배열이면 text 블록을 줄로 잇고, 이미지는 `[이미지]`, 그 밖의
 * 블록은 `[<type>]`로 둔다 — base64가 로그에 들어가지 않는다. 글이 될 수 없으면 null.
 */
export function claudeResultText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    const b = record(block)
    if (!b) continue
    if (b['type'] === 'text' && typeof b['text'] === 'string') parts.push(b['text'])
    else if (b['type'] === 'image') parts.push('[이미지]')
    else parts.push(`[${typeof b['type'] === 'string' ? b['type'] : '?'}]`)
  }
  return parts.join('\n')
}

/**
 * 읽기 도구(Read)의 결과인가. **읽기의 원문은 싣지 않는다**(spec §7-A) — 로그에서 가장 큰 몫인데
 * 화면(timeline FR-16)이 읽기 줄을 펼치지 않는다. 모양: `{type: 'text'|'image'|…, file: {…}}`.
 */
export function isClaudeReadResult(result: unknown): boolean {
  const r = record(result)
  return r !== null && typeof r['type'] === 'string' && record(r['file']) !== null
}

// ── tool_use_result → detail (FR-14) ─────────────────────────────────────────

/** 실패한 도구의 content는 `Exit code N\n…`으로 시작한다(기록 67건 전부) */
const EXIT_CODE = /^Exit code (\d+)/

/**
 * 중단된 셸의 표식. 2.1.280의 셸 오류 글은 `Exit code N`, (중단이면) 이 표식, stderr, stdout을 줄로
 * 이은 것이라 **둘째 줄에만** 선다(리뷰 반영 2026-09-27). 출력 속의 같은 글자는 중단이 아니다.
 */
const INTERRUPTED_MARK = '[Request interrupted by user for tool use]'

function shell(exitCode: number | null, interrupted: boolean, timedOut: boolean): ToolDetail {
  return { kind: 'shell', exitCode, interrupted, timedOut }
}

/** jsdiff hunk 배열. 하나라도 모양이 아니면 BAD. `\ No newline` 줄은 뺀다 */
function hunksOf(value: unknown): PatchHunk[] | Bad {
  if (!Array.isArray(value)) return BAD
  const hunks: PatchHunk[] = []
  for (const item of value) {
    const h = record(item)
    if (!h) return BAD
    const { oldStart, oldLines, newStart, newLines } = h
    const lines = h['lines']
    if (!isCount(oldStart) || !isCount(oldLines) || !isCount(newStart) || !isCount(newLines)) return BAD
    if (!Array.isArray(lines) || !lines.every((l): l is string => typeof l === 'string')) return BAD
    hunks.push({ oldStart, oldLines, newStart, newLines, lines: lines.filter((l) => !l.startsWith('\\')) })
  }
  return hunks
}

/**
 * 바꾸기 전 원본. 키 자체가 없으면 이유를 모르니 `unavailable`이다. **null의 뜻은 도구마다 다르다**
 * (리뷰 반영 2026-09-27 — 2.1.280 바이너리로 확인):
 * - Write update: 원본이 10MiB를 넘으면 CLI가 `originalFile`을 null로(hunk는 빈 배열로) 싣는다 —
 *   `too_large`다.
 * - Edit: 스트림의 Edit은 원본을 크기로 빼지 않는다. 기록의 null(129건 중 45건)은 트랜스크립트
 *   writer가 1만 자 넘는 원본을 디스크에 적으며 지운 것이다(스트림 변환은 그 객체를 그대로 싣는다).
 *   스트림의 null은 원격 실행 재구성처럼 원본을 모르는 경로라 `unavailable`이다.
 */
function beforeOf(
  value: unknown, nullMeans: 'too_large' | 'unavailable'
): Pick<EditFileInput, 'before' | 'beforeMissing'> | Bad {
  if (typeof value === 'string') return { before: value, beforeMissing: null }
  if (value === null) return { before: null, beforeMissing: nullMeans }
  if (value === undefined) return { before: null, beforeMissing: 'unavailable' }
  return BAD
}

/** Write·Edit 한 파일. 새 파일(Write create)은 원래 없으므로 before의 이유도 null이다 */
function editDetail(r: Record<string, unknown>, operation: EditFileInput['operation']): ToolDetail | undefined {
  const path = str(r['filePath'])
  const hunks = hunksOf(r['structuredPatch'])
  if (path === null || hunks === BAD) return undefined
  const before = operation === 'create'
    ? { before: null, beforeMissing: null }
    : beforeOf(r['originalFile'], operation === 'overwrite' ? 'too_large' : 'unavailable')
  if (before === BAD) return undefined
  return {
    kind: 'edit',
    files: capEditFiles([{ path, operation, hunks, added: null, removed: null, ...before }])
  }
}

/**
 * Grep. `numFiles`·`numLines`는 `head_limit`(기본 250)으로 **자른 뒤의** 수이고 `totalFiles`·
 * `totalLines`가 자르기 전의 총수다(리뷰 반영 2026-09-27 — 2.1.280 바이너리). 총수가 있으면 그것이
 * 개수이고 잘리지 않은 수다. 총수가 없는 모양(옛 버전)만 자른 뒤의 수에 `appliedLimit`으로 "더
 * 있다"를 단다 — `appliedLimit`은 실제로 잘렸을 때만 온다.
 */
function grepDetail(r: Record<string, unknown>, numFiles: number): ToolDetail | undefined {
  const cut = typeof r['appliedLimit'] === 'number'
  const numMatches = optCount(r['numMatches'])
  const totalFiles = optCount(r['totalFiles'])
  const totalLines = optCount(r['totalLines'])
  if (numMatches === BAD || totalFiles === BAD || totalLines === BAD) return undefined
  switch (r['mode']) {
    case undefined:
    case 'files_with_matches':
      return totalFiles !== null
        ? { kind: 'search', count: totalFiles, unit: 'files', truncated: false }
        : { kind: 'search', count: numFiles, unit: 'files', truncated: cut }
    case 'content': {
      if (numMatches !== null) return { kind: 'search', count: numMatches, unit: 'matches', truncated: cut }
      if (totalLines !== null) return { kind: 'search', count: totalLines, unit: 'lines', truncated: false }
      const numLines = optCount(r['numLines'])
      return numLines === null || numLines === BAD
        ? undefined
        : { kind: 'search', count: numLines, unit: 'lines', truncated: cut }
    }
    case 'count':
      // 일치 수가 없으면 센 것은 파일이다 — "일치"라고 부르지 않는다
      return numMatches !== null
        ? { kind: 'search', count: numMatches, unit: 'matches', truncated: cut }
        : { kind: 'search', count: numFiles, unit: 'files', truncated: cut }
    default:
      return undefined
  }
}

/** 잰 시간. 소수는 반올림한다(개수가 아니라 잰 값이다). 음수는 모양이 아니다 */
function optDuration(value: unknown): number | null | Bad {
  const ms = optNum(value)
  if (ms === null || ms === BAD) return ms
  return ms < 0 ? BAD : Math.round(ms)
}

function subagentDetail(r: Record<string, unknown>, sync: boolean): ToolDetail | undefined {
  const model = optStr(r['resolvedModel'])
  const durationMs = sync ? optDuration(r['totalDurationMs']) : null
  const toolCount = sync ? optCount(r['totalToolUseCount']) : null
  if (model === BAD || durationMs === BAD || toolCount === BAD) return undefined
  return { kind: 'subagent', sessionId: null, model, toolCount, durationMs }
}

/**
 * `tool_use_result`(도구의 전체 Output 객체)를 detail로 접는다. 위에서부터 처음 맞는 모양이다.
 *
 * - `content`: `tool_result.content`를 편 글(`claudeResultText`). 실패한 도구는 `tool_use_result`가
 *   객체가 아니라 문자열이라, **종료 코드는 content의 첫 줄 `Exit code N`에서만 읽는다**.
 * - claude의 셸은 성공한 종료 코드를 알려주지 않는다 — 성공한 셸의 `exitCode`는 null이다.
 */
export function claudeToolDetail(result: unknown, content: string | null, isError: boolean): ToolDetail | undefined {
  const match = isError && content !== null ? EXIT_CODE.exec(content) : null
  const exitCode = match ? Number(match[1]) : null
  const interruptedFailure = match !== null && content!.split('\n')[1] === INTERRUPTED_MARK

  const r = record(result)
  if (r) {
    const patch = Array.isArray(r['structuredPatch'])
    // Write — 모양에 type(create·update)이 있다. Edit에는 없다
    if (patch && (r['type'] === 'create' || r['type'] === 'update')) {
      return editDetail(r, r['type'] === 'create' ? 'create' : 'overwrite')
    }
    if (patch && typeof r['oldString'] === 'string') return editDetail(r, 'edit')

    // Bash·PowerShell — 종료 코드 필드가 없다. **`timedOutAfterMs`는 시간 초과가 아니다** — 2.1.280의
    // 설명은 "시간이 다 되어 자동으로 백그라운드로 넘겼다"이고 늘 `backgroundTaskId`와 함께 온다(명령은
    // 계속 돈다). 그것을 "시간 초과"로 그리면 아직 도는 명령이 멈춘 것으로 보인다(리뷰 반영 2026-09-27).
    // claude에는 셸이 시간 초과로 멈췄다는 필드가 없다 — `timedOut`은 늘 거짓이다.
    if ((typeof r['stdout'] === 'string' || typeof r['stderr'] === 'string') && typeof r['interrupted'] === 'boolean') {
      return shell(exitCode, r['interrupted'], false)
    }

    if (Array.isArray(r['filenames']) && typeof r['numFiles'] === 'number') {
      const numFiles = r['numFiles']
      if (!isCount(numFiles)) return undefined
      // Grep — mode가 있거나 durationMs가 없다. Glob — durationMs가 있다
      if (r['mode'] !== undefined || r['durationMs'] === undefined) return grepDetail(r, numFiles)
      if (num(r['durationMs']) === null) return undefined
      const total = optCount(r['totalMatches'])
      if (total === BAD) return undefined
      return { kind: 'search', count: total ?? numFiles, unit: 'files', truncated: r['truncated'] === true }
    }

    // 하위 에이전트 — 동기는 도구 수·시간이 있고, 비동기는 띄웠다는 것만 안다
    if (typeof r['totalToolUseCount'] === 'number') return subagentDetail(r, true)
    if (r['isAsync'] === true || typeof r['agentId'] === 'string') return subagentDetail(r, false)
  }

  return exitCode === null ? undefined : shell(exitCode, interruptedFailure, false)
}

// ── system 줄 → 공지 (FR-18·19) ──────────────────────────────────────────────

/** 모델 대체의 사유. 없는 사유는 원문 그대로 적는다 */
const FALLBACK_REASONS = new Map<string, string>([
  ['overloaded', '과부하'],
  ['model_not_found', '모델 없음'],
  ['permission_denied', '접근 권한 없음'],
  ['server_error', '서버 오류'],
  ['model_blocked', '차단됨'],
  ['refusal', '응답 거부']
])

const tokens = (n: number) => n.toLocaleString('en-US')

function denial(toolName: unknown, toolUseId: unknown): ClaudeNotice | null {
  const name = str(toolName)
  if (name === null) return null
  const id = str(toolUseId)
  const notice: ClaudeNotice = { kind: 'permission_denied', text: `권한 때문에 막힘: ${name}` }
  if (id !== null) notice.toolUseId = id
  return notice
}

/**
 * system 줄(init 밖)의 공지. **문구는 여기서 만들고 화면은 그대로 그린다** — 문구의 출처를 하나로
 * 둔다. 필수 필드가 없거나 타입이 다르면 null이다(줄은 JSON으로 읽혔으니 raw로도 만들지 않는다).
 * `status`·`notification`·`task_*`·`hook_*` 같은 하위 타입도 null이다(버린다 — `raw.jsonl`에는 남는다).
 */
export function claudeNotice(line: Record<string, unknown>): ClaudeNotice | null {
  switch (line['subtype']) {
    case 'compact_boundary': {
      const meta = record(line['compact_metadata'])
      const pre = num(meta?.['pre_tokens'])
      if (!meta || pre === null) return null
      const trigger = meta['trigger'] === 'manual' ? '수동' : meta['trigger'] === 'auto' ? '자동' : null
      const post = num(meta['post_tokens'])
      const parts = ['대화가 압축됨']
      if (trigger) parts.push(trigger)
      parts.push(post === null ? `압축 전 ${tokens(pre)} 토큰` : `${tokens(pre)} → ${tokens(post)} 토큰`)
      return { kind: 'compact', text: parts.join(' · ') }
    }

    case 'api_retry': {
      const attempt = num(line['attempt'])
      const max = num(line['max_retries'])
      const delay = num(line['retry_delay_ms'])
      const status = line['error_status']
      if (attempt === null || max === null || delay === null) return null
      // error_status가 null이면 응답 자체가 없었다(연결 오류)
      const cause = status === null ? '연결 오류' : num(status)
      if (cause === null) return null
      return {
        kind: 'retry',
        text: `API 재시도 중 · ${attempt}/${max}번째 · ${Math.ceil(delay / 1000)}초 뒤 · ${cause}`
      }
    }

    // best-effort다 — 항상 오지 않는다. 권위 있는 기록은 result.permission_denials다
    case 'permission_denied':
      return denial(line['tool_name'], line['tool_use_id'])

    case 'model_fallback':
    case 'model_refusal_fallback': {
      const from = str(line['original_model'])
      const to = str(line['fallback_model'])
      if (from === null || to === null) return null
      const trigger = str(line['trigger'])
      const reason = trigger === null ? '' : ` (${FALLBACK_REASONS.get(trigger) ?? trigger})`
      return { kind: 'model_fallback', text: `모델 대체: ${from} → ${to}${reason}` }
    }

    default:
      return null
  }
}

/**
 * `result.permission_denials` — 막힌 호출마다 공지 하나. 같은 호출이 `system/permission_denied`로
 * 이미 왔을 수 있지만 **거르지 않는다**: `parseLine`은 한 줄만 본다(NFR-3). 화면이 `toolUseId`로
 * 한 번만 그린다(FR-41).
 */
export function claudeDenialNotices(line: Record<string, unknown>): ClaudeNotice[] {
  const list = line['permission_denials']
  if (!Array.isArray(list)) return []
  const notices: ClaudeNotice[] = []
  for (const item of list) {
    const d = record(item)
    const notice = d ? denial(d['tool_name'], d['tool_use_id']) : null
    if (notice) notices.push(notice)
  }
  return notices
}
