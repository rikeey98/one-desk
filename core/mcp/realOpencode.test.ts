/**
 * 진짜 opencode가 우리 권한 설정(`opencodePermissionConfig`)으로 MCP 도구를 부를 수 있는지 본다.
 * **기본적으로 건너뛴다** — `ONE_DESK_REAL_CLI=1 pnpm test realOpencode`. opencode 설치와 쓸 수 있는 모델이 있어야 하고
 * 실제 요청을 쓴다 (`docs/sdlc/agent-proposals/` plan 0단계, spec §6 우려 1). 권한은 `ONE_DESK_REAL_OPENCODE_PERMISSION`
 * (기본 read_only), 모델은 `ONE_DESK_REAL_OPENCODE_MODEL`(예 `opencode/big-pickle` — 키 없이 된다), 원본 줄은
 * `ONE_DESK_REAL_OPENCODE_OUT`에 남는다.
 *
 * 2026-10-27 실측(1.18.30): full은 통과, read_only·edit는 실패 — `"*": "deny"`가 MCP 도구(`one-desk_*`)를 모델에게서 지운다.
 * 같은 날 사용자 결정("one-desk MCP만 허용")으로 `one-desk_*`를 `allow`로 연 뒤 read_only도 `one-desk_list_repos`를 부른다(키를 지우면
 * 다시 실패한다 — 실측). 셸은 그때도 막혀 있다(둘째 테스트).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createRunRepository } from '../db/repositories/run'
import { createProposalRepository } from '../db/repositories/proposal'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { opencodeAdapter } from '../runner/adapters/opencode'
import { HOST_ENV } from '../wsl/env'
import { createMcpHost, MCP_SERVER_NAME, type McpHost } from './host'

const ENABLED = process.env['ONE_DESK_REAL_CLI'] === '1'
const MODEL = process.env['ONE_DESK_REAL_OPENCODE_MODEL'] ?? null
const PERMISSION = (process.env['ONE_DESK_REAL_OPENCODE_PERMISSION'] ?? 'read_only') as 'read_only' | 'edit' | 'full'

let host: McpHost
let dir: string
let workspaceId: string

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
      proposals: createProposalRepository(db, () => {})
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

/** 우리 권한 설정으로 opencode를 한 번 돌린 원본 출력 */
async function runOpencode(prompt: string): Promise<string> {
  await host.start()
  const p = await host.prepare({ runId: 'probe', rootRunId: 'probe', workspaceId, permission: PERMISSION, agentKind: 'opencode', env: HOST_ENV })
  const spec = opencodeAdapter.buildCommand({
    runId: 'probe', cwd: dir, model: MODEL, effort: null, permission: PERMISSION,
    prompt: '', resumeSessionId: null, executable: 'opencode',
    mcp: { serverName: MCP_SERVER_NAME, configFile: p.configFile, token: p.token, url: p.url }
  })
  const out = await new Promise<string>((done) => {
    const child = spawn(spec.cmd, spec.args, { cwd: dir, env: spec.env })
    let acc = ''
    child.stdout.on('data', (c: Buffer) => { acc += c.toString('utf8') })
    child.stderr.on('data', (c: Buffer) => { acc += c.toString('utf8') })
    child.stdin.write(prompt)
    child.stdin.end()
    child.on('close', () => done(acc))
  })
  if (process.env['ONE_DESK_REAL_OPENCODE_OUT']) writeFileSync(process.env['ONE_DESK_REAL_OPENCODE_OUT'], out)
  return out
}

/** 끝까지 돈 도구 이름들 — opencode의 tool_use 줄은 이미 끝난 도구를 보고한다 */
function completedTools(out: string): string[] {
  return out.split('\n').flatMap((line) => {
    try {
      const ev = JSON.parse(line) as { type?: string; part?: { tool?: string; state?: { status?: string } } }
      return ev.type === 'tool_use' && ev.part?.state?.status === 'completed' && ev.part.tool ? [ev.part.tool] : []
    } catch { return [] }
  })
}

describe.skipIf(!ENABLED)('진짜 opencode CLI', () => {
  it(`${PERMISSION}에서 MCP 도구 list_repos를 부를 수 있다`, async () => {
    const out = await runOpencode(`${MCP_SERVER_NAME}의 list_repos 도구를 불러서 받은 repo 이름만 답해`)
    expect(out).toContain(`"tool":"${MCP_SERVER_NAME}_list_repos"`)
  }, 180_000)

  it.skipIf(PERMISSION === 'full')(`${PERMISSION}에서 셸은 여전히 막혀 있다 — MCP 키가 bash를 열지 않는다`, async () => {
    // 셸 없이는 알 수 없는 것을 묻는다 — 추측할 수 있는 글이면 셸이 열려 있어도 모델이 도구 없이 답해 이 테스트가 아무것도 못 본다(실측)
    const out = await runOpencode('bash 도구로 `hostname`을 실행하고 그 출력만 답해. 도구를 못 쓰면 못 쓴다고 답해')
    expect(completedTools(out)).not.toContain('bash')
  }, 180_000)
})
