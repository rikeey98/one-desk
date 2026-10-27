import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createIssueRepository } from './issue'
import { createRunRepository } from './run'
import { createProposalRepository, proposalStateOf } from './proposal'
import { proposal } from '../schema'
import type { Database } from '../open'
import type { ConversationIssuePayload } from '@shared/models'
import type { ErrorSink } from '../../errors'

const PAYLOAD: ConversationIssuePayload = {
  title: '로그인 버튼이 모바일에서 안 눌린다', body: '오버레이가 탭을 가로챈다', repoIds: [],
  source: null, kind: 'bug', priority: null, existingIssueId: null
}

describe('ProposalRepository (agent-proposals spec FR-1·FR-4)', () => {
  let db: Database
  let workspaceId: string
  let rootRunId: string
  let onError: ReturnType<typeof vi.fn<ErrorSink>>
  let proposals: ReturnType<typeof createProposalRepository>

  function makeRoot(ws = workspaceId): string {
    return createRunRepository(db).create({
      workspaceId: ws, agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp', permission: 'read_only',
      userPrompt: '고쳐줘', assembledPrompt: '고쳐줘', logPath: '/tmp/x', context: []
    }).id
  }

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    rootRunId = makeRoot()
    onError = vi.fn<ErrorSink>()
    proposals = createProposalRepository(db, onError)
  })

  afterEach(() => { db.$client.close() })

  const propose = (over: Partial<ConversationIssuePayload> = {}, root = rootRunId, ws = workspaceId) =>
    proposals.createIssueProposal({ workspaceId: ws, rootRunId: root, runId: root, payload: { ...PAYLOAD, ...over } })

  it('저장하면 pending으로 서고 payload를 그대로 되돌려 준다', () => {
    const made = propose()
    expect(made).toMatchObject({ kind: 'conversation-issue', status: 'pending', rootRunId, decidedAt: null, payload: PAYLOAD })
    expect(proposals.pendingIn(workspaceId).map((p) => p.id)).toEqual([made.id])
  })

  it('새 제안이 같은 대화의 앞의 것을 갈아끼운다 — 새 행이고 앞의 것은 superseded다', () => {
    const first = propose({ title: '첫 제목' })
    const second = propose({ title: '둘째 제목' })
    expect(second.id).not.toBe(first.id)
    expect(proposals.get(first.id)).toMatchObject({ status: 'superseded' })
    expect(proposals.get(first.id).decidedAt).not.toBeNull()
    expect(proposals.pendingIn(workspaceId).map((p) => p.payload.title)).toEqual(['둘째 제목'])
    // 갈아끼운 뒤에도 같은 대화에 또 제안할 수 있다 — 부분 유니크가 WHERE를 잃으면 여기서 던진다
    expect(() => propose({ title: '셋째' })).not.toThrow()
  })

  it('저장소를 거치지 않은 pending 둘이 막힌다 (부분 유니크 인덱스)', () => {
    const row = (kind: string) => ({
      id: randomUUID(), workspaceId, rootRunId, runId: rootRunId, kind: kind as 'conversation-issue',
      payload: '{}', status: 'pending' as const, createdAt: Date.now()
    })
    db.insert(proposal).values(row('conversation-issue')).run()
    expect(() => db.insert(proposal).values(row('conversation-issue')).run()).toThrow(/UNIQUE/)
  })

  it('다른 종류의 pending 둘은 막지 않는다 (둘째 사이클)', () => {
    const row = () => ({
      id: randomUUID(), workspaceId, rootRunId, runId: rootRunId, kind: 'workspace-tidy' as 'conversation-issue',
      payload: '{}', status: 'pending' as const, createdAt: Date.now()
    })
    db.insert(proposal).values(row()).run()
    expect(() => db.insert(proposal).values(row()).run()).not.toThrow()
  })

  it('pending 목록은 workspace와 상태로 거르고 오래된 순이다', () => {
    const otherWs = createWorkspaceRepository(db).create({ name: 'other' }).id
    const a = propose({ title: 'a' })
    const secondRoot = makeRoot()
    const b = propose({ title: 'b' }, secondRoot)
    propose({ title: '남의 것' }, makeRoot(otherWs), otherWs)
    proposals.decide(a.id, 'declined')
    const thirdRoot = makeRoot()
    const c = propose({ title: 'c' }, thirdRoot)
    expect(proposals.pendingIn(workspaceId).map((p) => p.id)).toEqual([b.id, c.id])
  })

  it('기존 이슈를 붙인다 — 지웠거나 다른 workspace의 이슈면 null', () => {
    const issues = createIssueRepository(db)
    const living = issues.create({ workspaceId, title: '로그인 버튼 반응 없음' })
    const gone = issues.create({ workspaceId, title: '지울 것' })
    const otherWs = createWorkspaceRepository(db).create({ name: 'other' }).id
    const foreign = issues.create({ workspaceId: otherWs, title: '남의 이슈' })

    const withLiving = propose({ existingIssueId: living.id })
    expect(proposals.get(withLiving.id).existingIssue).toEqual({ id: living.id, title: '로그인 버튼 반응 없음', status: 'open' })

    propose({ existingIssueId: gone.id }, makeRoot())
    issues.remove(gone.id)
    propose({ existingIssueId: foreign.id }, makeRoot())
    const byTitle = new Map(proposals.pendingIn(workspaceId).map((p) => [p.payload.existingIssueId, p.existingIssue]))
    expect(byTitle.get(living.id)).not.toBeNull()
    expect(byTitle.get(gone.id)).toBeNull()
    expect(byTitle.get(foreign.id)).toBeNull()
  })

  it('깨진 payload 행은 목록에서 빠지고 onError로 알린다', () => {
    const good = propose()
    db.insert(proposal).values({
      id: randomUUID(), workspaceId, rootRunId: makeRoot(), runId: 'r', kind: 'conversation-issue',
      payload: '{"title":""}', status: 'pending', createdAt: Date.now()
    }).run()
    expect(proposals.pendingIn(workspaceId).map((p) => p.id)).toEqual([good.id])
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('decide는 pending만 받는다 — 두 번 정하면 던진다', () => {
    const made = propose()
    expect(proposals.decide(made.id, 'accepted')).toMatchObject({ status: 'accepted' })
    expect(() => proposals.decide(made.id, 'declined')).toThrow('이미 처리된 제안입니다')
    expect(proposals.get(made.id).status).toBe('accepted')
  })

  it('stateOf는 그 대화의 기다림과 거절을 본다', () => {
    expect(proposalStateOf(db, rootRunId)).toEqual({ pending: false, declined: false })
    const made = propose()
    expect(proposals.stateOf(rootRunId)).toEqual({ pending: true, declined: false })
    proposals.decide(made.id, 'declined')
    expect(proposals.stateOf(rootRunId)).toEqual({ pending: false, declined: true })
  })

  it('workspace를 지우면 제안도 사라진다 (cascade)', () => {
    const made = propose()
    createWorkspaceRepository(db).remove(workspaceId)
    expect(() => proposals.get(made.id)).toThrow()
  })
})
