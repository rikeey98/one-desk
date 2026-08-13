import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { claudeCodeAdapter } from '../runner/adapters/claudeCode'
import { createMcpHost, MCP_SERVER_NAME, type McpHost } from './host'
import { rpc } from './testing'

let host: McpHost
let dir: string
let workspaceId: string

beforeEach(() => {
  const db = makeTestDb()
  workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  dir = mkdtempSync(resolve(tmpdir(), 'one-desk-mcphost-'))
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

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' }

describe('McpHost', () => {
  it('유효한 토큰이면 tools/list에 응답한다', async () => {
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    const res = await rpc(p.url, p.token, LIST)
    expect(res.status).toBe(200)
    expect(res.json.result.tools).toBeInstanceOf(Array)
  })

  it('토큰이 없으면 401이다', async () => {
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    expect((await rpc(p.url, null, LIST)).status).toBe(401)
  })

  it('모르는 토큰이면 401이다', async () => {
    // 토큰은 Authorization 헤더 값으로 들어간다. fetch의 Headers는 ByteString만
    // 받으므로(WHATWG 명세) 비ASCII 문자를 쓰면 요청 자체가 만들어지지 못한다.
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    expect((await rpc(p.url, 'aaaa-unknown-token', LIST)).status).toBe(401)
  })

  it('release한 토큰은 더 이상 통하지 않는다', async () => {
    // 이 한 줄이 4단계 전체의 보안 경계다. 폐기를 빠뜨리면 끝난 run의 토큰으로
    // workspace를 계속 읽고 쓸 수 있다.
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    expect((await rpc(p.url, p.token, LIST)).status).toBe(200)
    host.release('r1')
    expect((await rpc(p.url, p.token, LIST)).status).toBe(401)
  })

  it('release가 설정 파일도 함께 지운다', async () => {
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    expect(existsSync(p.configFile)).toBe(true)
    host.release('r1')
    expect(existsSync(p.configFile)).toBe(false)
  })

  it('/mcp가 아닌 경로는 404다', async () => {
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    const root = p.url.replace('/mcp', '/')
    const res = await fetch(root, { method: 'POST', body: '{}' })
    expect(res.status).toBe(404)
  })

  it('127.0.0.1에만 바인딩한다', async () => {
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    expect(p.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('동시에 두 run을 준비해도 포트를 하나만 연다', async () => {
    // 기동 프로미스를 캐시하지 않으면 두 서버가 뜨고, 한쪽 토큰만 아는 포트가
    // 생겨 절반의 agent가 조용히 연결에 실패한다.
    const [a, b] = await Promise.all([
      host.prepare({ runId: 'r1', workspaceId, permission: 'edit' }),
      host.prepare({ runId: 'r2', workspaceId, permission: 'read_only' })
    ])
    expect(new URL(a.url).port).toBe(new URL(b.url).port)
    // 두 토큰 모두 그 포트에서 통한다
    expect((await rpc(a.url, a.token, LIST)).status).toBe(200)
    expect((await rpc(b.url, b.token, LIST)).status).toBe(200)
  })

  it('close 후에는 아무 토큰도 통하지 않는다', async () => {
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    host.close()
    await expect(rpc(p.url, p.token, LIST)).rejects.toThrow()
  })

  it('설정 파일의 mcpServers 키와 --allowedTools의 mcp__ 접두사가 같은 값에서 나온다', async () => {
    // 전 브랜치 리뷰 I-1. CLI가 도구에 붙이는 이름은 설정 파일의 mcpServers
    // 키에서 나오고(mcp__<그 키>__<도구명>), 승인 목록은 MCP_SERVER_NAME에서
    // 나온다. 둘이 서로 다른 리터럴이면 한쪽만 바뀌었을 때 모든 MCP 호출이
    // 조용히 거부된다 — execution.ts가 실제로 하는 일(host.prepare가 쓴 설정
    // 파일 경로와 MCP_SERVER_NAME을 그대로 어댑터에 넘김)을 재현해 확인한다.
    const p = await host.prepare({ runId: 'r-name', workspaceId, permission: 'edit' })
    const parsed = JSON.parse(readFileSync(p.configFile, 'utf8')) as { mcpServers: Record<string, unknown> }
    const configKey = Object.keys(parsed.mcpServers)[0]

    const { args } = claudeCodeAdapter.buildCommand({
      runId: 'r-name',
      cwd: '/tmp',
      model: null,
      permission: 'edit',
      prompt: 'x',
      resumeSessionId: null,
      executable: '/usr/local/bin/claude',
      mcp: { serverName: MCP_SERVER_NAME, configFile: p.configFile, token: p.token, url: p.url }
    })
    const i = args.indexOf('--allowedTools')
    expect(args[i + 1]!.split(',')).toContain(`mcp__${configKey}`)
  })
})
