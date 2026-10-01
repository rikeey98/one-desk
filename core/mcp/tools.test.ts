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
  issues: ReturnType<typeof createIssueRepository>
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

  const wsA = workspaces.create({ name: 'A' }).id
  const wsB = workspaces.create({ name: 'B' }).id
  const repoA = repos.create({ workspaceId: wsA, name: 'api', path: '/tmp/a' }).id
  repos.create({ workspaceId: wsB, name: 'web', path: '/tmp/b' })

  const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-mcptools-'))
  f = {
    db, dir, wsA, wsB, repoA, issues, runs,
    issueA: issues.create({ workspaceId: wsA, title: 'A의 이슈', body: '본문 A' }).id,
    issueB: issues.create({ workspaceId: wsB, title: 'B의 이슈', body: '본문 B' }).id,
    memoA: memos.create({ workspaceId: wsA, title: 'A의 메모', body: '메모 A' }).id,
    memoB: memos.create({ workspaceId: wsB, title: 'B의 메모', body: '메모 B' }).id,
    host: createMcpHost({
      deps: { repos, issues, memos, runs },
      configDir: resolve(dir, 'mcp'),
    execPath: process.execPath,
    bridgePath: fileURLToPath(new URL('./bridge.mjs', import.meta.url))
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
  const p = await f.host.prepare({ runId: `run-${name}-${Math.random()}`, workspaceId, permission, agentKind: 'claude-code' })
  const res = await rpc(p.url, p.token, {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args }
  })
  const result = res.json.result
  return { text: result.content[0].text, isError: result.isError === true }
}

async function toolNames(workspaceId: string, permission: Permission): Promise<string[]> {
  const p = await f.host.prepare({ runId: `list-${permission}`, workspaceId, permission, agentKind: 'claude-code' })
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
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['closedAt', 'createdAt', 'id', 'kind', 'priority', 'repoIds', 'source', 'startedAt', 'status', 'title',
        'triagedAt', 'updatedAt']
    )
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
    expect(Object.keys(rows[0]).sort()).toEqual(['createdAt', 'id', 'repoIds', 'title', 'updatedAt'])
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

  it('읽기 전용 토큰에 읽기 도구 일곱 개가 있다', async () => {
    expect(new Set(await toolNames(f.wsA, 'read_only'))).toEqual(new Set([
      'list_repos', 'list_issues', 'get_issue', 'list_memos', 'get_memo', 'list_conversations', 'get_conversation'
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

  it('편집 허용과 전체 허용에는 열한 개가 모두 있다', async () => {
    for (const p of ['edit', 'full'] as const) {
      expect(await toolNames(f.wsA, p)).toHaveLength(11)
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

describe('분류 축', () => {
  it('create_issue가 축을 받고 triagedAt이 파생된다', async () => {
    await call(f.wsA, 'edit', 'create_issue', {
      title: '회의에서 나온 것', source: 'meeting', kind: 'feature', priority: 'week'
    })
    // beforeEach가 이미 wsA에 이슈 하나('A의 이슈')를 만들어 둔다.
    // 인덱스로 집으면 그것을 집으므로 반드시 제목으로 찾는다.
    const created = f.issues.list({ workspaceId: f.wsA })
      .find((i) => i.title === '회의에서 나온 것')
    expect(created?.source).toBe('meeting')
    expect(created?.triagedAt).not.toBeNull()
  })

  it('축을 안 주면 정리 안 된 채로 들어간다', async () => {
    await call(f.wsA, 'edit', 'create_issue', { title: '축 없이' })
    const created = f.issues.list({ workspaceId: f.wsA }).find((i) => i.title === '축 없이')
    expect(created?.triagedAt).toBeNull()
  })

  it('update_issue로 나머지 축을 채우면 triagedAt이 찍힌다', async () => {
    const made = f.issues.create({ workspaceId: f.wsA, title: '나중에 분류', source: 'dev' })
    await call(f.wsA, 'edit', 'update_issue', {
      id: made.id, kind: 'refactor', priority: 'someday'
    })
    expect(f.issues.get(made.id).triagedAt).not.toBeNull()
  })

  it('list_issues 요약에도 축과 triagedAt이 보인다', async () => {
    // 설계 §6: 회의 메모를 이슈로 쪼개 넣을 때, agent가 목록만 보고 어느 것이
    // 아직 미분류인지 판단할 수 있어야 한다 — get_issue로 하나씩 확인시키면
    // 이슈가 많을수록 컨텍스트만 태운다.
    f.issues.create({
      workspaceId: f.wsA, title: '분류된 이슈', source: 'meeting', kind: 'feature', priority: 'week'
    })
    const { text } = await call(f.wsA, 'read_only', 'list_issues')
    const rows = JSON.parse(text) as Array<{
      title: string; source: string | null; kind: string | null; priority: string | null; triagedAt: number | null
    }>
    const row = rows.find((r) => r.title === '분류된 이슈')
    expect(row?.source).toBe('meeting')
    expect(row?.kind).toBe('feature')
    expect(row?.priority).toBe('week')
    expect(row?.triagedAt).not.toBeNull()
  })
})

/** 시각으로 정리하기 (docs/sdlc/timestamps/ FR-4~FR-7) */
describe('시각', () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/

  it('목록 요약의 시각은 시간대가 붙은 ISO다 — 같은 순간으로 되읽힌다', async () => {
    const issue = f.issues.update({ id: f.issueA, status: 'doing' })
    const [row] = JSON.parse((await call(f.wsA, 'read_only', 'list_issues')).text)
    expect(row.createdAt).toMatch(ISO)
    expect(Date.parse(row.createdAt)).toBe(issue.createdAt)
    expect(Date.parse(row.startedAt)).toBe(issue.startedAt)
    expect(Date.parse(row.updatedAt)).toBe(issue.updatedAt)
    expect(row.closedAt).toBeNull()
    const [memo] = JSON.parse((await call(f.wsA, 'read_only', 'list_memos')).text)
    expect(memo.createdAt).toMatch(ISO)
  })

  it('get·create·update의 응답 시각도 ISO다', async () => {
    const got = JSON.parse((await call(f.wsA, 'read_only', 'get_issue', { id: f.issueA })).text)
    expect(got.createdAt).toMatch(ISO)
    expect(got.seenAt).toBeNull()
    const made = JSON.parse((await call(f.wsA, 'edit', 'create_memo', { title: '새 메모' })).text)
    expect(made.createdAt).toMatch(ISO)
    const done = JSON.parse((await call(f.wsA, 'edit', 'update_issue', { id: f.issueA, status: 'done' })).text)
    expect(done.closedAt).toMatch(ISO)
  })

  it('since·until은 그 기간에 만들어지거나 시작·완료·수정된 것만 준다', async () => {
    // 행의 시각을 직접 옮겨 기간을 만든다 — 같은 밀리초에 만든 둘을 가르려면 이것이 확실하다.
    const day = (d: number) => new Date(2026, 8, d, 12).getTime()
    f.db.$client.prepare('update issue set created_at = ?, updated_at = ? where id = ?').run(day(1), day(1), f.issueA)
    const later = f.issues.create({ workspaceId: f.wsA, title: '나중 이슈' })
    f.db.$client.prepare('update issue set created_at = ?, updated_at = ? where id = ?').run(day(10), day(10), later.id)
    // 1일에 만들었지만 12일에 완료한 이슈 — 완료 시각으로 기간에 든다.
    f.db.$client.prepare('update issue set closed_at = ? where id = ?').run(day(12), f.issueA)

    const titles = async (args: Record<string, string>) =>
      JSON.parse((await call(f.wsA, 'read_only', 'list_issues', args)).text).map((r: { title: string }) => r.title).sort()
    expect(await titles({ since: '2026-09-09', until: '2026-09-11' })).toEqual(['나중 이슈'])
    expect(await titles({ since: '2026-09-12' })).toEqual(['A의 이슈'])
    expect(await titles({ until: '2026-09-02' })).toEqual(['A의 이슈'])
    // until은 그 시각 전까지다 — 10일 0시까지면 10일 정오의 것은 빠진다.
    expect(await titles({ since: '2026-09-09', until: '2026-09-10' })).toEqual([])
  })

  it('못 읽는 기간은 오류로 알린다', async () => {
    const { isError, text } = await call(f.wsA, 'read_only', 'list_memos', { since: '지난주' })
    expect(isError).toBe(true)
    expect(text).toContain('since')
  })

  describe('list_conversations', () => {
    function turn(workspaceId: string, prompt: string, parentRunId?: string) {
      return f.runs.create({
        workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp',
        permission: 'edit', userPrompt: prompt, assembledPrompt: '<task/>', logPath: '/tmp/x',
        context: [], ...(parentRunId ? { parentRunId } : {})
      })
    }
    function finish(id: string, resultText: string, needsAnswer = false) {
      f.runs.markStarted(id)
      f.runs.markFinished(id, {
        status: 'succeeded', resultText, externalSessionId: null, needsAnswer,
        exitCode: 0, errorMessage: null, usage: null
      })
    }

    it('대화 하나당 한 줄 — 제목·턴 수·대표 턴의 상태와 답 앞부분, 다른 workspace는 없다', async () => {
      const root = turn(f.wsA, '로그인 버그 고쳐\n자세한 설명')
      finish(root.id, '고쳤습니다')
      const second = turn(f.wsA, '테스트도 추가해', root.id)
      finish(second.id, `추가했습니다 ${'가'.repeat(400)}`, true)
      finish(turn(f.wsB, 'B의 대화').id, '끝')

      const rows = JSON.parse((await call(f.wsA, 'read_only', 'list_conversations')).text)
      expect(rows).toHaveLength(1)
      const [c] = rows
      expect(c).toMatchObject({
        id: root.id, title: '로그인 버그 고쳐', turns: 2, status: 'succeeded', needsAnswer: true, closed: false,
        firstPrompt: '로그인 버그 고쳐\n자세한 설명'
      })
      expect(c.lastAnswer.startsWith('추가했습니다')).toBe(true)
      expect(c.lastAnswer.length).toBeLessThanOrEqual(301)
      expect(c.startedAt).toMatch(ISO)
      expect(Date.parse(c.lastActivityAt)).toBeGreaterThanOrEqual(Date.parse(c.startedAt))
      // 지시·답 전체와 맥락은 싣지 않는다.
      expect(c).not.toHaveProperty('assembledPrompt')
    })

    it('get_conversation은 턴마다 보낸·시작·끝 시각과 기다린·걸린 초를 오래된 순으로 준다 (timestamps FR-9)', async () => {
      const at = (h: number, m: number, s = 0) => new Date(2026, 8, 30, h, m).getTime() + s * 1000
      const root = turn(f.wsA, '로그인 버그 고쳐')
      finish(root.id, '고쳤습니다')
      f.db.$client.prepare('update run set created_at = ?, started_at = ?, ended_at = ? where id = ?')
        .run(at(14, 3, 0), at(14, 3, 12), at(14, 4, 34.5), root.id)
      const second = turn(f.wsA, '테스트도 추가해', root.id)
      f.db.$client.prepare('update run set created_at = ? where id = ?').run(at(14, 10), second.id)

      const detail = JSON.parse((await call(f.wsA, 'read_only', 'get_conversation', { id: second.id })).text)
      expect(detail).toMatchObject({ id: root.id, title: '로그인 버그 고쳐', closed: false })
      expect(detail.turns.map((t: { prompt: string }) => t.prompt)).toEqual(['로그인 버그 고쳐', '테스트도 추가해'])
      const [first, next] = detail.turns
      expect(first).toMatchObject({
        id: root.id, status: 'succeeded', waitSeconds: 12, durationSeconds: 82.5, answer: '고쳤습니다', agent: 'claude-code'
      })
      expect(Date.parse(first.requestedAt)).toBe(at(14, 3, 0))
      expect(Date.parse(first.startedAt)).toBe(at(14, 3, 12))
      expect(Date.parse(first.endedAt)).toBe(at(14, 4, 34.5))
      expect(first.requestedAt).toMatch(ISO)
      // 아직 시작하지 않은 턴 — 모르는 것은 null이다
      expect(next).toMatchObject({ status: 'pending', startedAt: null, endedAt: null, waitSeconds: null, durationSeconds: null })
    })

    it('get_conversation은 다른 workspace의 대화를 없는 id와 같은 말로 떨군다', async () => {
      const b = turn(f.wsB, 'B의 대화')
      const other = await call(f.wsA, 'read_only', 'get_conversation', { id: b.id })
      expect(other.isError).toBe(true)
      const missing = await call(f.wsA, 'read_only', 'get_conversation', { id: '없는-id' })
      expect(other.text.replace(b.id, 'X')).toBe(missing.text.replace('없는-id', 'X'))
    })

    it('붙인 이름이 있으면 그것이 제목이고, 기간은 [시작, 마지막 활동]이 겹치면 든다', async () => {
      const day = (d: number) => new Date(2026, 8, d, 12).getTime()
      const old = turn(f.wsA, '옛 대화')
      f.runs.rename(old.id, '9월 초 작업')
      f.db.$client.prepare('update run set created_at = ?, started_at = ?, ended_at = ? where id = ?')
        .run(day(1), day(1), day(3), old.id)
      const now = turn(f.wsA, '지금 대화')
      f.db.$client.prepare('update run set created_at = ? where id = ?').run(day(20), now.id)

      const titles = async (args: Record<string, string>) =>
        JSON.parse((await call(f.wsA, 'read_only', 'list_conversations', args)).text).map((r: { title: string }) => r.title)
      expect(await titles({})).toEqual(['지금 대화', '9월 초 작업'])
      expect(await titles({ since: '2026-09-02', until: '2026-09-05' })).toEqual(['9월 초 작업'])
      expect(await titles({ since: '2026-09-15' })).toEqual(['지금 대화'])
    })
  })
})
