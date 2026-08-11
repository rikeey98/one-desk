import { describe, it, expect, afterEach, vi } from 'vitest'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createCore, type Core } from './index'
import { DEFAULT_CONCURRENCY_LIMIT } from './db/repositories/setting'
import type { InboxCounts } from '@shared/models'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(HERE, '../drizzle')
const FAKE_AGENT = resolve(HERE, 'runner/fixtures/fake-claude.mjs')

/**
 * createCore는 실제 파일 DB를 연다 — 재기동 왕복이 이 테스트의 요점이라 인메모리로는
 * 아무것도 검증할 수 없다. 그래서 임시 디렉토리를 쓰고 반드시 shutdown()으로 닫는다
 * (better-sqlite3는 마지막 연결이 닫힐 때 WAL을 체크포인트한다).
 */
const dirs: string[] = []
const cores: Core[] = []

function makeDataDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-core-'))
  dirs.push(dir)
  return dir
}

function open(dataDir: string): Core {
  const core = createCore({ dataDir, migrationsDir: MIGRATIONS_DIR })
  cores.push(core)
  return core
}

function close(core: Core): void {
  core.shutdown()
  cores.splice(cores.indexOf(core), 1)
}

afterEach(() => {
  for (const core of cores.splice(0)) core.shutdown()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function seedRun(core: Core, dataDir: string, userPrompt: string) {
  const workspaceId = core.workspaces.create({ name: 'ws' }).id
  return core.runs.create({
    workspaceId,
    agentKind: 'claude-code',
    model: null,
    cwd: dataDir,
    permission: 'edit',
    userPrompt,
    assembledPrompt: '<task/>',
    // 실제로 만들지 않는다. 아래에서 logs/ 디렉토리의 부재로 "프로세스가 뜨지
    // 않았다"를 판정하므로 여기서 만들어 버리면 그 단언이 무력해진다.
    logPath: join(dataDir, 'logs', 'seed', 'stream.jsonl'),
    context: []
  })
}

describe('createCore', () => {
  it('바꾼 동시 실행 상한이 재기동 후에도 남는다', () => {
    // app_setting의 첫 사용처다. setLimit이 저장을 빠뜨리거나 부팅이 저장된 값을
    // 읽지 않으면 상한이 매 실행마다 조용히 기본값으로 돌아간다 — 화면에는
    // 아무 오류도 안 뜨고, 사용자는 자기가 설정을 안 눌렀다고 생각하게 된다.
    const dataDir = makeDataDir()

    const first = open(dataDir)
    expect(first.queue.snapshot().limit).toBe(DEFAULT_CONCURRENCY_LIMIT)
    expect(first.queue.setLimit(5)).toEqual({ running: 0, limit: 5, waiting: 0 })
    close(first)

    const second = open(dataDir)
    expect(second.queue.snapshot().limit).toBe(5)
    close(second)
  })

  it('상한이 1 미만이면 거부하고 저장된 값을 건드리지 않는다', () => {
    const dataDir = makeDataDir()

    const first = open(dataDir)
    first.queue.setLimit(2)
    expect(() => first.queue.setLimit(0)).toThrow(/1 이상의 정수/)
    close(first)

    const second = open(dataDir)
    expect(second.queue.snapshot().limit).toBe(2)
    close(second)
  })

  it('부팅은 아무것도 시작하지 않고 남아 있던 run만 정리한다', () => {
    // 앱을 여는 행위가 agent 실행을 부르면 안 된다(전체 설계 §14). 지금은 코드를
    // 읽어야만 알 수 있는 성질이라, 실행 가능한 단언으로 고정해 둔다.
    const dataDir = makeDataDir()

    const first = open(dataDir)
    const wasRunning = seedRun(first, dataDir, '실행 중이던 것')
    first.runs.markStarted(wasRunning.id)
    const wasPending = seedRun(first, dataDir, '대기 중이던 것')
    expect(first.runs.get(wasRunning.id).status).toBe('running')
    expect(first.runs.get(wasPending.id).status).toBe('pending')
    close(first)

    const second = open(dataDir)

    expect(second.runs.get(wasRunning.id).status).toBe('interrupted')
    expect(second.runs.get(wasPending.id).status).toBe('canceled')
    // 큐가 비어 있다 — 복구가 대기열에 다시 밀어 넣지 않았다.
    expect(second.queue.snapshot()).toEqual({
      running: 0, limit: DEFAULT_CONCURRENCY_LIMIT, waiting: 0
    })
    // manager는 프로세스를 띄우는 첫 동작으로 <dataDir>/logs/<runId>/를 만든다.
    // 그 디렉토리가 없다는 것이 "아무 프로세스도 뜨지 않았다"의 관측 가능한 증거다.
    expect(existsSync(join(dataDir, 'logs'))).toBe(false)
    close(second)
  })

  /**
   * 실제로 프로세스를 띄우는 유일한 테스트다.
   *
   * emitInbox는 execution의 onRunUpdate 경로에 있으므로, runs.markFinished를 직접
   * 불러서는 그 경로를 지나지 않아 아무것도 검증하지 못한다. 그래서 가짜 CLI를 실제로
   * 돌린다 — resolveAgentPath가 ONE_DESK_AGENT_PATH를 먼저 보므로 그 이음매로 물린다.
   */
  it('run이 끝나면 인박스 카운트를 push한다', async () => {
    const previous = process.env['ONE_DESK_AGENT_PATH']
    process.env['ONE_DESK_AGENT_PATH'] = FAKE_AGENT
    try {
      const dataDir = makeDataDir()
      const core = open(dataDir)
      const seen: InboxCounts[] = []
      core.onInboxUpdate((counts) => seen.push(counts))

      const ws = core.workspaces.create({ name: 'ws' }).id
      const run = await core.execution.start({
        workspaceId: ws, agentKind: 'claude-code', cwd: dataDir,
        permission: 'edit', userPrompt: 'x', context: []
      })
      await vi.waitFor(() => expect(core.runs.get(run.id).endedAt).toBeTypeOf('number'))

      await vi.waitFor(() => {
        expect(seen.at(-1)?.total).toBe(1)
        expect(seen.at(-1)?.byWorkspace[ws]).toBe(1)
      })
    } finally {
      // 전역을 건드렸으니 반드시 되돌린다. 남기면 뒤 테스트가 가짜 CLI를 쓴다.
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_PATH']
      else process.env['ONE_DESK_AGENT_PATH'] = previous
    }
  })

  it('확인함을 누르면 카운트가 줄어든 것을 push한다', () => {
    // 여기서는 프로세스를 띄울 필요가 없다. seedRun으로 행을 만들고 끝난 상태로
    // 바꾼 뒤, inbox.markReviewed가 스스로 push하는지만 본다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const seeded = seedRun(core, dataDir, '확인 대상')
    core.runs.markFinished(seeded.id, {
      status: 'succeeded', resultText: null, externalSessionId: null,
      needsAnswer: false, exitCode: 0, errorMessage: null
    })
    expect(core.inbox.counts().total).toBe(1)

    const seen: InboxCounts[] = []
    core.onInboxUpdate((counts) => seen.push(counts))
    core.inbox.markReviewed(seeded.id, 'confirmed')

    expect(seen.at(-1)).toEqual({ total: 0, byWorkspace: {} })
    expect(core.inbox.list()).toHaveLength(0)
  })
})
