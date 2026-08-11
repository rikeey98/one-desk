import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

  it('앱 재시작 시 running은 interrupted로, pending은 canceled로 정리한다', () => {
    const a = runs.create(baseInput())
    runs.markStarted(a.id)
    const b = runs.create(baseInput())

    expect(runs.reapStale()).toBe(2)

    const reaped = runs.get(a.id)
    expect(reaped.status).toBe('interrupted')
    expect(reaped.endedAt).toBeTypeOf('number')
    expect(reaped.errorMessage).toMatch(/중단/)

    // 시작도 못 한 run은 "중단"이 아니다. 그리고 여기서 자동으로 시작하지 않는다 —
    // 앱을 여는 행위가 agent 실행을 불러서는 안 된다.
    const dropped = runs.get(b.id)
    expect(dropped.status).toBe('canceled')
    expect(dropped.endedAt).toBeTypeOf('number')
    expect(dropped.errorMessage).toMatch(/대기/)

    // 복구 후에는 시작을 기다리는 run이 하나도 없다. 대기 큐는 메모리에만 있으므로
    // 여기서 pending이 남으면 영영 시작되지 않는 유령이 된다.
    const alive = runs.list(workspaceId).filter(
      (r) => r.status === 'pending' || r.status === 'running'
    )
    expect(alive).toHaveLength(0)
  })

  it('정리할 것이 없으면 0을 돌려주고 끝난 run은 건드리지 않는다', () => {
    const done = runs.create(baseInput())
    runs.markStarted(done.id)
    runs.markFinished(done.id, {
      status: 'succeeded', resultText: '끝남', externalSessionId: null,
      needsAnswer: false, exitCode: 0, errorMessage: null
    })
    const before = runs.get(done.id)

    expect(runs.reapStale()).toBe(0)

    expect(runs.get(done.id).status).toBe('succeeded')
    expect(runs.get(done.id).endedAt).toBe(before.endedAt)
  })

  describe('readLog', () => {
    let dir: string

    beforeEach(() => { dir = mkdtempSync(resolve(tmpdir(), 'one-desk-log-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    function runWithLog(logPath: string) {
      return runs.create({ ...baseInput(), logPath })
    }

    it('로그 파일의 JSONL을 이벤트 배열로 읽는다', () => {
      const logPath = join(dir, 'stream.jsonl')
      writeFileSync(logPath, [
        JSON.stringify({ type: 'session', runId: 'r', seq: 0, at: 1, sessionId: 's' }),
        JSON.stringify({ type: 'text', runId: 'r', seq: 1, at: 2, text: '안녕' })
      ].join('\n') + '\n')

      const events = runs.readLog(runWithLog(logPath).id)
      expect(events).toHaveLength(2)
      expect(events[1]).toMatchObject({ type: 'text', text: '안녕' })
    })

    it('로그 파일이 없으면 빈 배열을 준다', () => {
      // 취소되거나 spawn 전에 끝난 run은 파일이 없을 수 있다
      expect(runs.readLog(runWithLog(join(dir, '없는.jsonl')).id)).toEqual([])
    })

    it('깨진 줄이 있어도 나머지를 읽는다', () => {
      const logPath = join(dir, 'stream.jsonl')
      writeFileSync(logPath, '{깨진 줄\n' + JSON.stringify({ type: 'text', runId: 'r', seq: 1, at: 2, text: '살아남음' }) + '\n')
      const events = runs.readLog(runWithLog(logPath).id)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ text: '살아남음' })
    })
  })
})
