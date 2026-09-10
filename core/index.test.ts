import { describe, it, expect, afterEach, vi } from 'vitest'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createAdapters, createCore, type Core } from './index'
import { DEFAULT_CONCURRENCY_LIMIT } from './db/repositories/setting'
import type { InboxCounts, McpStatus } from '@shared/models'

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

function open(dataDir: string, homeDir?: string): Core {
  // 홈은 반드시 임시 경로다 — 진짜 홈을 훑으면 개발자마다 결과가 달라진다.
  const core = createCore({
    dataDir, migrationsDir: MIGRATIONS_DIR, homeDir: homeDir ?? join(dataDir, 'home')
  })
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

  it('부팅하면 MCP 서버가 뜨고 상태가 listening이 된다', async () => {
    // 이 단언은 예전에 정반대였다("부팅만으로는 포트를 열지 않는다"). 사용자가
    // 상시 기동을 택해 전체 설계 §14의 결정을 뒤집었다 — 지우지 않고 뒤집어,
    // 이 성질이 계속 실행 가능한 단언으로 남게 한다.
    const core = open(makeDataDir())
    await vi.waitFor(() => {
      expect(core.mcpStatus()).toEqual({ state: 'listening', port: expect.any(Number) })
    })
    expect(core.mcpPort()).toBeTypeOf('number')
    close(core)
  })

  it('부팅 기동의 결과를 onMcpStatus로 흘려보낸다', async () => {
    // 창이 먼저 뜨는 경우를 위해 읽기(mcpStatus)와 구독이 둘 다 있어야 한다.
    // 이 테스트는 구독 쪽 — core/index.ts가 emit하는 한 줄을 지키다.
    const core = open(makeDataDir())
    const seen: McpStatus[] = []
    core.onMcpStatus((s) => seen.push(s))
    await vi.waitFor(() => {
      expect(seen.at(-1)).toEqual({ state: 'listening', port: expect.any(Number) })
    })
    close(core)
  })

  it('실행이 시작되면 MCP 서버가 127.0.0.1에 뜬다', async () => {
    const previous = process.env['ONE_DESK_AGENT_PATH']
    process.env['ONE_DESK_AGENT_PATH'] = FAKE_AGENT
    try {
      const dataDir = makeDataDir()
      const core = open(dataDir)
      const ws = core.workspaces.create({ name: 'ws' }).id
      const run = await core.execution.start({
        workspaceId: ws, agentKind: 'claude-code', cwd: dataDir,
        permission: 'edit', userPrompt: 'x', context: []
      })
      expect(core.mcpPort()).toBeTypeOf('number')
      await vi.waitFor(() => expect(core.runs.get(run.id).endedAt).toBeTypeOf('number'))
      close(core)
    } finally {
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

describe('createAdapters', () => {
  it('opencode는 OpenCode 어댑터를 쓴다', () => {
    // 임시 매핑(opencode → claudeCodeAdapter)이 남아 있으면 여기서 걸린다.
    // 배선 한 줄은 그 자체로 되돌릴 수 있는 변이다.
    expect(createAdapters()['opencode'].kind).toBe('opencode')
  })

  it('claude-code 매핑은 그대로다', () => {
    expect(createAdapters()['claude-code'].kind).toBe('claude-code')
  })
})

describe('asset 스캔 배선', () => {
  it('repo를 등록하면 그 repo를 훑는다', async () => {
    // 설계 §3-2의 세 시점 중 하나. 이 한 줄이 빠져도 새로고침으로는 목록이
    // 채워지므로, 테스트가 없으면 "등록해도 안 뜬다"를 아무도 못 잡는다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id

    const repoPath = join(dataDir, 'repo')
    const skillDir = join(repoPath, '.claude', 'skills', '알파')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: 알파\ndescription: 스킬\n---\n')

    core.repos.create({ workspaceId, name: 'api', path: repoPath })

    await vi.waitFor(() => {
      expect(core.assets.list({ workspaceId }).map((a) => a.name)).toEqual(['알파'])
    })
    close(core)
  })

  it('rescan은 다시 훑고 갱신된 목록을 준다', async () => {
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const repoPath = join(dataDir, 'repo')
    mkdirSync(repoPath, { recursive: true })
    core.repos.create({ workspaceId, name: 'api', path: repoPath })

    // 등록 뒤에 파일이 생겼다 — 새로고침이 이 경우를 위해 있다.
    const skillDir = join(repoPath, '.claude', 'skills', '베타')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: 베타\n---\n')

    const after = await core.assets.rescan(workspaceId)
    expect(after.map((a) => a.name)).toEqual(['베타'])
    close(core)
  })
})

describe('글로벌 asset', () => {
  function writeGlobalSkill(home: string, name: string): void {
    const d = join(home, '.claude', 'skills', name)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: 설명\n---\n`)
  }

  it('부팅하면 글로벌 경로를 훑는다', async () => {
    // repo를 하나도 등록하지 않았는데도 보여야 한다.
    const dataDir = makeDataDir()
    const home = join(dataDir, 'home')
    writeGlobalSkill(home, '글로벌 알파')

    const core = open(dataDir, home)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id

    // workspace가 부팅 뒤에 생겼으므로 한 번 훑어준다.
    await core.assets.rescan(workspaceId)
    expect(core.assets.list({ workspaceId }).map((a) => a.name)).toEqual(['글로벌 알파'])
    close(core)
  })

  it('설정에서 경로를 바꾸면 그 경로를 훑는다', async () => {
    const dataDir = makeDataDir()
    const core = open(dataDir, join(dataDir, 'home'))
    const workspaceId = core.workspaces.create({ name: 'ws' }).id

    const other = join(dataDir, 'other-home')
    writeGlobalSkill(other, '다른 곳 것')
    await core.settings.setGlobalRoots({
      claude: [join(other, '.claude', 'skills')], opencode: []
    })

    // setGlobalRoots가 스스로 다시 훑으므로 새로고침 없이 보인다.
    expect(core.assets.list({ workspaceId }).map((a) => a.name)).toEqual(['다른 곳 것'])
    close(core)
  })

  it('run이 끝나면 그 workspace를 다시 훑는다', async () => {
    // agent가 실행 중에 만든 skill 파일이 새로고침 없이 뜬다.
    const dataDir = makeDataDir()
    const core = open(dataDir, join(dataDir, 'home'))
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const repoPath = join(dataDir, 'repo')
    mkdirSync(repoPath, { recursive: true })
    await core.repos.create({ workspaceId, name: 'api', path: repoPath })
    expect(core.assets.list({ workspaceId })).toEqual([])

    // agent가 실행 중에 만든 skill 파일을 흉내낸다. **run을 띄우기 전에 써 둔다** —
    // 시작한 뒤에 쓰면 Windows에서만 터진다. 거기서는 .mjs 픽스처를 직접 실행하지
    // 못해 spawn이 곧바로 실패하고, run이 start()가 resolve되기도 전에 끝나 버린다.
    // 유일한 재스캔이 그때 이미 지나가므로 뒤늦게 쓴 파일은 영영 안 보인다.
    writeGlobalSkill(repoPath, '실행 중 생김')
    // 파일이 생겼다고 목록이 차지는 않는다 — 아무도 아직 훑지 않았다.
    // 아래 단언이 통과한다면 그것은 run이 끝나며 돈 재스캔 때문이다.
    expect(core.assets.list({ workspaceId })).toEqual([])

    const prev = process.env['ONE_DESK_AGENT_PATH']
    process.env['ONE_DESK_AGENT_PATH'] = FAKE_AGENT
    try {
      const run = await core.execution.start({
        workspaceId, agentKind: 'claude-code', model: null, cwd: repoPath,
        permission: 'edit', userPrompt: 'x', context: []
      })
      // status가 아니라 endedAt으로 기다린다 — 재스캔은 endedAt !== null로만 걸리고,
      // Windows에서는 가짜 CLI의 run이 늘 failed로 끝난다(이 파일의 다른 run
      // 테스트가 전부 endedAt만 보는 이유다).
      await vi.waitFor(() => expect(core.runs.get(run.id).endedAt).toBeTypeOf('number'))
      await vi.waitFor(() => {
        expect(core.assets.list({ workspaceId }).map((a) => a.name)).toEqual(['실행 중 생김'])
      })
    } finally {
      if (prev === undefined) delete process.env['ONE_DESK_AGENT_PATH']
      else process.env['ONE_DESK_AGENT_PATH'] = prev
      close(core)
    }
  })
})
