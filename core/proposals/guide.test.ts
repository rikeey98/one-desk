import { describe, it, expect } from 'vitest'
import { shouldProposeIssue } from './guide'

const base = {
  mcp: true, assignedIssueId: null, state: { pending: false, declined: false }, fromSchedule: false, home: false
}

describe('shouldProposeIssue (agent-proposals spec FR-15)', () => {
  it('MCP가 있고 할당·기다림·거절이 없는 대화에는 붙인다', () => {
    expect(shouldProposeIssue(base)).toBe(true)
  })

  it('MCP가 없으면 부를 도구가 없다', () => {
    expect(shouldProposeIssue({ ...base, mcp: false })).toBe(false)
  })

  it('이슈가 할당된 대화에는 붙이지 않는다', () => {
    expect(shouldProposeIssue({ ...base, assignedIssueId: 'i1' })).toBe(false)
  })

  it('기다리는 제안이 있으면 붙이지 않는다 — 사람이 답하기 전에 다시 묻지 않는다', () => {
    expect(shouldProposeIssue({ ...base, state: { pending: true, declined: false } })).toBe(false)
  })

  it('거절한 대화에는 붙이지 않는다', () => {
    expect(shouldProposeIssue({ ...base, state: { pending: false, declined: true } })).toBe(false)
  })

  it('정기 실행이 낸 턴에는 붙이지 않는다 — 매시간 새 대화마다 배너가 서지 않게 (scheduled-runs FR-22)', () => {
    expect(shouldProposeIssue({ ...base, fromSchedule: true })).toBe(false)
  })

  it('홈 대화의 턴에는 붙이지 않는다 — 홈에는 이슈가 생길 수 없고 그 MCP 범위에 propose_issue가 없다 (home-conversation FR-7a)', () => {
    expect(shouldProposeIssue({ ...base, home: true })).toBe(false)
  })
})
