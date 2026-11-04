import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { NotFoundError } from '../errors'
import { MCP_SERVER_NAME } from './configFile'
import { summarizeConversations, conversationDetail } from './conversations'
import { issueTouchedIn, memoTouchedIn } from '../period/range'
import {
  reply, issueSummary, memoSummary, issueOut, memoOut, RANGE, readRange, ISSUE_STATUS, type McpHostDeps
} from './tools'
import type { Workspace } from '@shared/models'

/**
 * 홈 대화의 서버 (`docs/sdlc/home-conversation/` FR-9·FR-10). 홈을 뺀 모든 workspace를 **읽기만** 한다 — 쓰기 도구도
 * `propose_issue`도 등록하는 자리가 없다. 권한과 별개로 범위에서 끝난다(실행 서비스의 읽기 전용 강제가 뚫려도 막는 두 번째 겹).
 * 요약 모양은 workspace 범위의 같은 도구에 `workspaceId`·`workspaceName`을 얹은 것이다 — 요약 함수를 같이 쓴다.
 */
export function buildAllServer(deps: McpHostDeps): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '0.1.0' })

  /** 홈은 `list()`에 없으므로 홈 id와 없는 id가 같은 말이 된다 */
  function readable(workspaceId: string): Workspace | null {
    return deps.workspaces.list().find((w) => w.id === workspaceId) ?? null
  }

  /** 인자로 좁힌 workspace들. repo를 주면 그 repo의 workspace 하나다 — 공통 항목(태그 없는 것)이 다른 workspace에서 섞이지 않게 */
  function targets(workspaceId: string | undefined, repoId?: string): Workspace[] {
    if (repoId !== undefined) {
      let owner: Workspace | null = null
      try {
        owner = readable(deps.repos.get(repoId).workspaceId)
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err
      }
      if (!owner || (workspaceId !== undefined && owner.id !== workspaceId)) {
        throw new NotFoundError(`repo를 찾을 수 없습니다: ${repoId}`)
      }
      return [owner]
    }
    if (workspaceId === undefined) return deps.workspaces.list()
    const found = readable(workspaceId)
    if (!found) throw new NotFoundError(`workspace를 찾을 수 없습니다: ${workspaceId}`)
    return [found]
  }

  const named = (w: Workspace) => ({ workspaceId: w.id, workspaceName: w.name })

  const WORKSPACE_ID = z.string().optional().describe('이 workspace만 (list_workspaces의 id). 없으면 모든 workspace')
  const REPO_ID = z.string().optional().describe('이 repo에 태그된 것과 그 workspace의 공통 항목만')

  server.registerTool('list_workspaces', {
    description: '읽을 수 있는 모든 workspace — id·name·description·repoCount. 다른 도구의 workspaceId로 좁힐 때 쓴다.'
  }, async () => reply(() => deps.workspaces.list().map((w) => ({
    id: w.id, name: w.name, description: w.description, repoCount: deps.repos.list(w.id).length
  }))))

  server.registerTool('list_repos', {
    description: '모든 workspace에 등록된 repo 목록 — 항목마다 workspaceId·workspaceName',
    inputSchema: { workspaceId: WORKSPACE_ID }
  }, async ({ workspaceId }) => reply(() =>
    targets(workspaceId).flatMap((w) => deps.repos.list(w.id).map((r) => ({ ...r, workspaceName: w.name })))
  ))

  server.registerTool('list_issues', {
    description: '모든 workspace의 이슈 요약 목록 — 항목마다 workspaceId·workspaceName과 id·title·status·repoIds·source·kind·priority, 시각 createdAt·startedAt(마지막으로 doing이 된 때)·closedAt(done이 된 때)·updatedAt·triagedAt. 시각은 시간대가 붙은 ISO다. 본문은 빠진다 — get_issue로 읽는다. since·until을 주면 그 기간에 만들어지거나 시작·완료·수정된 이슈만 준다.',
    inputSchema: {
      workspaceId: WORKSPACE_ID,
      status: ISSUE_STATUS.optional().describe('상태로 거른다'),
      repoId: REPO_ID,
      ...RANGE
    }
  }, async ({ workspaceId, status, repoId, since, until }) => reply(() => {
    const range = readRange({ since, until })
    return targets(workspaceId, repoId).flatMap((w) =>
      deps.issues.list({ workspaceId: w.id, ...(repoId ? { repoId } : {}) })
        .filter((r) => issueTouchedIn(r, range) && (!status || r.status === status))
        .map((r) => ({ ...named(w), ...issueSummary(r) }))
    )
  }))

  server.registerTool('get_issue', {
    description: '이슈 하나의 본문 전체와 workspaceName — 어느 workspace의 이슈든',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => {
    const row = deps.issues.get(id)
    const w = readable(row.workspaceId)
    if (!w) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${id}`)
    return { ...issueOut(row), workspaceName: w.name }
  }))

  server.registerTool('list_memos', {
    description: '모든 workspace의 메모 요약 목록 — 항목마다 workspaceId·workspaceName과 id·title·repoIds·createdAt·updatedAt. 시각은 시간대가 붙은 ISO다. 본문은 빠진다 — get_memo로 읽는다. since·until을 주면 그 기간에 만들어지거나 수정된 메모만 준다.',
    inputSchema: { workspaceId: WORKSPACE_ID, repoId: REPO_ID, ...RANGE }
  }, async ({ workspaceId, repoId, since, until }) => reply(() => {
    const range = readRange({ since, until })
    return targets(workspaceId, repoId).flatMap((w) =>
      deps.memos.list({ workspaceId: w.id, ...(repoId ? { repoId } : {}) })
        .filter((r) => memoTouchedIn(r, range))
        .map((r) => ({ ...named(w), ...memoSummary(r) }))
    )
  }))

  server.registerTool('get_memo', {
    description: '메모 하나의 본문 전체와 workspaceName — 어느 workspace의 메모든',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => {
    const row = deps.memos.get(id)
    const w = readable(row.workspaceId)
    if (!w) throw new NotFoundError(`메모를 찾을 수 없습니다: ${id}`)
    return { ...memoOut(row), workspaceName: w.name }
  }))

  server.registerTool('list_conversations', {
    description: '모든 workspace에서 돌린 대화(agent 실행)의 요약 목록, 최신 활동순 — 항목마다 workspaceId·workspaceName과 id·title·startedAt·lastActivityAt·status·needsAnswer·turns·closed·issueId·firstPrompt(첫 지시 앞부분)·lastAnswer(마지막 답 앞부분). 시각은 시간대가 붙은 ISO다. 열린 대화만 보려면 closed: false를 준다 — workspace가 많으면 끝낸 대화까지 다 실은 목록은 길다. since·until을 주면 그 기간에 활동이 있던 대화만 준다. 턴마다 자세한 것은 get_conversation으로 읽는다.',
    inputSchema: {
      workspaceId: WORKSPACE_ID,
      closed: z.boolean().optional().describe('false면 열린 대화만, true면 끝낸 대화만. 없으면 둘 다'),
      ...RANGE
    }
  }, async ({ workspaceId, closed, since, until }) => reply(() => {
    const range = readRange({ since, until })
    return targets(workspaceId)
      .flatMap((w) => summarizeConversations(deps.runs.list(w.id), range).map((c) => ({ ...named(w), ...c })))
      .filter((c) => closed === undefined || c.closed === closed)
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
  }))

  server.registerTool('get_conversation', {
    description: '대화 하나의 턴 전부, 오래된 순 — workspaceName과 issueId, 턴마다 requestedAt·startedAt·endedAt·waitSeconds·durationSeconds·status·needsAnswer·agent·model·prompt(지시 앞부분)·answer(답 앞부분)·error. 시각은 시간대가 붙은 ISO다. id는 list_conversations의 id나 그 대화의 아무 턴 id.',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => {
    let workspaceId: string | null = null
    try {
      workspaceId = deps.runs.get(id).workspaceId
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
    // 홈 대화는 홈 대화를 읽지 않는다 (spec §5 우려 2) — 없는 id와 같은 말로 떨군다
    const w = workspaceId === null ? null : readable(workspaceId)
    const detail = w ? conversationDetail(deps.runs.list(w.id), id) : null
    if (!w || !detail) throw new NotFoundError(`대화를 찾을 수 없습니다: ${id}`)
    return { ...named(w), ...detail }
  }))

  return server
}
