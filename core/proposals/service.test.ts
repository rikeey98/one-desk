import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTestDb } from '../db/repositories/testing'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createRunRepository, type RunRepository } from '../db/repositories/run'
import { createProposalRepository } from '../db/repositories/proposal'
import { createProposalService } from './service'
import type { Database } from '../db/open'
import type { ConversationIssuePayload } from '@shared/models'

describe('제안 받기·거절 (agent-proposals spec FR-17~20)', () => {
  let db: Database
  let workspaceId: string
  let repoId: string
  let rootRunId: string
  let runs: RunRepository
  const issues = () => createIssueRepository(db)
  const proposals = () => createProposalRepository(db, () => {})
  const service = (runRepo: RunRepository = runs) => createProposalService({
    db, runs: runRepo, issues: issues(), proposals: proposals(), repos: createRepoRepository(db)
  })

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    repoId = createRepoRepository(db).create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    runs = createRunRepository(db)
    rootRunId = runs.create({
      workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp/web', permission: 'read_only',
      userPrompt: '고쳐줘', assembledPrompt: '고쳐줘', logPath: '/tmp/x', context: []
    }).id
  })
  afterEach(() => { db.$client.close() })

  const propose = (over: Partial<ConversationIssuePayload> = {}) => proposals().createIssueProposal({
    workspaceId, rootRunId, runId: rootRunId,
    payload: {
      title: '모바일 로그인 버튼', body: '오버레이가 가로챈다', repoIds: [repoId],
      source: 'dev', kind: 'bug', priority: 'week', existingIssueId: null, ...over
    }
  })

  it('새 이슈로 받으면 고친 제목으로 이슈를 만들고 대화에 할당하고 제안을 accepted로 둔다', () => {
    const p = propose()
    const result = service().accept(p.id, { mode: 'new', title: '  고친 제목  ' })
    expect(result.created).toBe(true)
    expect(result.issue).toMatchObject({
      title: '고친 제목', body: '오버레이가 가로챈다', repoIds: [repoId], source: 'dev', kind: 'bug', priority: 'week'
    })
    expect(result.conversation.issue).toEqual({ id: result.issue.id, title: '고친 제목' })
    expect(runs.get(rootRunId).issue?.id).toBe(result.issue.id)
    expect(proposals().get(p.id)).toMatchObject({ status: 'accepted' })
    expect(proposals().get(p.id).decidedAt).not.toBeNull()
  })

  it('기존 이슈로 받으면 새 이슈를 만들지 않고 그 이슈를 할당한다', () => {
    const existing = issues().create({ workspaceId, title: '로그인 버튼 반응 없음' })
    const p = propose({ existingIssueId: existing.id })
    const result = service().accept(p.id, { mode: 'existing' })
    expect(result.created).toBe(false)
    expect(result.issue.id).toBe(existing.id)
    expect(issues().list({ workspaceId })).toHaveLength(1)
    expect(runs.get(rootRunId).issue?.id).toBe(existing.id)
  })

  it('할당이 실패하면 만든 이슈도 없다 — 한 트랜잭션이다', () => {
    const p = propose()
    const failing: RunRepository = { ...runs, assignIssue: () => { throw new Error('할당 실패') } }
    expect(() => service(failing).accept(p.id, { mode: 'new', title: '제목' })).toThrow('할당 실패')
    expect(issues().list({ workspaceId })).toHaveLength(0)
    expect(proposals().get(p.id).status).toBe('pending')
  })

  it('두 번 받으면 둘째가 실패하고 이슈는 하나다', () => {
    const p = propose()
    service().accept(p.id, { mode: 'new', title: '제목' })
    // 할당을 떼어 둘째 받기가 "이미 처리된 제안"에서 막히는지 본다(할당 검사가 먼저 막으면 이 테스트가 그것을 못 본다)
    runs.assignIssue(rootRunId, null)
    expect(() => service().accept(p.id, { mode: 'new', title: '제목' })).toThrow('이미 처리된 제안입니다')
    expect(issues().list({ workspaceId })).toHaveLength(1)
  })

  it('받기 전에 사람이 할당했으면 실패한다', () => {
    const p = propose()
    const other = issues().create({ workspaceId, title: '손으로 붙인 이슈' })
    runs.assignIssue(rootRunId, other.id)
    expect(() => service().accept(p.id, { mode: 'new', title: '제목' })).toThrow('이미 이슈가 할당돼 있습니다')
    expect(issues().list({ workspaceId })).toHaveLength(1)
  })

  it('제안한 기존 이슈가 지워졌으면 기존으로는 받지 못한다', () => {
    const existing = issues().create({ workspaceId, title: '지울 것' })
    const p = propose({ existingIssueId: existing.id })
    issues().remove(existing.id)
    expect(() => service().accept(p.id, { mode: 'existing' })).toThrow('제안한 이슈가 지워졌습니다')
    expect(proposals().get(p.id).status).toBe('pending')
  })

  it.each([['빈 제목', '   '], ['여러 줄 제목', '첫 줄\n둘째 줄']])('새 이슈의 %s은 거부한다', (_, title) => {
    const p = propose()
    expect(() => service().accept(p.id, { mode: 'new', title })).toThrow()
    expect(issues().list({ workspaceId })).toHaveLength(0)
  })

  it('제안 뒤에 지워진 repo는 빼고 만든다', () => {
    const p = propose()
    createRepoRepository(db).remove(repoId)
    expect(service().accept(p.id, { mode: 'new', title: '제목' }).issue.repoIds).toEqual([])
  })

  it('거절하면 declined로 남고 그 대화의 stateOf가 거절을 본다 — 두 번 거절은 던진다', () => {
    const p = propose()
    expect(service().decline(p.id)).toMatchObject({ status: 'declined' })
    expect(proposals().stateOf(rootRunId)).toEqual({ pending: false, declined: true })
    expect(() => service().decline(p.id)).toThrow('이미 처리된 제안입니다')
  })
})
