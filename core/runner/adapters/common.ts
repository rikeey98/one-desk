/**
 * 어댑터들이 공유하는 것. **CLI에 속한 지식은 여기 두지 않는다** — 도구 이름
 * 판정이나 인자 조립은 각 어댑터의 책임이다 (전체 설계 §329).
 *
 * 여기 있는 셋은 CLI가 아니라 one-desk의 규약에 속한다.
 * - withLoopbackBypass: MCP 서버가 항상 127.0.0.1이라는 우리 쪽 사정
 * - stripNeedsAnswer: [NEEDS_ANSWER] 표식은 우리가 프롬프트로 심은 규약이다
 * - summarize·keepTail·keepHead·toolResultText·reasoningText·capEditFiles: 로그 길이 정책
 * - emptyUsage: RunUsage의 "전부 모름" 기준값 (아홉 필드를 매번 손으로 적지 않는다)
 */

import type { EditFileDetail, PatchHunk, RunUsage } from '@shared/events'

/**
 * 아무것도 모르는 `RunUsage`. 아는 것만 얹어 쓴다.
 *
 * **0이 아니라 null이 기준값이다** — 모르는 것과 0은 다르다(spec §3-1). 어댑터가
 * 필드 하나를 빠뜨려도 0이 아니라 null이 되어 화면에서 조각이 사라질 뿐,
 * "안 썼다"는 거짓말이 되지 않는다.
 */
export function emptyUsage(known: Partial<RunUsage> = {}): RunUsage {
  return {
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    costUsd: null,
    contextTokens: null,
    contextWindow: null,
    ...known
  }
}

export function summarize(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/*
 * 필드마다의 상한 (`docs/sdlc/conversation-events/` spec FR-10). **어댑터가 이벤트를 만들 때 한 번
 * 적용한다** — manager·로그·IPC·렌더러는 이미 잘린 값만 본다. 어댑터 밖에서 다시 자르지 말 것:
 * 두 자리가 서로 다른 수로 자르면 로그와 화면이 조용히 갈린다.
 *
 * 글자 수는 `string.length`(UTF-16 코드 유닛)다(FR-11).
 */

/** tool_result.output — **끝부분**을 남긴다. 셸 출력은 끝(테스트 결과·오류)이 중요하다 */
export const OUTPUT_MAX_CHARS = 65_536
/** reasoning.text — 앞부분을 남긴다. 읽는 순서대로다 */
export const REASONING_MAX_CHARS = 65_536
/** detail.files[].hunks — 결과 하나의 모든 파일을 합친 줄 글자 */
export const HUNKS_MAX_CHARS = 131_072
/** detail.files[].before — 넘으면 **싣지 않는다**. 잘린 원본은 원본이 아니다 */
export const BEFORE_MAX_CHARS = 131_072

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** `text[at]`이 서로게이트 쌍의 아래 반쪽이라 그 앞에서 자르면 쌍이 갈리는가 */
function splitsPair(text: string, at: number): boolean {
  return at > 0 && at < text.length && isHigh(text.charCodeAt(at - 1)) && isLow(text.charCodeAt(at))
}

/**
 * 끝부분 `max`자를 남긴다. 자르는 자리가 서로게이트 쌍 가운데면 한 칸 뒤로 옮겨 반쪽 글자를
 * 남기지 않는다(그래서 `max - 1`자가 될 수 있다). `dropped`는 버린 앞부분 글자 수다.
 */
export function keepTail(text: string, max: number): { text: string; dropped: number } {
  if (text.length <= max) return { text, dropped: 0 }
  let start = text.length - max
  if (splitsPair(text, start)) start += 1
  return { text: text.slice(start), dropped: start }
}

/** 앞부분 `max`자를 남긴다. 쌍 가운데면 한 칸 당긴다. `dropped`는 버린 뒷부분 글자 수다. */
export function keepHead(text: string, max: number): { text: string; dropped: number } {
  if (text.length <= max) return { text, dropped: 0 }
  let end = max
  if (splitsPair(text, end)) end -= 1
  return { text: text.slice(0, end), dropped: text.length - end }
}

/**
 * tool_result의 `output`·`outputTruncated` 두 필드. 이벤트에 그대로 펼친다.
 *
 * **값이 있을 때만 싣는다**(FR-7) — 비었으면 빈 객체, 잘리지 않았으면 `outputTruncated` 키가 없다.
 * 요약(`summary`)과 달리 CLI의 content를 글로 펴는 일은 여기서 하지 않는다 — 그 모양은 CLI마다
 * 다르고 어댑터가 안다.
 *
 * **잘린 자리가 줄 가운데면 다음 줄바꿈까지 더 버린다**(리뷰 반영 2026-09-27) — 그러지 않으면 출력의
 * 첫 줄이 앞이 날아간 조각(`se139.test.ts (3 tests)`)이라, 위의 "앞부분 N자" 안내와 함께 깨진 줄로
 * 읽힌다. 더 버린 글자도 `outputTruncated`에 든다. 남긴 끝부분에 줄바꿈이 없으면(한 줄짜리 긴
 * 출력) 그대로 둔다 — 다 버리면 남는 것이 없다.
 */
export function toolResultText(
  text: string | null | undefined,
  max: number = OUTPUT_MAX_CHARS
): { output?: string; outputTruncated?: number } {
  if (!text) return {}
  const kept = keepTail(text, max)
  if (kept.dropped === 0) return { output: kept.text }
  let output = kept.text
  let dropped = kept.dropped
  if (text[dropped - 1] !== '\n') {
    const newline = output.indexOf('\n')
    if (newline >= 0 && newline < output.length - 1) {
      output = output.slice(newline + 1)
      dropped += newline + 1
    }
  }
  return { output, outputTruncated: dropped }
}

/**
 * reasoning의 `text`·`truncated`. **공백뿐인 본문은 빈 문자열로 접는다** — 화면이 "펼칠 것 없음"을
 * `text === ''` 하나로 판정한다. 빈 본문으로 이벤트를 낼지는 어댑터가 정한다(spec §7-A).
 */
export function reasoningText(
  text: string,
  max: number = REASONING_MAX_CHARS
): { text: string; truncated?: number } {
  if (text.trim() === '') return { text: '' }
  const kept = keepHead(text, max)
  return kept.dropped > 0 ? { text: kept.text, truncated: kept.dropped } : { text: kept.text }
}

/** 상한을 씌우기 전의 파일 한 줄. `hunksTruncated`는 capEditFiles가 센다 */
export type EditFileInput = Omit<EditFileDetail, 'hunksTruncated'>

function countLines(hunks: PatchHunk[], sign: '+' | '-'): number {
  let n = 0
  for (const h of hunks) for (const line of h.lines) if (line.startsWith(sign)) n += 1
  return n
}

/**
 * 편집 detail의 hunk 예산과 before 상한(FR-10·12).
 *
 * - hunk는 **파일 순서·hunk 순서·줄 순서로** 예산을 채운다. 한 줄이 넘치면 그 줄부터 뒤는 — 다음
 *   파일의 줄까지 — 전부 버린다(앞쪽 줄만 남긴다). 줄이 하나도 안 남은 hunk는 빠지고, 잘린 hunk는
 *   머리(`oldStart`·`newStart`)를 그대로 둔다. 버린 줄 수는 파일마다 `hunksTruncated`다.
 * - `added`·`removed`는 **자르기 전에** 센다 — 화면의 `+N −M`이 잘린 값이 되지 않게. CLI가 준 값이
 *   있으면(opencode `filediff.additions`) 그것을 두고, hunk가 없으면 지어내지 않는다(null).
 * - `before`가 상한을 넘으면 싣지 않고 `beforeMissing: 'too_large'`다.
 */
export function capEditFiles(
  files: EditFileInput[],
  budget: number = HUNKS_MAX_CHARS,
  beforeMax: number = BEFORE_MAX_CHARS
): EditFileDetail[] {
  let used = 0
  let exhausted = false

  return files.map((file) => {
    const hasHunks = file.hunks.length > 0
    const added = file.added ?? (hasHunks ? countLines(file.hunks, '+') : null)
    const removed = file.removed ?? (hasHunks ? countLines(file.hunks, '-') : null)

    const hunks: PatchHunk[] = []
    let dropped = 0
    for (const hunk of file.hunks) {
      const lines: string[] = []
      for (const line of hunk.lines) {
        if (!exhausted && used + line.length <= budget) {
          lines.push(line)
          used += line.length
        } else {
          exhausted = true
          dropped += 1
        }
      }
      if (lines.length > 0) hunks.push({ ...hunk, lines })
    }

    const tooLarge = file.before !== null && file.before.length > beforeMax
    return {
      path: file.path,
      operation: file.operation,
      hunks,
      hunksTruncated: dropped,
      added,
      removed,
      before: tooLarge ? null : file.before,
      beforeMissing: tooLarge ? 'too_large' : file.beforeMissing
    }
  })
}

/** 우리 MCP 서버가 사는 곳. 여기로 가는 요청은 프록시를 타면 안 된다. */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1']

/**
 * agent에게 물려줄 환경에서 **루프백을 프록시 예외로 못박는다.**
 *
 * MCP 서버는 항상 `127.0.0.1`에 뜬다. 사내 프록시가 잡힌 환경에서 `NO_PROXY`에
 * 루프백이 빠져 있으면 agent의 MCP 요청이 프록시로 나가 닿지 못하고, 30초 뒤
 * 연결 타임아웃으로 죽는다. 실측한 환경에서 정확히 이 증상이 났다 — 같은
 * 포트에 curl은 401을 받는데 agent만 못 붙었다.
 *
 * **기존 값을 지우지 않고 더한다.** 그리고 이 변경은 원격 호출을 건드릴 수
 * 없다 — NO_PROXY는 "어디로 가는 요청을 프록시하지 않을지"를 정할 뿐이라,
 * 루프백을 넣는다고 Bedrock이나 API로 가는 길이 달라지지 않는다.
 *
 * 대소문자 둘 다 쓴다. POSIX는 환경변수를 구분하고, 도구마다 읽는 키가 다르다.
 */
export function withLoopbackBypass(env: NodeJS.ProcessEnv): Record<string, string> {
  const merged = { ...env } as Record<string, string>
  const existing = env['NO_PROXY'] ?? env['no_proxy'] ?? ''
  const hosts = new Set(existing.split(',').map((s) => s.trim()).filter(Boolean))
  for (const host of LOOPBACK_HOSTS) hosts.add(host)
  const value = [...hosts].join(',')
  merged['NO_PROXY'] = value
  merged['no_proxy'] = value
  return merged
}

const NEEDS_ANSWER_MARK = '[NEEDS_ANSWER]'

/**
 * 첫 줄의 [NEEDS_ANSWER] 표식을 떼어낸다.
 *
 * 같은 내용이 assistant 텍스트 블록으로 먼저 흐르고 result에 다시 담기므로,
 * result에서만 벗겨내면 표식이 도크 로그에 날것으로 새어나온다. 두 경로 모두 여기를 쓴다.
 */
export function stripNeedsAnswer(raw: string): { text: string; marked: boolean } {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith(NEEDS_ANSWER_MARK)) return { text: raw, marked: false }
  return { text: trimmed.slice(NEEDS_ANSWER_MARK.length).trimStart(), marked: true }
}
