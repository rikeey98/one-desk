/**
 * `@` 파일 참조의 문법 (`docs/sdlc/input-triggers/` §5-2).
 *
 * **한 곳뿐이다** — 렌더러(피커의 여는 조건·삽입)와 core(해석·조립의 다시 쓰기)가 같은 함수를 쓴다.
 * 따로 적으면 피커가 넣은 것을 core가 못 읽는다.
 *
 * 멘션의 경계는 **"`@`가 줄머리이거나 공백류 바로 뒤"**다. claude가 프롬프트의 `@경로`를 스스로
 * 펼치는 조건이 정확히 이것이다(spec §6 실측 — `x@…`·`(@…`·`"@…`는 펼치지 않고 탭 뒤는 펼친다).
 * 그래서 이 경계를 좁히면 중화(`rewriteMentions`)에 구멍이 난다.
 */

/** 해석되지 않은 멘션의 `@`를 바꿀 글자 — claude가 펼치지 않는다(spec §6의 M3) */
export const NEUTRAL_AT = '＠'

export interface MentionToken {
  /** `@`의 자리 */
  start: number
  /** 토큰 끝(캐럿 뒤로 이어진 글자까지) */
  end: number
  /** `@`(와 여는 따옴표) 뒤에서 캐럿까지 */
  query: string
  quoted: boolean
}

export interface Mention {
  start: number
  end: number
  /** `@` 뒤의 글. 따옴표 형식이면 따옴표 안쪽 */
  raw: string
  quoted: boolean
}

/** 캐럿 앞의 열린 `@` 토큰 (FR-1). 없으면 null. */
export function findMentionToken(text: string, cursor: number): MentionToken | null {
  const before = text.slice(0, cursor)
  const quoted = /(?:^|\s)@"([^"\n]*)$/.exec(before)
  if (quoted) {
    const start = cursor - quoted[1]!.length - 2
    const rest = text.slice(cursor).match(/^[^"\n]*"?/)?.[0] ?? ''
    return { start, end: cursor + rest.length, query: quoted[1]!, quoted: true }
  }
  const plain = /(?:^|\s)@([^\s"]*)$/.exec(before)
  if (!plain) return null
  const start = cursor - plain[1]!.length - 1
  const rest = text.slice(cursor).match(/^\S*/)?.[0] ?? ''
  return { start, end: cursor + rest.length, query: plain[1]!, quoted: false }
}

/** 피커가 넣는 글자. 공백이 있거나 따옴표로 시작하는 경로는 따옴표 형식이다 (FR-3). */
export function formatMention(path: string): string {
  return /\s/.test(path) || path.startsWith('"') ? `@"${path}" ` : `@${path} `
}

/** 토큰 자리에 멘션을 넣는다. 뒤에 붙어 있던 공백 하나는 겹치지 않게 먹는다(`insertCommand`와 같다). */
export function insertMention(text: string, token: MentionToken, path: string): { text: string; cursor: number } {
  const inserted = formatMention(path)
  const after = text.slice(token.end).replace(/^ /, '')
  return {
    text: text.slice(0, token.start) + inserted + after,
    cursor: token.start + inserted.length
  }
}

/** 글 안의 멘션 전부 (FR-8). `@` 뒤가 비어도 멘션이다 — 중화할 대상이다. */
export function scanMentions(text: string): Mention[] {
  const out: Mention[] = []
  const re = /(^|\s)@("[^"\n]*"|\S*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[1]!.length
    const body = match[2]!
    const quoted = body.length >= 2 && body.startsWith('"') && body.endsWith('"')
    out.push({
      start,
      end: start + 1 + body.length,
      raw: quoted ? body.slice(1, -1) : body,
      quoted
    })
    // 빈 멘션(`@` 뒤 공백)에서 제자리를 돌지 않게 한다.
    if (match[0].length === 0) re.lastIndex++
  }
  return out
}

/**
 * 멘션이 가리키는 파일 (FR-8). **가장 긴 앞부분이 목록에 정확히 있는** 파일이다 — 손으로 친
 * `@src/a.ts를`·`@src/a.ts,`를 잡으려는 것이다. 따옴표 형식은 정확히 같을 때만이다.
 * Windows에서는 `\`를 `/`로 바꿔 한 번 더 찾는다(목록은 git이 준 `/` 구분이다).
 */
export function longestFileMatch(
  mention: Pick<Mention, 'raw' | 'quoted'>, files: ReadonlySet<string>, platform: string
): string | null {
  const candidates = [mention.raw]
  if (platform === 'win32' && mention.raw.includes('\\')) candidates.push(mention.raw.replace(/\\/g, '/'))
  for (const raw of candidates) {
    if (mention.quoted) {
      if (files.has(raw)) return raw
      continue
    }
    for (let length = raw.length; length > 0; length--) {
      const prefix = raw.slice(0, length)
      if (files.has(prefix)) return prefix
    }
  }
  return null
}

/**
 * CLI에 보낼 지시문 (FR-12). `resolvedStarts`에 든 멘션(해석된 것)은 `@`만 떼고, 나머지 멘션은 `@`를
 * `NEUTRAL_AT`으로 바꾼다. 글자에 붙은 `@`(이메일 등)는 멘션이 아니라 그대로다. 바꾸는 것은 언제나
 * `@` 한 글자라 다른 자리의 위치는 변하지 않는다 — `@`가 없으면 글자 하나 바뀌지 않는다.
 */
export function rewriteMentions(text: string, resolvedStarts: ReadonlySet<number>): string {
  const mentions = scanMentions(text)
  if (mentions.length === 0) return text
  let out = ''
  let last = 0
  for (const m of mentions) {
    out += text.slice(last, m.start) + (resolvedStarts.has(m.start) ? '' : NEUTRAL_AT)
    last = m.start + 1
  }
  return out + text.slice(last)
}
