import { describe, it, expect } from 'vitest'
import { ISSUE_STATUS_LABELS, showsStatusBadge } from './issueStatus'

describe('이슈 상태의 화면 이름 (docs/sdlc/ux-polish/ FR-3)', () => {
  it('세 상태 전부 한국어 이름이 있다 — 영어 enum이 화면에 나가지 않는다', () => {
    expect(ISSUE_STATUS_LABELS).toEqual({ open: '열림', doing: '진행 중', done: '완료' })
  })

  it('기본 상태(열림)는 배지를 그리지 않는다 — 목록 전체가 같은 말을 반복하지 않게', () => {
    expect(showsStatusBadge('open')).toBe(false)
    expect(showsStatusBadge('doing')).toBe(true)
    expect(showsStatusBadge('done')).toBe(true)
  })
})
