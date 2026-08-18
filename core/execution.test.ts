import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { makeTestDb } from './db/repositories/testing'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createIssueRepository } from './db/repositories/issue'
import { createRunRepository, type RunRepository } from './db/repositories/run'
import { createRunManager, type RunManager, type RunOutcome } from './runner/manager'
import { createRunQueue } from './runner/queue'
import { claudeCodeAdapter } from './runner/adapters/claudeCode'
import { createExecutionService } from './execution'
import type { Run } from '@shared/models'
import type { PreflightResult } from './runner/types'
import type { McpHost } from './mcp/host'
import { consoleErrorSink, type ErrorSink } from './errors'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'runner/fixtures/fake-claude.mjs')

interface SetupOptions {
  preflight?: () => Promise<PreflightResult>
  manager?: RunManager
  limit?: number
  /** run 저장소를 감싸 특정 호출만 던지게 만드는 통로 (유령 run 재현) */
  wrapRuns?: (runs: RunRepository) => RunRepository
  /** 알림 리스너가 던지는 상황을 재현하는 통로 */
  onRunUpdate?: (run: Run) => void
  /** MCP 호스트를 물리는 통로. 없으면 MCP 없이 돈다 */
  mcp?: McpHost
  /** core가 삼킨 오류를 흘려보낼 곳을 재현하는 통로 */
  onError?: ErrorSink
}

function setup(options: SetupOptions = {}) {
  const db = makeTestDb()
  const logDir = mkdtempSync(resolve(tmpdir(), 'one-desk-exec-'))
  const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  const repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: process.cwd() }).id
  const issueId = createIssueRepository(db).create({ workspaceId, title: '토큰 버그', body: '설명' }).id
  const real = createRunRepository(db)
  const runs = options.wrapRuns ? options.wrapRuns(real) : real
  const updates: Run[] = []
  const manager = options.manager ?? createRunManager({
    adapters: { 'claude-code': claudeCodeAdapter, opencode: claudeCodeAdapter },
    logDir,
    onEvent: () => {},
    onError: consoleErrorSink
  })
  const queue = createRunQueue({ limit: options.limit ?? 3 })
  const service = createExecutionService({
    db, runs, manager, queue,
    ...(options.mcp ? { mcp: options.mcp } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    resolveExecutable: options.preflight ?? (async () => ({ ok: true, executable: process.execPath })),
    onRunUpdate: (run) => {
      updates.push(run)
      options.onRunUpdate?.(run)
    },
    extraArgs: [FAKE, '--scenario', 'success']
  })
  // 단언은 감싸지 않은 저장소로 읽는다 — 감싼 쪽이 던지게 만든 테스트에서
  // 단언까지 같이 넘어져 실패 원인이 흐려진다.
  return { db, service, runs: real, queue, updates, workspaceId, repoId, issueId, logDir }
}

describe('ExecutionService', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => { ctx = setup() })
  afterEach(() => { rmSync(ctx.logDir, { recursive: true, force: true }) })

  function startBase() {
    return ctx.service.start({
      workspaceId: ctx.workspaceId,
      agentKind: 'claude-code' as const,
      cwd: process.cwd(),
      permission: 'edit' as const,
      userPrompt: '고쳐줘',
      context: [{ type: 'issue' as const, id: ctx.issueId }]
    })
  }

  it('맥락을 조립해 assembledPrompt에 담고 run을 저장한다', async () => {
    const run = await startBase()
    expect(run.assembledPrompt).toContain('토큰 버그')
    expect(run.assembledPrompt).toContain('고쳐줘')

    const done = await vi.waitFor(() => {
      const r = ctx.runs.get(run.id)
      expect(r.status).toBe('succeeded')
      return r
    })
    expect(done.externalSessionId).toBe('fake-session')
    expect(done.resultText).toBe('끝남')
  })

  it('완료를 기다리지 않고 running 상태로 즉시 돌아온다', async () => {
    const run = await startBase()
    // 종료까지 await하면 IPC가 몇 분씩 막히고, 렌더러는 그동안 run의 id조차 모른다.
    expect(run.status).toBe('running')
    expect(run.startedAt).toBeTypeOf('number')
    expect(run.endedAt).toBeNull()
    await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
  })

  it('완료되면 onRunUpdate로 최종 run을 알린다', async () => {
    const run = await startBase()
    await vi.waitFor(() => {
      expect(ctx.updates.some((r) => r.id === run.id && r.status === 'succeeded')).toBe(true)
    })
  })

  it('DB에 기록한 logPath에 실제 로그 파일이 있다', async () => {
    const run = await startBase()
    await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
    expect(existsSync(run.logPath)).toBe(true)
  })

  it('preflight가 실패하면 프로세스를 띄우지 않고 failed로 기록한다', async () => {
    const local = setup({ preflight: async () => ({ ok: false, reason: 'claude를 찾을 수 없습니다' }) })
    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(run.status).toBe('failed')
    expect(run.errorMessage).toContain('claude를 찾을 수 없습니다')
    expect(run.startedAt).toBeNull()
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('맥락에 없는 이슈 id를 넘기면 거부한다', async () => {
    await expect(ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x',
      context: [{ type: 'issue', id: '없는-id' }]
    })).rejects.toThrow()
  })

  it('manager.start()가 아직 끝나지 않았는데도 start()가 먼저 돌아온다', async () => {
    // 위의 '완료를 기다리지 않고 running 상태로 즉시 돌아온다'는 이 계약을 못 지킨다.
    // 반환값은 markStarted가 만든 스냅샷이라, start()를 완료까지 await하도록 바꿔도
    // status는 여전히 'running'이라서 그 테스트는 통과한다. 계약을 실제로 고정하려면
    // 값의 모양이 아니라 시간 순서를 봐야 한다.
    //
    // e2e(core-loop)도 이 자리를 대신하지 못한다. 화면이 보는 running 탭은
    // notify(markStarted)가 만드는데 그건 manager.start() 호출보다 먼저 실행되므로,
    // 완료까지 기다리는 회귀가 생겨도 화면에는 드러나지 않는다.
    const managerStarted = createDeferredManager()
    const local = setup({ manager: managerStarted.manager })

    const run = await withTimeout(
      local.service.start({
        workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
        permission: 'edit', userPrompt: 'x', context: []
      }),
      1_000,
      'start()가 manager.start()의 완료를 기다리고 있다 — 완료를 기다리지 않는다는 계약이 깨졌다'
    )

    expect(managerStarted.calledOnce()).toBe(true)
    expect(managerStarted.settled()).toBe(false)
    expect(run.status).toBe('running')

    // 풀어주면 그제야 종료 처리가 돈다 — 체인이 연결돼 있다는 것까지 확인한다.
    managerStarted.resolve({
      status: 'succeeded',
      resultText: '끝남',
      externalSessionId: 'fake-session',
      needsAnswer: false,
      exitCode: 0,
      errorMessage: null,
      logPath: run.logPath
    })
    await vi.waitFor(() => expect(local.runs.get(run.id).status).toBe('succeeded'))
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('상한을 넘으면 두 번째 run이 pending으로 대기한다', async () => {
    const local = setup({ limit: 1 })
    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫째', context: []
    })
    const second = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '둘째', context: []
    })

    expect(first.status).toBe('running')
    expect(second.status).toBe('pending')
    expect(second.startedAt).toBeNull()
    expect(local.queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 1 })

    // 앞이 끝나면 뒤가 시작해서 끝난다.
    await vi.waitFor(() => expect(local.runs.get(second.id).status).toBe('succeeded'))
    expect(local.runs.get(first.id).status).toBe('succeeded')
    expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('run이 끝날 때마다 슬롯을 돌려준다', async () => {
    // 한 번이라도 빠뜨리면 상한이 영구히 줄고, 증상은
    // "언젠가부터 N개까지만 돈다"라서 원인을 찾기 어렵다.
    for (let i = 0; i < 3; i += 1) {
      const run = await startBase()
      await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
    }
    expect(ctx.queue.snapshot()).toEqual({ running: 0, limit: 3, waiting: 0 })
  })

  it('같은 대화의 두 run은 슬롯이 남아도 동시에 뜨지 않는다', async () => {
    // execution이 queue.enqueue의 세 번째 인자로 groupKey를 넘겨서
    // 같은 대화의 두 턴이 순차적으로 실행되게 한다. --resume이 이전 프로세스의
    // 완료를 요구하므로 동시 실행은 깨진다 (설계 §3-2).
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫째', context: []
    })
    // 같은 대화에 속하는 두 번째 run — parentRunId로 뿌리를 물려받는다
    const second = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '둘째', context: [],
      parentRunId: first.id
    })

    expect(second.rootRunId).toBe(first.rootRunId)
    // 상한이 3인데도 뜨지 않았다 — groupKey가 막은 것이다
    expect(second.status).toBe('pending')
    expect(ctrl.started(second.id)).toBe(false)
    expect(local.queue.snapshot()).toEqual({ running: 1, limit: 3, waiting: 1 })

    ctrl.finish(first.id)
    await vi.waitFor(() => expect(ctrl.started(second.id)).toBe(true))

    ctrl.finish(second.id)
    await vi.waitFor(() => {
      expect(local.queue.snapshot()).toEqual({ running: 0, limit: 3, waiting: 0 })
    })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('다른 대화의 두 run은 상한 안에서 동시에 뜬다', async () => {
    // 그룹 직렬화는 같은 대화에만 적용된다. 다른 대화는 병렬로 실행할 수 있어야 한다.
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫 대화', context: []
    })
    const second = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '다른 대화', context: []
    })

    // rootRunId가 다르다 — 다른 대화다
    expect(first.rootRunId ?? first.id).not.toBe(second.rootRunId ?? second.id)
    // 둘 다 떴다 — 병렬 실행 가능하다
    expect(first.status).toBe('running')
    expect(second.status).toBe('running')
    expect(ctrl.started(first.id)).toBe(true)
    expect(ctrl.started(second.id)).toBe(true)
    expect(local.queue.snapshot()).toEqual({ running: 2, limit: 3, waiting: 0 })

    ctrl.finish(first.id)
    ctrl.finish(second.id)
    await vi.waitFor(() => {
      expect(local.queue.snapshot()).toEqual({ running: 0, limit: 3, waiting: 0 })
    })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('예약할 때 세션이 없어도 실행 시점에 앞 턴의 세션을 집는다', async () => {
    const fake = createPerRunManager()
    const ctx2 = setup({ manager: fake.manager, limit: 3 })
    const first = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    expect(first.status).toBe('running')

    // 1턴이 도는 중에 2턴을 예약한다. 아직 세션 id가 없다.
    const second = await ctx2.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
    })
    // 같은 대화라 슬롯이 둘 남아도 뜨지 않는다 (Task 3).
    expect(second.status).toBe('pending')
    expect(fake.started(second.id)).toBe(false)

    fake.finish(first.id, 'sess-1')

    // 이제 2턴이 뜨면서 그 세션을 집는다.
    await vi.waitFor(() => expect(fake.started(second.id)).toBe(true))
    expect(ctx2.runs.get(second.id).status).toBe('running')
    // 헤드라인 약속 그 자체 — "떴다"만으로는 앞 턴의 세션을 실제로 집었는지
    // 증명하지 못한다. manager.start()에 넘어간 값을 직접 본다.
    expect(fake.sessionIdFor(second.id)).toBe('sess-1')
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('예약한 사이 세션이 하나도 남지 않으면 실패로 끝난다', async () => {
    const fake = createPerRunManager()
    const ctx2 = setup({ manager: fake.manager, limit: 3 })
    const first = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    const second = await ctx2.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
    })

    // 1턴이 세션 없이 끝났다. 조용히 새 세션으로 시작하면 agent는 이전 대화를
    // 모르는 채 돌고, 사용자는 답이 이상해진 이유를 알 방법이 없다.
    fake.finish(first.id, null)

    await vi.waitFor(() => expect(ctx2.runs.get(second.id).status).toBe('failed'))
    const stored = ctx2.runs.get(second.id)
    expect(stored.errorMessage).toContain('이어받을 세션이 없습니다')
    // 프로세스는 뜬 적이 없다.
    expect(stored.startedAt).toBeNull()
    expect(fake.started(second.id)).toBe(false)
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('실행 시점의 세션 조회가 던지면 run을 어중간하게 두지 않고 슬롯을 돌려준다', async () => {
    // latestSessionRun 호출은 원래 resume()의 호출 시점에 있었다 — 그때는 run
    // 행도 MCP 토큰도 큐 슬롯도 없어 던져도 부작용이 없었다. beginRun으로
    // 옮기며 셋 다 이미 존재하는 자리가 됐다. wrapRuns로 이 호출만(그것도
    // beginRun이 부르는 시점에만) 던지게 만들어 새 try/catch가 실제로
    // 막아주는지 본다.
    let failing = false
    const fake = createPerRunManager()
    const logs = captureConsoleError()
    const ctx2 = setup({
      manager: fake.manager,
      limit: 1,
      wrapRuns: (runs) => ({
        ...runs,
        latestSessionRun: (rootRunId: string) => {
          if (failing) throw new Error('database is locked')
          return runs.latestSessionRun(rootRunId)
        }
      })
    })

    const first = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    // 아직 failing이 꺼져 있다 — resume()이 잠긴 값의 출처를 구하려고 부르는
    // 호출은 정상적으로 성공해야 한다.
    const second = await ctx2.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
    })
    expect(second.status).toBe('pending')
    // 다른 대화의 세 번째 run — limit이 1이라 second 뒤에서 같이 기다린다.
    const third = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '다른 대화', context: []
    })
    expect(third.status).toBe('pending')

    // 이제부터 latestSessionRun이 던진다 — beginRun이 second를 띄우려는
    // 순간을 겨냥한다.
    failing = true
    fake.finish(first.id, 'sess-1')

    // (b) 슬롯이 반환되어 다음 대기분(third)이 뜬다.
    await vi.waitFor(() => expect(fake.started(third.id)).toBe(true))
    expect(ctx2.runs.get(third.id).status).toBe('running')

    // (a) second는 던진 조회 때문에 시작하지 못했다 — running도 failed도
    // 아닌 pending으로 남는다. 다음 재시작의 reapStale이 정리할 자리다.
    expect(fake.started(second.id)).toBe(false)
    expect(ctx2.runs.get(second.id).status).toBe('pending')
    expect(ctx2.runs.get(second.id).startedAt).toBeNull()
    // 조용히 넘어가면 안 된다 — 큐의 catch와 달리 이 실패는 beginRun 안에서
    // 직접 다뤘으므로, 로그가 유일한 흔적이다.
    expect(logs.some((line) => line.includes(second.id))).toBe(true)

    fake.finish(third.id)
    await vi.waitFor(() => {
      expect(ctx2.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    })
    logs.restore()
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('preflight가 실패하면 슬롯을 쓰지 않는다', async () => {
    // 실행 파일조차 없는 run이 MCP 포트를 열게 해서는 안 된다 — preflight가
    // mcp.prepare()보다 먼저 와야 한다는 순서 계약을 여기서 함께 고정한다.
    const fake = fakeHost()
    const local = setup({
      preflight: async () => ({ ok: false, reason: 'claude를 찾을 수 없습니다' }),
      limit: 1,
      mcp: fake.host
    })
    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(run.status).toBe('failed')
    expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    expect(fake.prepared).toEqual([])
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('대기 중인 run을 취소하면 canceled로 끝나고 다음이 시작한다', async () => {
    const local = setup({ limit: 1 })
    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫째', context: []
    })
    const waiting = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '대기', context: []
    })
    expect(waiting.status).toBe('pending')

    local.service.cancel(waiting.id)

    expect(local.runs.get(waiting.id).status).toBe('canceled')
    // 슬롯을 쥔 적이 없으므로 돌려줄 것도 없다.
    expect(local.queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 0 })
    await vi.waitFor(() => expect(local.runs.get(first.id).status).toBe('succeeded'))
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('유령 run은 건너뛰되 슬롯을 돌려줘 다음 대기분이 시작한다', async () => {
    // 스펙 §9가 "이 설계의 급소"라 부른 슬롯 누수의 beginRun 쪽 경로다. 대기 중에
    // workspace가 지워지면 run 행이 cascade로 사라져 markStarted가 던진다. 여기서
    // release를 빠뜨리면 슬롯이 영구히 줄고, 증상("언젠가부터 N-1개까지만 돈다")은
    // 원인에서 한참 떨어진 곳에 나타난다.
    const ghosts = new Set<string>()
    const ctrl = createPerRunManager()
    const logs = captureConsoleError()
    const local = setup({
      limit: 1,
      manager: ctrl.manager,
      wrapRuns: (runs) => ({
        ...runs,
        markStarted: (id: string) => {
          if (ghosts.has(id)) throw new Error(`run을 찾을 수 없습니다: ${id}`)
          return runs.markStarted(id)
        }
      })
    })
    const start = (userPrompt: string) => local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt, context: []
    })

    // 슬롯을 하나 붙잡아 둔 채로 유령과 그 뒤를 대기열에 세운다. 유령이 대기 중일 때
    // 실패해야 "다음 대기분이 시작하는가"까지 함께 볼 수 있다.
    const holder = await start('슬롯을 쥔다')
    const ghost = await start('유령')
    ghosts.add(ghost.id)
    const next = await start('다음')
    expect([holder.status, ghost.status, next.status]).toEqual(['running', 'pending', 'pending'])

    ctrl.finish(holder.id)

    // 슬롯이 돌아오지 않으면 여기서 영영 running이 되지 않는다.
    await vi.waitFor(() => expect(local.runs.get(next.id).status).toBe('running'))
    expect(ctrl.started(ghost.id)).toBe(false)
    expect(local.runs.get(ghost.id).status).toBe('pending')
    expect(local.queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 0 })
    // 조용히 넘어가면 안 된다 — 큐의 catch는 실패를 삼키므로 이 로그가 유일한 흔적이다.
    expect(logs.some((line) => line.includes(ghost.id))).toBe(true)

    ctrl.finish(next.id)
    await vi.waitFor(() => {
      expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    })
    logs.restore()
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('시작을 알리다 실패해도 시작 기록 실패로 보고하지 않는다', async () => {
    // notify가 markStarted와 같은 try에 있으면 두 실패가 뒤섞인다. 종료 중 파괴된
    // webContents처럼 리스너 쪽이 던졌을 뿐인데 로그는 "시작 기록 실패"라고 말한다 —
    // DB에는 running으로 멀쩡히 적혀 있으므로 거짓이고, 그 거짓말이 조사를
    // DB 쪽으로 몰아간다.
    const ctrl = createPerRunManager()
    const logs = captureConsoleError()
    const local = setup({
      manager: ctrl.manager,
      onRunUpdate: (run) => {
        if (run.status === 'running') throw new Error('창이 이미 닫혔습니다')
      }
    })

    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })

    expect(local.runs.get(run.id).status).toBe('running')
    expect(logs.filter((line) => line.includes('시작 기록 실패'))).toEqual([])
    logs.restore()
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('알림이 던져도 manager.start가 불려 run이 실제로 시작한다', async () => {
    // notify(started)가 try 밖에 있으면 리스너가 던지는 순간 beginRun이 그대로
    // 빠져나가 manager.start를 영영 못 부른다. 큐의 방어적 catch는 슬롯만
    // 돌려줄 뿐이라 DB는 running인데 프로세스가 없는 run이 남는다 —
    // 다음 재시작의 reapStale이 interrupted로 정리할 때까지 아무도 모른다.
    const ctrl = createPerRunManager()
    const logs = captureConsoleError()
    const local = setup({
      manager: ctrl.manager,
      onRunUpdate: (run) => {
        if (run.status === 'running') throw new Error('창이 이미 닫혔습니다')
      }
    })

    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })

    expect(ctrl.started(run.id)).toBe(true)

    // 슬롯 회계도 정상이어야 한다 — finish까지 흘러가 release가 정확히 한 번 불린다.
    ctrl.finish(run.id)
    await vi.waitFor(() => expect(local.runs.get(run.id).status).toBe('succeeded'))
    expect(local.queue.snapshot()).toEqual({ running: 0, limit: 3, waiting: 0 })
    logs.restore()
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('사용자가 대기 중인 run을 취소하면 인박스에 뜨지 않는다', async () => {
    // 본인이 알아서 한 일이니 이미 "확인됨"이다. 인박스에 남는 canceled는
    // 앱이 재시작하며 취소한 것뿐이어야 한다.
    const local = setup({ limit: 1 })
    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫째', context: []
    })
    const waiting = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '대기', context: []
    })
    expect(waiting.status).toBe('pending')

    local.service.cancel(waiting.id)

    expect(local.runs.get(waiting.id).status).toBe('canceled')
    expect(local.runs.get(waiting.id).reviewedKind).toBe('archived')
    expect(local.runs.inbox().map((r) => r.id)).not.toContain(waiting.id)
    // 첫째는 여전히 실제 프로세스로 돌고 있다. 끝나기 전에 로그 디렉터리를
    // 지우면 그 프로세스가 남은 로그를 쓰다 ENOENT로 죽어 테스트 출력이 지저분해진다.
    await vi.waitFor(() => expect(local.runs.get(first.id).status).toBe('succeeded'))
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('사용자가 실행 중인 run을 취소하면 인박스에 뜨지 않는다', async () => {
    // 실행 경로는 SIGTERM만 보내고 종료 기록은 나중에 온다. 그 시점에 run이
    // 아직 running이지만 reviewedAt을 미리 찍어도 무해하다 — 인박스는 종료
    // 상태만 보고, markFinished는 reviewedAt을 건드리지 않는다.
    const run = await startBase()
    expect(run.status).toBe('running')

    ctx.service.cancel(run.id)

    expect(ctx.runs.get(run.id).reviewedKind).toBe('archived')
    await vi.waitFor(() => expect(ctx.runs.get(run.id).endedAt).toBeTypeOf('number'))
    expect(ctx.runs.inbox().map((r) => r.id)).not.toContain(run.id)
  })

  it('삼킨 오류를 주입받은 onError로 흘려보낸다', async () => {
    // core/는 나중에 별도 데몬으로 떨어질 수 있으므로 목적지를 스스로 정하지 않는다.
    // 이 테스트는 start()가 삼키는 오류를 본다 — describe('resume') 안에 있던 것을
    // 옮겼다. resume 전용 동작이 아닌데 그 안에 있으면 자리를 찾기 어렵다.
    const seen: string[] = []
    const ctx2 = setup({
      onError: (message) => { seen.push(message) },
      wrapRuns: (runs) => ({
        ...runs,
        markStarted: () => { throw new Error('행이 사라졌다') }
      })
    })
    await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    await vi.waitFor(() => expect(seen.join(' ')).toContain('시작 기록 실패'))
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  describe('resume', () => {
    /** 세션 id를 가진 채 끝난 run을 하나 만든다. */
    async function finishedWithSession() {
      const run = await startBase()
      await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
      return ctx.runs.get(run.id)
    }

    it('원본의 agent와 작업 디렉토리를 그대로 쓰고 세션을 이어받는다', async () => {
      const parent = await finishedWithSession()
      expect(parent.externalSessionId).toBe('fake-session')

      const child = await ctx.service.resume({
        conversationId: parent.id,
        permission: 'read_only',
        userPrompt: '이어서 해줘',
        context: []
      })

      // 잠긴 값 — 원본에서 온다
      expect(child.agentKind).toBe(parent.agentKind)
      expect(child.cwd).toBe(parent.cwd)
      expect(child.workspaceId).toBe(parent.workspaceId)
      expect(child.parentRunId).toBe(parent.id)
      // 바꿀 수 있는 값
      expect(child.permission).toBe('read_only')
      expect(child.userPrompt).toBe('이어서 해줘')
      await vi.waitFor(() => expect(ctx.runs.get(child.id).status).toBe('succeeded'))
    })

    it('원본에 걸린 timeoutMs를 이어받는다', async () => {
      // 잠기는 것도 바꿀 수 있는 것도 아니라 설계가 비워둔 자리 — 원본의 성질을 따른다.
      const started = await ctx.service.start({
        workspaceId: ctx.workspaceId,
        agentKind: 'claude-code' as const,
        cwd: process.cwd(),
        permission: 'edit' as const,
        userPrompt: '고쳐줘',
        context: [],
        timeoutMs: 5000
      })
      await vi.waitFor(() => expect(ctx.runs.get(started.id).status).toBe('succeeded'))
      const parent = ctx.runs.get(started.id)
      expect(parent.timeoutMs).toBe(5000)

      const child = await ctx.service.resume({
        conversationId: parent.id,
        permission: 'read_only',
        userPrompt: '이어서 해줘',
        context: []
      })

      expect(child.timeoutMs).toBe(5000)
      await vi.waitFor(() => expect(ctx.runs.get(child.id).status).toBe('succeeded'))
    })

    it('이어받을 세션이 없으면 실행 시점에 실패로 끝난다', async () => {
      // 실패한 run은 세션이 만들어지기 전에 죽었을 수 있다. resume() 자체는
      // 더 이상 거부하지 않는다 — 세션 확인은 beginRun이 실행 직전에 한다
      // (Task 4, 설계 §3-2).
      const created = ctx.runs.create({
        workspaceId: ctx.workspaceId,
        agentKind: 'claude-code',
        model: null,
        cwd: process.cwd(),
        permission: 'edit',
        userPrompt: 'x',
        assembledPrompt: 'x',
        logPath: '/tmp/none/stream.jsonl',
        context: []
      })
      ctx.runs.markFinished(created.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: '죽음'
      })

      const child = await ctx.service.resume({
        conversationId: created.id, permission: 'edit', userPrompt: 'x', context: []
      })
      expect(child.status).toBe('failed')
      expect(child.errorMessage).toContain('이어받을 세션이 없습니다')
      expect(child.startedAt).toBeNull()
    })

    it('원본이 없으면 거부한다', async () => {
      await expect(ctx.service.resume({
        conversationId: '없는-id', permission: 'edit', userPrompt: 'x', context: []
      })).rejects.toThrow(/대화/)
    })

    it('원본을 읽다 DB가 터지면 그 오류를 그대로 올린다', async () => {
      // 지금은 모든 예외를 "원본 run이 없습니다"로 뭉갠다. DB가 잠겼거나 스키마가
      // 깨진 것도 같은 메시지가 되어 조사가 엉뚱한 데로 간다.
      const ctx2 = setup({
        wrapRuns: (runs) => ({
          ...runs,
          get: () => { throw new Error('database is locked') }
        })
      })
      await expect(ctx2.service.resume({
        conversationId: 'whatever', permission: 'edit', userPrompt: 'x', context: []
      })).rejects.toThrow(/database is locked/)
      rmSync(ctx2.logDir, { recursive: true, force: true })
    })

    it('manager에 원본의 세션 id를 넘긴다', async () => {
      // 이걸 안 넘기면 resume이 조용히 새 세션으로 돈다 — 화면에서는 구별되지 않는다.
      const parent = await finishedWithSession()
      const seen: (string | null)[] = []
      // setup은 옵션 객체를 받는다 (3a의 최종 수정 웨이브가 그렇게 바꿨다).
      // SetupOptions: { preflight?, manager?, limit?, wrapRuns?, onRunUpdate? }
      const spy = setup({
        manager: {
          logPathFor: (id: string) => resolve(tmpdir(), `one-desk-spy-${id}.jsonl`),
          start: async (spec) => {
            seen.push(spec.resumeSessionId)
            return {
              status: 'succeeded' as const, resultText: null, externalSessionId: null,
              needsAnswer: false, exitCode: 0, errorMessage: null, logPath: 'x'
            }
          },
          cancel: () => {},
          cancelAll: () => {},
          isRunning: () => false
        }
      })
      // 원본을 spy 쪽 DB에도 만들어야 하므로 원본 run을 그대로 옮겨 심는다.
      const seeded = spy.runs.create({
        workspaceId: spy.workspaceId,
        agentKind: parent.agentKind,
        model: null,
        cwd: parent.cwd,
        permission: parent.permission,
        userPrompt: parent.userPrompt,
        assembledPrompt: parent.assembledPrompt,
        logPath: parent.logPath,
        context: []
      })
      spy.runs.markFinished(seeded.id, {
        status: 'succeeded', resultText: null, externalSessionId: 'fake-session',
        needsAnswer: false, exitCode: 0, errorMessage: null
      })

      await spy.service.resume({
        conversationId: seeded.id, permission: 'edit', userPrompt: '이어서', context: []
      })

      expect(seen).toEqual(['fake-session'])
      rmSync(spy.logDir, { recursive: true, force: true })
    })

    it('마지막 턴이 세션 없이 실패해도 그 앞 턴에서 이어받는다', async () => {
      const first = await finishedWithSession()
      expect(first.externalSessionId).toBe('fake-session')

      // 2턴이 세션 없이 실패한 상황을 만든다 — preflight 실패와 같은 모양이다.
      const failed = await ctx.service.resume({
        conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
      })
      await vi.waitFor(() => expect(ctx.runs.get(failed.id).status).toBe('succeeded'))
      ctx.runs.markFinished(failed.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: '실행 파일을 찾을 수 없습니다.'
      })

      // 3턴은 그 앞 턴(1턴)의 세션을 이어받는다.
      const third = await ctx.service.resume({
        conversationId: first.id, permission: 'edit', userPrompt: '3턴', context: []
      })
      expect(third.rootRunId).toBe(first.id)
      // 세션을 준 run이 부모다 — 실패한 2턴이 아니다.
      expect(third.parentRunId).toBe(first.id)
    })

    // '세션을 가진 run이 하나도 없으면 던진다'(Task 2)는 여기서 지웠다. resume()이
    // 더 이상 호출 시점에 세션을 확인하지 않는다 — Task 4가 그 확인을 beginRun의
    // 실행 시점으로 옮겼다. 같은 시나리오는 이제 최상단 describe의
    // '예약한 사이 세션이 하나도 남지 않으면 실패로 끝난다'가 덮는다.
  })
})

describe('MCP 배선', () => {
  it('run을 띄울 때 MCP 설정을 준비해 커맨드까지 실어 보낸다', async () => {
    // 이 테스트가 전달 사슬 세 줄을 한 번에 지킨다. 하나라도 지우면 여기서 잡힌다.
    const seen: string[][] = []
    const manager = {
      logPathFor: (id: string) => `/tmp/${id}.jsonl`,
      async start(spec: { mcp?: { configFile: string } | null; executable: string }) {
        seen.push(spec.mcp ? ['mcp', spec.mcp.configFile] : ['no-mcp'])
        return {
          status: 'succeeded' as const, resultText: null, externalSessionId: null,
          needsAnswer: false, exitCode: 0, errorMessage: null, logPath: '/tmp/x'
        }
      },
      cancel() {}, cancelAll() {}, isRunning: () => false
    }
    const fake = fakeHost()
    const ctx2 = setup({ manager: manager as unknown as RunManager, mcp: fake.host })
    const run = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(fake.prepared).toEqual([run.id])
    expect(seen).toEqual([['mcp', `/tmp/${run.id}.json`]])
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('run이 끝나면 토큰을 폐기한다', async () => {
    const fake = fakeHost()
    const ctx2 = setup({ mcp: fake.host })
    const run = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    await vi.waitFor(() => expect(ctx2.runs.get(run.id).endedAt).toBeTypeOf('number'))
    await vi.waitFor(() => expect(fake.released).toEqual([run.id]))
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('유령 run이 되어도 토큰을 폐기한다', async () => {
    // 슬롯을 돌려주는 자리가 곧 토큰을 폐기하는 자리다. 하나라도 빠지면 끝난
    // run의 토큰으로 workspace를 계속 읽고 쓸 수 있다.
    const fake = fakeHost()
    const ctx2 = setup({
      mcp: fake.host,
      wrapRuns: (runs) => ({
        ...runs,
        markStarted: () => { throw new Error('행이 사라졌다') }
      })
    })
    const run = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    await vi.waitFor(() => expect(fake.released).toEqual([run.id]))
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('MCP 준비에 실패하면 프로세스를 띄우지 않고 failed로 기록한다', async () => {
    // 조용히 MCP 없이 진행하면 agent는 이슈를 못 고치는 채로 "성공"으로 끝난다.
    const fake = fakeHost()
    fake.fail()
    const ctx2 = setup({ mcp: fake.host })
    const run = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(run.status).toBe('failed')
    expect(run.startedAt).toBeNull()
    expect(run.errorMessage).toContain('MCP')
    // 슬롯을 잡았다 놓지도 않았다
    expect(ctx2.queue.snapshot().running).toBe(0)
    // prepare()가 토큰을 등록한 뒤 설정 파일 쓰기에서 실패했을 수 있다 — 방어적으로도 폐기를 시도한다.
    expect(fake.released).toEqual([run.id])
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('release가 던져도 슬롯은 돌아온다', async () => {
    // releaseMcp의 catch가 슬롯 영구 누수를 막는 유일한 방벽이다. mcp.release()는
    // removeMcpConfig → rmSync를 부르므로 EPERM/EACCES로 던질 수 있다. catch가
    // 없으면 finish()의 finally가 releaseMcp에서 끊겨 opts.queue.release가 영영
    // 불리지 않고, 슬롯이 영구히 줄어든다 — 증상은 "언젠가부터 N개까지만 돈다".
    const fake = fakeHost()
    fake.failRelease()
    const seen: string[] = []
    const ctx2 = setup({ mcp: fake.host, limit: 1, onError: (message) => { seen.push(message) } })
    const run = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    await vi.waitFor(() => expect(ctx2.runs.get(run.id).status).toBe('succeeded'))
    // 슬롯이 실제로 돌아왔는지가 핵심 단언이다 — release가 던졌다고 여기서
    // running이 1로 멈춰 있으면 catch가 없는 것이다.
    expect(ctx2.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    expect(seen.some((m) => m.includes('MCP 토큰 폐기'))).toBe(true)
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('대기 중인 run을 취소해도 토큰을 폐기한다', async () => {
    // prepare()는 enqueue보다 먼저 끝나므로, 큐에 슬롯을 쥔 적이 없는 대기
    // 중인 run도 이미 토큰을 쥐고 있을 수 있다. "슬롯을 돌려주는 자리"로만
    // 규칙을 좁히면 cancel()의 이 분기가 새어나간다.
    const fake = fakeHost()
    const ctx2 = setup({ mcp: fake.host, limit: 1 })
    const first = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫째', context: []
    })
    const waiting = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '대기', context: []
    })
    expect(waiting.status).toBe('pending')
    expect(fake.prepared).toEqual([first.id, waiting.id])

    ctx2.service.cancel(waiting.id)

    expect(fake.released).toEqual([waiting.id])
    await vi.waitFor(() => expect(ctx2.runs.get(first.id).status).toBe('succeeded'))
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })
})

/**
 * prepare/release 호출을 기록하는 가짜 MCP 호스트. 실제 포트를 열지 않는다.
 * describe 블록을 가로질러 쓰인다 — 함수 선언은 호이스팅되므로 파일 앞쪽의
 * describe(preflight 테스트 등)에서 먼저 등장해도 문제없다.
 */
function fakeHost() {
  const prepared: string[] = []
  const released: string[] = []
  let failing = false
  let failingRelease = false
  const host = {
    async prepare(ctx: { runId: string }) {
      if (failing) throw new Error('포트를 열지 못했습니다')
      prepared.push(ctx.runId)
      return { token: `tok-${ctx.runId}`, url: 'http://127.0.0.1:1/mcp', configFile: `/tmp/${ctx.runId}.json` }
    },
    release(runId: string) {
      // failRelease()가 켜지면 실제 removeMcpConfig의 rmSync가 EPERM/EACCES로
      // 던질 수 있는 상황을 흉내낸다. releaseMcp의 catch가 없으면 이 호출이
      // finish()의 finally를 통째로 끊어 queue.release가 영영 불리지 않는다.
      if (failingRelease) throw new Error('토큰 폐기에 실패했습니다')
      released.push(runId)
    },
    close() {},
    port: () => 1
  }
  return {
    host: host as unknown as McpHost,
    prepared,
    released,
    fail: () => { failing = true },
    failRelease: () => { failingRelease = true }
  }
}

/** console.error로 새는 것을 모아 두고 테스트 출력은 조용하게 유지한다. */
function captureConsoleError() {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '))
  })
  return Object.assign(lines, { restore: () => spy.mockRestore() })
}

/**
 * runId마다 따로 풀어줄 수 있는 가짜 manager.
 * 실제 프로세스로는 "앞 run이 끝나는 순간"을 정확히 잡을 수 없어 경합이 생긴다.
 */
function createPerRunManager() {
  const logPathFor = (runId: string) => resolve(tmpdir(), `one-desk-perrun-${runId}.jsonl`)
  const settlers = new Map<string, (outcome: RunOutcome) => void>()
  const seen = new Set<string>()
  // manager.start()에 실제로 넘어온 resumeSessionId를 기록한다. beginRun이
  // 실행 시점에 고른 값이 이 자리로 온다 — 그냥 "떴는지"만으로는 지연 해석이
  // 앞 턴의 세션을 실제로 집었는지 증명하지 못한다.
  const resumeSessionIds = new Map<string, string | null>()

  const manager: RunManager = {
    logPathFor,
    start: (spec) => {
      seen.add(spec.runId)
      resumeSessionIds.set(spec.runId, spec.resumeSessionId)
      return new Promise<RunOutcome>((r) => settlers.set(spec.runId, r))
    },
    cancel: () => {},
    cancelAll: () => {},
    isRunning: (runId) => settlers.has(runId)
  }

  return {
    manager,
    started: (runId: string) => seen.has(runId),
    sessionIdFor: (runId: string) => resumeSessionIds.get(runId) ?? null,
    finish(runId: string, sessionId: string | null = null) {
      const settle = settlers.get(runId)
      if (!settle) throw new Error(`시작한 적 없는 run입니다: ${runId}`)
      settlers.delete(runId)
      settle({
        status: 'succeeded',
        resultText: null,
        externalSessionId: sessionId,
        needsAnswer: false,
        exitCode: 0,
        errorMessage: null,
        logPath: logPathFor(runId)
      })
    }
  }
}

/**
 * manager.start()가 우리가 풀어줄 때까지 끝나지 않는 가짜 manager.
 * 타이머로 흉내내면 느리고 불안정하다 — 보류된 프로미스를 직접 쥐면 결정적이다.
 */
function createDeferredManager() {
  let settle: ((outcome: RunOutcome) => void) | null = null
  let done = false
  let calls = 0
  const pending = new Promise<RunOutcome>((r) => {
    settle = (outcome) => { done = true; r(outcome) }
  })

  const manager: RunManager = {
    logPathFor: (runId) => resolve(tmpdir(), `one-desk-deferred-${runId}.jsonl`),
    start: () => { calls += 1; return pending },
    cancel: () => {},
    cancelAll: () => {},
    isRunning: () => calls > 0 && !done
  }

  return {
    manager,
    calledOnce: () => calls === 1,
    settled: () => done,
    resolve: (outcome: RunOutcome) => settle?.(outcome)
  }
}

/** 계약이 깨지면 무한 대기 대신 이유가 적힌 실패로 끝나게 한다. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms).unref()
    })
  ])
}
