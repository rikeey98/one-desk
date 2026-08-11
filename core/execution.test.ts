import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { makeTestDb } from './db/repositories/testing'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createIssueRepository } from './db/repositories/issue'
import { createRunRepository } from './db/repositories/run'
import { createRunManager, type RunManager, type RunOutcome } from './runner/manager'
import { createRunQueue } from './runner/queue'
import { claudeCodeAdapter } from './runner/adapters/claudeCode'
import { createExecutionService } from './execution'
import type { Run } from '@shared/models'
import type { PreflightResult } from './runner/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'runner/fixtures/fake-claude.mjs')

function setup(
  preflight?: () => Promise<PreflightResult>,
  managerOverride?: RunManager,
  limit = 3
) {
  const db = makeTestDb()
  const logDir = mkdtempSync(resolve(tmpdir(), 'one-desk-exec-'))
  const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  const repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: process.cwd() }).id
  const issueId = createIssueRepository(db).create({ workspaceId, title: '토큰 버그', body: '설명' }).id
  const runs = createRunRepository(db)
  const updates: Run[] = []
  const manager = managerOverride ?? createRunManager({
    adapters: { 'claude-code': claudeCodeAdapter, opencode: claudeCodeAdapter },
    logDir,
    onEvent: () => {}
  })
  const queue = createRunQueue({ limit })
  const service = createExecutionService({
    db, runs, manager, queue,
    resolveExecutable: preflight ?? (async () => ({ ok: true, executable: process.execPath })),
    onRunUpdate: (run) => updates.push(run),
    extraArgs: [FAKE, '--scenario', 'success']
  })
  return { db, service, runs, queue, updates, workspaceId, repoId, issueId, logDir }
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
    const local = setup(async () => ({ ok: false, reason: 'claude를 찾을 수 없습니다' }))
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
    const local = setup(undefined, managerStarted.manager)

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
    const local = setup(undefined, undefined, 1)
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

  it('preflight가 실패하면 슬롯을 쓰지 않는다', async () => {
    const local = setup(async () => ({ ok: false, reason: 'claude를 찾을 수 없습니다' }), undefined, 1)
    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(run.status).toBe('failed')
    expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('대기 중인 run을 취소하면 canceled로 끝나고 다음이 시작한다', async () => {
    const local = setup(undefined, undefined, 1)
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
})

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
