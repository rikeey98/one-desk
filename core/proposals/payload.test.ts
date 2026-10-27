import { describe, it, expect } from 'vitest'
import { conversationIssuePayload, parseIssuePayload } from './payload'

const ok = { title: '로그인 버튼이 모바일에서 안 눌린다' }

describe('conversationIssuePayload (spec FR-2·FR-7)', () => {
  it('빠진 선택 값은 null·빈 값으로 채운다', () => {
    expect(conversationIssuePayload.parse(ok)).toEqual({
      title: ok.title, body: '', repoIds: [], source: null, kind: null, priority: null, existingIssueId: null
    })
  })

  it('제목의 앞뒤 공백을 걷는다', () => {
    expect(conversationIssuePayload.parse({ title: '  고칠 것  ' }).title).toBe('고칠 것')
  })

  it.each([
    ['줄바꿈', 'a\nb'],
    ['빈 값', '   '],
    ['201자', 'x'.repeat(201)]
  ])('제목의 %s을 거부한다', (_, title) => {
    expect(conversationIssuePayload.safeParse({ title }).success).toBe(false)
  })

  it('200자 제목은 받는다', () => {
    expect(conversationIssuePayload.safeParse({ title: 'x'.repeat(200) }).success).toBe(true)
  })

  it('4,001자 본문을 거부한다', () => {
    expect(conversationIssuePayload.safeParse({ ...ok, body: 'x'.repeat(4001) }).success).toBe(false)
    expect(conversationIssuePayload.safeParse({ ...ok, body: 'x'.repeat(4000) }).success).toBe(true)
  })

  it('모르는 축 값을 거부한다', () => {
    expect(conversationIssuePayload.safeParse({ ...ok, kind: 'chore' }).success).toBe(false)
  })

  it('모르는 키는 버린다', () => {
    expect(conversationIssuePayload.parse({ ...ok, extra: 1 })).not.toHaveProperty('extra')
  })
})

describe('parseIssuePayload', () => {
  it('저장한 JSON을 되읽는다', () => {
    const payload = conversationIssuePayload.parse({ ...ok, kind: 'bug', repoIds: ['r1'], existingIssueId: 'i1' })
    expect(parseIssuePayload(JSON.stringify(payload))).toEqual(payload)
  })

  it('깨진 JSON과 스키마에 맞지 않는 값은 null이다', () => {
    expect(parseIssuePayload('{')).toBeNull()
    expect(parseIssuePayload(JSON.stringify({ title: '' }))).toBeNull()
  })
})
