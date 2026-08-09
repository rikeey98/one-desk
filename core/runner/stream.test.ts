import { describe, it, expect } from 'vitest'
import { createLineSplitter } from './stream'

describe('createLineSplitter', () => {
  it('완전한 줄을 그대로 넘긴다', () => {
    const lines: string[] = []
    const push = createLineSplitter((l) => lines.push(l))
    push(Buffer.from('a\nb\n'))
    expect(lines).toEqual(['a', 'b'])
  })

  it('줄 경계와 맞지 않는 청크를 이어붙인다', () => {
    const lines: string[] = []
    const push = createLineSplitter((l) => lines.push(l))
    push(Buffer.from('{"ty'))
    push(Buffer.from('pe":"x"}\n'))
    expect(lines).toEqual(['{"type":"x"}'])
  })

  it('멀티바이트 문자가 청크 사이에서 잘려도 깨지지 않는다', () => {
    const lines: string[] = []
    const push = createLineSplitter((l) => lines.push(l))
    const buf = Buffer.from('한글\n', 'utf8')
    push(buf.subarray(0, 2))
    push(buf.subarray(2))
    expect(lines).toEqual(['한글'])
  })

  it('flush가 개행 없이 끝난 마지막 줄을 내보낸다', () => {
    const lines: string[] = []
    const push = createLineSplitter((l) => lines.push(l))
    push(Buffer.from('마지막'))
    push.flush()
    expect(lines).toEqual(['마지막'])
  })

  it('빈 줄은 버린다', () => {
    const lines: string[] = []
    const push = createLineSplitter((l) => lines.push(l))
    push(Buffer.from('a\n\n\nb\n'))
    expect(lines).toEqual(['a', 'b'])
  })
})
