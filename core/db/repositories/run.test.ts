import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inArray } from 'drizzle-orm'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createIssueRepository } from './issue'
import { createRunRepository } from './run'
import { run } from '../schema'
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

  describe('인박스', () => {
    /** 끝난 run을 하나 만든다. 인박스 조건은 종료 상태만 본다. */
    function finished(status: 'succeeded' | 'failed' | 'interrupted' | 'canceled', extra: {
      needsAnswer?: boolean
      workspaceId?: string
    } = {}) {
      const created = runs.create({
        ...baseInput(),
        ...(extra.workspaceId ? { workspaceId: extra.workspaceId } : {})
      })
      return runs.markFinished(created.id, {
        status,
        resultText: null,
        externalSessionId: null,
        needsAnswer: extra.needsAnswer ?? false,
        exitCode: null,
        errorMessage: null
      })
    }

    it('종료된 run 중 확인하지 않은 것만 담는다', () => {
      const done = finished('succeeded')
      const failed = finished('failed')
      const stopped = finished('interrupted')
      // 앱이 재시작하며 취소한 대기 run — 사용자가 취소한 것이 아니므로 알려야 한다.
      const dropped = finished('canceled')
      // 아직 도는 중인 run은 인박스가 아니다.
      const running = runs.create(baseInput())
      runs.markStarted(running.id)

      const ids = runs.inbox().map((r) => r.id)
      expect(ids).toContain(done.id)
      expect(ids).toContain(failed.id)
      expect(ids).toContain(stopped.id)
      expect(ids).toContain(dropped.id)
      expect(ids).not.toContain(running.id)
    })

    it('확인한 run은 목록에서 빠진다', () => {
      const done = finished('succeeded')
      expect(runs.inbox().map((r) => r.id)).toContain(done.id)

      runs.markReviewed(done.id, 'confirmed')

      expect(runs.inbox().map((r) => r.id)).not.toContain(done.id)
      const after = runs.get(done.id)
      expect(after.reviewedAt).toBeTypeOf('number')
      expect(after.reviewedKind).toBe('confirmed')
    })

    it('이미 확인한 run에 다시 불러도 처음 시각을 덮어쓰지 않는다', () => {
      // 처음 확인한 때가 기록으로서 의미가 있다.
      const done = finished('succeeded')
      // 두 markReviewed 호출이 실제로는 같은 밀리초에 떨어질 수 있어 시각이
      // 우연히 같아 보일 수 있다. Date.now를 통제해 서로 다른 값을 물려야
      // 가드가 없을 때 둘째 값으로 덮이는 회귀를 확실히 잡는다.
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
      const first = runs.markReviewed(done.id, 'confirmed')
      const second = runs.markReviewed(done.id, 'archived')
      nowSpy.mockRestore()

      expect(first.reviewedAt).toBe(1000)
      expect(second.reviewedAt).toBe(first.reviewedAt)
      expect(second.reviewedKind).toBe('confirmed')
    })

    it('최신 종료 순으로 정렬하고 같은 밀리초는 삽입 순의 역순으로 가른다', () => {
      // endedAt만으로는 같은 밀리초에 끝난 항목들의 순서가 흔들린다.
      const a = finished('succeeded')
      const b = finished('succeeded')
      const c = finished('succeeded')
      // markFinished를 세 번 연달아 불러도 실제 DB 쓰기 시간 때문에 endedAt이
      // 자연스럽게 갈라진다 — tie-break(rowid)를 검증하려면 동률을 직접 만들어야
      // 한다. 그렇지 않으면 이 테스트는 desc(endedAt) 정렬만 확인하고 rowid
      // tie-break가 지워져도 통과한다.
      const tie = Date.now()
      db.update(run).set({ endedAt: tie }).where(inArray(run.id, [a.id, b.id, c.id])).run()

      const listed = runs.inbox().map((r) => r.id)
      expect(listed.slice(0, 3)).toEqual([c.id, b.id, a.id])
    })

    it('전체와 workspace별 건수를 센다', () => {
      const other = createWorkspaceRepository(db).create({ name: 'ws2' }).id
      finished('succeeded')
      finished('failed')
      finished('succeeded', { workspaceId: other })

      const counts = runs.inboxCounts()
      expect(counts.total).toBe(3)
      expect(counts.byWorkspace[workspaceId]).toBe(2)
      expect(counts.byWorkspace[other]).toBe(1)
    })

    it('미처리가 없는 workspace는 키가 없다 (회귀 가드가 아니라 계약 진술)', () => {
      // 0을 키로 넣으면 배지가 0을 그리게 되고, 0이 상시 붙으면 눈이 걸러낸다.
      //
      // 정직하게 밝혀둔다: 이 단언은 한 줄 회귀를 잡지 못한다. inboxCounts가
      // 지금처럼 GROUP BY 결과 행만으로 byWorkspace를 채우는 한, 매칭 행이
      // 0인 workspace는 애초에 결과 행이 될 수 없어 키도 생길 수 없다 —
      // 구조적으로 항상 성립한다. 이 테스트가 실제로 잡는 것은 나중에 누군가
      // "모든 workspace를 미리 훑어 0으로 채우는" 식으로 구현을 다시 쓸 때뿐이다.
      const other = createWorkspaceRepository(db).create({ name: 'ws2' }).id
      finished('succeeded')
      expect(runs.inboxCounts().byWorkspace[other]).toBeUndefined()
    })
  })
})
