import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createRunRepository } from '../db/repositories/run'
import { createProposalRepository } from '../db/repositories/proposal'
import { HOST_ENV } from '../wsl/env'
import { createMcpHost, type McpHost } from './host'
import { rpc } from './testing'
import type { Permission } from '@shared/models'

/** 홈 대화의 MCP — 홈을 뺀 모든 workspace를 읽기만 한다 (docs/sdlc/home-conversation/ FR-8~10) */

const ALL_TOOLS = [
  'get_conversation', 'get_issue', 'get_memo', 'list_conversations', 'list_issues', 'list_memos', 'list_repos', 'list_workspaces'
]

interface Fixture {
  host: McpHost
  dir: string
  homeId: string
  wsA: string
  wsB: string
  repoA: string
  issueA: string
  issueB: string
  memoB: string
  runs: ReturnType<typeof createRunRepository>
}

let f: Fixture

beforeEach(() => {
  const db = makeTestDb()
  const workspaces = createWorkspaceRepository(db)
  const repos = createRepoRepository(db)
  const issues = createIssueRepository(db)
  const memos = createMemoRepository(db)
  const runs = createRunRepository(db)
  const homeId = workspaces.ensureHome().id
  const wsA = workspaces.create({ name: '회사' }).id
  const wsB = workspaces.create({ name: '개인' }).id
  const repoA = repos.create({ workspaceId: wsA, name: 'api', path: '/tmp/a' }).id
  repos.create({ workspaceId: wsA, name: 'web', path: '/tmp/a2' })
  repos.create({ workspaceId: wsB, name: 'blog', path: '/tmp/b' })
  const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-alltools-'))
  f = {
    dir, homeId, wsA, wsB, repoA, runs,
    issueA: issues.create({ workspaceId: wsA, title: '회사 이슈', body: '본문 A', repoIds: [repoA] }).id,
    issueB: issues.create({ workspaceId: wsB, title: '개인 이슈', body: '본문 B' }).id,
    memoB: memos.create({ workspaceId: wsB, title: '개인 메모', body: '메모 B' }).id,
    host: createMcpHost({
      deps: { workspaces, repos, issues, memos, runs, proposals: createProposalRepository(db, () => {}) },
      configDir: resolve(dir, 'mcp'),
      execPath: process.execPath,
      execEnv: {},
      bridgePath: fileURLToPath(new URL('./bridge.mjs', import.meta.url))
    })
  }
  memos.create({ workspaceId: wsA, title: '회사 메모' })
})

afterEach(() => {
  f.host.close()
  rmSync(f.dir, { recursive: true, force: true })
})

async function call(
  workspaceId: string, name: string, args: unknown = {}, permission: Permission = 'read_only'
): Promise<{ text: string; isError: boolean }> {
  const runId = `run-${name}-${Math.random()}`
  const p = await f.host.prepare({ runId, rootRunId: runId, workspaceId, permission, agentKind: 'claude-code', env: HOST_ENV })
  const res = await rpc(p.url, p.token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  const result = res.json.result
  return { text: result.content[0].text, isError: result.isError === true }
}

const rows = async (name: string, args: unknown = {}) => {
  const { text, isError } = await call(f.homeId, name, args)
  if (isError) throw new Error(text)
  return JSON.parse(text)
}

async function toolNames(workspaceId: string, permission: Permission): Promise<string[]> {
  const p = await f.host.prepare({ runId: `list-${permission}`, rootRunId: `list-${permission}`, workspaceId, permission, agentKind: 'claude-code', env: HOST_ENV })
  const res = await rpc(p.url, p.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
  return res.json.result.tools.map((t: { name: string }) => t.name).sort()
}

function turn(workspaceId: string, prompt: string, parentRunId?: string) {
  return f.runs.create({
    workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp',
    permission: 'read_only', userPrompt: prompt, assembledPrompt: '<task/>', logPath: '/tmp/x',
    context: [], ...(parentRunId ? { parentRunId } : {})
  })
}

function finish(id: string, resultText: string) {
  f.runs.markStarted(id)
  f.runs.markFinished(id, {
    status: 'succeeded', resultText, externalSessionId: null, needsAnswer: false, exitCode: 0, errorMessage: null, usage: null
  })
}

describe('범위 (FR-8·FR-9)', () => {
  it.each(['read_only', 'edit', 'full'] as const)('홈 workspace의 토큰은 %s여도 읽기 도구 여덟뿐이다 — 쓰기도 propose_issue도 없다', async (permission) => {
    expect(await toolNames(f.homeId, permission)).toEqual(ALL_TOOLS)
  })

  it('보통 workspace의 토큰은 workspace 범위 그대로다 — list_workspaces가 없다', async () => {
    const names = await toolNames(f.wsA, 'read_only')
    expect(names).not.toContain('list_workspaces')
    expect(names).toContain('propose_issue')
  })

  it.each(['create_issue', 'update_issue', 'create_memo', 'update_memo', 'propose_issue'])('이름을 알고 %s를 불러도 없는 도구다', async (name) => {
    const { text, isError } = await call(f.homeId, name, { title: 'x', id: f.issueA }, 'full')
    expect(isError).toBe(true)
    expect(text).toContain('not found')
  })
})

describe('읽기 (FR-9·FR-10)', () => {
  it('list_workspaces는 홈을 뺀 workspace와 repo 수를 준다', async () => {
    const out = await rows('list_workspaces')
    expect(out).toEqual([
      { id: f.wsB, name: '개인', description: null, repoCount: 1 },
      { id: f.wsA, name: '회사', description: null, repoCount: 2 }
    ])
  })

  it('list_issues는 모든 workspace의 이슈에 workspaceId·workspaceName을 얹어 준다 — 본문은 없다', async () => {
    const out = await rows('list_issues')
    expect(out.map((r: { title: string; workspaceName: string }) => `${r.workspaceName}:${r.title}`).sort())
      .toEqual(['개인:개인 이슈', '회사:회사 이슈'])
    expect(out[0]).not.toHaveProperty('body')
    expect(out.find((r: { id: string }) => r.id === f.issueA).workspaceId).toBe(f.wsA)
  })

  it('workspaceId·repoId로 좁힌다 — repo는 그 repo의 workspace 하나로 좁힌다', async () => {
    expect((await rows('list_issues', { workspaceId: f.wsB })).map((r: { title: string }) => r.title)).toEqual(['개인 이슈'])
    expect((await rows('list_issues', { repoId: f.repoA })).map((r: { title: string }) => r.title)).toEqual(['회사 이슈'])
    expect((await rows('list_memos', { workspaceId: f.wsB })).map((r: { title: string }) => r.title)).toEqual(['개인 메모'])
  })

  it('홈 workspace id는 없는 workspace와 같은 말이다', async () => {
    const home = await call(f.homeId, 'list_issues', { workspaceId: f.homeId })
    const missing = await call(f.homeId, 'list_issues', { workspaceId: '없는-id' })
    expect(home.isError).toBe(true)
    expect(home.text.replace(f.homeId, 'X')).toBe(missing.text.replace('없는-id', 'X'))
  })

  it('다른 workspace의 repo를 workspaceId와 같이 주면 없는 repo다', async () => {
    const { isError, text } = await call(f.homeId, 'list_issues', { workspaceId: f.wsB, repoId: f.repoA })
    expect(isError).toBe(true)
    expect(text).toContain('찾을 수 없습니다')
  })

  it('get_issue·get_memo는 어느 workspace의 것이든 본문과 workspaceName을 준다', async () => {
    expect(await rows('get_issue', { id: f.issueB })).toMatchObject({ body: '본문 B', workspaceId: f.wsB, workspaceName: '개인' })
    expect(await rows('get_memo', { id: f.memoB })).toMatchObject({ body: '메모 B', workspaceName: '개인' })
  })

  it('list_conversations는 두 workspace의 대화를 최근 활동순으로 주고 홈 대화는 뺀다', async () => {
    const a = turn(f.wsA, '회사 대화')
    finish(a.id, '끝')
    const b = turn(f.wsB, '개인 대화')
    finish(b.id, '끝')
    finish(turn(f.homeId, '내가 뭐 하고 있었지').id, '정리')
    const out = await rows('list_conversations')
    expect(out.map((c: { id: string; workspaceName: string }) => [c.id, c.workspaceName])).toEqual([[b.id, '개인'], [a.id, '회사']])
  })

  it('list_conversations의 closed로 끝낸 대화를 거른다', async () => {
    const open = turn(f.wsA, '열린 대화')
    finish(open.id, '끝')
    const closed = turn(f.wsB, '끝낸 대화')
    finish(closed.id, '끝')
    f.runs.close(closed.id)
    expect((await rows('list_conversations', { closed: false })).map((c: { id: string }) => c.id)).toEqual([open.id])
    expect((await rows('list_conversations', { closed: true })).map((c: { id: string }) => c.id)).toEqual([closed.id])
    expect(await rows('list_conversations')).toHaveLength(2)
  })

  it('get_conversation은 어느 workspace의 대화든 펴고, 홈 대화는 없는 id와 같은 말이다', async () => {
    const a = turn(f.wsA, '회사 대화')
    finish(a.id, '끝')
    expect(await rows('get_conversation', { id: a.id })).toMatchObject({ workspaceId: f.wsA, workspaceName: '회사' })
    const home = turn(f.homeId, '내가 뭐 하고 있었지')
    const hidden = await call(f.homeId, 'get_conversation', { id: home.id })
    const missing = await call(f.homeId, 'get_conversation', { id: '없는-id' })
    expect(hidden.isError).toBe(true)
    expect(hidden.text.replace(home.id, 'X')).toBe(missing.text.replace('없는-id', 'X'))
  })

  it('get_issue는 홈의 것이 아니어도 없는 id면 같은 말이다', async () => {
    const { isError, text } = await call(f.homeId, 'get_issue', { id: '없는-id' })
    expect(isError).toBe(true)
    expect(text).toContain('찾을 수 없습니다')
  })
})
