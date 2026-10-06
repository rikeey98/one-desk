import { describe, it, expect } from 'vitest'
import { splitTitleBody } from './titleBody'

describe('splitTitleBody — 첫 줄이 제목, 나머지가 본문', () => {
  it('한 줄이면 제목만 있다', () => {
    expect(splitTitleBody('  로그인 토큰이 만료된다  ')).toEqual({ title: '로그인 토큰이 만료된다', body: '' })
  })

  it('첫 줄이 제목이고 나머지가 본문이다 — 본문의 줄바꿈·들여쓰기는 그대로다', () => {
    expect(splitTitleBody('로그인 깨짐\n재현:\n  1. 하루 뒤 접속\n  2. 401')).toEqual({
      title: '로그인 깨짐',
      body: '재현:\n  1. 하루 뒤 접속\n  2. 401'
    })
  })

  it('본문 앞의 빈 줄은 걷는다', () => {
    expect(splitTitleBody('제목\n\n  \n본문')).toEqual({ title: '제목', body: '본문' })
  })

  it('첫 줄이 길어도 자르지 않는다', () => {
    const long = '가'.repeat(200)
    expect(splitTitleBody(`${long}\n본문`).title).toBe(long)
  })

  it('첫 줄의 마크다운 제목 표시는 뗀다', () => {
    expect(splitTitleBody('## 회의 정리\n내용')).toEqual({ title: '회의 정리', body: '내용' })
    // 표시만 있는 줄은 그대로 둔다 — 빈 제목을 만들지 않는다.
    expect(splitTitleBody('#해시태그').title).toBe('#해시태그')
  })

  it('CRLF도 줄로 가른다', () => {
    expect(splitTitleBody('제목\r\n본문')).toEqual({ title: '제목', body: '본문' })
  })
})
