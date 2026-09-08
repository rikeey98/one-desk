import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from './frontmatter'

describe('parseFrontmatter', () => {
  it('한 줄 name과 description을 읽는다', () => {
    const text = [
      '---',
      'name: brainstorming',
      'description: Use when facing 2+ independent tasks',
      '---',
      '',
      '# 본문'
    ].join('\n')
    expect(parseFrontmatter(text)).toEqual({
      name: 'brainstorming',
      description: 'Use when facing 2+ independent tasks'
    })
  })

  it('따옴표를 벗긴다', () => {
    const text = '---\nname: x\ndescription: "감싼 한 줄"\n---\n'
    expect(parseFrontmatter(text).description).toBe('감싼 한 줄')
  })

  it('다음 줄부터 들여쓴 여러 줄을 이어붙인다', () => {
    // 실제로 존재하는 모양이다 — math-olympiad/SKILL.md가 이렇다.
    // 이 처리가 없으면 그런 파일의 설명이 조용히 빈칸이 된다.
    const text = [
      '---',
      'name: math-olympiad',
      'description:',
      '  "첫 줄이 이어지고',
      '  둘째 줄도 이어진다."',
      '---'
    ].join('\n')
    expect(parseFrontmatter(text).description).toBe('첫 줄이 이어지고 둘째 줄도 이어진다.')
  })

  it('블록 지시자를 떼고 이어붙인다', () => {
    const text = '---\nname: x\ndescription: >\n  접힌 첫 줄\n  둘째 줄\n---\n'
    expect(parseFrontmatter(text).description).toBe('접힌 첫 줄 둘째 줄')
  })

  it('frontmatter가 없으면 둘 다 null이다', () => {
    expect(parseFrontmatter('# 그냥 마크다운\n내용')).toEqual({ name: null, description: null })
  })

  it('닫는 --- 가 없으면 frontmatter로 보지 않는다', () => {
    expect(parseFrontmatter('---\nname: x\n본문만 이어짐'))
      .toEqual({ name: null, description: null })
  })

  it('모르는 키는 무시한다', () => {
    const text = '---\nname: x\nallowed-tools: Read, Grep\ndescription: 설명\n---\n'
    expect(parseFrontmatter(text)).toEqual({ name: 'x', description: '설명' })
  })

  it('본문에 있는 name: 은 읽지 않는다', () => {
    // 닫는 --- 뒤는 본문이다.
    const text = '---\nname: 진짜\n---\nname: 가짜\n'
    expect(parseFrontmatter(text).name).toBe('진짜')
  })
})
