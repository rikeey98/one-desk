import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createIssueRepository } from './issue'
import { createRunRepository } from './run'
import type { Database } from '../open'

describe('RunRepository', () => {
  let db: Database
  let runs: ReturnType<typeof createRunRepository>
  let workspaceId: string
  let issueId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    createRepoRepository(db).create({ workspaceId, name: 'api', path: '/tmp/api' })
    issueId = createIssueRepository(db).create({ workspaceId, title: '버그' }).id
    runs = createRunRepository(db)
  })

  function baseInput() {
    return {
      workspaceId,
      agentKind: 'claude-code' as const,
      model: null,
      cwd: '/tmp/api',
      permission: 'edit' as const,
      userPrompt: '고쳐줘',
      assembledPrompt: '<task>고쳐줘</task>',
      logPath: '/tmp/logs/r1/stream.jsonl',
      context: [{ type: 'issue' as const, id: issueId }]
    }
  }

  it('생성하면 pending 상태이고 맥락 항목이 함께 저장된다', () => {
    const created = runs.create(baseInput())
    expect(created.status).toBe('pending')
    expect(created.contextItems).toEqual([{ type: 'issue', id: issueId }])
  })

  it('시작과 종료를 기록한다', () => {
    const created = runs.create(baseInput())
    runs.markStarted(created.id)
    const finished = runs.markFinished(created.id, {
      status: 'succeeded',
      resultText: '끝',
      externalSessionId: 'sess-1',
      needsAnswer: false,
      exitCode: 0,
      errorMessage: null
    })
    expect(finished.status).toBe('succeeded')
    expect(finished.startedAt).toBeTypeOf('number')
    expect(finished.endedAt).toBeTypeOf('number')
    expect(finished.externalSessionId).toBe('sess-1')
  })

  it('workspace의 run을 최신순으로 반환한다', () => {
    const a = runs.create(baseInput())
    const b = runs.create(baseInput())
    // 같은 밀리초에 만들어져도 순서가 흔들리면 안 된다
    expect(runs.list(workspaceId).map((r) => r.id)).toEqual([b.id, a.id])
  })

  it('첨부한 이슈를 지워도 run 기록은 남고 항목만 비어 있다', () => {
    const created = runs.create(baseInput())
    createIssueRepository(db).remove(issueId)
    const found = runs.get(created.id)
    expect(found.id).toBe(created.id)
    expect(found.contextItems).toEqual([])
  })

  it('앱 재시작 시 running/pending을 interrupted로 정리한다', () => {
    const a = runs.create(baseInput())
    runs.markStarted(a.id)
    const b = runs.create(baseInput())
    expect(runs.reapStale()).toBe(2)
    expect(runs.get(a.id).status).toBe('interrupted')
    expect(runs.get(b.id).status).toBe('interrupted')
  })
})
