import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { makeTestDb } from './db/repositories/testing'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createIssueRepository } from './db/repositories/issue'
import { createRunRepository, type RunRepository } from './db/repositories/run'
import { createAssetRepository } from './db/repositories/asset'
import { createRunManager, type RunManager, type RunOutcome } from './runner/manager'
import { createRunQueue } from './runner/queue'
import { claudeCodeAdapter } from './runner/adapters/claudeCode'
import { createExecutionService } from './execution'
import type { AgentKind, Run } from '@shared/models'
import type { PreflightResult, VerifyRunnableInput } from './runner/types'
import type { McpHost } from './mcp/host'
import { consoleErrorSink, type ErrorSink } from './errors'
import { createFileService, type FileService } from './files/service'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

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
  /** 어댑터의 마지막 확인을 물리는 통로. 없으면 부르지 않는다 */
  verifyRunnable?: (
    agentKind: AgentKind,
    input: VerifyRunnableInput
  ) => Promise<PreflightResult>
  /** `@` 파일 참조의 해석 (docs/sdlc/input-triggers/). 없으면 멘션이 전부 중화된다 */
  files?: Pick<FileService, 'resolveMentions'>
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
    onError: consoleErrorSink,
    onPlanUsage: () => {}
  })
  const queue = createRunQueue({ limit: options.limit ?? 3 })
  const service = createExecutionService({
    db, runs, manager, queue,
    ...(options.mcp ? { mcp: options.mcp } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.verifyRunnable ? { verifyRunnable: options.verifyRunnable } : {}),
    ...(options.files ? { files: options.files } : {}),
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

  it('verifyRunnable이 거부하면 run이 시작하지 않고 실패로 끝난다', async () => {
    const verifyRunnable = vi.fn(async () => ({
      ok: false, reason: "bash 권한이 '물어보기'로 남아 있어 실행할 수 없습니다."
    }))
    const local = setup({ verifyRunnable })
    try {
      const run = await local.service.start({
        workspaceId: local.workspaceId,
        agentKind: 'opencode' as const,
        cwd: process.cwd(),
        permission: 'edit' as const,
        userPrompt: '고쳐줘',
        context: []
      })

      const saved = local.runs.get(run.id)
      expect(saved.status).toBe('failed')
      expect(saved.errorMessage).toContain('물어보기')
      // preflight 실패와 같은 성질 — 슬롯을 잡은 적이 없다.
      expect(saved.startedAt).toBeNull()
    } finally {
      rmSync(local.logDir, { recursive: true, force: true })
    }
  })

  it('verifyRunnable에 실제로 쓸 실행 파일·cwd·권한을 넘긴다', async () => {
    // 이걸 빠뜨리면 실행할 때와 다른 조건을 검사하게 되어 검사가 무의미해진다.
    const verifyRunnable = vi.fn(async () => ({ ok: true }))
    const local = setup({ verifyRunnable })
    try {
      await local.service.start({
        workspaceId: local.workspaceId,
        agentKind: 'opencode' as const,
        cwd: process.cwd(),
        permission: 'read_only' as const,
        userPrompt: '봐줘',
        context: []
      })

      expect(verifyRunnable).toHaveBeenCalledWith('opencode', {
        executable: process.execPath,
        cwd: process.cwd(),
        permission: 'read_only'
      })
    } finally {
      rmSync(local.logDir, { recursive: true, force: true })
    }
  })

  it('verifyRunnable이 없으면 그대로 진행한다', async () => {
    // claude 어댑터는 구현하지 않는다. 기본 setup에는 통로가 없다.
    const run = await startBase()
    expect(ctx.runs.get(run.id).status).not.toBe('failed')
  })

  it('맥락에 담은 authored asset의 본문이 프롬프트에 실린다', async () => {
    const made = createAssetRepository(ctx.db).createAuthored({
      workspaceId: ctx.workspaceId, kind: 'skill', name: '내 스킬', content: '# DB 본문'
    })

    const run = await ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: 'claude-code' as const,
      cwd: process.cwd(), permission: 'edit' as const, userPrompt: '해줘',
      context: [{ type: 'asset' as const, id: made.id }]
    })

    expect(run.assembledPrompt).toContain('# DB 본문')
    expect(run.assembledPrompt).toContain('<skills>')
  })

  it('discovered asset의 본문은 실행 시점에 디스크에서 읽는다', async () => {
    // DB에 본문이 없다. 파일을 고치면 다음 실행에 그대로 반영돼야 한다 (설계 §2-2).
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-asset-'))
    try {
      const file = resolve(dir, 'SKILL.md')
      writeFileSync(file, '# 처음 본문')
      const repoId = createRepoRepository(ctx.db)
        .create({ workspaceId: ctx.workspaceId, name: 'assets', path: dir }).id
      const assets = createAssetRepository(ctx.db)
      assets.upsertDiscovered({
        workspaceId: ctx.workspaceId, repoId, seenAt: 1,
        found: [{ kind: 'skill', name: '알파', description: null, filePath: file }]
      })
      const id = assets.list({ workspaceId: ctx.workspaceId })[0]!.id

      writeFileSync(file, '# 고친 본문')
      const run = await ctx.service.start({
        workspaceId: ctx.workspaceId, agentKind: 'claude-code' as const,
        cwd: process.cwd(), permission: 'edit' as const, userPrompt: '해줘',
        context: [{ type: 'asset' as const, id }]
      })

      expect(run.assembledPrompt).toContain('# 고친 본문')
      expect(run.assembledPrompt).not.toContain('# 처음 본문')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('파일이 사라진 asset을 담으면 조용히 빼지 않고 알린다', async () => {
    // 조용히 빼면 사용자는 agent가 읽고도 무시했다고 오해한다 (설계 §5-3).
    const repoId = createRepoRepository(ctx.db)
      .create({ workspaceId: ctx.workspaceId, name: 'gone', path: '/tmp/없는곳' }).id
    const assets = createAssetRepository(ctx.db)
    assets.upsertDiscovered({
      workspaceId: ctx.workspaceId, repoId, seenAt: 1,
      found: [{ kind: 'skill', name: '사라짐', description: null, filePath: '/tmp/없는곳/SKILL.md' }]
    })
    const id = assets.list({ workspaceId: ctx.workspaceId })[0]!.id

    const run = await ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: 'claude-code' as const,
      cwd: process.cwd(), permission: 'edit' as const, userPrompt: '해줘',
      context: [{ type: 'asset' as const, id }]
    })
    await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))

    const events = readFileSync(run.logPath, 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; message?: string })
    const error = events.find((e) => e.type === 'error')
    expect(error, '사라진 asset을 알리는 error 이벤트가 없다').toBeDefined()
    expect(error!.message).toContain('사라짐')
    // run 자체는 실패시키지 않는다 — 나머지 맥락으로 할 수 있는 일이 있다.
    expect(ctx.runs.get(run.id).status).not.toBe('failed')
  })

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
      logPath: run.logPath,
      usage: null
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

  it('다른 활성 턴이 없는 예약 턴을 취소하면 뿌리가 확인되어 대화가 인박스에 안 뜬다 (C-1)', async () => {
    // 리뷰가 잡은 결함: cancel()이 확인 표시를 취소하는 그 턴의 id에 찍으면
    // (뿌리가 아니라) 뿌리는 미확인인 채로 남는다. inbox()의 소속 판정이
    // 뿌리 기준이라, 이 대화는 앞 턴과 함께 인박스에 다시 뜬다 — 3b가 cancel()에
    // 확인 표시를 넣은 이유("사용자가 스스로 한 일") 자체는 맞지만 자리가 틀렸었다.
    //
    // **그 대화에 다른 활성 턴이 없을 때로 좁혔다** (`docs/sdlc/conversation-fixes/`
    // spec FR-8). 앞 턴이 아직 돌고 있으면 찍지 않는다 — 아래 FR-8 테스트가 그쪽이다.
    // 그래서 이 예약은 같은 대화의 앞 턴이 아니라 **전역 상한** 때문에 기다리게 만든다.
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 1 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    ctrl.finish(first.id, 'sess-1')
    await vi.waitFor(() => expect(local.runs.get(first.id).status).toBe('succeeded'))

    // 다른 대화가 하나뿐인 슬롯을 쥔다.
    const other = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '다른 대화', context: []
    })
    expect(other.status).toBe('running')

    // 1턴은 끝났다 — 2턴은 슬롯이 없어 기다린다. 이 대화에 다른 활성 턴은 없다.
    const second = await local.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴(예약)', context: []
    })
    expect(second.status).toBe('pending')

    local.service.cancel(second.id)

    expect(local.runs.get(second.id).status).toBe('canceled')
    // 뿌리(1턴)가 확인 표시를 받아야 대화 전체가 인박스에서 빠진다.
    const root = local.runs.get(first.id)
    expect(root.reviewedKind).toBe('archived')
    expect(root.reviewedAt).toBeTypeOf('number')
    // 대화 전체가 인박스에서 빠져야 한다 — 취소된 2턴을 건너뛴 대표 턴(1턴)으로도 뜨면 안 된다.
    expect(local.runs.inbox().map((r) => r.rootRunId ?? r.id)).not.toContain(first.id)

    ctrl.finish(other.id)
    await vi.waitFor(() => {
      expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('실행 중인 예약 턴을 취소해도 뿌리가 확인되어 대화가 인박스에 안 뜬다 (C-1, 실행 중 분기)', async () => {
    // 위 C-1 회귀 테스트는 대기 중 취소 분기만 지나간다(취소 대상이 pending이므로).
    // cancel()의 실행 중 취소 분기(target.rootRunId ?? target.id)도 같은 버그에
    // 노출될 수 있다 — 예약된 턴이 앞 턴 종료로 자동 실행되면 running이면서
    // rootRunId와 다른 id를 갖는다. 도크 헤더는 대화의 활성 턴(conversation.active)으로
    // 취소를 건다. 1턴은 이미 끝났으므로 **다른 활성 턴이 없다** (FR-8).
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    expect(first.status).toBe('running')

    // 1턴이 도는 중에 2턴을 예약한다 — 같은 대화라 슬롯이 남아도 대기한다.
    const second = await local.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴(예약)', context: []
    })
    expect(second.status).toBe('pending')

    // 1턴을 세션과 함께 끝낸다 — 2턴이 자동으로 뜬다(running).
    ctrl.finish(first.id, 'session-1')
    await vi.waitFor(() => expect(local.runs.get(second.id).status).toBe('running'))

    // 2턴을 취소한다 — 이제 실행 중 분기다.
    local.service.cancel(second.id)
    expect(ctrl.cancelRequests).toEqual([second.id])

    // 뿌리(1턴)가 확인 표시를 받아야 대화 전체가 인박스에서 빠진다.
    const root = local.runs.get(first.id)
    expect(root.reviewedKind).toBe('archived')
    expect(root.reviewedAt).toBeTypeOf('number')

    ctrl.finish(second.id, 'session-1', 'canceled')
    await vi.waitFor(() => expect(local.runs.get(second.id).status).toBe('canceled'))
    // 대화 전체가 인박스에서 빠져야 한다 — "대기 중 취소됨"으로 재등장하면 안 된다.
    expect(local.runs.inbox()).toHaveLength(0)
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('도는 턴 뒤의 예약을 취소해도 뿌리에 찍지 않는다 — 앞 턴의 실패가 인박스에 남는다 (FR-8)', async () => {
    // 취소는 어느 분기든 뿌리에 archived를 찍었다. 2턴이 도는 중 예약한 3턴을
    // 취소하면, 2턴이 답변 필요·실패로 끝나도 인박스에도 배지에도 안 떴다
    // (intent 결함 1). 다른 활성 턴이 있으면 그 턴의 결과가 인박스를 정한다.
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    const second = await local.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴(예약)', context: []
    })
    expect(second.status).toBe('pending')

    local.service.cancel(second.id)

    expect(local.runs.get(second.id).status).toBe('canceled')
    expect(local.runs.get(first.id).reviewedAt).toBeNull()

    ctrl.finish(first.id, 'sess-1', 'failed')
    await vi.waitFor(() => expect(local.runs.get(first.id).status).toBe('failed'))
    // 취소된 예약을 건너뛴 대표 턴(1턴, 실패)이 대화를 대표한다 (FR-1).
    expect(local.runs.inbox().map((r) => r.id)).toEqual([first.id])
    expect(local.runs.inboxCounts().total).toBe(1)
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('예약이 남은 채로 실행 중인 턴을 멈추면 예약은 이어서 뜨고 뿌리에 찍지 않는다 (FR-8·FR-9)', async () => {
    // 실행 중 턴의 취소는 그 프로세스만 멈춘다. 예약은 사용자가 따로 보낸 지시라
    // 건드리지 않고(FR-9), 그 예약이 아직 남아 있으니 대화는 끝나지 않았다(FR-8).
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    const second = await local.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴(예약)', context: []
    })
    expect(second.status).toBe('pending')

    local.service.cancel(first.id)

    expect(ctrl.cancelRequests).toEqual([first.id])
    expect(local.runs.get(second.id).status).toBe('pending')
    expect(local.runs.get(first.id).reviewedAt).toBeNull()

    // 프로세스가 멈춘다 — 세션은 남아 있으니 예약이 그것을 이어받아 뜬다.
    ctrl.finish(first.id, 'sess-1', 'canceled')
    await vi.waitFor(() => expect(ctrl.started(second.id)).toBe(true))
    expect(ctrl.sessionIdFor(second.id)).toBe('sess-1')

    ctrl.finish(second.id, 'sess-1', 'failed')
    await vi.waitFor(() => expect(local.runs.get(second.id).status).toBe('failed'))
    expect(local.runs.inbox().map((r) => r.id)).toEqual([second.id])
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('도는 턴을 멈추고 그 프로세스가 끝나기 전에 예약까지 취소해도, 대화가 인박스에 남지 않는다 (FR-8)', async () => {
    // 두 취소가 겹치는 순서다. 판정을 누른 순간에만 하면 아무도 뿌리에 찍지 않는다:
    // (1) 1턴을 멈출 때는 예약(2턴)이 활성이라 찍지 않고, (2) 1턴이 SIGTERM 유예·taskkill로
    // 아직 내려가는 중에 예약을 취소하면 이번엔 1턴이 DB에서 running이라 또 찍지 않는다.
    // 그러면 사용자가 전부 멈춘 대화가 시작한 뒤 취소된 1턴을 대표로 내세워 "대기 중
    // 취소됨"으로 인박스에 남는다. 대화록은 도는 턴이 위, 예약이 아래라 이 순서가 자연스럽다.
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    const second = await local.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴(예약)', context: []
    })
    expect(second.status).toBe('pending')

    local.service.cancel(first.id)
    local.service.cancel(second.id)
    expect(local.runs.get(second.id).status).toBe('canceled')

    // 1턴의 프로세스가 이제야 내려간다.
    ctrl.finish(first.id, 'sess-1', 'canceled')
    await vi.waitFor(() => expect(local.runs.get(first.id).status).toBe('canceled'))

    expect(local.runs.get(first.id).reviewedKind).toBe('archived')
    expect(local.runs.inbox()).toHaveLength(0)
    expect(ctrl.started(second.id)).toBe(false)
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('멈춘 턴이 끝날 때 다른 예약이 남아 있으면 그때도 찍지 않는다 (FR-8·FR-9)', async () => {
    // 끝날 때 다시 판정하는 것이 "무조건 찍기"가 되면 이어서 뜰 예약의 결과가 가려진다.
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    const second = await local.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴(예약)', context: []
    })

    local.service.cancel(first.id)
    ctrl.finish(first.id, 'sess-1', 'canceled')
    await vi.waitFor(() => expect(ctrl.started(second.id)).toBe(true))

    expect(local.runs.get(first.id).reviewedAt).toBeNull()
    ctrl.finish(second.id, 'sess-1', 'failed')
    await vi.waitFor(() => expect(local.runs.inbox().map((r) => r.id)).toEqual([second.id]))
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('이미 끝난 턴에 뒤늦게 온 취소는 뿌리에 찍지 않는다 — 그 턴의 결과가 인박스를 정한다', async () => {
    // 턴이 실패·답변 필요로 끝나는 순간과 헤더의 "취소"가 겹치면, 렌더러가 종료 push를
    // 받기 전에 취소가 도착한다. 그 취소가 뿌리에 archived를 찍으면 방금 생긴 실패가
    // 인박스에도 배지에도 뜨지 않는다.
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    ctrl.finish(run.id, 'sess-1', 'failed')
    await vi.waitFor(() => expect(local.runs.get(run.id).status).toBe('failed'))

    local.service.cancel(run.id)

    expect(local.runs.get(run.id).reviewedAt).toBeNull()
    expect(local.runs.inbox().map((r) => r.id)).toEqual([run.id])
    expect(local.runs.inboxCounts().total).toBe(1)
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('프로세스는 끝났고 종료 기록 직전에 온 취소도 찍지 않는다', async () => {
    // DB에는 아직 running인데 프로세스는 이미 없다 — manager가 결과를 돌려주고 finish가
    // 기록하기 전의 틈이다. 취소는 아무것도 멈추지 못하고, 결과는 그 턴 자신의 것이다.
    const ctrl = createPerRunManager()
    const local = setup({ manager: ctrl.manager, limit: 3 })

    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    ctrl.finish(run.id, 'sess-1', 'failed')
    expect(local.runs.get(run.id).status).toBe('running')

    local.service.cancel(run.id)
    await vi.waitFor(() => expect(local.runs.get(run.id).status).toBe('failed'))

    expect(local.runs.get(run.id).reviewedAt).toBeNull()
    expect(local.runs.inbox().map((r) => r.id)).toEqual([run.id])
    rmSync(local.logDir, { recursive: true, force: true })
  })

  describe('launch 중 취소 (FR-7)', () => {
    // launch는 행을 만들어 먼저 알린 뒤 실행 파일 확인·실행 전 확인·MCP 준비를 await하고
    // 나서야 큐에 넣는다. 그 틈의 취소는 큐에도 manager에도 없어 삼켜졌다 — 턴은 그대로
    // 돌고 뿌리에는 archived만 남았다(intent 결함 1).
    const ok: PreflightResult = { ok: true, executable: process.execPath }

    function startIn(local: ReturnType<typeof setup>, userPrompt = '고쳐줘') {
      return local.service.start({
        workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
        permission: 'edit', userPrompt, context: []
      })
    }

    it('실행 파일을 확인하는 동안 취소하면 뒤 단계 없이 canceled로 끝난다', async () => {
      const gate = createGate<PreflightResult>()
      const ctrl = createPerRunManager()
      // 뒤 단계가 불리는지 보려고 둘 다 물린다 — 취소된 run이 `opencode debug config`를
      // 띄우거나 MCP 토큰을 받는 낭비가 없어야 한다.
      const verifyRunnable = vi.fn(async () => ({ ok: true }))
      const fake = fakeHost()
      const local = setup({
        manager: ctrl.manager, preflight: gate.wait, limit: 1, verifyRunnable, mcp: fake.host
      })

      const launching = startIn(local)
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      const id = local.updates[0]!.id
      expect(local.runs.get(id).status).toBe('pending')

      local.service.cancel(id)
      gate.release(ok)
      const run = await launching

      expect(run.status).toBe('canceled')
      // 시작한 적이 없다 — 대표 턴 규칙(FR-1)이 건너뛰는 "시작하지 못하고 취소된 턴"이다.
      expect(run.startedAt).toBeNull()
      expect(ctrl.started(id)).toBe(false)
      expect(verifyRunnable).not.toHaveBeenCalled()
      expect(fake.prepared).toEqual([])
      expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
      // 사용자가 스스로 한 일이고 이 대화에 다른 활성 턴이 없다 — 뿌리에 찍는다 (FR-8).
      expect(local.runs.get(id).reviewedKind).toBe('archived')
      rmSync(local.logDir, { recursive: true, force: true })
    })

    it('실행 전 확인(verifyRunnable) 중에 취소하면 MCP를 준비하지 않고 canceled로 끝난다', async () => {
      const gate = createGate<PreflightResult>()
      const ctrl = createPerRunManager()
      const fake = fakeHost()
      const local = setup({ manager: ctrl.manager, verifyRunnable: gate.wait, mcp: fake.host })

      const launching = startIn(local)
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      const id = local.updates[0]!.id

      local.service.cancel(id)
      gate.release({ ok: true })
      const run = await launching

      expect(run.status).toBe('canceled')
      expect(run.startedAt).toBeNull()
      expect(ctrl.started(id)).toBe(false)
      expect(fake.prepared).toEqual([])
      rmSync(local.logDir, { recursive: true, force: true })
    })

    it('실행 전 확인이 거부해도 취소 요청이 있으면 취소로 끝난다', async () => {
      const gate = createGate<PreflightResult>()
      const local = setup({ verifyRunnable: gate.wait })

      const launching = startIn(local)
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      local.service.cancel(local.updates[0]!.id)
      gate.release({ ok: false, reason: "bash 권한이 '물어보기'로 남아 있습니다." })

      const run = await launching
      expect(run.status).toBe('canceled')
      expect(run.errorMessage).toBeNull()
      rmSync(local.logDir, { recursive: true, force: true })
    })

    it('MCP 준비가 실패해도 취소 요청이 있으면 취소로 끝나고 토큰은 한 번만 폐기한다', async () => {
      const gate = createGate<void>()
      const fake = fakeHost()
      const inner = fake.host
      const host = {
        ...inner,
        async prepare(input: Parameters<McpHost['prepare']>[0]) {
          await gate.wait()
          throw new Error(`포트를 열지 못했습니다 (${input.runId})`)
        }
      } as McpHost
      const local = setup({ mcp: host })

      const launching = startIn(local)
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      const id = local.updates[0]!.id
      local.service.cancel(id)
      gate.release()

      const run = await launching
      expect(run.status).toBe('canceled')
      expect(run.errorMessage).toBeNull()
      expect(fake.released).toEqual([id])
      rmSync(local.logDir, { recursive: true, force: true })
    })

    it('MCP를 준비하는 동안 취소하면 받은 토큰을 폐기하고 canceled로 끝난다', async () => {
      // prepare()가 끝나면 토큰이 이미 등록돼 있다. 폐기하지 않으면 시작도 못 한
      // run의 토큰으로 workspace를 계속 읽고 쓸 수 있다 (releaseMcp 참고).
      const gate = createGate<void>()
      const fake = fakeHost()
      const inner = fake.host
      const host = {
        ...inner,
        async prepare(input: Parameters<McpHost['prepare']>[0]) {
          await gate.wait()
          return inner.prepare(input)
        }
      } as McpHost
      const ctrl = createPerRunManager()
      const local = setup({ manager: ctrl.manager, mcp: host })

      const launching = startIn(local)
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      const id = local.updates[0]!.id

      local.service.cancel(id)
      gate.release()
      const run = await launching

      expect(run.status).toBe('canceled')
      expect(ctrl.started(id)).toBe(false)
      expect(fake.prepared).toEqual([id])
      expect(fake.released).toEqual([id])
      expect(local.queue.snapshot().running).toBe(0)
      rmSync(local.logDir, { recursive: true, force: true })
    })

    it('취소 요청이 있으면 실행 파일 확인이 실패해도 실패가 아니라 취소로 끝난다', async () => {
      // 사용자가 멈추라고 한 턴이다. 읽을 필요 없는 오류 문구로 인박스·배지에 오르면 안 된다.
      const gate = createGate<PreflightResult>()
      const local = setup({ preflight: gate.wait })

      const launching = startIn(local)
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      const id = local.updates[0]!.id

      local.service.cancel(id)
      gate.release({ ok: false, reason: 'claude를 찾을 수 없습니다' })
      const run = await launching

      expect(run.status).toBe('canceled')
      expect(run.errorMessage).toBeNull()
      rmSync(local.logDir, { recursive: true, force: true })
    })

    it('launch가 어느 출구로 끝나든 표식을 남기지 않는다 — 실패·취소 경로 포함', async () => {
      // 표식이 새면 동작은 같아 보인다(끝난 run의 취소는 어차피 아무것도 하지 않는다).
      // 대신 실패한 run마다 항목이 쌓인다 — plan의 리스크 "모든 조기 반환 경로에서 요청
      // 표식을 치운다"를 여기서 고정한다.
      const cases: { name: string; local: ReturnType<typeof setup>; status: Run['status'] }[] = []

      const preflightFails = setup({ preflight: async () => ({ ok: false, reason: 'claude가 없다' }) })
      cases.push({ name: '실행 파일 확인 실패', local: preflightFails, status: 'failed' })

      const verifyFails = setup({ verifyRunnable: async () => ({ ok: false, reason: "'물어보기'가 남았다" }) })
      cases.push({ name: '실행 전 확인 실패', local: verifyFails, status: 'failed' })

      const broken = fakeHost()
      broken.fail()
      const mcpFails = setup({ mcp: broken.host })
      cases.push({ name: 'MCP 준비 실패', local: mcpFails, status: 'failed' })

      for (const c of cases) {
        const run = await startIn(c.local)
        expect(run.status, c.name).toBe(c.status)
        expect(c.local.service.launchingCount(), c.name).toBe(0)
        rmSync(c.local.logDir, { recursive: true, force: true })
      }

      // launch 중 취소로 끝난 경로
      const gate = createGate<PreflightResult>()
      const canceled = setup({ preflight: gate.wait })
      const launching = startIn(canceled)
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      expect(canceled.service.launchingCount()).toBe(1)
      canceled.service.cancel(canceled.updates[0]!.id)
      gate.release(ok)
      expect((await launching).status).toBe('canceled')
      expect(canceled.service.launchingCount()).toBe(0)
      rmSync(canceled.logDir, { recursive: true, force: true })
    })

    it('같은 대화에 도는 턴이 있으면 launch 중 취소도 뿌리에 찍지 않는다', async () => {
      const gate = createGate<PreflightResult>()
      let calls = 0
      const ctrl = createPerRunManager()
      const local = setup({
        manager: ctrl.manager,
        // 1턴은 바로 통과하고, 2턴만 확인 중에 붙잡아 둔다.
        preflight: () => (calls++ === 0 ? Promise.resolve(ok) : gate.wait())
      })

      const first = await startIn(local, '1턴')
      expect(first.status).toBe('running')
      const launching = local.service.resume({
        conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
      })
      await vi.waitFor(() => expect(gate.entered()).toBe(true))
      const secondId = local.updates.find((r) => r.userPrompt === '2턴')!.id

      local.service.cancel(secondId)
      gate.release(ok)
      expect((await launching).status).toBe('canceled')
      expect(local.runs.get(first.id).reviewedAt).toBeNull()

      ctrl.finish(first.id, 'sess-1', 'failed')
      await vi.waitFor(() => expect(local.runs.inbox().map((r) => r.id)).toEqual([first.id]))
      rmSync(local.logDir, { recursive: true, force: true })
    })
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
        effort: null,
        cwd: process.cwd(),
        permission: 'edit',
        userPrompt: 'x',
        assembledPrompt: 'x',
        logPath: '/tmp/none/stream.jsonl',
        context: []
      })
      ctx.runs.markFinished(created.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: '죽음',
        usage: null
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
          rawLogPathFor: (id: string) => resolve(tmpdir(), `one-desk-spy-${id}.raw.jsonl`),
          start: async (spec) => {
            seen.push(spec.resumeSessionId)
            return {
              status: 'succeeded' as const, resultText: null, externalSessionId: null,
              needsAnswer: false, exitCode: 0, errorMessage: null, logPath: 'x', usage: null
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
        effort: null,
        cwd: parent.cwd,
        permission: parent.permission,
        userPrompt: parent.userPrompt,
        assembledPrompt: parent.assembledPrompt,
        logPath: parent.logPath,
        context: []
      })
      spy.runs.markFinished(seeded.id, {
        status: 'succeeded', resultText: null, externalSessionId: 'fake-session',
        needsAnswer: false, exitCode: 0, errorMessage: null,
        usage: null
      })

      await spy.service.resume({
        conversationId: seeded.id, permission: 'edit', userPrompt: '이어서', context: []
      })

      expect(seen).toEqual(['fake-session'])
      rmSync(spy.logDir, { recursive: true, force: true })
    })

    it('첫 턴이 도는 중 앱이 꺼져도 그 대화를 이을 수 있다 (FR-16)', async () => {
      // 예전에는 세션 id가 종료 때(markFinished)에야 DB에 들어갔다. 첫 턴이 도는 중
      // 앱이 꺼지면 reapStale이 행을 interrupted로 만드는데 세션 id가 없어, 이으면
      // "이어받을 세션이 없습니다"로 실패했다. 실행 서비스가 manager에 넘기는
      // onSession 한 줄이 이 테스트에 걸려 있다 — 빼면 아래 단언이 전부 빨개진다.
      const running = setup({
        manager: {
          logPathFor: (id: string) => resolve(tmpdir(), `one-desk-early-${id}.jsonl`),
          rawLogPathFor: (id: string) => resolve(tmpdir(), `one-desk-early-${id}.raw.jsonl`),
          // 세션 id를 알린 뒤 끝나지 않는다 — 앱이 꺼질 때까지 도는 첫 턴이다.
          start: (spec) => {
            spec.onSession?.(spec.runId, 'sess-early')
            return new Promise<RunOutcome>(() => {})
          },
          cancel: () => {},
          cancelAll: () => {},
          isRunning: () => true
        }
      })
      try {
        const first = await running.service.start({
          workspaceId: running.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
          permission: 'edit', userPrompt: '1턴', context: []
        })
        expect(running.runs.get(first.id).status).toBe('running')
        // 종료를 기다리지 않고 이미 남아 있다.
        expect(running.runs.get(first.id).externalSessionId).toBe('sess-early')

        // 앱이 꺼졌다가 다시 뜬다 — 같은 DB, 새 실행 서비스와 새 큐.
        running.runs.reapStale()
        expect(running.runs.get(first.id).status).toBe('interrupted')

        const seen: (string | null)[] = []
        const restarted = createExecutionService({
          db: running.db,
          runs: running.runs,
          queue: createRunQueue({ limit: 3 }),
          resolveExecutable: async () => ({ ok: true, executable: process.execPath }),
          manager: {
            logPathFor: (id: string) => resolve(tmpdir(), `one-desk-restart-${id}.jsonl`),
            rawLogPathFor: (id: string) => resolve(tmpdir(), `one-desk-restart-${id}.raw.jsonl`),
            start: async (spec) => {
              seen.push(spec.resumeSessionId)
              return {
                status: 'succeeded' as const, resultText: null, externalSessionId: null,
                needsAnswer: false, exitCode: 0, errorMessage: null, logPath: 'x', usage: null
              }
            },
            cancel: () => {},
            cancelAll: () => {},
            isRunning: () => false
          }
        })

        const second = await restarted.resume({
          conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
        })

        expect(seen).toEqual(['sess-early'])
        await vi.waitFor(() => expect(running.runs.get(second.id).status).toBe('succeeded'))
        expect(running.runs.get(second.id).errorMessage).toBeNull()
      } finally {
        rmSync(running.logDir, { recursive: true, force: true })
      }
    })

    it('세션을 배운 뒤 manager.start가 거부돼도 도는 중에 남긴 세션을 지우지 않는다', async () => {
      // 거부 경로는 종료를 externalSessionId: null로 기록한다. 그것이 FR-16으로 남긴 값을
      // 덮으면 그 대화는 "이어받을 세션이 없습니다"로 끊긴다.
      const local = setup({
        manager: {
          logPathFor: (id: string) => resolve(tmpdir(), `one-desk-reject-${id}.jsonl`),
          rawLogPathFor: (id: string) => resolve(tmpdir(), `one-desk-reject-${id}.raw.jsonl`),
          start: async (spec) => {
            spec.onSession?.(spec.runId, 'sess-learned')
            throw new Error('로그를 닫지 못했다')
          },
          cancel: () => {},
          cancelAll: () => {},
          isRunning: () => false
        }
      })
      try {
        const run = await local.service.start({
          workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
          permission: 'edit', userPrompt: '1턴', context: []
        })
        await vi.waitFor(() => expect(local.runs.get(run.id).status).toBe('failed'))

        expect(local.runs.get(run.id).errorMessage).toBe('로그를 닫지 못했다')
        expect(local.runs.get(run.id).externalSessionId).toBe('sess-learned')
        expect(local.runs.latestSessionRun(run.id)?.id).toBe(run.id)
      } finally {
        rmSync(local.logDir, { recursive: true, force: true })
      }
    })

    it('마지막 턴이 세션 없이 실패해도 그 앞 턴에서 이어받는다', async () => {
      const first = await finishedWithSession()
      expect(first.externalSessionId).toBe('fake-session')

      // 2턴이 세션 없이 실패한 상황을 만든다 — preflight 실패와 같은 모양이다.
      // 행을 직접 만든다: 한 번 돈 턴을 null로 덮어 흉내내던 것은 이제 통하지 않는다 —
      // 종료 기록의 null은 도는 중에 남긴 세션을 지우지 않는다(markFinished).
      const failed = ctx.runs.create({
        workspaceId: first.workspaceId, agentKind: first.agentKind, model: null, effort: null,
        cwd: first.cwd, permission: 'edit', userPrompt: '2턴', assembledPrompt: '2턴',
        logPath: resolve(ctx.logDir, 'no-such', 'stream.jsonl'), context: [], parentRunId: first.id
      })
      ctx.runs.markFinished(failed.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: null, errorMessage: '실행 파일을 찾을 수 없습니다.',
        usage: null
      })
      expect(ctx.runs.get(failed.id).externalSessionId).toBeNull()

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

describe('effort 배선 (docs/sdlc/agent-setup/)', () => {
  /** manager.start가 받은 spec을 모으는 setup. resume 테스트의 spy와 같은 모양이다. */
  function spySetup() {
    const seen: (string | null)[] = []
    const ctx = setup({
      manager: {
        logPathFor: (id: string) => resolve(tmpdir(), `one-desk-effort-${id}.jsonl`),
        rawLogPathFor: (id: string) => resolve(tmpdir(), `one-desk-effort-${id}.raw.jsonl`),
        start: async (spec) => {
          seen.push(spec.effort)
          return {
            status: 'succeeded' as const, resultText: null, externalSessionId: 'sess-1',
            needsAnswer: false, exitCode: 0, errorMessage: null, logPath: 'x', usage: null
          }
        },
        cancel: () => {},
        cancelAll: () => {},
        isRunning: () => false
      }
    })
    return { ...ctx, seen }
  }

  it('넘긴 effort가 저장되고 어댑터까지 닿는다', async () => {
    // 저장만 되고 CLI에 안 가면 화면은 high인데 실제로는 기본값으로 돈다 —
    // 어느 CLI도 effort를 되돌려 주지 않아 그 어긋남이 영영 드러나지 않는다.
    const ctx = spySetup()
    const run = await ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: 'claude-code', effort: 'high',
      cwd: process.cwd(), permission: 'edit', userPrompt: '해줘', context: []
    })

    expect(ctx.runs.get(run.id).effort).toBe('high')
    expect(ctx.seen).toEqual(['high'])
    rmSync(ctx.logDir, { recursive: true, force: true })
  })

  it('effort를 넘기지 않으면 null이 흐른다', async () => {
    const ctx = spySetup()
    const run = await ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: 'claude-code',
      cwd: process.cwd(), permission: 'edit', userPrompt: '해줘', context: []
    })

    expect(ctx.runs.get(run.id).effort).toBeNull()
    expect(ctx.seen).toEqual([null])
    rmSync(ctx.logDir, { recursive: true, force: true })
  })

  it('이어서 실행하면 effort는 이어받지 않고 그 턴이 새로 정한다', async () => {
    // agentKind·cwd와 다르다 — 그 둘은 세션에 묶여 잠기지만 effort는 모델과 같이
    // 매 턴 고르는 값이다. 이어받으면 화면에 없는 값이 따라와 무엇으로 도는지 모른다.
    const ctx = spySetup()
    const first = await ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: 'claude-code', effort: 'max',
      cwd: process.cwd(), permission: 'edit', userPrompt: '첫 턴', context: []
    })
    ctx.runs.markFinished(first.id, {
      status: 'succeeded', resultText: null, externalSessionId: 'sess-1',
      needsAnswer: false, exitCode: 0, errorMessage: null, usage: null
    })

    const second = await ctx.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '둘째 턴', context: []
    })

    expect(ctx.runs.get(second.id).effort).toBeNull()
    expect(ctx.seen).toEqual(['max', null])
    rmSync(ctx.logDir, { recursive: true, force: true })
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
  // manager.cancel()이 불린 run. 실제 manager처럼 프로세스를 죽이지는 않는다 —
  // 끝나는 순간은 테스트가 finish()로 정한다.
  const cancelRequests: string[] = []

  const manager: RunManager = {
    logPathFor,
    rawLogPathFor: (runId: string) => resolve(tmpdir(), `one-desk-perrun-${runId}.raw.jsonl`),
    start: (spec) => {
      seen.add(spec.runId)
      resumeSessionIds.set(spec.runId, spec.resumeSessionId)
      return new Promise<RunOutcome>((r) => settlers.set(spec.runId, r))
    },
    cancel: (runId) => { cancelRequests.push(runId) },
    cancelAll: () => {},
    isRunning: (runId) => settlers.has(runId)
  }

  return {
    manager,
    started: (runId: string) => seen.has(runId),
    sessionIdFor: (runId: string) => resumeSessionIds.get(runId) ?? null,
    cancelRequests,
    finish(runId: string, sessionId: string | null = null, status: RunOutcome['status'] = 'succeeded') {
      const settle = settlers.get(runId)
      if (!settle) throw new Error(`시작한 적 없는 run입니다: ${runId}`)
      settlers.delete(runId)
      settle({
        status,
        resultText: null,
        externalSessionId: sessionId,
        needsAnswer: false,
        exitCode: status === 'succeeded' ? 0 : 1,
        errorMessage: status === 'failed' ? '깨짐' : null,
        logPath: logPathFor(runId),
        usage: null
      })
    }
  }
}

/** 테스트가 풀어줄 때까지 끝나지 않는 비동기 단계 하나 (launch 중 취소 재현용). */
function createGate<T>() {
  let open: ((value: T) => void) | null = null
  let entered = false
  const wait = () => {
    entered = true
    return new Promise<T>((r) => { open = r })
  }
  return {
    wait,
    entered: () => entered,
    release: (value: T) => {
      if (!open) throw new Error('아직 그 단계에 들어오지 않았다')
      open(value)
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
    rawLogPathFor: (runId) => resolve(tmpdir(), `one-desk-deferred-${runId}.raw.jsonl`),
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

describe('사용량 배선 (docs/sdlc/run-info/)', () => {
  it('RunManager가 낸 usage가 run에 저장된다', async () => {
    // execution.ts의 finish(...)에 `usage:` 한 줄이 없으면 여기서 잡힌다.
    // 실제 spawn에 얹지 않는 이유: Windows에서는 가짜 CLI가 뜨지 않아 스트림이
    // 아예 없다(CLAUDE.md). 스텁이라야 두 OS에서 같은 것을 본다.
    const usage = {
      model: 'claude-opus-5[1m]',
      inputTokens: 2, outputTokens: 4,
      cacheReadTokens: 15428, cacheWriteTokens: 37917,
      reasoningTokens: 0, costUsd: 0.386994,
      contextTokens: 53347, contextWindow: 1000000
    }
    const manager = {
      logPathFor: (id: string) => `/tmp/${id}.jsonl`,
      async start() {
        return {
          status: 'succeeded' as const, resultText: '끝', externalSessionId: null,
          needsAnswer: false, exitCode: 0, errorMessage: null, logPath: '/tmp/x',
          usage
        }
      },
      cancel() {}, cancelAll() {}, isRunning: () => false
    }
    const ctx2 = setup({ manager: manager as unknown as RunManager })
    const started = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(ctx2.runs.get(started.id).usage).toEqual(usage)
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('usage가 없는 실행은 run.usage가 null이다', async () => {
    const manager = {
      logPathFor: (id: string) => `/tmp/${id}.jsonl`,
      async start() {
        return {
          status: 'succeeded' as const, resultText: '끝', externalSessionId: null,
          needsAnswer: false, exitCode: 0, errorMessage: null, logPath: '/tmp/x',
          usage: null
        }
      },
      cancel() {}, cancelAll() {}, isRunning: () => false
    }
    const ctx2 = setup({ manager: manager as unknown as RunManager })
    const started = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(ctx2.runs.get(started.id).usage).toBeNull()
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })
})

describe('지시 파일은 맥락에 담을 수 없다 (docs/sdlc/repo-instructions/ FR-9)', () => {
  it('instructions asset을 담아 시작하면 거부된다', async () => {
    const ctx = setup()
    try {
      const repoId = createRepoRepository(ctx.db)
        .create({ workspaceId: ctx.workspaceId, name: 'api', path: '/tmp/api' }).id
      const assets = createAssetRepository(ctx.db)
      assets.upsertDiscovered({
        workspaceId: ctx.workspaceId, repoId, seenAt: 1,
        found: [{ kind: 'instructions', name: 'CLAUDE.md', description: null, filePath: '/tmp/api/CLAUDE.md' }]
      })
      const id = assets.list({ workspaceId: ctx.workspaceId })[0]!.id
      // workspace 밖 항목(assertFound)과 같은 자리에서 막는다 — run 행이 생기기 전이라
      // start 자체가 거부된다. 조용히 빼고 성공으로 끝나면 여기서 잡힌다.
      await expect(ctx.service.start({
        workspaceId: ctx.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
        permission: 'edit', userPrompt: 'x', context: [{ type: 'asset', id }]
      })).rejects.toThrow(/지시 파일/)
      expect(ctx.runs.list(ctx.workspaceId)).toHaveLength(0)
    } finally {
      rmSync(ctx.logDir, { recursive: true, force: true })
    }
  })
})

describe('@ 파일 참조 (docs/sdlc/input-triggers/)', () => {
  /** 진짜 git 저장소를 작업 디렉토리로 등록한다. 테스트 프로세스의 동기 git은 괜찮다 — 앱 밖이다. */
  function withGitRepo(files: Record<string, string | Buffer>, options: { gitignore?: string } = {}) {
    const listCalls: string[] = []
    const real = createFileService({ getRepo: () => { throw new Error('검색은 쓰지 않는다') } })
    const counting: Pick<FileService, 'resolveMentions'> = {
      resolveMentions: (repo, prompt) => { listCalls.push(prompt); return real.resolveMentions(repo, prompt) }
    }
    const ctx = setup({ files: counting })
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-mention-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    if (options.gitignore) writeFileSync(resolve(dir, '.gitignore'), options.gitignore)
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(resolve(dir, rel)), { recursive: true })
      writeFileSync(resolve(dir, rel), content)
    }
    const repoId = createRepoRepository(ctx.db).create({ workspaceId: ctx.workspaceId, name: 'notes-repo', path: dir }).id
    const start = (userPrompt: string, extra: { agentKind?: AgentKind } = {}) => ctx.service.start({
      workspaceId: ctx.workspaceId, agentKind: extra.agentKind ?? 'claude-code', cwd: dir,
      permission: 'edit', userPrompt, context: []
    })
    // 가짜 CLI가 그 디렉토리를 cwd로 쥐고 도는 동안 Windows는 지우지 못한다(EBUSY) — 끝나길 기다린다.
    const cleanup = async () => {
      await vi.waitFor(() => {
        expect(ctx.runs.list(ctx.workspaceId).every((r) => r.endedAt !== null)).toBe(true)
      }, { timeout: 15_000 })
      rmSync(ctx.logDir, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
    return { ctx, dir, repoId, start, cleanup, listCalls }
  }

  it('요청 맥락에 file이 오면 거부되고 run 행이 생기지 않는다 (FR-9)', async () => {
    const ctx = setup()
    try {
      await expect(ctx.service.start({
        workspaceId: ctx.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
        permission: 'edit', userPrompt: 'x', context: [{ type: 'file', id: `${ctx.repoId}:package.json` }]
      })).rejects.toThrow('파일은 지시문의 @로만 담을 수 있습니다')
      expect(ctx.runs.list(ctx.workspaceId)).toHaveLength(0)
    } finally {
      rmSync(ctx.logDir, { recursive: true, force: true })
    }
  })

  it('지시문의 @경로를 읽어 <files>에 싣고, file 맥락을 기록하며, 저장된 지시는 원문이다 (FR-8·FR-12·FR-15)', async () => {
    const t = withGitRepo({ 'notes/a.txt': 'PELICAN 문장' })
    try {
      const run = await t.start('@notes/a.txt를 요약하고 @../secret 은 무시')
      const saved = t.ctx.runs.get(run.id)

      expect(saved.userPrompt).toBe('@notes/a.txt를 요약하고 @../secret 은 무시')
      expect(saved.assembledPrompt).toContain('<file repo="notes-repo" path="notes/a.txt">PELICAN 문장</file>')
      expect(saved.assembledPrompt).toContain('<task>\nnotes/a.txt를 요약하고 ＠../secret 은 무시\n</task>')
      expect(saved.contextItems).toContainEqual({ type: 'file', id: `${t.repoId}:notes/a.txt`, label: 'notes/a.txt' })
    } finally {
      await t.cleanup()
    }
  })

  it('무시된 파일(.env)은 손으로 쳐도 싣지 않고 중화한다 (spec §7의 3)', async () => {
    const t = withGitRepo({ '.env': 'SECRET=1' }, { gitignore: '.env\n' })
    try {
      const run = await t.start('@.env 봐')
      const saved = t.ctx.runs.get(run.id)

      expect(saved.assembledPrompt).not.toContain('SECRET=1')
      expect(saved.assembledPrompt).toContain('＠.env 봐')
      expect(saved.contextItems.filter((c) => c.type === 'file')).toEqual([])
    } finally {
      await t.cleanup()
    }
  })

  it('바이너리 멘션은 전송을 거부하고 run 행이 생기지 않는다. 이유에 경로가 있다 (FR-10)', async () => {
    const t = withGitRepo({ 'img.bin': Buffer.from([0x61, 0x00, 0x62]) })
    try {
      await expect(t.start('@img.bin 봐')).rejects.toThrow('바이너리 파일은 담을 수 없습니다: img.bin')
      expect(t.ctx.runs.list(t.ctx.workspaceId)).toHaveLength(0)
    } finally {
      await t.cleanup()
    }
  })

  it('opencode여도 조립 결과가 같다 — 앱이 읽어 싣는다', async () => {
    const t = withGitRepo({ 'a.txt': 'A 내용' })
    try {
      const claude = t.ctx.runs.get((await t.start('@a.txt 봐')).id)
      const opencode = t.ctx.runs.get((await t.start('@a.txt 봐', { agentKind: 'opencode' })).id)

      expect(opencode.assembledPrompt).toBe(claude.assembledPrompt)
      expect(opencode.assembledPrompt).toContain('A 내용')
    } finally {
      await t.cleanup()
    }
  })

  it('이어 가는 턴(resume)도 대화의 작업 디렉토리에서 해석한다', async () => {
    const t = withGitRepo({ 'b.txt': 'B 내용' })
    try {
      const first = await t.start('처음')
      await vi.waitFor(() => expect(t.ctx.runs.get(first.id).endedAt).toBeTypeOf('number'), { timeout: 15_000 })
      const next = await t.ctx.service.resume({
        conversationId: first.id, userPrompt: '@b.txt 도 봐', context: [],
        model: null, effort: null, permission: 'edit'
      })

      expect(t.ctx.runs.get(next.id).assembledPrompt).toContain('B 내용')
    } finally {
      await t.cleanup()
    }
  })

  it('파일 해석이 없으면 멘션은 전부 중화된다 — 펼칠 길을 남기지 않는다', async () => {
    const ctx = setup()
    try {
      const run = await ctx.service.start({
        workspaceId: ctx.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
        permission: 'edit', userPrompt: '@package.json 봐', context: []
      })
      expect(ctx.runs.get(run.id).assembledPrompt).toContain('＠package.json 봐')
    } finally {
      rmSync(ctx.logDir, { recursive: true, force: true })
    }
  })
})
