import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inArray } from 'drizzle-orm'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createIssueRepository } from './issue'
import { createMemoRepository } from './memo'
import { createAssetRepository } from './asset'
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
      effort: null,
      cwd: '/tmp/api',
      permission: 'edit' as const,
      userPrompt: '고쳐줘',
      assembledPrompt: '<task>고쳐줘</task>',
      logPath: '/tmp/logs/r1/stream.jsonl',
      context: [{ type: 'issue' as const, id: issueId }]
    }
  }

  it('effort를 저장하고 그대로 돌려준다', () => {
    // claude면 --effort, opencode면 --variant. 어느 CLI도 실행 결과로 되돌려 주지
    // 않으므로(docs/sdlc/run-info/ 실측) 이 컬럼이 기록의 전부다 — 잃으면
    // "무슨 effort로 돌았나"를 영영 알 수 없다.
    const created = runs.create({ ...baseInput(), effort: 'high' })
    expect(created.effort).toBe('high')
    expect(runs.get(created.id).effort).toBe('high')
  })

  it('effort를 넘기지 않으면 null이다', () => {
    // null이 "그 인자를 붙이지 않았다"이고, 화면의 빈 칸과 같은 자리다.
    const created = runs.create(baseInput())
    expect(created.effort).toBeNull()
  })

  it('생성하면 pending 상태이고 맥락 항목이 함께 저장된다', () => {
    const created = runs.create(baseInput())
    expect(created.status).toBe('pending')
    expect(created.contextItems).toEqual([{ type: 'issue', id: issueId, label: '버그' }])
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
      errorMessage: null,
      usage: null
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

  it('맥락 항목의 이름은 읽는 시점의 이름이다 — 이슈 제목을 바꾸면 따라 바뀐다', () => {
    runs.create(baseInput())
    createIssueRepository(db).update({ id: issueId, title: '토큰 만료 버그' })
    expect(runs.list(workspaceId)[0]!.contextItems)
      .toEqual([{ type: 'issue', id: issueId, label: '토큰 만료 버그' }])
  })

  it('repo·메모·asset에도 이름이 붙는다', () => {
    const repoId = createRepoRepository(db).create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    const memoId = createMemoRepository(db).create({ workspaceId, title: '릴리스 절차' }).id
    const assetId = createAssetRepository(db)
      .createAuthored({ workspaceId, kind: 'skill', name: 'review' }).id
    const created = runs.create({ ...baseInput(), context: [
      { type: 'repo', id: repoId }, { type: 'memo', id: memoId }, { type: 'asset', id: assetId }
    ] })
    expect(runs.get(created.id).contextItems).toEqual([
      { type: 'repo', id: repoId, label: 'web' },
      { type: 'memo', id: memoId, label: '릴리스 절차' },
      { type: 'asset', id: assetId, label: 'review' }
    ])
  })

  // 지워진 asset도 이슈·메모·repo와 똑같이 빠진다. 4단계의 "asset은 테이블이 없어
  // 걸러내지 않는다"를 뒤집은 것 — spec의 확인 필요 항목에서 2026-09-17 승인됐다.
  it('첨부한 asset을 지워도 run 기록은 남고 그 항목만 빠진다', () => {
    const assets = createAssetRepository(db)
    const assetId = assets.createAuthored({ workspaceId, kind: 'skill', name: 'review' }).id
    const created = runs.create({ ...baseInput(), context: [
      { type: 'issue', id: issueId }, { type: 'asset', id: assetId }
    ] })
    assets.remove(assetId)
    expect(runs.get(created.id).contextItems)
      .toEqual([{ type: 'issue', id: issueId, label: '버그' }])
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
      needsAnswer: false, exitCode: 0, errorMessage: null,
      usage: null
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

    it('로그 파일의 JSONL을 이벤트 배열로 읽는다', async () => {
      const logPath = join(dir, 'stream.jsonl')
      writeFileSync(logPath, [
        JSON.stringify({ type: 'session', runId: 'r', seq: 0, at: 1, sessionId: 's' }),
        JSON.stringify({ type: 'text', runId: 'r', seq: 1, at: 2, text: '안녕' })
      ].join('\n') + '\n')

      const events = await runs.readLog(runWithLog(logPath).id)
      expect(events).toHaveLength(2)
      expect(events[1]).toMatchObject({ type: 'text', text: '안녕' })
    })

    it('로그 파일이 없으면 빈 배열을 준다', async () => {
      // 취소되거나 spawn 전에 끝난 run은 파일이 없을 수 있다
      expect(await runs.readLog(runWithLog(join(dir, '없는.jsonl')).id)).toEqual([])
    })

    it('깨진 줄이 있어도 나머지를 읽는다', async () => {
      const logPath = join(dir, 'stream.jsonl')
      writeFileSync(logPath, '{깨진 줄\n' + JSON.stringify({ type: 'text', runId: 'r', seq: 1, at: 2, text: '살아남음' }) + '\n')
      const events = await runs.readLog(runWithLog(logPath).id)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ text: '살아남음' })
    })

    it('파일을 비동기로 읽는다 — 동기로 읽으면 메인 프로세스가 통째로 멈춘다', async () => {
      // `docs/sdlc/conversation-fixes/` spec FR-19. 긴 로그를 readFileSync로 읽는 동안
      // 같은 프로세스의 MCP 서버와 IPC가 전부 멈춘다. 반환값이 Promise라는 것만으로는
      // 부족하다 — async 함수 안에서 readFileSync를 불러도 Promise가 나온다.
      //
      // 그래서 **마이크로태스크만으로는 끝나지 않아야 한다**를 본다. 동기로 읽으면 결과가
      // 이미 정해진 Promise라 마이크로태스크 몇 번이면 풀린다. 진짜 I/O는 이벤트 루프로
      // 돌아가야 완료되므로 그 사이에 풀릴 수 없다. (호출 직후 파일을 지우는 식으로
      // 보면 경합이다 — 스레드 풀이 먼저 열 수 있고, Windows는 열린 파일도 지운다.)
      const logPath = join(dir, 'stream.jsonl')
      writeFileSync(logPath, JSON.stringify({ type: 'text', runId: 'r', seq: 0, at: 1, text: '읽힘' }) + '\n')
      const id = runWithLog(logPath).id

      let settled = false
      const pending = runs.readLog(id).then((events) => { settled = true; return events })
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(settled).toBe(false)

      expect(await pending).toHaveLength(1)
    })

    it('없는 것 말고 읽기 실패는 삼키지 않는다', async () => {
      // 디렉토리를 가리키면(EISDIR) "로그 없음"이 아니라 오류다 — 빈 배열로 바꾸면
      // 화면은 로그가 원래 없던 run으로 보인다.
      await expect(runs.readLog(runWithLog(dir).id)).rejects.toThrow()
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
        errorMessage: null,
        usage: null
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
      // 셋 다 배지가 세는 카테고리(INBOX_RULES의 badge)로 고른다 — 완료·미확인은
      // 배지가 세지 않으므로 (spec FR-4) 그것으로 채우면 이 테스트가 workspace별 집계가 아니라
      // 카테고리 필터를 재확인하는 것이 된다.
      finished('failed')
      finished('interrupted')
      finished('failed', { workspaceId: other })

      const counts = runs.inboxCounts()
      expect(counts.total).toBe(3)
      expect(counts.byWorkspace[workspaceId]).toBe(2)
      expect(counts.byWorkspace[other]).toBe(1)
    })

    /**
     * **배지는 "지금 손이 필요한가"이고 목록은 "아직 안 내린 것"이다** (spec FR-4).
     *
     * 완료·미확인까지 배지가 세면 숫자가 대화 수만큼 단조 증가해 빨간 원의 의미가
     * 사라진다 — 이 기능이 고치려던 증상 그 자체다. 목록에서까지 빼지는 않는다:
     * 인박스는 여전히 "아직 내리지 않은 것"을 전부 보여준다.
     */
    it('완료·미확인 대화는 배지가 세지 않지만 목록에는 남는다', () => {
      const done = finished('succeeded')

      expect(runs.inbox().map((r) => r.id)).toContain(done.id)
      expect(runs.inboxCounts().total).toBe(0)
      expect(runs.inboxCounts().byWorkspace[workspaceId]).toBeUndefined()
    })

    it('대기 중 취소됨도 배지가 세지 않는다', () => {
      // 사용자가 스스로 내린 것이다.
      const dropped = finished('canceled')

      expect(runs.inbox().map((r) => r.id)).toContain(dropped.id)
      expect(runs.inboxCounts().total).toBe(0)
    })

    it('답변 필요·실패·중단됨은 배지가 센다', () => {
      finished('succeeded', { needsAnswer: true })
      finished('failed')
      finished('interrupted')
      // 세지 않는 것 둘을 섞어 두어 필터가 실제로 갈라내는지 본다.
      finished('succeeded')
      finished('canceled')

      expect(runs.inbox()).toHaveLength(5)
      expect(runs.inboxCounts().total).toBe(3)
    })

    it('succeeded여도 needsAnswer면 배지가 센다', () => {
      // 카테고리 판정이 status보다 needsAnswer를 먼저 본다(shared/inbox.ts).
      // 여기서 status만 보면 agent의 질문이 배지에서 통째로 사라진다.
      finished('succeeded', { needsAnswer: true })
      expect(runs.inboxCounts().total).toBe(1)
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
      // 배지가 세는 카테고리로 만든다 — 완료·미확인은 애초에 세지 않아(FR-4)
      // 이 단언이 아무것도 말하지 않게 된다.
      finished('failed')
      expect(runs.inboxCounts().byWorkspace[other]).toBeUndefined()
    })
  })

  describe('대화 단위 인박스', () => {
    function succeed(id: string, sessionId = 'sess') {
      runs.markFinished(id, {
        status: 'succeeded', resultText: null, externalSessionId: sessionId,
        needsAnswer: false, exitCode: 0, errorMessage: null,
        usage: null
      })
    }

    /** 배지가 세는 카테고리로 끝낸다 (shared/inbox.ts의 INBOX_RULES). */
    function fail(id: string, sessionId = 'sess') {
      runs.markFinished(id, {
        status: 'failed', resultText: null, externalSessionId: sessionId,
        needsAnswer: false, exitCode: 1, errorMessage: '깨짐',
        usage: null
      })
    }

    it('3턴 대화가 인박스에 한 줄로 뜬다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      succeed(second.id)
      const third = runs.create({ ...baseInput(), parentRunId: second.id })
      succeed(third.id)

      const items = runs.inbox()
      expect(items).toHaveLength(1)
      // 보여줄 내용은 마지막 턴에서 온다.
      expect(items[0]!.id).toBe(third.id)
      expect(items[0]!.rootRunId).toBe(first.id)
    })

    it('root를 확인하면 대화가 통째로 내려간다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      succeed(second.id)

      runs.markReviewed(first.id, 'confirmed')
      expect(runs.inbox()).toHaveLength(0)
      expect(runs.inboxCounts().total).toBe(0)
    })

    it('마지막 턴이 아직 돌고 있으면 인박스에 없다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      runs.markStarted(second.id)

      expect(runs.inbox()).toHaveLength(0)
    })

    it('건수도 대화 단위로 센다', () => {
      // 마지막 턴을 배지가 세는 카테고리로 끝낸다 — 완료·미확인은 배지가 세지 않으므로
      // (FR-4) succeed로 두면 "대화 단위로 센다"가 아니라 "0이다"를 확인하게 된다.
      const a = runs.create(baseInput())
      succeed(a.id)
      const a2 = runs.create({ ...baseInput(), parentRunId: a.id })
      fail(a2.id)
      const b = runs.create(baseInput())
      fail(b.id)

      expect(runs.inboxCounts().total).toBe(2)
      expect(runs.inboxCounts().byWorkspace[workspaceId]).toBe(2)
    })

    /** 시작하지 못한 채 취소된 예약 턴. startedAt이 null로 남는다. */
    function dropPending(id: string) {
      runs.markFinished(id, {
        status: 'canceled', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: null, errorMessage: null, usage: null
      })
    }

    /**
     * **시작하지 못하고 취소된 예약은 앞 턴의 결과를 가리지 않는다**
     * (`docs/sdlc/conversation-fixes/` spec FR-1·FR-2).
     *
     * 마지막으로 만든 턴을 그대로 쓰면 2턴의 실패가 3턴 예약의 canceled에 가려
     * "대기 중 취소됨"(배지가 세지 않음)이 된다 — 사람이 봐야 할 실패가 사라진다.
     * 목록과 배지가 같은 턴을 보는지 둘 다 확인한다(`lastTurnsOf`가 공유한다).
     */
    it('시작하지 못하고 취소된 마지막 턴은 건너뛰고 앞 턴이 대화를 대표한다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      runs.markStarted(second.id)
      fail(second.id)
      const third = runs.create({ ...baseInput(), parentRunId: second.id })
      dropPending(third.id)

      const items = runs.inbox()
      expect(items).toHaveLength(1)
      expect(items[0]!.id).toBe(second.id)
      // 배지도 같은 턴(실패)을 본다. select에서 startedAt이 빠지면 여기서 드러난다 —
      // 그 컬럼이 없으면 예약을 건너뛰지 못해 0이 된다.
      expect(runs.inboxCounts().total).toBe(1)
    })

    it('앱 재시작 뒤 끊긴 턴이 취소된 예약에 가려 배지에서 빠지지 않는다', () => {
      // 2턴이 도는 중에 3턴을 예약한 채로 앱이 꺼졌다. reapStale은 2턴을
      // interrupted, 3턴을 canceled(startedAt null)로 만든다.
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      runs.markStarted(second.id)
      runs.create({ ...baseInput(), parentRunId: second.id })

      runs.reapStale()

      expect(runs.inbox().map((r) => r.id)).toEqual([second.id])
      expect(runs.inboxCounts().total).toBe(1)
    })

    it('시작한 뒤 취소된 턴은 건너뛰지 않는다', () => {
      // 돌다가 멈춘 것이다 — 그 턴이 대화의 지금 상태다.
      const first = runs.create(baseInput())
      fail(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      runs.markStarted(second.id)
      dropPending(second.id)

      expect(runs.inbox().map((r) => r.id)).toEqual([second.id])
      expect(runs.inboxCounts().total).toBe(0)
    })

    it('모든 턴이 시작하지 못하고 취소됐으면 가장 최근 턴을 보여준다', () => {
      const first = runs.create(baseInput())
      dropPending(first.id)

      expect(runs.inbox().map((r) => r.id)).toEqual([first.id])
      expect(runs.inboxCounts().total).toBe(0)
    })

    it('확인한 대화에 새 턴이 생기면 뿌리의 확인 표시가 풀려 다시 인박스에 뜬다 (CT-3)', () => {
      // markReviewed는 한 번 찍히면 스스로 지워지지 않는다. create()가
      // parentRunId를 받을 때 뿌리의 확인 표시를 지우지 않으면, 한 번이라도
      // "확인함"/"보관"한 대화는 그 뒤로 needs_answer가 다시 떠도 영원히
      // 인박스에 안 뜬다(설계 §5 재개 규칙).
      const first = runs.create(baseInput())
      succeed(first.id)
      runs.markReviewed(first.id, 'confirmed')
      expect(runs.inbox()).toHaveLength(0)
      expect(runs.get(first.id).reviewedAt).toBeTypeOf('number')

      const second = runs.create({ ...baseInput(), parentRunId: first.id })

      // create() 시점에 곧바로 풀린다 — second가 끝나기 전에도 확인된다.
      const root = runs.get(first.id)
      expect(root.reviewedAt).toBeNull()
      expect(root.reviewedKind).toBeNull()

      // 배지까지 되살아나는지 보려면 마지막 턴이 배지가 세는 카테고리여야 한다(FR-4).
      fail(second.id)
      const items = runs.inbox()
      expect(items).toHaveLength(1)
      expect(items[0]!.id).toBe(second.id)
      expect(runs.inboxCounts().total).toBe(1)
    })
  })

  describe('대화 종료와 이름', () => {
    function succeed(id: string) {
      runs.markFinished(id, {
        status: 'succeeded', resultText: null, externalSessionId: 'sess',
        needsAnswer: false, exitCode: 0, errorMessage: null, usage: null
      })
    }

    it('끝내면 종료 시각이 찍힌다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      expect(runs.get(first.id).closedAt).toBeNull()

      const closed = runs.close(first.id)

      expect(closed.closedAt).toBeTypeOf('number')
      expect(runs.get(first.id).closedAt).toBe(closed.closedAt)
    })

    /**
     * **종료는 확인도 겸한다** (spec FR-12). 겸하지 않으면 끝낸 대화가 배지에 남아
     * 종료의 의미가 사라진다 — 도크 목록에서는 사라졌는데 빨간 숫자는 그대로인
     * 상태가 되고, 그때는 내릴 방법조차 없다(인박스의 그 줄이 가리키는 대화를
     * 도크에서 열 수 없으므로).
     */
    it('끝내면 아직 미확인이던 대화가 인박스에서도 내려간다', () => {
      const first = runs.create(baseInput())
      runs.markFinished(first.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: '깨짐', usage: null
      })
      expect(runs.inboxCounts().total).toBe(1)

      const closed = runs.close(first.id)

      expect(closed.reviewedAt).toBeTypeOf('number')
      expect(closed.reviewedKind).toBe('archived')
      expect(runs.inbox()).toHaveLength(0)
      expect(runs.inboxCounts().total).toBe(0)
    })

    it('이미 확인한 대화를 끝내도 처음 확인 시각을 덮어쓰지 않는다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1000)
      runs.markReviewed(first.id, 'confirmed')
      nowSpy.mockRestore()

      const closed = runs.close(first.id)

      expect(closed.reviewedAt).toBe(1000)
      expect(closed.reviewedKind).toBe('confirmed')
      expect(closed.closedAt).toBeTypeOf('number')
    })

    /**
     * **찍는 자리(종료)와 지우는 자리(새 턴)는 짝이다** (spec FR-13).
     *
     * `create()`가 뿌리의 `reviewedAt`을 지우는 바로 그 자리에서 `closedAt`도
     * 지운다. 한쪽만 두면 끝낸 대화에 턴을 보냈을 때 화면에서는 영영 사라진 채로
     * 실행만 되는 상태가 된다.
     */
    it('끝낸 대화에 턴을 이으면 종료가 풀린다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      runs.close(first.id)
      expect(runs.get(first.id).closedAt).toBeTypeOf('number')

      runs.create({ ...baseInput(), parentRunId: first.id })

      const root = runs.get(first.id)
      expect(root.closedAt).toBeNull()
      expect(root.reviewedAt).toBeNull()
    })

    it('새 대화를 만드는 것으로는 남의 종료가 풀리지 않는다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      runs.close(first.id)

      // parentRunId 없이 만든 run은 자기 자신이 뿌리다 — 남의 행을 건드리면 안 된다.
      runs.create(baseInput())

      expect(runs.get(first.id).closedAt).toBeTypeOf('number')
    })

    it('이름을 붙이고 지운다', () => {
      const first = runs.create(baseInput())
      expect(first.title).toBeNull()

      expect(runs.rename(first.id, '로그인 정리').title).toBe('로그인 정리')
      expect(runs.get(first.id).title).toBe('로그인 정리')

      // 빈 문자열은 null로 저장해 **파생으로 되돌린다** (spec FR-14, workspace
      // 기본값의 "빈 모델은 null"과 같은 규칙). 빈 문자열로 저장하면 화면이
      // 이름 없는 대화를 빈 제목으로 그린다.
      expect(runs.rename(first.id, '   ').title).toBeNull()
      expect(runs.get(first.id).title).toBeNull()
    })

    /**
     * `title`·`closed_at`이 뿌리 행에서만 의미가 있다는 규칙을 **타입은 지켜주지
     * 않는다** — 이어지는 턴의 행에도 컬럼이 있고 null일 뿐이다. 이 검증이 유일한
     * 방어선이다 (spec 우려 6).
     */
    it('뿌리가 아닌 턴에는 이름을 붙일 수 없다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })

      expect(() => runs.rename(second.id, '아무거나')).toThrow(/뿌리/)
      expect(runs.get(second.id).title).toBeNull()
    })

    it('뿌리가 아닌 턴은 끝낼 수 없다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })

      expect(() => runs.close(second.id)).toThrow(/뿌리/)
      expect(runs.get(second.id).closedAt).toBeNull()
    })

    it('없는 id는 NotFound다', () => {
      expect(() => runs.close('없음')).toThrow()
      expect(() => runs.rename('없음', 'x')).toThrow()
    })
  })

  describe('rootRunId', () => {
    it('부모가 없으면 자기 자신이 뿌리다', () => {
      const first = runs.create(baseInput())
      expect(first.rootRunId).toBe(first.id)
    })

    it('부모가 있으면 부모의 뿌리를 물려받는다', () => {
      const first = runs.create(baseInput())
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      expect(second.rootRunId).toBe(first.id)
    })

    it('3단 체인이 전부 같은 뿌리를 갖는다', () => {
      const first = runs.create(baseInput())
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      const third = runs.create({ ...baseInput(), parentRunId: second.id })
      expect(third.rootRunId).toBe(first.id)
      expect([first, second, third].map((r) => r.rootRunId))
        .toEqual([first.id, first.id, first.id])
    })

    it('부모가 사라졌으면 자기 자신이 뿌리다', () => {
      // parent_run_id에는 외래키가 없다 — 가리키는 run이 없을 수 있다.
      const orphan = runs.create({ ...baseInput(), parentRunId: 'ghost' })
      expect(orphan.rootRunId).toBe(orphan.id)
    })
  })

  describe('latestSessionRun', () => {
    function finishWithSession(id: string, sessionId: string | null) {
      runs.markFinished(id, {
        status: 'succeeded', resultText: null, externalSessionId: sessionId,
        needsAnswer: false, exitCode: 0, errorMessage: null,
        usage: null
      })
    }

    it('세션 id를 가진 가장 최근 run을 고른다', () => {
      const first = runs.create(baseInput())
      finishWithSession(first.id, 'sess-1')
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      finishWithSession(second.id, 'sess-2')

      expect(runs.latestSessionRun(first.id)?.id).toBe(second.id)
    })

    it('마지막 턴에 세션이 없으면 그 앞 턴을 고른다', () => {
      // preflight 실패나 MCP 준비 실패로 끝난 run은 프로세스가 뜬 적이 없어
      // 세션 id가 없다. 이 경우가 체인을 끊으면 안 된다 (설계 §3-1).
      const first = runs.create(baseInput())
      finishWithSession(first.id, 'sess-1')
      const failed = runs.create({ ...baseInput(), parentRunId: first.id })
      finishWithSession(failed.id, null)

      expect(runs.latestSessionRun(first.id)?.id).toBe(first.id)
    })

    it('세션을 가진 run이 하나도 없으면 null이다', () => {
      const first = runs.create(baseInput())
      expect(runs.latestSessionRun(first.id)).toBeNull()
    })
  })

  /**
   * 도는 중에 세션 id를 저장한다 (`docs/sdlc/conversation-fixes/` spec FR-16).
   * 종료 때에야 저장하면 첫 턴이 앱 종료로 끊긴 대화를 이을 수 없다.
   */
  describe('saveExternalSessionId', () => {
    it('실행 중인 run에 세션 id를 남긴다 — 종료를 기다리지 않는다', () => {
      const created = runs.create(baseInput())
      runs.markStarted(created.id)

      runs.saveExternalSessionId(created.id, 'sess-early')

      const saved = runs.get(created.id)
      expect(saved.externalSessionId).toBe('sess-early')
      expect(saved.status).toBe('running')
    })

    it('이미 값이 있으면 덮지 않는다', () => {
      const created = runs.create(baseInput())
      runs.saveExternalSessionId(created.id, 'sess-1')
      runs.saveExternalSessionId(created.id, 'sess-2')
      expect(runs.get(created.id).externalSessionId).toBe('sess-1')
    })

    it('다른 run은 건드리지 않는다', () => {
      const a = runs.create(baseInput())
      const b = runs.create(baseInput())
      runs.saveExternalSessionId(a.id, 'sess-a')
      expect(runs.get(b.id).externalSessionId).toBeNull()
    })

    it('빈 세션 id는 남기지 않는다 — 먼저 쓴 값이 이기므로 진짜 id를 막는다', () => {
      // claude 어댑터는 init에 session_id가 없으면 빈 문자열을 싣는다. ''가 먼저 들어가면
      // 뒤에 오는 진짜 id가 "이미 값이 있다"에 막히고, latestSessionRun(isNotNull)이 그
      // 턴을 골라 앞 턴의 유효한 세션까지 가린다.
      const created = runs.create(baseInput())
      runs.saveExternalSessionId(created.id, '')
      expect(runs.get(created.id).externalSessionId).toBeNull()
      runs.saveExternalSessionId(created.id, 'sess-real')
      expect(runs.get(created.id).externalSessionId).toBe('sess-real')
    })

    it('종료 기록이 세션 id를 모르면(null) 도는 중에 남긴 값을 지우지 않는다', () => {
      // manager.start가 거부되는 경로(세션을 배운 뒤 flush·로그 닫기에서 던짐)는 종료를
      // externalSessionId: null로 기록한다. 그대로 덮으면 이을 수 있던 대화가 끊긴다.
      const created = runs.create(baseInput())
      runs.markStarted(created.id)
      runs.saveExternalSessionId(created.id, 'sess-early')

      runs.markFinished(created.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: null, errorMessage: '스트림을 닫다 실패했다', usage: null
      })

      expect(runs.get(created.id).externalSessionId).toBe('sess-early')
    })

    it('종료 기록이 세션 id를 알면 그것이 남는다', () => {
      const created = runs.create(baseInput())
      runs.saveExternalSessionId(created.id, 'sess-init')
      runs.markFinished(created.id, {
        status: 'succeeded', resultText: '끝', externalSessionId: 'sess-result',
        needsAnswer: false, exitCode: 0, errorMessage: null, usage: null
      })
      expect(runs.get(created.id).externalSessionId).toBe('sess-result')
    })

    it('reapStale은 저장한 세션 id를 지우지 않는다 — 끊긴 첫 턴에서 이어받을 수 있다', () => {
      const first = runs.create(baseInput())
      runs.markStarted(first.id)
      runs.saveExternalSessionId(first.id, 'sess-early')

      runs.reapStale()

      const reaped = runs.get(first.id)
      expect(reaped.status).toBe('interrupted')
      expect(reaped.externalSessionId).toBe('sess-early')
      expect(runs.latestSessionRun(first.id)?.id).toBe(first.id)
    })
  })

  /** 취소가 뿌리에 확인 표시를 찍을지 정한다 (`docs/sdlc/conversation-fixes/` spec FR-8). */
  describe('activeTurnIds', () => {
    it('그 대화의 running·pending 턴만 준다', () => {
      const first = runs.create(baseInput())
      runs.markStarted(first.id)
      runs.markFinished(first.id, {
        status: 'succeeded', resultText: null, externalSessionId: 'sess',
        needsAnswer: false, exitCode: 0, errorMessage: null, usage: null
      })
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      runs.markStarted(second.id)
      const third = runs.create({ ...baseInput(), parentRunId: second.id })

      expect(runs.activeTurnIds(first.id).sort()).toEqual([second.id, third.id].sort())
    })

    it('뿌리 자신이 돌고 있으면 뿌리도 포함한다', () => {
      const root = runs.create(baseInput())
      runs.markStarted(root.id)
      expect(runs.activeTurnIds(root.id)).toEqual([root.id])
    })

    it('다른 대화의 활성 턴은 섞이지 않는다', () => {
      const mine = runs.create(baseInput())
      runs.markFinished(mine.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: 'x', usage: null
      })
      const other = runs.create(baseInput())
      runs.markStarted(other.id)

      expect(runs.activeTurnIds(mine.id)).toEqual([])
    })
  })

  /** 모델·토큰·컨텍스트 (`docs/sdlc/run-info/`) */
  describe('usage', () => {
    const sample = {
      model: 'claude-opus-5[1m]',
      inputTokens: 2, outputTokens: 4,
      cacheReadTokens: 15428, cacheWriteTokens: 37917,
      reasoningTokens: 0, costUsd: 0.386994,
      contextTokens: 53347, contextWindow: 1000000
    }

    function finish(usage: typeof sample | null) {
      const created = runs.create(baseInput())
      runs.markFinished(created.id, {
        status: 'succeeded', resultText: '끝', externalSessionId: 's1',
        needsAnswer: false, exitCode: 0, errorMessage: null, usage
      })
      return runs.get(created.id)
    }

    it('저장한 사용량이 그대로 돌아온다', () => {
      expect(finish(sample).usage).toEqual(sample)
    })

    it('사용량이 없으면 usage는 null이다 — 0으로 채우지 않는다', () => {
      expect(finish(null).usage).toBeNull()
    })

    it('일부만 아는 사용량은 나머지가 null로 남는다', () => {
      const created = runs.create(baseInput())
      runs.markFinished(created.id, {
        status: 'succeeded', resultText: '끝', externalSessionId: 's1',
        needsAnswer: false, exitCode: 0, errorMessage: null,
        usage: { ...sample, model: null, contextWindow: null }
      })
      const got = runs.get(created.id).usage!
      expect(got.model).toBeNull()
      expect(got.contextWindow).toBeNull()
      expect(got.inputTokens).toBe(2)
    })

    it('아홉 컬럼이 Run에 낱개로 새지 않는다', () => {
      // hydrate가 `{ ...row }`로 흘려보내면 usage와 낱개 컬럼이 둘 다 실려
      // IPC로 나간다. 타입 오류가 안 나서 조용히 지나간다 — 여기서 잡는다.
      const keys = Object.keys(finish(sample))
      for (const leaked of [
        'actualModel', 'inputTokens', 'outputTokens', 'cacheReadTokens',
        'cacheWriteTokens', 'reasoningTokens', 'costUsd', 'contextTokens', 'contextWindow'
      ]) {
        expect(keys).not.toContain(leaked)
      }
    })

    it('list와 get이 같은 usage를 준다', () => {
      const created = runs.create(baseInput())
      runs.markFinished(created.id, {
        status: 'succeeded', resultText: '끝', externalSessionId: 's1',
        needsAnswer: false, exitCode: 0, errorMessage: null, usage: sample
      })
      const listed = runs.list(workspaceId).find((r) => r.id === created.id)!
      expect(listed.usage).toEqual(sample)
    })
  })

})
