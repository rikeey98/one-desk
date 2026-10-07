import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { NotFoundError } from '../errors'
import { MCP_SERVER_NAME } from './configFile'
import type { RepoRepository } from '../db/repositories/repo'
import type { IssueRepository } from '../db/repositories/issue'
import type { MemoRepository } from '../db/repositories/memo'
import type { RunRepository } from '../db/repositories/run'
import type { RunContext } from './host'
import type { Issue, IssueStatus, IssueSource, IssueKind, IssuePriority, Memo } from '@shared/models'
import { parseBound, toIso } from './time'
import { summarizeConversations, conversationDetail } from './conversations'
import { issueTouchedIn, memoTouchedIn } from '../period/range'

export interface McpHostDeps {
  repos: RepoRepository
  issues: IssueRepository
  memos: MemoRepository
  /** `list_conversations`가 읽는다 (docs/sdlc/timestamps/ FR-7). 쓰지 않는다 */
  runs: RunRepository
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

/**
 * list_issues가 돌려주는 요약 형태. body를 뺀다 — get_issue와 대칭.
 *
 * 분류 축과 triagedAt은 넣는다 (설계 §6) — agent가 회의 메모를 이슈로 쪼개 넣고
 * 어떤 것이 아직 미분류인지 목록만 보고 판단하게 하려면 요약에서도 보여야 한다.
 */
interface IssueSummary {
  id: string
  title: string
  status: IssueStatus
  repoIds: string[]
  source: IssueSource | null
  kind: IssueKind | null
  priority: IssuePriority | null
  // 시각은 전부 시간대가 붙은 ISO다 (docs/sdlc/timestamps/ FR-4) — 모델은 epoch ms로 요일을 계산하다 틀린다.
  createdAt: string
  updatedAt: string
  startedAt: string | null
  closedAt: string | null
  triagedAt: string | null
}

function issueSummary(row: Issue): IssueSummary {
  return {
    id: row.id, title: row.title, status: row.status, repoIds: row.repoIds,
    source: row.source, kind: row.kind, priority: row.priority,
    createdAt: toIso(row.createdAt)!, updatedAt: toIso(row.updatedAt)!, startedAt: toIso(row.startedAt),
    closedAt: toIso(row.closedAt), triagedAt: toIso(row.triagedAt)
  }
}

/** issueSummary와 대칭. memo에는 status가 없다. */
interface MemoSummary {
  id: string
  title: string
  repoIds: string[]
  createdAt: string
  updatedAt: string
}

function memoSummary(row: Memo): MemoSummary {
  return {
    id: row.id, title: row.title, repoIds: row.repoIds,
    createdAt: toIso(row.createdAt)!, updatedAt: toIso(row.updatedAt)!
  }
}

/** get·create·update가 돌려주는 이슈 전체 — 본문까지, 시각만 ISO로 (FR-4) */
function issueOut(row: Issue) {
  return {
    ...row,
    createdAt: toIso(row.createdAt), updatedAt: toIso(row.updatedAt), closedAt: toIso(row.closedAt),
    startedAt: toIso(row.startedAt), triagedAt: toIso(row.triagedAt), seenAt: toIso(row.seenAt)
  }
}

/** issueOut과 대칭 */
function memoOut(row: Memo) {
  return { ...row, createdAt: toIso(row.createdAt), updatedAt: toIso(row.updatedAt) }
}

/** 기간 인자. 둘 다 선택이고 `until`은 그 시각 **전까지**다 (FR-6) */
const RANGE = {
  since: z.string().optional().describe('이 날짜(2026-09-28이면 그 날 0시) 또는 ISO 날짜시각부터'),
  until: z.string().optional().describe('이 날짜 또는 ISO 날짜시각 전까지')
}

function readRange(args: { since?: string | undefined; until?: string | undefined }) {
  return {
    ...(args.since !== undefined ? { since: parseBound(args.since, 'since') } : {}),
    ...(args.until !== undefined ? { until: parseBound(args.until, 'until') } : {})
  }
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

const ISSUE_SOURCE_VALUES = ['customer', 'plan', 'meeting', 'dev'] as const
const ISSUE_KIND_VALUES = ['bug', 'feature', 'refactor', 'docs', 'research'] as const
const ISSUE_PRIORITY_VALUES = ['urgent', 'week', 'someday'] as const

/** ISSUE_STATUS와 같은 장치다 — 축이 추가·개명되면 이 줄에서 타입 오류가 난다. */
type AssertSourceExhaustive<T extends readonly IssueSource[]> =
  IssueSource extends T[number] ? T : never
type AssertKindExhaustive<T extends readonly IssueKind[]> =
  IssueKind extends T[number] ? T : never
type AssertPriorityExhaustive<T extends readonly IssuePriority[]> =
  IssuePriority extends T[number] ? T : never

const issueSourceValues: AssertSourceExhaustive<typeof ISSUE_SOURCE_VALUES> = ISSUE_SOURCE_VALUES
const issueKindValues: AssertKindExhaustive<typeof ISSUE_KIND_VALUES> = ISSUE_KIND_VALUES
const issuePriorityValues: AssertPriorityExhaustive<typeof ISSUE_PRIORITY_VALUES> = ISSUE_PRIORITY_VALUES

const ISSUE_SOURCE = z.enum(issueSourceValues)
const ISSUE_KIND = z.enum(issueKindValues)
const ISSUE_PRIORITY = z.enum(issuePriorityValues)

export function buildServer(ctx: RunContext, deps: McpHostDeps): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '0.1.0' })

  server.registerTool('list_repos', {
    description: '이 workspace에 등록된 repo 목록'
  }, async () => reply(() => deps.repos.list(ctx.workspaceId)))

  server.registerTool('list_issues', {
    description: '이 workspace의 이슈 요약 목록 (id·title·status·repoIds·source·kind·priority와 시각 createdAt·startedAt(마지막으로 doing이 된 때)·closedAt(done이 된 때)·updatedAt·triagedAt — 본문은 빠진다). 시각은 시간대가 붙은 ISO다. source/kind/priority가 비어 있거나 triagedAt이 null이면 아직 분류되지 않은 이슈다. since·until을 주면 그 기간에 만들어지거나 시작·완료·수정된 이슈만 준다 — "이번 주에 생긴 것·한 일" 정리에 쓴다. 본문이 필요하면 get_issue를 쓴다.',
    inputSchema: {
      status: ISSUE_STATUS.optional().describe('상태로 거른다'),
      repoId: z.string().optional().describe('이 repo에 태그된 것과 공통 항목만'),
      ...RANGE
    }
  }, async ({ status, repoId, since, until }) => reply(() => {
    const range = readRange({ since, until })
    const rows = deps.issues.list({ workspaceId: ctx.workspaceId, ...(repoId ? { repoId } : {}) })
      .filter((r) => issueTouchedIn(r, range))
    return (status ? rows.filter((r) => r.status === status) : rows).map(issueSummary)
  }))

  server.registerTool('get_issue', {
    description: '이슈 하나의 본문 전체',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => issueOut(loadIssue(deps, ctx, id))))

  server.registerTool('list_memos', {
    description: '이 workspace의 메모 요약 목록 (id·title·repoIds·createdAt·updatedAt — 본문은 빠진다). 시각은 시간대가 붙은 ISO다. since·until을 주면 그 기간에 만들어지거나 수정된 메모만 준다. 본문이 필요하면 get_memo를 쓴다.',
    inputSchema: {
      repoId: z.string().optional().describe('이 repo에 태그된 것과 공통 항목만'),
      ...RANGE
    }
  }, async ({ repoId, since, until }) => reply(() => {
    const range = readRange({ since, until })
    return deps.memos.list({ workspaceId: ctx.workspaceId, ...(repoId ? { repoId } : {}) })
      .filter((r) => memoTouchedIn(r, range))
      .map(memoSummary)
  }))

  server.registerTool('get_memo', {
    description: '메모 하나의 본문 전체',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => memoOut(loadMemo(deps, ctx, id))))

  server.registerTool('list_conversations', {
    description: '이 workspace에서 돌린 대화(agent 실행)의 요약 목록, 최신 활동순 — id·title·startedAt·lastActivityAt·status·needsAnswer·turns·closed·issueId(이 대화에 할당된 이슈, 없으면 null — 본문은 get_issue로)·firstPrompt(첫 지시 앞부분)·lastAnswer(마지막 답 앞부분). 시각은 시간대가 붙은 ISO다. since·until을 주면 그 기간에 활동이 있던 대화만 준다 — "이번 주에 한 일" 정리에 쓴다. 지시·답 전체는 싣지 않는다.',
    inputSchema: { ...RANGE }
  }, async ({ since, until }) => reply(() =>
    summarizeConversations(deps.runs.list(ctx.workspaceId), readRange({ since, until }))
  ))

  server.registerTool('get_conversation', {
    description: '대화 하나의 턴 전부, 오래된 순, 그리고 issueId(이 대화에 할당된 이슈, 없으면 null) — 턴마다 requestedAt(지시를 보낸 때)·startedAt(실행 시작)·endedAt(끝)·waitSeconds(기다린 초)·durationSeconds(걸린 초)·status·needsAnswer·agent·model·prompt(지시 앞부분)·answer(답 앞부분)·error. 시각은 시간대가 붙은 ISO다. id는 list_conversations의 id나 그 대화의 아무 턴 id. "언제 무엇을 시켰고 얼마나 걸렸나" 정리에 쓴다.',
    inputSchema: { id: z.string() }
  }, async ({ id }) => reply(() => {
    // 토큰의 workspace 것만 본다 — 다른 workspace의 대화는 없는 id와 같은 말로 떨군다(loadIssue와 같은 원칙).
    const detail = conversationDetail(deps.runs.list(ctx.workspaceId), id)
    if (!detail) throw new NotFoundError(`대화를 찾을 수 없습니다: ${id}`)
    return detail
  }))

  // 읽기 전용은 여기서 끝난다. 파일은 못 고치는데 이슈 상태는 바꿀 수 있다면
  // "읽기 전용"이라는 표현을 신뢰할 수 없게 된다 (설계 §8).
  if (ctx.permission === 'read_only') return server

  server.registerTool('create_issue', {
    description: '이 workspace에 이슈를 만든다',
    inputSchema: {
      title: z.string().min(1),
      body: z.string().default(''),
      repoIds: z.array(z.string()).optional().describe('태그할 repo. 같은 workspace여야 한다'),
      source: ISSUE_SOURCE.optional().describe('어디서 온 이슈인가'),
      kind: ISSUE_KIND.optional().describe('무슨 성격의 일인가'),
      priority: ISSUE_PRIORITY.optional().describe('얼마나 급한가')
    }
  }, async ({ title, body, repoIds, source, kind, priority }) => reply(() => issueOut(deps.issues.create({
    workspaceId: ctx.workspaceId, title, body,
    ...(repoIds ? { repoIds } : {}),
    // 셋을 다 주면 triagedAt이 파생돼 사람의 훑기를 건너뛴다 (설계 §6).
    ...(source ? { source } : {}),
    ...(kind ? { kind } : {}),
    ...(priority ? { priority } : {})
  }))))

  server.registerTool('update_issue', {
    description: '이슈의 상태·본문·분류를 고친다',
    inputSchema: {
      id: z.string(),
      status: ISSUE_STATUS.optional(),
      body: z.string().optional(),
      source: ISSUE_SOURCE.optional(),
      kind: ISSUE_KIND.optional(),
      priority: ISSUE_PRIORITY.optional()
    }
  }, async ({ id, status, body, source, kind, priority }) => reply(() => {
    // 소속 확인이 먼저다. 저장소의 update는 id만 보므로 여기서 막지 않으면
    // 다른 workspace의 이슈가 고쳐진다.
    loadIssue(deps, ctx, id)
    return issueOut(deps.issues.update({
      id,
      ...(status ? { status } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(source ? { source } : {}),
      ...(kind ? { kind } : {}),
      ...(priority ? { priority } : {})
    }))
  }))

  server.registerTool('create_memo', {
    description: '이 workspace에 메모를 만든다',
    inputSchema: {
      title: z.string().min(1),
      body: z.string().default(''),
      repoIds: z.array(z.string()).optional().describe('태그할 repo. 같은 workspace여야 한다')
    }
  }, async ({ title, body, repoIds }) => reply(() => memoOut(deps.memos.create({
    workspaceId: ctx.workspaceId, title, body, ...(repoIds ? { repoIds } : {})
  }))))

  server.registerTool('update_memo', {
    description: '메모의 제목이나 본문을 고친다',
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional()
    }
  }, async ({ id, title, body }) => reply(() => {
    loadMemo(deps, ctx, id)
    return memoOut(deps.memos.update({
      id, ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {})
    }))
  }))

  return server
}
