import { describe, it, expect, afterEach, vi } from 'vitest'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createAdapters, createCore, type Core } from './index'
import { DEFAULT_CONCURRENCY_LIMIT } from './db/repositories/setting'
import type { InboxCounts, McpStatus, Run } from '@shared/models'
import { INBOX_RULES, inboxCategory } from '@shared/inbox'

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
    effort: null,
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

      // **숫자를 직접 못 박지 않는다.** 가짜 CLI는 macOS에서 실제로 돌아 succeeded
      // (=완료·미확인, 배지가 세지 않음)로 끝나고, Windows에서는 .mjs라 spawn조차
      // 되지 않아 failed(=배지가 셈)로 끝난다(CLAUDE.md). `toBe(1)`로 박으면
      // **한쪽 플랫폼에서만 초록인 테스트**가 된다.
      //
      // 이 테스트가 지키는 것은 카테고리 규칙이 아니라 **배선**이다: run이 끝나면
      // emitInbox가 불려 지금 집계가 push되는가. 그래서 (a) push가 한 번이라도
      // 일어났고 (b) 마지막 push가 지금 집계와 같은지를 본다 — onRunUpdate에서
      // emitInbox() 한 줄을 지우면 seen이 비어 (a)가 빨개진다.
      await vi.waitFor(() => {
        expect(seen.length).toBeGreaterThan(0)
        expect(seen.at(-1)).toEqual(core.inbox.counts())
      })
      // 어느 플랫폼이든 그 run이 유일한 대화이므로, 집계는 그 대화의 카테고리가
      // 정하는 값과 정확히 같다.
      const finished = core.runs.get(run.id)
      const expected = INBOX_RULES[inboxCategory(finished)].badge ? 1 : 0
      expect(core.inbox.counts().total).toBe(expected)
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

  describe('대화 종료와 이름', () => {
    /**
     * 배선 테스트다 — 저장소의 동작은 `run.test.ts`가 본다. 여기서 지키는 것은
     * **core가 두 이벤트를 내보내는가**뿐이다 (spec FR-15). 빠뜨리면 화면이
     * 조용히 낡는다: 종료해도 배지가 안 줄고, 이름을 바꿔도 도크가 그대로다.
     */
    function finishedRun(core: Core, dataDir: string) {
      const seeded = seedRun(core, dataDir, '대상')
      core.runs.markFinished(seeded.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: '깨짐', usage: null
      })
      return seeded
    }

    it('끝내면 run 갱신과 인박스 카운트를 모두 push한다', () => {
      const dataDir = makeDataDir()
      const core = open(dataDir)
      const seeded = finishedRun(core, dataDir)
      expect(core.inbox.counts().total).toBe(1)

      const runsSeen: Run[] = []
      const countsSeen: InboxCounts[] = []
      core.onRunUpdate((r) => runsSeen.push(r))
      core.onInboxUpdate((c) => countsSeen.push(c))

      const closed = core.conversations.close(seeded.id)

      expect(closed.closedAt).toBeTypeOf('number')
      expect(runsSeen.at(-1)?.id).toBe(seeded.id)
      expect(countsSeen.at(-1)).toEqual({ total: 0, byWorkspace: {} })
    })

    it('이름을 바꾸면 run 갱신을 push한다', () => {
      const dataDir = makeDataDir()
      const core = open(dataDir)
      const seeded = finishedRun(core, dataDir)

      const runsSeen: Run[] = []
      const countsSeen: InboxCounts[] = []
      core.onRunUpdate((r) => runsSeen.push(r))
      core.onInboxUpdate((c) => countsSeen.push(c))

      const renamed = core.conversations.rename(seeded.id, '로그인 정리')

      expect(renamed.title).toBe('로그인 정리')
      expect(runsSeen.at(-1)?.title).toBe('로그인 정리')
      // 이름은 인박스 소속을 바꾸지 않지만 같은 경로로 흘려보낸다 — 목록의 제목이
      // 인박스 항목에도 쓰일 수 있고, 한쪽만 보내면 어느 화면이 낡는지가 배선에
      // 따라 달라진다.
      expect(countsSeen.at(-1)).toEqual(core.inbox.counts())
    })
  })

  it('확인함을 누르면 카운트가 줄어든 것을 push한다', () => {
    // 여기서는 프로세스를 띄울 필요가 없다. seedRun으로 행을 만들고 끝난 상태로
    // 바꾼 뒤, inbox.markReviewed가 스스로 push하는지만 본다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const seeded = seedRun(core, dataDir, '확인 대상')
    // 배지가 세는 카테고리로 끝낸다 — 완료·미확인은 애초에 0이라(shared/inbox.ts의
    // INBOX_RULES, spec FR-4) succeeded로 두면 "줄어든 것을 push한다"를 확인할 수 없다.
    core.runs.markFinished(seeded.id, {
      status: 'failed', resultText: null, externalSessionId: null,
      needsAnswer: false, exitCode: 1, errorMessage: '깨짐',
      usage: null
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

describe('@ 파일 검색 배선 (docs/sdlc/input-triggers/)', () => {
  it('core.files.search가 등록된 repo의 git 목록에서 찾는다', async () => {
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const repoPath = join(dataDir, 'repo')
    mkdirSync(join(repoPath, 'notes'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: repoPath })
    writeFileSync(join(repoPath, 'notes', 'a.txt'), 'x')
    const repoId = (await core.repos.create({ workspaceId, name: 'api', path: repoPath })).id

    const result = await core.files.search({ workspaceId, repoId, query: 'a.txt' })

    expect(result).toEqual({ ok: true, files: [{ path: 'notes/a.txt' }], truncated: false })
    close(core)
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
        workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: repoPath,
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

describe('슬래시 커맨드 배선', () => {
  /** 가짜 CLI를 물리는 env를 걸었다가 반드시 되돌린다 — 남기면 뒤 테스트가 그것을 쓴다. */
  async function withAgentPath<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.env['ONE_DESK_AGENT_PATH']
    process.env['ONE_DESK_AGENT_PATH'] = path
    try {
      return await fn()
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_PATH']
      else process.env['ONE_DESK_AGENT_PATH'] = previous
    }
  }

  it('실행 파일을 찾지 못하면 던지지 않고 빈 목록과 사유를 준다', async () => {
    // preflight 실패가 예외로 새면 IPC 핸들러가 거부되고 피커는 사유 없이 비어 보인다.
    // 사유는 preflight의 것을 그대로 — 설정한 경로가 무엇이었는지 화면에서 보여야 한다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const missing = join(dataDir, '없는-claude')

    const result = await withAgentPath(missing, () => core.commands.list({ workspaceId, cwd: dataDir }))

    expect(result).toEqual({ commands: [], error: expect.stringContaining(missing) })
    // 앱은 멀쩡하다 — core가 계속 응답하고 아무 프로세스도 뜨지 않았다.
    expect(core.queue.snapshot().running).toBe(0)
    expect(existsSync(join(dataDir, 'logs'))).toBe(false)
    close(core)
  })

  it('목록을 얻어도 슬롯·큐·run 테이블·이벤트에 흔적이 없다 (FR-11)', async () => {
    const dataDir = makeDataDir()
    const core = open(dataDir)
    // run 테이블이 비어 있으면 "같다"가 자명하다 — 행을 하나 두고 본다.
    const seeded = seedRun(core, dataDir, '기존 것')
    const workspaceId = seeded.workspaceId
    const leaked: unknown[] = []
    core.onRunEvent((e) => leaked.push(e))
    core.onRunUpdate((r) => leaked.push(r))
    core.onQueueUpdate((s) => leaked.push(s))
    const queueBefore = core.queue.snapshot()
    const runsBefore = core.runs.list(workspaceId)

    await withAgentPath(FAKE_AGENT, () => core.commands.list({ workspaceId, cwd: dataDir }))

    expect(core.queue.snapshot()).toEqual(queueBefore)
    expect(core.runs.list(workspaceId)).toEqual(runsBefore)
    expect(leaked).toEqual([])
    // manager는 프로세스를 띄우는 첫 동작으로 logs/를 만든다 — 없다는 것이
    // 탐색이 RunManager를 타지 않았다는 관측 가능한 증거다.
    expect(existsSync(join(dataDir, 'logs'))).toBe(false)
    close(core)
  })

  /**
   * 아래는 shebang 스크립트를 실행 파일로 직접 띄운다. Windows에는 shebang 실행이 없어
   * 성립하지 않는다 — probe.test.ts와 같은 규칙으로 스킵한다.
   */
  describe.skipIf(process.platform === 'win32')('가짜 CLI를 실제로 띄운다', () => {
    it('픽스처의 init에서 터미널 전용을 뺀 목록을 준다', async () => {
      const dataDir = makeDataDir()
      const core = open(dataDir)
      const workspaceId = core.workspaces.create({ name: 'ws' }).id

      const result = await withAgentPath(FAKE_AGENT, () => core.commands.list({ workspaceId, cwd: dataDir }))

      expect(result).toEqual({
        commands: [
          { name: 'code-review', description: null, usesArguments: false },
          { name: 'compact', description: null, usesArguments: false },
          { name: 'pinetest', description: null, usesArguments: false }
        ],
        error: null
      })
      close(core)
    })

    it('설명은 넘긴 homeDir에서 읽는다', async () => {
      // opts.homeDir가 describe까지 닿는 한 줄. 빈 문자열이나 cwd를 넘겨도 위 테스트는
      // 통과하므로 따로 고정한다 — 배선 한 줄은 그 자체로 되돌릴 수 있는 변이다.
      const dataDir = makeDataDir()
      const home = join(dataDir, 'home')
      const commandsDir = join(home, '.claude', 'commands')
      mkdirSync(commandsDir, { recursive: true })
      writeFileSync(join(commandsDir, 'pinetest.md'), '---\ndescription: 솔잎 검사\n---\n$ARGUMENTS를 검사한다\n')
      const core = open(dataDir, home)
      const workspaceId = core.workspaces.create({ name: 'ws' }).id

      const { commands } = await withAgentPath(FAKE_AGENT, () => core.commands.list({ workspaceId, cwd: dataDir }))

      expect(commands.find((c) => c.name === 'pinetest'))
        .toEqual({ name: 'pinetest', description: '솔잎 검사', usesArguments: true })
      close(core)
    })

    it('실패한 조회는 수동 새로고침으로 다시 얻는다', async () => {
      // 경로를 고친 뒤 새로고침하면 실패한 캐시를 버리고 다시 탐색한다.
      const dataDir = makeDataDir()
      const core = open(dataDir)
      const workspaceId = core.workspaces.create({ name: 'ws' }).id
      const target = { workspaceId, cwd: dataDir }

      const failed = await withAgentPath(join(dataDir, '없는-claude'), () => core.commands.list(target))
      const retried = await withAgentPath(FAKE_AGENT, () => core.commands.refresh(target))

      expect(failed.commands).toEqual([])
      expect(retried.error).toBeNull()
      expect(retried.commands.map((c) => c.name)).toEqual(['code-review', 'compact', 'pinetest'])
      close(core)
    })

    it('run이 끝나도 다시 탐색하지 않는다 (FR-13)', async () => {
      // createCore에는 probe를 주입할 이음매가 없다 — 그래서 spawn 자체를 센다. 가짜 CLI 앞에
      // argv를 기록해 도구를 비운 probe만 센다. read_only run도 --tools를 쓰지만 값이 비어 있지 않다.
      const dataDir = makeDataDir()
      const spawnLog = join(dataDir, 'spawns.jsonl')
      const counting = join(dataDir, 'counting-claude.mjs')
      writeFileSync(counting, [
        '#!/usr/bin/env node',
        "import { appendFileSync } from 'node:fs'",
        `appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(process.argv.slice(2)) + '\\n')`,
        `await import(${JSON.stringify(pathToFileURL(FAKE_AGENT).href)})`,
        ''
      ].join('\n'), { mode: 0o755 })
      const probeSpawns = (): number => existsSync(spawnLog)
        ? readFileSync(spawnLog, 'utf8').trim().split('\n').filter((line) => {
            const args = JSON.parse(line) as string[]
            return args[args.indexOf('--tools') + 1] === ''
          }).length
        : 0

      const core = open(dataDir)
      const workspaceId = core.workspaces.create({ name: 'ws' }).id
      const target = { workspaceId, cwd: dataDir }

      await withAgentPath(counting, async () => {
        const first = await core.commands.list(target)
        expect(first.error).toBeNull()
        expect(probeSpawns()).toBe(1)

        const run = await core.execution.start({
          workspaceId, agentKind: 'claude-code', cwd: dataDir,
          permission: 'edit', userPrompt: 'x', context: []
        })
        await vi.waitFor(() => expect(core.runs.get(run.id).endedAt).toBeTypeOf('number'))

        // 끝난 뒤의 list가 캐시를 맞으면 CLI가 다시 뜨지 않는다. onRunUpdate가 refresh를
        // 불렀다면 캐시가 비워져 여기서(또는 이미) 한 번 더 떴다 — 진행 중인 조회를 나눠
        // 쓰는 규칙 때문에 그 spawn이 아직 안 찍혔어도 이 await가 그것을 기다린다.
        const after = await core.commands.list(target)
        expect(after).toEqual(first)
        expect(probeSpawns()).toBe(1)
      })
      close(core)
    })
  })
})

describe('core.workspaces.checkAgents', () => {
  /**
   * 설정 화면이 보여주는 판정은 실행을 막는 판정과 **같아야 한다** (설계 §595).
   * 따로 구현하면 화면은 초록인데 실행 버튼은 막히는 상태가 생긴다.
   *
   * ONE_DESK_AGENT_PATH가 잡혀 있으면 workspace 설정보다 먼저다 — e2e가 가짜
   * CLI를 물리는 통로이자 resolveAgentPath의 규칙 그대로다. 여기서는 그 변수가
   * 결과를 오염시키지 않도록 지우고 돈다.
   */
  const withoutOverride = async (fn: () => Promise<void>): Promise<void> => {
    const previous = process.env['ONE_DESK_AGENT_PATH']
    delete process.env['ONE_DESK_AGENT_PATH']
    try {
      await fn()
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_PATH']
      else process.env['ONE_DESK_AGENT_PATH'] = previous
    }
  }

  it('설정한 경로가 실행 가능하면 그 경로를 돌려준다', async () => {
    await withoutOverride(async () => {
      const core = open(makeDataDir())
      const ws = core.workspaces.create({ name: 'ws' }).id
      // 실제로 존재하고 실행 가능한 파일 — 지금 돌고 있는 node 바이너리다.
      // 플랫폼별 실행 권한 규칙을 흉내내지 않고 진짜를 쓴다.
      core.workspaces.updatePaths({ id: ws, claudePath: process.execPath, opencodePath: null })

      const status = await core.workspaces.checkAgents(ws)

      expect(status['claude-code'].ok).toBe(true)
      expect(status['claude-code'].executable).toBe(process.execPath)
    })
  })

  it('설정한 경로가 없으면 그 이유를 돌려준다', async () => {
    await withoutOverride(async () => {
      const core = open(makeDataDir())
      const ws = core.workspaces.create({ name: 'ws' }).id
      core.workspaces.updatePaths({
        id: ws, claudePath: join(makeDataDir(), '없는-claude'), opencodePath: null
      })

      const status = await core.workspaces.checkAgents(ws)

      expect(status['claude-code'].ok).toBe(false)
      expect(status['claude-code'].reason).toContain('실행할 수 없습니다')
    })
  })

  it('두 agent를 각자의 경로로 따로 본다', async () => {
    // 한 칸을 둘 다에 쓰면 claude 경로를 고쳤을 때 opencode까지 초록이 된다.
    await withoutOverride(async () => {
      const core = open(makeDataDir())
      const ws = core.workspaces.create({ name: 'ws' }).id
      core.workspaces.updatePaths({
        id: ws,
        claudePath: process.execPath,
        opencodePath: join(makeDataDir(), '없는-opencode')
      })

      const status = await core.workspaces.checkAgents(ws)

      expect(status['claude-code'].ok).toBe(true)
      expect(status.opencode.ok).toBe(false)
    })
  })

  it('없는 workspace면 설정이 없는 것으로 보고 PATH 탐색으로 떨어진다', async () => {
    // 던지지 않는다 — 이 조회는 화면을 그리는 길목이고, workspace가 막 지워진
    // 찰나에 던지면 설정 화면 전체가 빨간 줄만 남는다.
    await withoutOverride(async () => {
      const core = open(makeDataDir())
      const status = await core.workspaces.checkAgents('없는-id')
      expect(status['claude-code']).toHaveProperty('ok')
      expect(status.opencode).toHaveProperty('ok')
    })
  })

  it('opencode 2.x는 설정 화면과 실행이 같은 이유로 막고, 버전은 한 번만 읽는다 (FR-17)', async () => {
    // `docs/sdlc/conversation-fixes/` spec FR-17. 버전 게이트를 preflight에 둔 것이 곧
    // "checkAgents와 실행이 같은 판정"이다 — 한쪽에만 있으면 설정 화면은 초록인데 실행은
    // 막히거나, 반대로 화면은 빨간데 2.x가 권한 정책 없이 돈다. 판정은 (경로, 크기, mtime)
    // 캐시를 함께 쓰므로 두 번의 확인과 한 번의 실행이 프로세스를 한 번만 띄운다.
    await withoutOverride(async () => {
      const dataDir = makeDataDir()
      const script = join(dataDir, 'opencode-2.mjs')
      const calls = join(dataDir, 'version-calls.txt')
      writeFileSync(script, [
        "import { appendFileSync } from 'node:fs'",
        'process.stdin.resume()',
        "process.stdin.on('end', () => {",
        "  if (!process.argv.includes('--version')) return",
        `  appendFileSync(${JSON.stringify(calls)}, 'x')`,
        "  process.stdout.write('2.0.18\\n')",
        '})'
      ].join('\n'), { mode: 0o755 })

      // 셔뱅이 없는 .mjs다 — Windows는 런처 없이 띄우지 못한다(driver.ts와 같은 통로).
      const previousLauncher = process.env['ONE_DESK_AGENT_LAUNCHER']
      process.env['ONE_DESK_AGENT_LAUNCHER'] = process.execPath
      try {
        const core = open(dataDir)
        const ws = core.workspaces.create({ name: 'ws' }).id
        core.workspaces.updatePaths({ id: ws, claudePath: null, opencodePath: script })

        const status = await core.workspaces.checkAgents(ws)
        expect(status.opencode.ok).toBe(false)
        expect(status.opencode.reason).toContain('2.x')
        // 다시 열어도 같은 답이다 — 캐시에서 온다.
        expect((await core.workspaces.checkAgents(ws)).opencode).toEqual(status.opencode)

        const run = await core.execution.start({
          workspaceId: ws, agentKind: 'opencode', cwd: dataDir,
          permission: 'read_only', userPrompt: 'x', context: []
        })
        const saved = core.runs.get(run.id)
        expect(saved.status).toBe('failed')
        // 실행을 막은 이유가 설정 화면이 보여준 이유와 글자까지 같다.
        expect(saved.errorMessage).toBe(status.opencode.reason)
        expect(saved.startedAt).toBeNull()

        expect(readFileSync(calls, 'utf8')).toBe('x')
        close(core)
      } finally {
        if (previousLauncher === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
        else process.env['ONE_DESK_AGENT_LAUNCHER'] = previousLauncher
      }
    })
  })

  it('opencode 1.x는 설정 화면에서 그 실행 파일로 잡힌다', async () => {
    // 게이트가 멀쩡한 설치본까지 막지 않는다는 반대쪽 절반이다.
    await withoutOverride(async () => {
      const dataDir = makeDataDir()
      const script = join(dataDir, 'opencode-1.mjs')
      writeFileSync(script, [
        'process.stdin.resume()',
        "process.stdin.on('end', () => { process.stdout.write('1.18.30\\n') })"
      ].join('\n'), { mode: 0o755 })

      const previousLauncher = process.env['ONE_DESK_AGENT_LAUNCHER']
      process.env['ONE_DESK_AGENT_LAUNCHER'] = process.execPath
      try {
        const core = open(dataDir)
        const ws = core.workspaces.create({ name: 'ws' }).id
        core.workspaces.updatePaths({ id: ws, claudePath: null, opencodePath: script })

        const status = await core.workspaces.checkAgents(ws)
        expect(status.opencode).toEqual({ ok: true, executable: script })
        close(core)
      } finally {
        if (previousLauncher === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
        else process.env['ONE_DESK_AGENT_LAUNCHER'] = previousLauncher
      }
    })
  })

  it('ONE_DESK_AGENT_PATH가 workspace 설정을 이긴다 — 실행과 같은 규칙이다', async () => {
    const previous = process.env['ONE_DESK_AGENT_PATH']
    process.env['ONE_DESK_AGENT_PATH'] = process.execPath
    try {
      const core = open(makeDataDir())
      const ws = core.workspaces.create({ name: 'ws' }).id
      core.workspaces.updatePaths({
        id: ws, claudePath: join(makeDataDir(), '없는-claude'), opencodePath: null
      })

      const status = await core.workspaces.checkAgents(ws)

      expect(status['claude-code'].ok).toBe(true)
      expect(status['claude-code'].executable).toBe(process.execPath)
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_PATH']
      else process.env['ONE_DESK_AGENT_PATH'] = previous
    }
  })
})

describe('core.workspaces.probeAgents (docs/sdlc/agent-setup/)', () => {
  /** 실행 파일 자리에 가짜 CLI를 물린다. checkAgents 테스트와 같은 통로다. */
  async function withAgentPath<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.env['ONE_DESK_AGENT_PATH']
    process.env['ONE_DESK_AGENT_PATH'] = path
    try {
      return await fn()
    } finally {
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_PATH']
      else process.env['ONE_DESK_AGENT_PATH'] = previous
    }
  }

  it('실행 파일이 없으면 두 agent 모두 unknown이고 던지지 않는다', async () => {
    // 이 조회의 실패가 예외로 새면 설정 화면이 통째로 빈다(FR-6).
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const ws = core.workspaces.create({ name: 'ws' }).id
    const missing = join(dataDir, '없는-cli')

    const probes = await withAgentPath(missing, () => core.workspaces.probeAgents(ws))

    expect(probes['claude-code'].auth.state).toBe('unknown')
    expect(probes['claude-code'].model.state).toBe('skipped')
    expect(probes.opencode.auth.state).toBe('unknown')
    close(core)
  })

  it('repo가 없으면 모델 칸이 skipped다', async () => {
    // probe의 cwd는 실행 패널이 쓰는 것과 같아야 한다 — repo가 없으면 그 자리가 없다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const ws = core.workspaces.create({ name: 'ws' }).id

    const probes = await withAgentPath(FAKE_AGENT, () => core.workspaces.probeAgents(ws))

    expect(probes['claude-code'].model.state).toBe('skipped')
    close(core)
  })

  it('조회해도 슬롯·큐·run 테이블·이벤트에 흔적이 없다 (FR-5)', async () => {
    // 슬래시 커맨드 FR-11과 같은 규칙이다. RunManager를 타면 실행 슬롯이 물리고
    // 인박스에 유령 run이 뜬다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const seeded = seedRun(core, dataDir, '기존 것')
    const workspaceId = seeded.workspaceId
    const leaked: unknown[] = []
    core.onRunEvent((e) => leaked.push(e))
    core.onRunUpdate((r) => leaked.push(r))
    core.onQueueUpdate((s) => leaked.push(s))
    const queueBefore = core.queue.snapshot()
    const runsBefore = core.runs.list(workspaceId)

    await withAgentPath(FAKE_AGENT, () => core.workspaces.probeAgents(workspaceId))

    expect(core.queue.snapshot()).toEqual(queueBefore)
    expect(core.runs.list(workspaceId)).toEqual(runsBefore)
    expect(leaked).toEqual([])
    // manager는 프로세스를 띄우는 첫 동작으로 logs/를 만든다 — 없다는 것이
    // 조회가 RunManager를 타지 않았다는 관측 가능한 증거다.
    expect(existsSync(join(dataDir, 'logs'))).toBe(false)
    close(core)
  })

  it('다시 확인은 workspace의 모든 repo cwd 커맨드 캐시를 비운다 (command-cache-auth FR-1)', async () => {
    // 첫 repo만 비우면, 실행 패널에서 다른 repo를 고른 사람에게는 그 cwd의 옛 실패가 남는다.
    const dataDir = makeDataDir()
    const spawnLog = join(dataDir, 'spawns.jsonl')
    const counting = join(dataDir, 'counting-claude.mjs')
    writeFileSync(counting, [
      '#!/usr/bin/env node',
      "import { appendFileSync } from 'node:fs'",
      `appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n')`,
      `await import(${JSON.stringify(pathToFileURL(FAKE_AGENT).href)})`,
      ''
    ].join('\n'), { mode: 0o755 })
    const probeSpawnsIn = (cwd: string): number => existsSync(spawnLog)
      ? readFileSync(spawnLog, 'utf8').trim().split('\n').filter((line) => {
          const { cwd: at, args } = JSON.parse(line) as { cwd: string; args: string[] }
          return at === cwd && args[args.indexOf('--tools') + 1] === ''
        }).length
      : 0

    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const first = join(dataDir, 'repo-a')
    const second = join(dataDir, 'repo-b')
    mkdirSync(first)
    mkdirSync(second)
    await core.repos.create({ workspaceId, name: 'a', path: first })
    await core.repos.create({ workspaceId, name: 'b', path: second })

    // 셔뱅이 없는 .mjs다 — Windows는 런처 없이 띄우지 못한다(driver.ts와 같은 통로).
    const previousLauncher = process.env['ONE_DESK_AGENT_LAUNCHER']
    process.env['ONE_DESK_AGENT_LAUNCHER'] = process.execPath
    try {
      await withAgentPath(counting, async () => {
        await core.commands.list({ workspaceId, cwd: first })
        await core.commands.list({ workspaceId, cwd: second })
        expect(probeSpawnsIn(realpathSync(second))).toBe(1)

        await core.workspaces.probeAgents(workspaceId, true)
        await core.commands.list({ workspaceId, cwd: second })

        expect(probeSpawnsIn(realpathSync(second))).toBe(2)
      })
    } finally {
      if (previousLauncher === undefined) delete process.env['ONE_DESK_AGENT_LAUNCHER']
      else process.env['ONE_DESK_AGENT_LAUNCHER'] = previousLauncher
      close(core)
    }
  })

  it('checkAgents는 그대로다 — 느린 칸이 빠른 칸을 대신하지 않는다', async () => {
    // 두 메서드가 하나로 합쳐지면 workspace를 고를 때마다 실행 파일 줄까지
    // 1초씩 비어 있게 된다(spec NFR-4).
    const core = open(makeDataDir())
    const ws = core.workspaces.create({ name: 'ws' }).id

    const status = await core.workspaces.checkAgents(ws)

    // 준비 상태의 느린 칸이 여기 섞여 들어오지 않는다.
    expect(status['claude-code']).not.toHaveProperty('auth')
    expect(status['claude-code']).not.toHaveProperty('model')
    close(core)
  })
})

describe('repos.update — 설정 화면의 repo 탭', () => {
  function seedRepoWithSkill(dataDir: string, name: string): string {
    const repoPath = join(dataDir, name)
    const skillDir = join(repoPath, '.claude', 'skills', '알파')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: 알파\ndescription: 스킬\n---\n')
    return repoPath
  }

  it('경로를 바꾸면 그 repo의 asset이 새 경로로 한 벌만 남는다', async () => {
    // spec FR-9. 치환 없이 재스캔만 하면 옛 행은 "없음"으로 남고 새 행이 쌓여 목록이
    // 두 벌이 된다 — 그것을 잡는 테스트다. 치환만 하고 재스캔을 빼면 lastSeenAt이 낡는다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const oldPath = seedRepoWithSkill(dataDir, 'repo-old')
    const made = await core.repos.create({ workspaceId, name: 'api', path: oldPath })
    const before = core.assets.list({ workspaceId })
    expect(before).toHaveLength(1)

    // 디렉토리를 실제로 옮긴다 — 설정에서 경로를 고치는 상황이 이것이다.
    const newPath = join(dataDir, 'repo-new')
    const { renameSync } = await import('node:fs')
    renameSync(oldPath, newPath)

    const seenBefore = before[0]!.lastSeenAt
    await new Promise((r) => setTimeout(r, 2))
    const updated = await core.repos.update({ id: made.id, path: newPath })
    expect(updated.path).toBe(newPath)

    const after = core.assets.list({ workspaceId })
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before[0]!.id, name: '알파' })
    expect(after[0]!.filePath!.startsWith(newPath)).toBe(true)
    // 재스캔까지 갔다는 증거 — 옮긴 자리에서 다시 봤으므로 lastSeenAt이 올라간다.
    expect(after[0]!.lastSeenAt!).toBeGreaterThan(seenBefore!)
    close(core)
  })

  it('존재하지 않는 경로는 거부하고 아무것도 바꾸지 않는다', async () => {
    // 실행의 cwd가 되는 값이다 — 없는 경로를 받아 두면 다음 실행이 조용히 실패한다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const repoPath = seedRepoWithSkill(dataDir, 'repo')
    const made = await core.repos.create({ workspaceId, name: 'api', path: repoPath })

    await expect(core.repos.update({ id: made.id, path: join(dataDir, '없는-디렉토리') }))
      .rejects.toThrow('존재하지 않는 경로')
    expect(core.repos.get(made.id).path).toBe(repoPath)
    expect(core.assets.list({ workspaceId })[0]!.filePath!.startsWith(repoPath)).toBe(true)
    close(core)
  })

  it('이름만 바꾸면 다시 훑지 않는다', async () => {
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const workspaceId = core.workspaces.create({ name: 'ws' }).id
    const repoPath = seedRepoWithSkill(dataDir, 'repo')
    const made = await core.repos.create({ workspaceId, name: 'api', path: repoPath })
    const seen = core.assets.list({ workspaceId })[0]!.lastSeenAt

    await new Promise((r) => setTimeout(r, 2))
    const updated = await core.repos.update({ id: made.id, name: 'api-renamed', description: '설명' })
    expect(updated).toMatchObject({ name: 'api-renamed', description: '설명', path: repoPath })
    expect(core.assets.list({ workspaceId })[0]!.lastSeenAt).toBe(seen)
    close(core)
  })
})

describe('paths — 정보 탭', () => {
  it('DB 파일과 로그 디렉토리의 실제 위치를 준다', () => {
    // 정보 탭이 보여주는 값이다. 여기가 실제 경로와 어긋나면 사용자가 엉뚱한 파일을
    // 백업한다 — 그래서 문자열 조립이 아니라 core가 실제로 여는 경로를 그대로 준다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const paths = core.paths()
    expect(paths.dbFile).toBe(join(dataDir, 'one-desk.db'))
    expect(paths.logDir).toBe(join(dataDir, 'logs'))
    expect(existsSync(paths.dbFile)).toBe(true)
    close(core)
  })
})
