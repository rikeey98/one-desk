/**
 * 진짜 claude CLI와의 계약을 검증한다. **기본적으로 건너뛴다.**
 *
 * `ONE_DESK_REAL_CLI=1 pnpm test realCli`로 돌린다. 실행에 claude 설치와
 * 로그인이 필요하고, 실제 요청 한 번을 쓰며 30초쯤 걸린다.
 *
 * **이 파일이 있는 이유:** e2e는 가짜 CLI를 쓰고 그 가짜는 `--mcp-config`를
 * 읽지 않는다. 그래서 "우리가 쓴 설정 파일을 진짜 CLI가 읽고 서버에 붙어
 * 도구가 노출되는가"는 4단계 내내 한 번도 검증된 적이 없었다. 그 계약이
 * 깨지면 agent는 MCP 도구를 전혀 못 쓰는데 실패가 조용하다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { claudeCodeAdapter } from '../runner/adapters/claudeCode'
import { createMcpHost, MCP_SERVER_NAME, type McpHost } from './host'

const ENABLED = process.env['ONE_DESK_REAL_CLI'] === '1'

let host: McpHost
let dir: string
let workspaceId: string

beforeEach(() => {
  const db = makeTestDb()
  workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  dir = mkdtempSync(resolve(tmpdir(), 'one-desk-realcli-'))
  host = createMcpHost({
    deps: {
      repos: createRepoRepository(db),
      issues: createIssueRepository(db),
      memos: createMemoRepository(db)
    },
    configDir: resolve(dir, 'mcp')
  })
})

afterEach(() => {
  host.close()
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!ENABLED)('진짜 claude CLI', () => {
  it('우리 설정 파일로 MCP 서버에 붙고 도구 아홉 개를 노출한다', async () => {
    const p = await host.prepare({ runId: 'probe', workspaceId, permission: 'edit' })
    const { args } = claudeCodeAdapter.buildCommand({
      runId: 'probe',
      cwd: dir,
      model: null,
      permission: 'edit',
      prompt: '무시',
      resumeSessionId: null,
      executable: 'claude',
      mcp: { serverName: MCP_SERVER_NAME, configFile: p.configFile, token: p.token, url: p.url }
    })

    // **동기 spawn을 쓰면 안 된다.** execFileSync는 이벤트 루프를 막아
    // 같은 프로세스의 MCP 서버가 연결을 받지 못하고, 제품이 멀쩡한데도
    // status가 failed로 나온다 (이 함정에 실제로 한 번 빠졌다).
    const out = await new Promise<string>((done) => {
      const child = spawn('claude', args, { cwd: dir })
      let acc = ''
      child.stdout.on('data', (c: Buffer) => { acc += c.toString('utf8') })
      child.stdin.write('안녕이라고만 답해')
      child.stdin.end()
      child.on('close', () => done(acc))
    })

    const init = out
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((o) => o['type'] === 'system' && o['subtype'] === 'init')

    const servers = init?.['mcp_servers'] as { name: string; status: string }[]
    expect(servers).toContainEqual({ name: MCP_SERVER_NAME, status: 'connected' })

    const mcpTools = (init?.['tools'] as string[]).filter((t) => t.startsWith('mcp__'))
    expect(mcpTools).toHaveLength(9)
    expect(mcpTools).toContain(`mcp__${MCP_SERVER_NAME}__create_issue`)
  }, 130_000)
})
