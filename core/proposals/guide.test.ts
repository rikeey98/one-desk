import { describe, it, expect } from 'vitest'
import { shouldProposeIssue } from './guide'

const base = {
  mcp: true, agentKind: 'claude-code' as const, permission: 'read_only' as const,
  assignedIssueId: null, state: { pending: false, declined: false }
}

describe('shouldProposeIssue (agent-proposals spec FR-15)', () => {
  it('MCP가 있고 할당·기다림·거절이 없는 claude 대화에는 붙인다', () => {
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

  it('OpenCode는 전체 허용에서만 붙인다 — 읽기 전용·편집 허용에서는 MCP 도구가 모델에게 보이지 않는다 (plan 0단계 실측)', () => {
    expect(shouldProposeIssue({ ...base, agentKind: 'opencode', permission: 'read_only' })).toBe(false)
    expect(shouldProposeIssue({ ...base, agentKind: 'opencode', permission: 'edit' })).toBe(false)
    expect(shouldProposeIssue({ ...base, agentKind: 'opencode', permission: 'full' })).toBe(true)
  })
})
