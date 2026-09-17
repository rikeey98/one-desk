import { describe, it, expect } from 'vitest'
import { findSlashToken, insertCommand, matchCommands, commonPrefix, extendCommand } from './slash'

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

describe('커맨드 매칭', () => {
  const cmd = (name: string, description: string | null = null) => ({ name, description, usesArguments: false })
  const commands = [
    cmd('prepare', '준비'),
    cmd('review', '코드 검사'),
    cmd('args', 'review와 비슷'),
    cmd('deploy'),
    cmd('review-all', '전체 검사')
  ]
  const names = (query: string) => matchCommands(commands, query).map((c) => c.name)

  it('빈 질의는 원래 순서 그대로 전부 준다', () => {
    expect(names('')).toEqual(['prepare', 'review', 'args', 'deploy', 'review-all'])
  })

  it('앞글자 일치 > 이름 중간 일치 > 설명 일치 순으로 세운다', () => {
    // 'review'·'review-all'은 앞글자, 'prepare'는 중간(p-re-pare), 'args'는 설명에서만 걸린다.
    expect(names('re')).toEqual(['review', 'review-all', 'prepare', 'args'])
  })

  it('같은 등급 안에서는 원래 순서를 지킨다', () => {
    expect(names('review')).toEqual(['review', 'review-all', 'args'])
  })

  it('대소문자를 가리지 않는다', () => {
    expect(names('RE')).toEqual(['review', 'review-all', 'prepare', 'args'])
  })

  it('글자를 순서대로 건너뛴 것도 잡는다 — 정확한 일치보다 뒤에 온다', () => {
    // r·v·w가 이 순서로 들어 있는 이름. 어디에도 'rvw'가 붙어 있지는 않다.
    expect(names('rvw')).toEqual(['review', 'review-all'])
  })

  it('세 글자부터는 한 글자 오타를 봐준다', () => {
    expect(names('reveiw')).toEqual(['review', 'review-all'])   // 자리바꿈
    expect(names('deploi')).toEqual(['deploy'])                 // 치환
    expect(names('depoy')).toEqual(['deploy'])                  // 빠짐
    expect(names('deploky')).toEqual(['deploy'])                // 끼어듦
  })

  it('두 글자 이하는 오타를 봐주지 않는다 — 그 길이에서는 거의 다 걸린다', () => {
    expect(names('dx')).toEqual([])
  })

  it('완전히 다른 것은 걸러낸다', () => {
    expect(names('zzz')).toEqual([])
  })
})

describe('공통 접두어', () => {
  it('후보 이름들이 공유하는 앞부분을 준다', () => {
    expect(commonPrefix(['review-pr', 'review-all', 'review'])).toBe('review')
  })

  it('공유하는 게 없으면 빈 문자열이다', () => {
    expect(commonPrefix(['review', 'args'])).toBe('')
    expect(commonPrefix([])).toBe('')
  })

  it('하나뿐이면 그 이름 전체다', () => {
    expect(commonPrefix(['deploy'])).toBe('deploy')
  })
})

describe('토큰 늘리기', () => {
  it('공백을 붙이지 않고 토큰만 바꾼다 — 피커가 열린 채로 남아야 한다', () => {
    const token = findSlashToken('/rev', 4)!
    expect(extendCommand('/rev', token, 'review-')).toEqual({ text: '/review-', cursor: 8 })
  })

  it('토큰 뒤 지시는 그대로 둔다', () => {
    const token = findSlashToken('/rev 나머지', 4)!
    expect(extendCommand('/rev 나머지', token, 'review-')).toEqual({ text: '/review- 나머지', cursor: 8 })
  })
})
