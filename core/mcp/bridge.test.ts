import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createMcpHost, type McpHost } from './host'

const BRIDGE = fileURLToPath(new URL('./bridge.mjs', import.meta.url))

let host: McpHost
let dir: string
let workspaceId: string
let child: ChildProcess | null = null

beforeEach(() => {
  const db = makeTestDb()
  workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  dir = mkdtempSync(resolve(tmpdir(), 'one-desk-bridge-'))
  host = createMcpHost({
    deps: {
      repos: createRepoRepository(db),
      issues: createIssueRepository(db),
      memos: createMemoRepository(db)
    },
    configDir: resolve(dir, 'mcp'),
    execPath: process.execPath,
    bridgePath: BRIDGE
  })
})

afterEach(() => {
  child?.kill()
  child = null
  host.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 브리지를 띄우고 줄들을 넣은 뒤, 기대하는 개수만큼 응답이 나오면 돌려준다.
 *
 * **동기 spawn을 쓰면 안 된다** — 이벤트 루프를 막아 같은 프로세스의 MCP 서버가
 * 연결을 받지 못한다. 제품이 멀쩡한데 실패로 보이는 함정에 실제로 빠진 적이 있다.
 */
function runBridge(
  env: Record<string, string>, lines: string[], expected: number, waitMs = 3000
): Promise<string[]> {
  return new Promise((done, fail) => {
    const proc = spawn(process.execPath, [BRIDGE], { env: { ...process.env, ...env } })
    child = proc
    const out: string[] = []
    let buf = ''
    const timer = setTimeout(() => done(out), waitMs)
    proc.stdout.on('data', (c: Buffer) => {
      buf += c.toString('utf8')
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      out.push(...parts.filter(Boolean))
      if (out.length >= expected) { clearTimeout(timer); done(out) }
    })
    proc.on('error', fail)
    for (const line of lines) proc.stdin.write(`${line}\n`)
  })
}

describe('stdio 브리지', () => {
  it('tools/list를 서버까지 왕복시킨다', async () => {
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit' })
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: p.url, ONE_DESK_MCP_TOKEN: p.token },
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
      1
    )
    const res = JSON.parse(line!)
    expect(res.id).toBe(1)
    expect(res.result.tools.map((t: { name: string }) => t.name)).toContain('create_issue')
  })

  it('read_only 토큰에는 쓰기 도구가 안 보인다 — 권한은 서버가 정한다', async () => {
    // 브리지는 멍청한 파이프다. 권한 게이팅을 브리지로 옮기지 않았다는 것을 고정한다.
    const p = await host.prepare({ runId: 'r2', workspaceId, permission: 'read_only' })
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: p.url, ONE_DESK_MCP_TOKEN: p.token },
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
      1
    )
    const names = JSON.parse(line!).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('list_issues')
    expect(names).not.toContain('create_issue')
  })

  it('토큰이 틀리면 매달리지 않고 JSON-RPC 오류를 돌려준다', async () => {
    const p = await host.prepare({ runId: 'r3', workspaceId, permission: 'edit' })
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: p.url, ONE_DESK_MCP_TOKEN: 'wrong' },
      [JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })],
      1
    )
    const res = JSON.parse(line!)
    expect(res.id).toBe(7)
    expect(res.error.message).toContain('401')
  })

  it('서버가 죽어 있어도 매달리지 않는다', async () => {
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: 'http://127.0.0.1:1/mcp', ONE_DESK_MCP_TOKEN: 'x' },
      [JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })],
      1
    )
    expect(JSON.parse(line!).error.message).toContain('연결하지 못했습니다')
  })

  it('id 없는 알림에는 아무것도 쓰지 않는다', async () => {
    const p = await host.prepare({ runId: 'r4', workspaceId, permission: 'edit' })
    const out = await runBridge(
      { ONE_DESK_MCP_URL: p.url, ONE_DESK_MCP_TOKEN: p.token },
      [JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })],
      1,
      1200
    )
    expect(out).toEqual([])
  })
})
