import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { decodeText, detectEol, encodeText, hashBytes, splitBom } from './text'

const utf8 = (s: string) => Buffer.from(s, 'utf8')
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

/** 바이트 → 판정 → `\n` 텍스트 → 되살린 바이트. 고치지 않았으면 원래 바이트와 같아야 한다 (spec FR-18). */
function roundTrip(bytes: Buffer): Buffer {
  const { bom, body } = splitBom(bytes)
  const decoded = decodeText(body.toString('utf8'))
  if (decoded.eol === 'mixed') throw new Error('섞인 줄바꿈은 되살리지 않는다')
  return encodeText(decoded.text, decoded.eol, bom)
}

describe('detectEol', () => {
  it.each([
    ['a\nb\n', 'lf'],
    ['a\r\nb\r\n', 'crlf'],
    ['한 줄', 'none'],
    ['', 'none'],
    ['a\r\nb\n', 'mixed'],
    // 외톨이 \r(옛 Mac)은 LF로도 CRLF로도 되살릴 수 없다 — 섞인 것으로 본다.
    ['a\rb', 'mixed'],
    ['a\r\nb\rc\r\n', 'mixed']
  ] as const)('%j → %s', (content, eol) => {
    expect(detectEol(content)).toBe(eol)
  })
})

describe('decodeText', () => {
  it('CRLF 파일은 \\n 텍스트로 준다', () => {
    expect(decodeText('a\r\nb\r\n')).toEqual({ text: 'a\nb\n', eol: 'crlf' })
  })

  it('LF 파일은 그대로다', () => {
    expect(decodeText('a\nb')).toEqual({ text: 'a\nb', eol: 'lf' })
  })

  it('섞인 파일도 보여 줄 수는 있게 \\n 텍스트로 준다 — 저장은 막힌다', () => {
    expect(decodeText('a\r\nb\rc\n')).toEqual({ text: 'a\nb\nc\n', eol: 'mixed' })
  })
})

describe('splitBom', () => {
  it('UTF-8 BOM을 떼고 있었다고 말한다', () => {
    const { bom, body } = splitBom(Buffer.concat([BOM, utf8('x')]))
    expect(bom).toBe(true)
    expect(body.equals(utf8('x'))).toBe(true)
  })

  it('없으면 그대로다', () => {
    const { bom, body } = splitBom(utf8('x'))
    expect(bom).toBe(false)
    expect(body.equals(utf8('x'))).toBe(true)
  })
})

describe('되살리기 (FR-18)', () => {
  it.each([
    ['LF', utf8('const a = 1\nconst b = 2\n')],
    ['CRLF', utf8('const a = 1\r\nconst b = 2\r\n')],
    ['끝 개행 없음', utf8('const a = 1\r\nconst b = 2')],
    ['한 줄', utf8('only')],
    ['빈 파일', Buffer.alloc(0)],
    ['BOM + CRLF', Buffer.concat([BOM, utf8('가\r\n나\r\n')])],
    ['BOM만', BOM]
  ])('%s 파일은 고치지 않으면 바이트가 그대로다', (_name, bytes) => {
    expect(roundTrip(bytes).equals(bytes)).toBe(true)
  })

  it('CRLF 파일에 \\n 텍스트를 쓰면 CRLF로 나간다', () => {
    expect(encodeText('a\nb\nc', 'crlf', false).equals(utf8('a\r\nb\r\nc'))).toBe(true)
  })

  it('BOM이 있던 파일은 BOM을 다시 붙인다', () => {
    expect(encodeText('x', 'lf', true).equals(Buffer.concat([BOM, utf8('x')]))).toBe(true)
  })

  it('줄바꿈이 없던 파일에 줄을 더하면 LF다', () => {
    expect(encodeText('a\nb', 'none', false).equals(utf8('a\nb'))).toBe(true)
  })
})

describe('hashBytes', () => {
  it('바이트의 sha256 hex다 — BOM과 줄바꿈까지 포함한다', () => {
    const bytes = Buffer.concat([BOM, utf8('a\r\n')])
    expect(hashBytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(hashBytes(utf8('a\r\n'))).not.toBe(hashBytes(utf8('a\n')))
  })
})
