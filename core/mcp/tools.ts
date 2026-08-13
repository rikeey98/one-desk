import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { NotFoundError } from '../errors'
import type { RepoRepository } from '../db/repositories/repo'
import type { IssueRepository } from '../db/repositories/issue'
import type { MemoRepository } from '../db/repositories/memo'
import type { RunContext } from './host'
import type { Issue, Memo } from '@shared/models'

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

const ISSUE_STATUS = z.enum(['open', 'doing', 'done'])

export function buildServer(ctx: RunContext, deps: McpHostDeps): McpServer {
  const server = new McpServer({ name: 'onedesk', version: '0.1.0' })

  server.registerTool('list_repos', {
    description: '이 workspace에 등록된 repo 목록'
  }, async () => reply(() => deps.repos.list(ctx.workspaceId)))

  server.registerTool('list_issues', {
    description: '이 workspace의 이슈 목록',
    inputSchema: {
      status: ISSUE_STATUS.optional().describe('상태로 거른다'),
      repoId: z.string().optional().describe('이 repo에 태그된 것과 공통 항목만')
    }
  }, async ({ status, repoId }) => reply(() => {
    const rows = deps.issues.list({ workspaceId: ctx.workspaceId, ...(repoId ? { repoId } : {}) })
    return status ? rows.filter((r) => r.status === status) : rows
  }))

  server.registerTool('get_issue', {
    description: '이슈 하나의 본문',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => loadIssue(deps, ctx, id)))

  server.registerTool('list_memos', {
    description: '이 workspace의 메모 목록',
    inputSchema: { repoId: z.string().optional().describe('이 repo에 태그된 것과 공통 항목만') }
  }, async ({ repoId }) => reply(() =>
    deps.memos.list({ workspaceId: ctx.workspaceId, ...(repoId ? { repoId } : {}) })
  ))

  server.registerTool('get_memo', {
    description: '메모 하나의 본문',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => loadMemo(deps, ctx, id)))

  return server
}
