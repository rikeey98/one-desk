/**
 * 진짜 opencode로 권한과 MCP가 실제로 걸리는지 본다. **기본적으로 건너뛴다** — 실제 요청을 쓴다.
 *
 *   ONE_DESK_REAL_CLI=1 ONE_DESK_REAL_OPENCODE_MODEL=opencode/big-pickle pnpm test realOpencode
 *
 * - `ONE_DESK_REAL_OPENCODE_PATH`: 실행 파일(없으면 PATH의 opencode). **방언은 그 바이너리의 preflight가 정한다** —
 *   1.x·확인할 수 있는 2.x(2.3.2)·확인할 수 없는 2.x(2.0.18)가 각자의 describe를 돈다.
 * - `ONE_DESK_REAL_OPENCODE_MODEL`: 예 `opencode/big-pickle`(키 없이 된다 — 분당·일일 한도가 있다. 한도에 닿으면 그 테스트는
 *   실패가 아니라 건너뛴 것으로 남는다).
 * - `ONE_DESK_REAL_OPENCODE_PERMISSION`: 1.x 테스트의 권한(기본 read_only).
 * - `ONE_DESK_REAL_OPENCODE_OUT`: 마지막 run의 원본 줄을 남길 파일.
 *
 * **명령은 손으로 쓰지 않는다** — 실행 서비스가 하는 그대로 `verifyRunnable` → `buildCommand`로 만든다. 그래야 이 테스트가
 * 어댑터의 인자·환경변수·규칙을 실제로 검증한다.
 *
 * 1.x (2026-10-27 실측, 1.18.30): full은 통과, read_only·edit는 `"*": "deny"`가 MCP 도구(`one-desk_*`)를 모델에게서 지워
 * 실패했다. 같은 날 사용자 결정("one-desk MCP만 허용")으로 `one-desk_*`를 연 뒤 read_only도 `one-desk_list_repos`를 부른다.
 *
 * 2.x (`docs/sdlc/opencode-v2/` spec FR-24): 프로젝트 설정이 우리 규칙을 다시 여는 구멍 넷(0-1)이 막혀 있는지를 진짜
 * 모델로 본다. 확인할 수 없는 바이너리(2.0.18)는 읽기 전용·편집 허용이 실행 전에 막히는지와 전체 허용이 도는지를 본다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, type TestContext } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { Permission } from '@shared/models'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createRunRepository } from '../db/repositories/run'
import { createProposalRepository } from '../db/repositories/proposal'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { opencodeAdapter } from '../runner/adapters/opencode'
import { UNVERIFIABLE_REASON } from '../runner/adapters/opencode.verify'
import type { OpencodeDialect, PreflightResult } from '../runner/types'
import { terminate } from '../runner/terminate'
import { HOST_ENV } from '../wsl/env'
import { createMcpHost, MCP_SERVER_NAME, type McpHost } from './host'

const ENABLED = process.env['ONE_DESK_REAL_CLI'] === '1'
const MODEL = process.env['ONE_DESK_REAL_OPENCODE_MODEL'] ?? null
const V1_PERMISSION = (process.env['ONE_DESK_REAL_OPENCODE_PERMISSION'] ?? 'read_only') as Permission

/** 어느 갈래의 바이너리인가 — 모듈을 읽을 때 한 번 정한다(describe.skipIf가 동기라서다) */
type Flavor = 'v1' | 'v2' | 'v2-unverifiable'

/** 이만큼 지나도 끝나지 않는 run은 매달린 것으로 보고 끝낸다 — 테스트 제한(180초)보다 짧아야 정리할 틈이 있다 */
const HANG_MS = 150_000

let executable = ''
let dialect: OpencodeDialect = 'v1'
let flavor: Flavor = 'v1'

let host: McpHost
let dir: string
let workspaceId: string

beforeAll(async () => {
  if (!ENABLED) return
  const pre = await opencodeAdapter.preflight(process.env['ONE_DESK_REAL_OPENCODE_PATH'] ?? null)
  if (!pre.ok || !pre.executable || !pre.dialect) throw new Error(`opencode를 쓸 수 없습니다: ${pre.reason}`)
  executable = pre.executable
  dialect = pre.dialect
  const note = dialect === 'v2' ? await opencodeAdapter.statusNote(pre) : null
  flavor = dialect === 'v1' ? 'v1' : note ? 'v2-unverifiable' : 'v2'
})

beforeEach(() => {
  const db = makeTestDb()
  workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  createRepoRepository(db).create({ workspaceId, name: 'probe-repo-zebra', path: '/tmp/probe' })
  dir = mkdtempSync(resolve(tmpdir(), 'one-desk-realoc-'))
  host = createMcpHost({
    deps: {
      repos: createRepoRepository(db),
      issues: createIssueRepository(db),
      memos: createMemoRepository(db),
      runs: createRunRepository(db),
      proposals: createProposalRepository(db, () => {}), workspaces: createWorkspaceRepository(db)
    },
    configDir: resolve(dir, 'mcp'),
    execPath: process.execPath,
    execEnv: {},
    bridgePath: fileURLToPath(new URL('./bridge.mjs', import.meta.url))
  })
})

afterEach(() => {
  host.close()
  rmSync(dir, { recursive: true, force: true })
})

interface Turn {
  /** 실행 직전 확인의 결과. 거부되면 run은 띄우지 않는다 */
  verified: PreflightResult
  out: string
  /** 끝까지 돈 도구 이름 — opencode의 tool_use 줄은 이미 끝난 도구를 보고한다 */
  completed: string[]
}

/** 무료 모델의 한도에 닿았나 — 그 run은 아무것도 증명하지 못한다 */
function limited(out: string): boolean {
  return /provider\.(free-limit|quota)|Free usage limit|FreeUsageLimit/i.test(out)
}

/** stdout의 첫 오류 줄(`{"type":"error"}`) — 두 방언이 같은 `type`으로 낸다. 없으면 null */
function errorLineOf(out: string): string | null {
  for (const line of out.split('\n')) {
    try {
      const ev = JSON.parse(line) as { type?: string; error?: unknown }
      if (ev.type === 'error') return JSON.stringify(ev.error).slice(0, 300)
    } catch { /* JSON이 아닌 줄 */ }
  }
  return null
}

/**
 * 실행 서비스가 하는 그대로 한 턴을 돌린다 — 실행 직전 확인 → MCP 준비 → `buildCommand`. `project`는 그 작업 디렉토리의
 * `opencode.json`이다(우리 권한을 다시 열려는 남의 설정을 흉내 낸다).
 */
async function runTurn(ctx: TestContext, permission: Permission, prompt: string, project?: unknown): Promise<Turn> {
  if (project) writeFileSync(join(dir, 'opencode.json'), JSON.stringify(project))
  const verified = await opencodeAdapter.verifyRunnable({
    executable, cwd: dir, permission, dialect, model: MODEL, effort: null, resumeSessionId: null
  })
  if (!verified.ok) return { verified, out: '', completed: [] }

  await host.start()
  const p = await host.prepare({ runId: 'probe', rootRunId: 'probe', workspaceId, permission, agentKind: 'opencode', dialect, env: HOST_ENV })
  const spec = opencodeAdapter.buildCommand({
    runId: 'probe', cwd: dir, model: MODEL, effort: null, permission,
    prompt: '', resumeSessionId: null, executable,
    mcp: { serverName: MCP_SERVER_NAME, configFile: p.configFile, token: p.token, url: p.url },
    dialect
  })
  let hung = false
  const out = await new Promise<string>((done) => {
    const child = spawn(spec.cmd, spec.args, { cwd: dir, env: spec.env })
    let acc = ''
    child.stdout.on('data', (c: Buffer) => { acc += c.toString('utf8') })
    child.stderr.on('data', (c: Buffer) => { acc += c.toString('utf8') })
    child.stdin.write(prompt)
    child.stdin.end()
    // 매달린 run을 트리째 끝낸다 — 살려 두면 임시 폴더를 못 지운다(Windows의 EBUSY)
    const timer = setTimeout(() => {
      hung = true
      terminate(child)
    }, HANG_MS)
    child.on('close', () => {
      clearTimeout(timer)
      done(acc)
    })
  })
  if (process.env['ONE_DESK_REAL_OPENCODE_OUT']) writeFileSync(process.env['ONE_DESK_REAL_OPENCODE_OUT'], out)
  if (limited(out)) ctx.skip('무료 모델의 한도에 닿았다 — 이 run은 아무것도 증명하지 못한다')
  // 1.18.30은 한도에 걸리면 아무것도 찍지 않고 조용히 재시도한다(2026-11-19 실측) — 2.x는 오류 줄을 내고 끝난다
  if (hung && out.trim() === '') ctx.skip('출력 없이 매달렸다 — 1.x는 모델 한도에 걸리면 조용히 재시도한다. 증명한 것이 없다')
  // 모델을 부르지 못한 run은 "아무 일도 일어나지 않았다"를 공짜로 통과시킨다(2026-11-20 실측 — provider 인증 401로
  // 읽기 전용 넷이 초록이었다). 한도가 아닌 오류는 건너뛰지 않고 실패시킨다: 고칠 수 있는 설정 문제다
  const failure = errorLineOf(out)
  if (failure) throw new Error(`모델 호출이 실패했다 — 이 run은 아무것도 증명하지 못한다: ${failure}`)

  const completed = out.split('\n').flatMap((line) => {
    try {
      const ev = JSON.parse(line) as { type?: string; part?: { tool?: string; state?: { status?: string } } }
      return ev.type === 'tool_use' && ev.part?.state?.status === 'completed' && ev.part.tool ? [ev.part.tool] : []
    } catch { return [] }
  })
  return { verified, out, completed }
}

describe.skipIf(!ENABLED)('진짜 opencode CLI', () => {
  // ── 1.x ──────────────────────────────────────────────────────────────────
  describe('1.x', () => {
    it(`${V1_PERMISSION}에서 MCP 도구 list_repos를 부를 수 있다`, async (ctx) => {
      if (flavor !== 'v1') ctx.skip('1.x 바이너리가 아니다')
      const turn = await runTurn(ctx, V1_PERMISSION, `${MCP_SERVER_NAME}의 list_repos 도구를 불러서 받은 repo 이름만 답해`)
      expect(turn.verified).toEqual({ ok: true })
      expect(turn.out).toContain(`"tool":"${MCP_SERVER_NAME}_list_repos"`)
    }, 180_000)

    it(`${V1_PERMISSION}에서 셸은 여전히 막혀 있다 — MCP 키가 bash를 열지 않는다`, async (ctx) => {
      if (flavor !== 'v1' || V1_PERMISSION === 'full') ctx.skip('1.x의 읽기 전용·편집 허용만 본다')
      // 셸 없이는 알 수 없는 것을 묻는다 — 추측할 수 있는 글이면 셸이 열려 있어도 모델이 도구 없이 답해 이 테스트가 아무것도 못 본다(실측)
      const turn = await runTurn(ctx, V1_PERMISSION, 'bash 도구로 `hostname`을 실행하고 그 출력만 답해. 도구를 못 쓰면 못 쓴다고 답해')
      expect(turn.completed).not.toContain('bash')
    }, 180_000)
  })

  // ── 2.x: 확인할 수 있는 바이너리 (opencode-v2 spec FR-24의 1~6) ───────────
  describe('2.x — 권한 규칙이 프로젝트 설정에 뚫리지 않는다', () => {
    const TASK =
      'Do exactly these two things with tools, then reply with the single word DONE. ' +
      '1) Run the shell command: echo PROBE-SHELL 2) Create a file named made.txt containing the text hi'
    const OPEN = ['shell', 'edit'].map((action) => ({ action, resource: '*', effect: 'allow' }))

    /** 셸도 파일 쓰기도 일어나지 않았다 */
    function expectNothingHappened(turn: Turn): void {
      expect(turn.verified).toEqual({ ok: true })
      expect(existsSync(join(dir, 'made.txt'))).toBe(false)
      for (const tool of ['shell', 'write', 'edit', 'execute']) expect(turn.completed, tool).not.toContain(tool)
    }

    for (const [name, project] of [
      ['빈 프로젝트', undefined],
      ['프로젝트가 최상위 permissions로 연다', { permissions: [{ action: '*', resource: '*', effect: 'allow' }] }],
      // spec 0-1의 구멍 — agent별 규칙은 환경변수의 최상위 규칙 뒤에 붙는다. 같은 목록을 agents.build에도 넣어 막았다
      ['프로젝트가 agents.build.permissions로 연다', { agents: { build: { permissions: OPEN } } }],
      // spec 0-1의 구멍 — 느슨한 agent를 기본으로 지정한다. `--agent build`로 막았다
      ['프로젝트가 default_agent로 느슨한 agent를 지정한다', {
        default_agent: 'loose', agents: { loose: { mode: 'primary', description: 'x', permissions: OPEN } }
      }]
    ] as const) {
      it(`읽기 전용 — ${name}: 셸도 파일 생성도 일어나지 않는다`, async (ctx) => {
        if (flavor !== 'v2') ctx.skip('확인할 수 있는 2.x 바이너리가 아니다')
        expectNothingHappened(await runTurn(ctx, 'read_only', TASK, project))
      }, 180_000)
    }

    it('편집 허용 — 파일은 만들고 셸은 못 돌린다', async (ctx) => {
      if (flavor !== 'v2') ctx.skip('확인할 수 있는 2.x 바이너리가 아니다')
      const turn = await runTurn(ctx, 'edit', TASK)
      expect(turn.verified).toEqual({ ok: true })
      expect(existsSync(join(dir, 'made.txt'))).toBe(true)
      expect(turn.completed).not.toContain('shell')
      expect(turn.completed).not.toContain('execute')
    }, 180_000)

    it('읽기 전용에서도 one-desk MCP 도구를 직접 부른다 — execute를 거치지 않는다', async (ctx) => {
      if (flavor !== 'v2') ctx.skip('확인할 수 있는 2.x 바이너리가 아니다')
      const turn = await runTurn(ctx, 'read_only', `Call the list_repos tool of the ${MCP_SERVER_NAME} MCP server and reply with the repo names only.`)
      expect(turn.completed).toContain(`${MCP_SERVER_NAME}_list_repos`)
      expect(turn.completed).not.toContain('execute')
      expect(turn.out).toContain('probe-repo-zebra')
    }, 180_000)
  })

  // ── 2.x: 확인할 수 없는 바이너리 — 2.0.18 (FR-8a) ─────────────────────────
  describe('2.x — 실행 직전 확인을 못 하는 바이너리', () => {
    for (const permission of ['read_only', 'edit'] as const) {
      it(`${permission}는 실행 전에 막힌다 — 모델을 부르지 않는다`, async (ctx) => {
        if (flavor !== 'v2-unverifiable') ctx.skip('확인할 수 없는 2.x 바이너리가 아니다')
        const turn = await runTurn(ctx, permission, 'Reply with only OK.')
        expect(turn.verified).toEqual({ ok: false, reason: UNVERIFIABLE_REASON })
        expect(turn.out).toBe('')
      }, 60_000)
    }

    it('전체 허용은 돌고 셸과 파일 생성이 된다', async (ctx) => {
      if (flavor !== 'v2-unverifiable') ctx.skip('확인할 수 없는 2.x 바이너리가 아니다')
      const turn = await runTurn(ctx, 'full',
        'Do exactly these two things with tools, then reply with the single word DONE. ' +
        '1) Run the shell command: echo PROBE-SHELL 2) Create a file named made.txt containing the text hi')
      expect(turn.verified).toEqual({ ok: true })
      expect(turn.completed).toContain('shell')
      expect(existsSync(join(dir, 'made.txt'))).toBe(true)
    }, 180_000)

    it('전체 허용에서 one-desk MCP 도구가 execute가 아니라 직접 불린다 — codemode: false', async (ctx) => {
      if (flavor !== 'v2-unverifiable') ctx.skip('확인할 수 없는 2.x 바이너리가 아니다')
      const turn = await runTurn(ctx, 'full', `Call the list_repos tool of the ${MCP_SERVER_NAME} MCP server and reply with the repo names only.`)
      expect(turn.completed).toContain(`${MCP_SERVER_NAME}_list_repos`)
      expect(turn.completed).not.toContain('execute')
    }, 180_000)
  })
})
