import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { NotFoundError } from '../errors'
import { MCP_SERVER_NAME } from './configFile'
import type { RepoRepository } from '../db/repositories/repo'
import type { IssueRepository } from '../db/repositories/issue'
import type { MemoRepository } from '../db/repositories/memo'
import type { RunContext } from './host'
import type { Issue, IssueStatus, Memo } from '@shared/models'

export interface McpHostDeps {
  repos: RepoRepository
  issues: IssueRepository
  memos: MemoRepository
}

/** 도구 결과의 공통 형태. 던진 것은 isError로 바꿔 agent가 읽고 대응하게 한다. */
function reply(fn: () => unknown) {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify(fn(), null, 2) }] }
  } catch (err) {
    // run을 죽이지 않는다 — 잘못된 id 하나로 몇 분짜리 실행이 날아가면 안 된다.
    return {
      content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
      isError: true
    }
  }
}

/**
 * id로 이슈를 집되 **토큰의 workspace 소속인지 확인한다.**
 *
 * 저장소의 get/update는 id만 본다. 렌더러만 부르던 때는 무해했지만 MCP는 agent가
 * 임의의 id를 넘기는 첫 경로다 (설계 §5). id를 받는 도구는 반드시 이 함수를 지난다.
 * 소속이 다르면 **존재를 알리지 않고** 없는 id와 같은 메시지로 떨군다.
 */
function loadIssue(deps: McpHostDeps, ctx: RunContext, id: string): Issue {
  const row = deps.issues.get(id)
  if (row.workspaceId !== ctx.workspaceId) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${id}`)
  return row
}

/** loadIssue와 대칭. 한쪽을 고치면 반드시 다른 쪽도 고친다. */
function loadMemo(deps: McpHostDeps, ctx: RunContext, id: string): Memo {
  const row = deps.memos.get(id)
  if (row.workspaceId !== ctx.workspaceId) throw new NotFoundError(`메모를 찾을 수 없습니다: ${id}`)
  return row
}

/** list_issues가 돌려주는 요약 형태. body를 뺀다 — get_issue와 대칭. */
interface IssueSummary {
  id: string
  title: string
  status: IssueStatus
  updatedAt: number
  repoIds: string[]
}

function issueSummary(row: Issue): IssueSummary {
  return { id: row.id, title: row.title, status: row.status, updatedAt: row.updatedAt, repoIds: row.repoIds }
}

/** issueSummary와 대칭. memo에는 status가 없다. */
interface MemoSummary {
  id: string
  title: string
  updatedAt: number
  repoIds: string[]
}

function memoSummary(row: Memo): MemoSummary {
  return { id: row.id, title: row.title, updatedAt: row.updatedAt, repoIds: row.repoIds }
}

const ISSUE_STATUS_VALUES = ['open', 'doing', 'done'] as const

/**
 * `ISSUE_STATUS_VALUES`가 `@shared/models`의 `IssueStatus`와 정확히 같은 집합인지
 * 컴파일 타임에 확인한다. 상태가 추가·삭제·개명되면 이 줄에서 타입 오류가 나
 * zod enum이 조용히 뒤처지는 일을 막는다 — 원소가 IssueStatus 밖이면 제네릭
 * 제약이, IssueStatus 쪽이 더 많으면 아래 조건부 타입이 `never`가 되어 잡는다.
 */
type AssertIssueStatusExhaustive<T extends readonly IssueStatus[]> =
  IssueStatus extends T[number] ? T : never
const issueStatusValues: AssertIssueStatusExhaustive<typeof ISSUE_STATUS_VALUES> = ISSUE_STATUS_VALUES

const ISSUE_STATUS = z.enum(issueStatusValues)

export function buildServer(ctx: RunContext, deps: McpHostDeps): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '0.1.0' })

  server.registerTool('list_repos', {
    description: '이 workspace에 등록된 repo 목록'
  }, async () => reply(() => deps.repos.list(ctx.workspaceId)))

  server.registerTool('list_issues', {
    description: '이 workspace의 이슈 요약 목록 (id·title·status·updatedAt·repoIds — 본문은 빠진다). 본문이 필요하면 get_issue를 쓴다.',
    inputSchema: {
      status: ISSUE_STATUS.optional().describe('상태로 거른다'),
      repoId: z.string().optional().describe('이 repo에 태그된 것과 공통 항목만')
    }
  }, async ({ status, repoId }) => reply(() => {
    const rows = deps.issues.list({ workspaceId: ctx.workspaceId, ...(repoId ? { repoId } : {}) })
    return (status ? rows.filter((r) => r.status === status) : rows).map(issueSummary)
  }))

  server.registerTool('get_issue', {
    description: '이슈 하나의 본문 전체',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => loadIssue(deps, ctx, id)))

  server.registerTool('list_memos', {
    description: '이 workspace의 메모 요약 목록 (id·title·updatedAt·repoIds — 본문은 빠진다). 본문이 필요하면 get_memo를 쓴다.',
    inputSchema: { repoId: z.string().optional().describe('이 repo에 태그된 것과 공통 항목만') }
  }, async ({ repoId }) => reply(() =>
    deps.memos.list({ workspaceId: ctx.workspaceId, ...(repoId ? { repoId } : {}) }).map(memoSummary)
  ))

  server.registerTool('get_memo', {
    description: '메모 하나의 본문 전체',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => loadMemo(deps, ctx, id)))

  // 읽기 전용은 여기서 끝난다. 파일은 못 고치는데 이슈 상태는 바꿀 수 있다면
  // "읽기 전용"이라는 표현을 신뢰할 수 없게 된다 (설계 §8).
  if (ctx.permission === 'read_only') return server

  server.registerTool('create_issue', {
    description: '이 workspace에 이슈를 만든다',
    inputSchema: {
      title: z.string().min(1),
      body: z.string().default(''),
      repoIds: z.array(z.string()).optional().describe('태그할 repo. 같은 workspace여야 한다')
    }
  }, async ({ title, body, repoIds }) => reply(() => deps.issues.create({
    workspaceId: ctx.workspaceId, title, body, ...(repoIds ? { repoIds } : {})
  })))

  server.registerTool('update_issue', {
    description: '이슈의 상태나 본문을 고친다',
    inputSchema: {
      id: z.string(),
      status: ISSUE_STATUS.optional(),
      body: z.string().optional()
    }
  }, async ({ id, status, body }) => reply(() => {
    // 소속 확인이 먼저다. 저장소의 update는 id만 보므로 여기서 막지 않으면
    // 다른 workspace의 이슈가 고쳐진다.
    loadIssue(deps, ctx, id)
    return deps.issues.update({
      id, ...(status ? { status } : {}), ...(body !== undefined ? { body } : {})
    })
  }))

  server.registerTool('create_memo', {
    description: '이 workspace에 메모를 만든다',
    inputSchema: {
      title: z.string().min(1),
      body: z.string().default(''),
      repoIds: z.array(z.string()).optional().describe('태그할 repo. 같은 workspace여야 한다')
    }
  }, async ({ title, body, repoIds }) => reply(() => deps.memos.create({
    workspaceId: ctx.workspaceId, title, body, ...(repoIds ? { repoIds } : {})
  })))

  server.registerTool('update_memo', {
    description: '메모의 제목이나 본문을 고친다',
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional()
    }
  }, async ({ id, title, body }) => reply(() => {
    loadMemo(deps, ctx, id)
    return deps.memos.update({
      id, ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {})
    })
  }))

  return server
}
