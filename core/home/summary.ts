import { INBOX_RULES, inboxCategory, representativeTurn } from '@shared/inbox'
import { conversationTitle } from '@shared/conversationTitle'
import { isStale, isUntriaged } from '@shared/issueRules'
import { repoOfCwd } from '@shared/repoPath'
import type {
  HomeDoneIssue, HomeRepo, HomeRepoState, HomeRunning, HomeSetup, HomeSummary, HomeSummaryInput, HomeTimelineRow, HomeTodo,
  HomeWorkspace, Issue, QueueSnapshot, Repo, Run, Workspace
} from '@shared/models'
import { groupTurns, conversationSpan } from '../period/conversations'
import type { LiveSnapshot } from './live'

/**
 * 홈 요약 (`docs/sdlc/home/` FR-1~7·FR-14). workspace를 넘어 읽는 **두 번째 자리**(첫째는 `reports/build.ts`)이고 똑같이
 * MCP `deps`에는 넘기지 않는다 — agent는 토큰의 workspace만 본다(전체 설계 §8).
 *
 * 판정은 전부 import다(NFR-2): 대화의 상태는 `representativeTurn`(인박스·도크와 같은 턴), 배지에 세는 카테고리는
 * `INBOX_RULES`, 정리 안 됨·오래 안 본은 `shared/issueRules`, 제목은 `shared/conversationTitle`, repo는 `shared/repoPath`.
 * 여기서 다시 적으면 홈이 세는 수와 인박스·이슈 패널의 수가 갈린다.
 *
 * 저장소를 직접 받지 않는다 — 테스트가 평범한 배열로 세운다(`ReportSources`와 같은 모양).
 */
export interface HomeSources {
  workspaces(): Workspace[]
  repos(workspaceId: string): Repo[]
  issues(workspaceId: string): Issue[]
  /** 최신순(`runs.list`) */
  runs(workspaceId: string): Run[]
  /** 미확인 대화의 대표 턴, 끝난 시각 최신 먼저(`runs.inbox`) */
  inbox(): Run[]
  /** 돌고 있는 턴의 메모리 스냅샷(`live.ts`) — 없으면 null */
  live(runId: string): LiveSnapshot | null
  queue(): QueueSnapshot
}

/** 질문·실패 이유 앞부분의 길이 (spec §3) */
const DETAIL_CHARS = 160
/** 정리 안 됨·오래 안 본 줄에 보이는 제목 수 */
const TITLES_MAX = 3

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars)}…` : text
}

/** 한 workspace의 대화 — 뿌리·오래된 순 턴·대표 턴·활성 턴·repo. 도크의 `Conversation`과 같은 판정이다 */
interface Conv {
  id: string
  root: Run
  ordered: Run[]
  state: Run
  active: Run | null
  title: string
  repo: Repo | null
}

function conversationsOf(runsLatestFirst: readonly Run[], repos: readonly Repo[]): Conv[] {
  const out: Conv[] = []
  for (const [id, turns] of groupTurns(runsLatestFirst)) {
    const ordered = [...turns].reverse()
    // 뿌리는 id로 찾는다 (CLAUDE.md "`run.title`·`run.closed_at`은 뿌리 행에서만")
    const root = ordered.find((t) => t.id === id) ?? ordered[0]!
    out.push({
      id,
      root,
      ordered,
      state: representativeTurn(turns)!,
      // 대화당 running은 하나뿐이고 예약도 하나뿐이다(설계 §3-2) — 도크의 `active`와 같다
      active: ordered.find((r) => r.status === 'running') ?? ordered.find((r) => r.status === 'pending') ?? null,
      title: conversationTitle(root, ordered),
      repo: repoOfCwd(root.cwd, repos)
    })
  }
  return out
}

type BadgeKind = 'needs-answer' | 'failed' | 'interrupted'

/** 배지에 세는 카테고리면 그 이름, 아니면 null — 판정은 `INBOX_RULES.badge` 한 칸이다(FR-3) */
function badgeKindOf(run: Run): BadgeKind | null {
  const cat = inboxCategory(run)
  return INBOX_RULES[cat].badge ? (cat as BadgeKind) : null
}

/** 할 일 1·2 — 인박스 목록 중 배지에 세는 것만, 답변 필요가 먼저(안정 분할), 그 안은 인박스 순 */
function badgeRuns(inbox: readonly Run[], workspaceIds: ReadonlySet<string>): Array<{ run: Run; kind: BadgeKind }> {
  const counted = inbox.flatMap((run) => {
    if (!workspaceIds.has(run.workspaceId)) return []
    const kind = badgeKindOf(run)
    return kind ? [{ run, kind }] : []
  })
  return [
    ...counted.filter((c) => c.kind === 'needs-answer'),
    ...counted.filter((c) => c.kind !== 'needs-answer')
  ]
}

interface WorkspaceData {
  workspace: Workspace
  repos: Repo[]
  issues: Issue[]
  convs: Conv[]
}

/** 할 일 3·4 — workspace마다 한 줄, 개수가 0이면 줄이 없다 */
function issueTodos(data: readonly WorkspaceData[], now: number): HomeTodo[] {
  const untriaged: HomeTodo[] = []
  const stale: HomeTodo[] = []
  for (const { workspace, issues } of data) {
    const u = issues.filter(isUntriaged)
    if (u.length > 0) {
      untriaged.push({ kind: 'untriaged', workspaceId: workspace.id, workspaceName: workspace.name, count: u.length, titles: u.slice(0, TITLES_MAX).map((i) => i.title) })
    }
    const s = issues.filter((i) => isStale(i, now))
    if (s.length > 0) {
      stale.push({ kind: 'stale', workspaceId: workspace.id, workspaceName: workspace.name, count: s.length, titles: s.slice(0, TITLES_MAX).map((i) => i.title) })
    }
  }
  return [...untriaged, ...stale]
}

/** repo 줄의 상태 — 가장 급한 것 (FR-6) */
function repoStateOf(convs: readonly Conv[]): HomeRepoState {
  if (convs.some((c) => c.active?.status === 'running')) return 'running'
  if (convs.some((c) => c.state.needsAnswer)) return 'needs-answer'
  if (convs.some((c) => { const cat = inboxCategory(c.state); return cat === 'failed' || cat === 'interrupted' })) return 'failed'
  return convs.length > 0 ? 'done' : 'none'
}

export function buildHomeSummary(src: HomeSources, input: HomeSummaryInput): HomeSummary {
  const { now, dayStart } = input
  const workspaces = src.workspaces()
  const data: WorkspaceData[] = workspaces.map((workspace) => {
    const repos = src.repos(workspace.id)
    return { workspace, repos, issues: src.issues(workspace.id), convs: conversationsOf(src.runs(workspace.id), repos) }
  })
  const convById = new Map<string, { conv: Conv; workspace: Workspace }>()
  for (const d of data) for (const conv of d.convs) convById.set(conv.id, { conv, workspace: d.workspace })

  // 돌고 있는 것 · 대기
  const running: HomeRunning[] = []
  let queued = 0
  for (const { workspace, convs } of data) {
    for (const conv of convs) {
      queued += conv.ordered.filter((r) => r.status === 'pending').length
      const turn = conv.active
      if (!turn || turn.status !== 'running') continue
      const live = src.live(turn.id)
      running.push({
        workspaceId: workspace.id, workspaceName: workspace.name,
        repoId: conv.repo?.id ?? null, repoName: conv.repo?.name ?? null,
        conversationId: conv.id, runId: turn.id, title: conv.title, turns: conv.ordered.length,
        startedAt: turn.startedAt, currentTool: live?.currentTool ?? null, lastText: live?.lastText ?? null
      })
    }
  }
  running.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const queue = src.queue()

  // 할 일
  const wsIds = new Set(workspaces.map((w) => w.id))
  const todos: HomeTodo[] = badgeRuns(src.inbox(), wsIds).map(({ run, kind }): HomeTodo => {
    const conversationId = run.rootRunId ?? run.id
    // 요약이 읽은 run 목록에 없는 대화(그 사이 지워짐)도 줄은 남긴다(제목은 첫 지시) — `homeCount`가 같은 집합을 세야 배지와 줄 수가 같다
    const found = convById.get(conversationId)
    const detail = kind === 'needs-answer' ? run.resultText : run.errorMessage
    return {
      kind,
      workspaceId: run.workspaceId,
      workspaceName: found?.workspace.name ?? '',
      repoId: found?.conv.repo?.id ?? null,
      repoName: found?.conv.repo?.name ?? null,
      conversationId,
      runId: run.id,
      title: found?.conv.title ?? run.userPrompt.split('\n')[0] ?? '',
      detail: detail ? clip(detail, DETAIL_CHARS) : null,
      at: run.endedAt
    }
  })
  todos.push(...issueTodos(data, now))

  // 오늘 타임라인 — 오늘과 겹치는 대화의 막대를 오늘로 클립한다
  const timeline: HomeTimelineRow[] = data.map(({ workspace, convs }) => ({
    workspaceId: workspace.id,
    name: workspace.name,
    bars: convs.flatMap((conv) => {
      const span = conversationSpan(conv.ordered)
      const isRunning = conv.active?.status === 'running'
      const lastAt = isRunning ? now : span.lastAt
      if (lastAt < dayStart || span.startedAt > now) return []
      return [{
        conversationId: conv.id, title: conv.title,
        from: Math.max(span.startedAt, dayStart), to: Math.min(lastAt, now),
        status: conv.active?.status ?? conv.state.status, needsAnswer: conv.state.needsAnswer
      }]
    }).sort((a, b) => a.from - b.from)
  }))

  // workspace 카드
  const homeWorkspaces: HomeWorkspace[] = data.map(({ workspace, repos, issues, convs }) => ({
    workspaceId: workspace.id,
    name: workspace.name,
    open: issues.filter((i) => i.status === 'open').length,
    doing: issues.filter((i) => i.status === 'doing').length,
    doneToday: issues.filter((i) => i.status === 'done' && i.closedAt !== null && i.closedAt >= dayStart).length,
    untriaged: issues.filter(isUntriaged).length,
    repos: repos.map((repo): HomeRepo => {
      const mine = convs.filter((c) => c.repo?.id === repo.id && c.root.closedAt === null)
      return {
        repoId: repo.id, name: repo.name, path: repo.path, agentEnv: repo.agentEnv,
        open: issues.filter((i) => i.status !== 'done' && i.repoIds.includes(repo.id)).length,
        conversations: mine.length,
        state: repoStateOf(mine)
      }
    })
  }))

  // 오늘 완료
  const doneToday: HomeDoneIssue[] = data.flatMap(({ workspace, issues }) => issues
    .filter((i) => i.status === 'done' && i.closedAt !== null && i.closedAt >= dayStart)
    .map((i) => ({ workspaceId: workspace.id, workspaceName: workspace.name, issueId: i.id, title: i.title, closedAt: i.closedAt! })))
    .sort((a, b) => b.closedAt - a.closedAt)

  const setup: HomeSetup = {
    workspace: workspaces.length > 0,
    repo: data.some((d) => d.repos.length > 0),
    firstRun: data.some((d) => d.convs.length > 0)
  }

  return {
    running, queued, slots: { used: queue.running, limit: queue.limit },
    todos, timeline, workspaces: homeWorkspaces, doneToday, setup
  }
}

/**
 * 홈 배지 — `todos.length`와 같은 수(FR-4·FR-17). 요약 전체를 만들지 않고 인박스와 이슈만 읽는다 — workspace 화면에 있을
 * 때도 매 이슈 변경마다 모든 workspace의 run을 긁지 않기 위해서다. 집합은 `buildHomeSummary`의 할 일과 같은 함수에서 나온다.
 */
export function homeCount(src: Pick<HomeSources, 'workspaces' | 'issues' | 'inbox'>, input: Pick<HomeSummaryInput, 'now'>): number {
  const workspaces = src.workspaces()
  const wsIds = new Set(workspaces.map((w) => w.id))
  const data = workspaces.map((workspace) => ({ workspace, repos: [], issues: src.issues(workspace.id), convs: [] }))
  return badgeRuns(src.inbox(), wsIds).length + issueTodos(data, input.now).length
}
