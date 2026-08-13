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

  it('list_issues는 요약만 준다 — 본문은 빠진다', async () => {
    // 설계 §5: list_*는 요약, get_*는 본문. 본문이 섞여 들어오면 이슈 200개짜리
    // workspace에서 list_issues 한 번에 전 이슈 본문이 컨텍스트로 쏟아진다.
    const { text } = await call(f.wsA, 'read_only', 'list_issues')
    const rows = JSON.parse(text)
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('body')
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'repoIds', 'status', 'title', 'updatedAt'])
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

  it('list_memos는 요약만 준다 — 본문은 빠진다', async () => {
    // list_issues와 대칭 — 이슈 쪽만 지키고 메모 쪽이 새면 issue.ts↔memo.ts
    // 어긋남의 재발이다.
    const { text } = await call(f.wsA, 'read_only', 'list_memos')
    const rows = JSON.parse(text)
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('body')
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'repoIds', 'title', 'updatedAt'])
  })

  it('get_memo는 본문을 준다', async () => {
    const { text } = await call(f.wsA, 'read_only', 'get_memo', { id: f.memoA })
    expect(JSON.parse(text).body).toBe('메모 A')
  })

  it('get_memo는 다른 workspace의 메모를 존재하지 않는 것처럼 다룬다', async () => {
    // get_issue와 대칭 — 이것이 설계 §8의 보안 경계다. 저장소의 get은 id만 보므로
    // 여기서 막지 않으면 A의 토큰으로 B의 데이터를 읽을 수 있다.
    const { text, isError } = await call(f.wsA, 'read_only', 'get_memo', { id: f.memoB })
    expect(isError).toBe(true)
    expect(text).toContain('찾을 수 없습니다')
    // 존재 여부가 새어나가면 안 된다 — 없는 id와 같은 메시지여야 한다.
    const missing = await call(f.wsA, 'read_only', 'get_memo', { id: '없는-id' })
    expect(text.replace(f.memoB, 'X')).toBe(missing.text.replace('없는-id', 'X'))
  })

  it('읽기 전용 토큰에 읽기 도구 다섯 개가 있다', async () => {
    expect(new Set(await toolNames(f.wsA, 'read_only'))).toEqual(new Set([
      'list_repos', 'list_issues', 'get_issue', 'list_memos', 'get_memo'
    ]))
  })
})

describe('쓰기 도구', () => {
  it('create_issue가 토큰의 workspace에 이슈를 만든다', async () => {
    const { text } = await call(f.wsA, 'edit', 'create_issue', { title: '새 이슈', body: '내용' })
    const created = JSON.parse(text)
    expect(created.workspaceId).toBe(f.wsA)
    expect(createIssueRepository(f.db).get(created.id).title).toBe('새 이슈')
  })

  it('create_issue는 다른 workspace의 repo를 태그할 수 없다', async () => {
    const otherRepo = createRepoRepository(f.db).list(f.wsB)[0]!.id
    const { isError, text } = await call(f.wsA, 'edit', 'create_issue', {
      title: 'x', body: '', repoIds: [otherRepo]
    })
    expect(isError).toBe(true)
    expect(text).toContain('속하지 않는 repo')
  })

  it('update_issue가 상태를 바꾸고 closedAt을 함께 채운다', async () => {
    await call(f.wsA, 'edit', 'update_issue', { id: f.issueA, status: 'done' })
    const after = createIssueRepository(f.db).get(f.issueA)
    expect(after.status).toBe('done')
    expect(after.closedAt).toBeTypeOf('number')
  })

  it('update_issue는 다른 workspace의 이슈를 고칠 수 없다', async () => {
    const { isError } = await call(f.wsA, 'edit', 'update_issue', { id: f.issueB, status: 'done' })
    expect(isError).toBe(true)
    // 실제로 안 바뀌었는지 본다 — 오류만 보고 통과하면 반쯤 쓴 상태를 놓친다.
    expect(createIssueRepository(f.db).get(f.issueB).status).toBe('open')
  })

  it('create_memo와 update_memo가 이슈 쪽과 대칭으로 동작한다', async () => {
    const created = JSON.parse((await call(f.wsA, 'edit', 'create_memo', {
      title: '새 메모', body: '내용'
    })).text)
    expect(created.workspaceId).toBe(f.wsA)
    // create_issue 쪽은 저장 직후 title을 확인한다 — 여기서도 update로 덮기
    // 전에 확인해야 create_memo가 title을 잘못 저장해도 잡을 수 있다.
    expect(createMemoRepository(f.db).get(created.id).title).toBe('새 메모')

    await call(f.wsA, 'edit', 'update_memo', { id: created.id, title: '고친 제목' })
    expect(createMemoRepository(f.db).get(created.id).title).toBe('고친 제목')
  })

  it('create_memo는 다른 workspace의 repo를 태그할 수 없다', async () => {
    // create_issue는 다른 workspace의 repo를 태그할 수 없다와 대칭 — 이슈 쪽만 지키고
    // 메모 쪽이 새면 issue.ts↔memo.ts 어긋남의 재발이다.
    const otherRepo = createRepoRepository(f.db).list(f.wsB)[0]!.id
    const { isError, text } = await call(f.wsA, 'edit', 'create_memo', {
      title: 'x', body: '', repoIds: [otherRepo]
    })
    expect(isError).toBe(true)
    expect(text).toContain('속하지 않는 repo')
  })

  it('update_memo는 다른 workspace의 메모를 고칠 수 없다', async () => {
    const { isError } = await call(f.wsA, 'edit', 'update_memo', { id: f.memoB, title: 'x' })
    expect(isError).toBe(true)
    expect(createMemoRepository(f.db).get(f.memoB).title).toBe('B의 메모')
  })
})

describe('권한이 도구 등록을 통제한다', () => {
  it('읽기 전용 토큰에는 쓰기 도구가 없다', async () => {
    const names = await toolNames(f.wsA, 'read_only')
    expect(names).not.toContain('create_issue')
    expect(names).not.toContain('update_issue')
    expect(names).not.toContain('create_memo')
    expect(names).not.toContain('update_memo')
  })

  it('편집 허용과 전체 허용에는 아홉 개가 모두 있다', async () => {
    for (const p of ['edit', 'full'] as const) {
      expect(await toolNames(f.wsA, p)).toHaveLength(9)
    }
  })

  it('읽기 전용 토큰으로 이름을 알고 직접 호출해도 거부된다', async () => {
    // 목록에서 빼는 것만으로는 부족하다 — 도구 이름을 추측해 호출할 수 있다.
    // 등록 자체를 안 하므로 SDK가 "Tool not found"로 떨군다 (실측 노트 Q28).
    const { text, isError } = await call(f.wsA, 'read_only', 'update_issue', {
      id: f.issueA, status: 'done'
    })
    expect(isError).toBe(true)
    expect(text).toContain('not found')
    expect(createIssueRepository(f.db).get(f.issueA).status).toBe('open')
  })
})
