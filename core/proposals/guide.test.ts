import { describe, it, expect } from 'vitest'
import { shouldProposeIssue } from './guide'

const base = {
  mcp: true, assignedIssueId: null, state: { pending: false, declined: false }
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
})
