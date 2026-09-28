import { describe, it, expect } from 'vitest'
import {
  findMentionToken, insertMention, formatMention, scanMentions, longestFileMatch, rewriteMentions,
  NEUTRAL_AT
} from './mentions'

/** `|`로 캐럿 자리를 적은 문자열을 (글, 캐럿)으로 푼다. */
function at(marked: string): [string, number] {
  const cursor = marked.indexOf('|')
  return [marked.replace('|', ''), cursor]
}

describe('findMentionToken (FR-1)', () => {
  it('줄머리·줄 가운데(공백 뒤)에서 열리고, 글자에 붙은 @에서는 열리지 않는다', () => {
    expect(findMentionToken(...at('@ab|'))).toEqual({ start: 0, end: 3, query: 'ab', quoted: false })
    expect(findMentionToken(...at('보고 @ab|'))).toEqual({ start: 3, end: 6, query: 'ab', quoted: false })
    expect(findMentionToken(...at('a@b|'))).toBeNull()
    expect(findMentionToken(...at('줄\n@ab|'))).toMatchObject({ start: 2, query: 'ab' })
    expect(findMentionToken(...at('a\t@ab|'))).toMatchObject({ start: 2, query: 'ab' })
  })

  it('캐럿이 토큰 가운데면 end는 토큰 끝이다', () => {
    expect(findMentionToken(...at('@a|bc 뒤'))).toEqual({ start: 0, end: 4, query: 'a', quoted: false })
  })

  it('빈 질의 @|에서도 열린다', () => {
    expect(findMentionToken(...at('봐 @|'))).toEqual({ start: 2, end: 3, query: '', quoted: false })
  })

  it('따옴표 형식은 닫는 따옴표 전까지가 질의이고, 닫은 뒤 공백이면 닫힌다', () => {
    expect(findMentionToken(...at('@"a b|'))).toEqual({ start: 0, end: 5, query: 'a b', quoted: true })
    expect(findMentionToken(...at('@"a b" |'))).toBeNull()
  })

  it('공백을 지나면 닫힌다', () => {
    expect(findMentionToken(...at('@ab |'))).toBeNull()
  })
})

describe('insertMention·formatMention (FR-3)', () => {
  it('토큰을 `@경로 `로 바꾸고 캐럿은 공백 뒤다. 뒤의 글은 남는다', () => {
    const [text, cursor] = at('봐 @no| 그리고')
    const token = findMentionToken(text, cursor)!
    expect(insertMention(text, token, 'notes/a.txt')).toEqual({
      text: '봐 @notes/a.txt 그리고', cursor: '봐 @notes/a.txt '.length
    })
  })

  it('공백이 있거나 따옴표로 시작하는 경로는 따옴표 형식이다', () => {
    expect(formatMention('a.ts')).toBe('@a.ts ')
    expect(formatMention('my notes/a b.txt')).toBe('@"my notes/a b.txt" ')
    expect(formatMention('"odd.txt')).toBe('@""odd.txt" ')
  })
})

describe('scanMentions (FR-8)', () => {
  it('줄머리·공백류 뒤의 @만 찾는다 — 이메일과 글자에 붙은 @는 아니다', () => {
    const found = scanMentions('@a.ts 와 b@c.com 그리고\n@d.ts\t@e.ts x@f')
    expect(found.map((m) => m.raw)).toEqual(['a.ts', 'd.ts', 'e.ts'])
    expect(found[0]).toEqual({ start: 0, end: 5, raw: 'a.ts', quoted: false })
  })

  it('따옴표 형식을 하나의 멘션으로 본다', () => {
    const found = scanMentions('봐 @"a b.txt" 끝')
    expect(found).toEqual([{ start: 2, end: 12, raw: 'a b.txt', quoted: true }])
  })

  it('@ 뒤가 비어도 멘션이다 — 중화할 대상이다', () => {
    expect(scanMentions('끝 @')).toEqual([{ start: 2, end: 3, raw: '', quoted: false }])
  })
})

describe('longestFileMatch (FR-8)', () => {
  const files = new Set(['src/a.ts', 'src/a.tsx', 'notes/a.txt'])

  it('한국어 조사·문장 부호가 붙어도 가장 긴 앞부분이 파일이면 잡는다', () => {
    expect(longestFileMatch({ raw: 'src/a.ts를', quoted: false }, files, 'linux')).toBe('src/a.ts')
    expect(longestFileMatch({ raw: 'notes/a.txt,', quoted: false }, files, 'linux')).toBe('notes/a.txt')
  })

  it('더 긴 파일이 있으면 그것이 이긴다', () => {
    expect(longestFileMatch({ raw: 'src/a.tsx를', quoted: false }, files, 'linux')).toBe('src/a.tsx')
  })

  it('목록에 없으면 null이다', () => {
    expect(longestFileMatch({ raw: '../x/.env', quoted: false }, files, 'linux')).toBeNull()
    expect(longestFileMatch({ raw: '', quoted: false }, files, 'linux')).toBeNull()
  })

  it('Windows에서만 역슬래시를 슬래시로 바꿔 한 번 더 찾는다', () => {
    expect(longestFileMatch({ raw: 'src\\a.ts', quoted: false }, files, 'win32')).toBe('src/a.ts')
    expect(longestFileMatch({ raw: 'src\\a.ts', quoted: false }, files, 'linux')).toBeNull()
  })

  it('줄 범위 #10-20이 붙으면 앞의 파일을 잡는다 (spec §7의 8)', () => {
    expect(longestFileMatch({ raw: 'src/a.ts#10-20', quoted: false }, files, 'linux')).toBe('src/a.ts')
  })

  it('따옴표 형식은 정확히 같을 때만이다', () => {
    const spaced = new Set(['my notes/a b.txt'])
    expect(longestFileMatch({ raw: 'my notes/a b.txt', quoted: true }, spaced, 'linux')).toBe('my notes/a b.txt')
    expect(longestFileMatch({ raw: 'my notes/a b.txt를', quoted: true }, spaced, 'linux')).toBeNull()
  })
})

describe('rewriteMentions (FR-12)', () => {
  it('해석된 멘션은 @만 떼고, 나머지는 전각 ＠로 바꾸고, 글자에 붙은 @는 그대로다', () => {
    const text = '@src/a.ts를 보고 @../x/.env 도 a@b.com'
    const resolved = new Set([0])
    expect(rewriteMentions(text, resolved)).toBe(`src/a.ts를 보고 ${NEUTRAL_AT}../x/.env 도 a@b.com`)
  })

  it('따옴표 형식도 @만 뗀다', () => {
    expect(rewriteMentions('봐 @"a b.txt"', new Set([2]))).toBe('봐 "a b.txt"')
  })

  it('@가 없으면 글자 하나 바뀌지 않는다', () => {
    const text = '  그냥 지시\n둘째 줄 '
    expect(rewriteMentions(text, new Set())).toBe(text)
  })
})
