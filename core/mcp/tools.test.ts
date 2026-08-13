import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createMcpHost, type McpHost } from './host'
import { rpc } from './testing'
import type { Permission } from '@shared/models'

interface Fixture {
  host: McpHost
  dir: string
  wsA: string
  wsB: string
  issueA: string
  issueB: string
  memoA: string
  memoB: string
  repoA: string
  db: ReturnType<typeof makeTestDb>
}

let f: Fixture

beforeEach(() => {
  const db = makeTestDb()
  const workspaces = createWorkspaceRepository(db)
  const repos = createRepoRepository(db)
  const issues = createIssueRepository(db)
  const memos = createMemoRepository(db)

  const wsA = workspaces.create({ name: 'A' }).id
  const wsB = workspaces.create({ name: 'B' }).id
  const repoA = repos.create({ workspaceId: wsA, name: 'api', path: '/tmp/a' }).id
  repos.create({ workspaceId: wsB, name: 'web', path: '/tmp/b' })

  const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-mcptools-'))
  f = {
    db, dir, wsA, wsB, repoA,
    issueA: issues.create({ workspaceId: wsA, title: 'A의 이슈', body: '본문 A' }).id,
    issueB: issues.create({ workspaceId: wsB, title: 'B의 이슈', body: '본문 B' }).id,
    memoA: memos.create({ workspaceId: wsA, title: 'A의 메모', body: '메모 A' }).id,
    memoB: memos.create({ workspaceId: wsB, title: 'B의 메모', body: '메모 B' }).id,
    host: createMcpHost({
      deps: { repos, issues, memos },
      configDir: resolve(dir, 'mcp')
    })
  }
})

afterEach(() => {
  f.host.close()
  rmSync(f.dir, { recursive: true, force: true })
})

/** 그 workspace·권한의 토큰으로 도구를 부르고 결과 텍스트를 돌려준다. */
async function call(
  workspaceId: string, permission: Permission, name: string, args: unknown = {}
): Promise<{ text: string; isError: boolean }> {
  const p = await f.host.prepare({ runId: `run-${name}-${Math.random()}`, workspaceId, permission })
  const res = await rpc(p.url, p.token, {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args }
  })
  const result = res.json.result
  return { text: result.content[0].text, isError: result.isError === true }
}

async function toolNames(workspaceId: string, permission: Permission): Promise<string[]> {
  const p = await f.host.prepare({ runId: `list-${permission}`, workspaceId, permission })
  const res = await rpc(p.url, p.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
  return res.json.result.tools.map((t: { name: string }) => t.name)
}

describe('읽기 도구', () => {
  it('list_repos는 그 workspace의 repo만 준다', async () => {
    const { text } = await call(f.wsA, 'read_only', 'list_repos')
    const rows = JSON.parse(text)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('api')
  })

  it('list_issues는 그 workspace의 이슈만 준다', async () => {
    const { text } = await call(f.wsA, 'read_only', 'list_issues')
    const rows = JSON.parse(text)
    expect(rows.map((r: { title: string }) => r.title)).toEqual(['A의 이슈'])
  })

  it('list_issues는 status로 거른다', async () => {
    createIssueRepository(f.db).update({ id: f.issueA, status: 'done' })
    expect(JSON.parse((await call(f.wsA, 'read_only', 'list_issues', { status: 'open' })).text))
      .toHaveLength(0)
    expect(JSON.parse((await call(f.wsA, 'read_only', 'list_issues', { status: 'done' })).text))
      .toHaveLength(1)
  })

  it('get_issue는 본문을 준다', async () => {
    const { text } = await call(f.wsA, 'read_only', 'get_issue', { id: f.issueA })
    expect(JSON.parse(text).body).toBe('본문 A')
  })

  it('get_issue는 다른 workspace의 이슈를 존재하지 않는 것처럼 다룬다', async () => {
    // 이것이 설계 §8의 보안 경계다. 저장소의 get은 id만 보므로 여기서 막지
    // 않으면 A의 토큰으로 B의 데이터를 읽을 수 있다.
    const { text, isError } = await call(f.wsA, 'read_only', 'get_issue', { id: f.issueB })
    expect(isError).toBe(true)
    expect(text).toContain('찾을 수 없습니다')
    // 존재 여부가 새어나가면 안 된다 — 없는 id와 같은 메시지여야 한다.
    const missing = await call(f.wsA, 'read_only', 'get_issue', { id: '없는-id' })
    expect(text.replace(f.issueB, 'X')).toBe(missing.text.replace('없는-id', 'X'))
  })

  it('list_memos는 그 workspace의 메모만 준다', async () => {
    const { text } = await call(f.wsA, 'read_only', 'list_memos')
    expect(JSON.parse(text).map((r: { title: string }) => r.title)).toEqual(['A의 메모'])
  })

  it('get_memo는 다른 workspace의 메모를 존재하지 않는 것처럼 다룬다', async () => {
    const { text, isError } = await call(f.wsA, 'read_only', 'get_memo', { id: f.memoB })
    expect(isError).toBe(true)
    expect(text).toContain('찾을 수 없습니다')
  })

  it('읽기 전용 토큰에 읽기 도구 다섯 개가 있다', async () => {
    expect(new Set(await toolNames(f.wsA, 'read_only'))).toEqual(new Set([
      'list_repos', 'list_issues', 'get_issue', 'list_memos', 'get_memo'
    ]))
  })
})
