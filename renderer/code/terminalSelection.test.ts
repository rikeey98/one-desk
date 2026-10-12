import { describe, it, expect } from 'vitest'
import { terminalSelectionBlock } from './terminalSelection'

describe('terminalSelectionBlock', () => {
  it('코드 울타리로 감싸고 끝에 줄바꿈을 둔다', () => {
    expect(terminalSelectionBlock('$ ls\nsrc  test')).toBe('```\n$ ls\nsrc  test\n```\n')
  })

  it('줄 끝 공백·앞뒤 빈 줄·CRLF를 걷고 줄 안의 들여쓰기는 남긴다', () => {
    expect(terminalSelectionBlock('\r\n  a   \r\n    b\t\r\n\r\n')).toBe('```\n  a\n    b\n```\n')
  })

  it('글 안의 backtick 줄보다 긴 울타리를 쓴다', () => {
    expect(terminalSelectionBlock('```js\nx\n```')).toBe('````\n```js\nx\n```\n````\n')
  })

  it('공백뿐이면 null이다', () => {
    expect(terminalSelectionBlock('  \n \r\n')).toBeNull()
  })
})
