import { describe, it, expect } from 'vitest'
import { bannerOf } from './proposal'
import { groupConversations } from './conversation'
import type { IssueProposal, Run } from '@shared/models'

function run(over: Partial<Run> = {}): Run {
  return {
    id: 'c1', workspaceId: 'w1', agentKind: 'claude-code', model: null, effort: null,
    cwd: '/tmp/api', permission: 'read_only', userPrompt: '고쳐줘', assembledPrompt: '', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id ?? 'c1', resultText: null, needsAnswer: false,
    timeoutMs: null, exitCode: 0, errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, title: null, closedAt: null, createdAt: 1, contextItems: [], issue: null, usage: null,
    ...over
  }
}

function proposal(over: Partial<IssueProposal> = {}): IssueProposal {
  return {
    id: 'p1', workspaceId: 'w1', rootRunId: 'c1', runId: 'c1', status: 'pending', createdAt: 1, decidedAt: null,
    kind: 'conversation-issue', existingIssue: null,
    payload: { title: '제목', body: '', repoIds: [], source: null, kind: null, priority: null, existingIssueId: null },
    ...over
  }
}

const conv = (over: Partial<Run> = {}) => groupConversations([run(over)])[0]!

describe('bannerOf (agent-proposals spec FR-21·22)', () => {
  it('이 대화의 기다리는 제안이 있으면 새 이슈 갈래다', () => {
    expect(bannerOf([proposal()], conv())).toEqual({ mode: 'new', proposal: proposal() })
  })

  it('새 대화 칸에는 없다', () => {
    expect(bannerOf([proposal()], null)).toBeNull()
  })

  it('할당된 대화에는 배너가 없다', () => {
    expect(bannerOf([proposal()], conv({ issue: { id: 'i1', title: '이슈' } }))).toBeNull()
  })

  it('다른 대화의 제안은 보지 않는다', () => {
    expect(bannerOf([proposal({ rootRunId: 'c2' })], conv())).toBeNull()
  })

  it('기존 이슈가 살아 있으면 기존 갈래, 지워졌으면(existingIssue null) 새 갈래다', () => {
    const existing = { id: 'i1', title: '로그인 버튼 반응 없음', status: 'open' as const }
    expect(bannerOf([proposal({ existingIssue: existing })], conv())).toMatchObject({ mode: 'existing', existing })
    const gone = proposal({ payload: { ...proposal().payload, existingIssueId: 'i9' }, existingIssue: null })
    expect(bannerOf([gone], conv())).toMatchObject({ mode: 'new' })
  })
})
