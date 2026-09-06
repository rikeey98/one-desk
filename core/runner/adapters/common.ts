/**
 * 어댑터들이 공유하는 것. **CLI에 속한 지식은 여기 두지 않는다** — 도구 이름
 * 판정이나 인자 조립은 각 어댑터의 책임이다 (전체 설계 §329).
 *
 * 여기 있는 셋은 CLI가 아니라 one-desk의 규약에 속한다.
 * - withLoopbackBypass: MCP 서버가 항상 127.0.0.1이라는 우리 쪽 사정
 * - stripNeedsAnswer: [NEEDS_ANSWER] 표식은 우리가 프롬프트로 심은 규약이다
 * - summarize: 로그 길이 정책
 */

export function summarize(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
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
