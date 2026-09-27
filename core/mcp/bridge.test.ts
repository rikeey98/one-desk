import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
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
    const p = await host.prepare({ runId: 'r1', workspaceId, permission: 'edit', agentKind: 'claude-code' })
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
    const p = await host.prepare({ runId: 'r2', workspaceId, permission: 'read_only', agentKind: 'claude-code' })
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
    const p = await host.prepare({ runId: 'r3', workspaceId, permission: 'edit', agentKind: 'claude-code' })
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

  it('id 없는 알림에는 아무것도 쓰지 않는다 (진짜 서버)', async () => {
    const p = await host.prepare({ runId: 'r4', workspaceId, permission: 'edit', agentKind: 'claude-code' })
    const out = await runBridge(
      { ONE_DESK_MCP_URL: p.url, ONE_DESK_MCP_TOKEN: p.token },
      [JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })],
      1,
      1200
    )
    expect(out).toEqual([])
  })
})

/**
 * SSE 본문에서 응답을 고르는 규칙 (`docs/sdlc/conversation-fixes/` spec FR-20).
 *
 * 진짜 서버는 지금 응답 하나만 싣지만, 스트림은 응답 전에 알림(진행 상황·로그)이나
 * 서버발 요청을 먼저 흘릴 수 있다. 첫 `data:` 줄을 응답으로 돌려주면 진짜 응답이
 * 버려지고 claude는 그 요청의 답을 영영 못 받는다. 서버가 그렇게 보내게 만들 수 없으니
 * 본문을 직접 정하는 가짜 서버로 고정한다.
 */
describe('stdio 브리지 — SSE 응답 고르기', () => {
  let server: Server | null = null

  afterEach(async () => {
    child?.kill()
    child = null
    if (server) await new Promise<void>((r) => server!.close(() => r()))
    server = null
  })

  /** 받은 요청에 `body`를 SSE로 돌려주는 서버를 띄우고 URL을 준다 */
  async function sseServer(body: (req: { id: unknown }) => string): Promise<string> {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c: Buffer) => { raw += c.toString('utf8') })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(body(JSON.parse(raw) as { id: unknown }))
      })
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    const { port } = server.address() as AddressInfo
    return `http://127.0.0.1:${port}/mcp`
  }

  function event(message: unknown): string {
    return `event: message\ndata: ${JSON.stringify(message)}\n\n`
  }

  it('응답 앞에 온 알림을 건너뛰고 요청 id와 같은 응답을 돌려준다', async () => {
    const url = await sseServer(({ id }) =>
      event({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: '진행 중' } }) +
      event({ jsonrpc: '2.0', id, result: { ok: true } })
    )
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: url, ONE_DESK_MCP_TOKEN: 't' },
      [JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call' })],
      1
    )
    expect(JSON.parse(line!)).toEqual({ jsonrpc: '2.0', id: 5, result: { ok: true } })
  })

  it('id가 같아도 서버발 요청(method가 있는 것)은 응답이 아니다', async () => {
    // 서버발 요청의 id는 서버가 매기므로 클라이언트의 id와 숫자가 겹칠 수 있다.
    const url = await sseServer(({ id }) =>
      event({ jsonrpc: '2.0', id, method: 'sampling/createMessage', params: {} }) +
      event({ jsonrpc: '2.0', id, result: { answer: 42 } })
    )
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: url, ONE_DESK_MCP_TOKEN: 't' },
      [JSON.stringify({ jsonrpc: '2.0', id: 'req-1', method: 'tools/call' })],
      1
    )
    expect(JSON.parse(line!).result).toEqual({ answer: 42 })
  })

  it('맞는 응답이 없으면 매달리지 않고 그 id로 JSON-RPC 오류를 돌려준다', async () => {
    // 알림만 돌려주고 끝나면 claude는 답을 영영 기다린다 — 오류라도 받아야 넘어간다.
    const url = await sseServer(() =>
      event({ jsonrpc: '2.0', method: 'notifications/message', params: {} })
    )
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: url, ONE_DESK_MCP_TOKEN: 't' },
      [JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/call' })],
      1
    )
    const res = JSON.parse(line!)
    expect(res.id).toBe(11)
    expect(res.error.message).toContain('응답')
  })

  it('여러 줄에 걸친 data도 한 줄짜리 메시지로 돌려준다 — stdio는 줄 하나가 메시지 하나다', async () => {
    const url = await sseServer(({ id }) => {
      const json = JSON.stringify({ jsonrpc: '2.0', id, result: { multi: true } }, null, 2)
      return 'event: message\n' + json.split('\n').map((l) => `data: ${l}`).join('\n') + '\n\n'
    })
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: url, ONE_DESK_MCP_TOKEN: 't' },
      [JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call' })],
      1
    )
    expect(JSON.parse(line!)).toEqual({ jsonrpc: '2.0', id: 8, result: { multi: true } })
  })

  it('CRLF 줄바꿈의 SSE도 읽는다', async () => {
    const url = await sseServer(({ id }) =>
      event({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }).replace(/\n/g, '\r\n') +
      event({ jsonrpc: '2.0', id, result: { crlf: true } }).replace(/\n/g, '\r\n')
    )
    const [line] = await runBridge(
      { ONE_DESK_MCP_URL: url, ONE_DESK_MCP_TOKEN: 't' },
      [JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call' })],
      1
    )
    expect(JSON.parse(line!).result).toEqual({ crlf: true })
  })
})
