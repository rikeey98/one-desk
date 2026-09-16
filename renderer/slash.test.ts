import { describe, it, expect } from 'vitest'
import { findSlashToken, insertCommand } from './slash'

describe('슬래시 토큰', () => {
  it.each([
    ['/', { start: 0, end: 1, query: '' }],
    ['  /co', { start: 2, end: 5, query: 'co' }],
    ['/a /b', { start: 3, end: 5, query: 'b' }],
    ['hello /co', null],
    ['abc/def', null],
    ['/a 인자 /b', null],
    ['/a ', null]
  ])('%s의 커서 앞 토큰을 판정한다', (text, expected) => {
    expect(findSlashToken(text, text.length)).toEqual(expected)
  })

  it('커서 뒤의 토큰까지 교체하고 이후 지시를 유지한다', () => {
    const token = findSlashToken('/rev 나머지 지시', 2)!
    expect(token).toEqual({ start: 0, end: 4, query: 'r' })
    expect(insertCommand('/rev 나머지 지시', token, 'code-review')).toEqual({
      text: '/code-review 나머지 지시', cursor: 13
    })
  })

  it('스택의 현재 토큰만 바꾸고 공백을 붙인다', () => {
    expect(insertCommand('/a /b', { start: 3, end: 5, query: 'b' }, 'build')).toEqual({
      text: '/a /build ', cursor: 10
    })
  })
})
