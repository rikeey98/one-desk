import { describe, it, expect } from 'vitest'
import { splitFrontmatter } from './frontmatter'

describe('splitFrontmatter', () => {
  it('맨 앞의 frontmatter를 떼어 낸다', () => {
    expect(splitFrontmatter('---\nname: 배포\ndescription: 절차\n---\n# 제목\n'))
      .toEqual({ front: 'name: 배포\ndescription: 절차', rest: '# 제목\n' })
  })

  it('CRLF와 닫는 줄 뒤의 끝도 받는다', () => {
    expect(splitFrontmatter('---\r\na: 1\r\n---')).toEqual({ front: 'a: 1', rest: '' })
  })

  it('맨 앞이 아니거나 닫히지 않으면 없다', () => {
    expect(splitFrontmatter('본문\n---\na: 1\n---\n')).toEqual({ front: null, rest: '본문\n---\na: 1\n---\n' })
    expect(splitFrontmatter('---\na: 1\n')).toEqual({ front: null, rest: '---\na: 1\n' })
    expect(splitFrontmatter('')).toEqual({ front: null, rest: '' })
  })
})
