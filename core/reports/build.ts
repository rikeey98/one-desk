import { representativeTurn } from '@shared/inbox'
import { conversationTitle } from '@shared/conversationTitle'
import { groupTurns, conversationSpan, spanOverlaps } from '../period/conversations'
import { issueTouchedIn, memoTouchedIn } from '../period/range'
import type {
  BuildReportInput, Issue, Memo, ReportConversation, ReportData, ReportWorkspace, Run, Workspace
} from '@shared/models'

/** 답 앞부분의 길이 — MCP `list_conversations`의 `lastAnswer`와 같다 */
const ANSWER_CHARS = 300

/** 저장소를 직접 받지 않는다 — 테스트가 평범한 배열로 세운다 */
export interface ReportSources {
  workspaces(): Workspace[]
  issues(workspaceId: string): Issue[]
  memos(workspaceId: string): Memo[]
  runs(workspaceId: string): Run[]
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars)}…` : text
}

function conversationsIn(runs: readonly Run[], range: BuildReportInput): ReportConversation[] {
  const out: ReportConversation[] = []
  for (const [rootId, turns] of groupTurns(runs)) {
    if (!spanOverlaps(conversationSpan(turns), range)) continue
    const ordered = [...turns].sort((a, b) => a.createdAt - b.createdAt)
    const latestFirst = [...ordered].reverse()
    // 뿌리는 id로 찾는다 (CLAUDE.md "`run.title`·`run.closed_at`은 뿌리 행에서만")
    const root = ordered.find((t) => t.id === rootId) ?? ordered[0]!
    const state = representativeTurn(latestFirst)!
    out.push({
      id: rootId,
      title: conversationTitle(root, ordered),
      status: state.status,
      needsAnswer: state.needsAnswer,
      closed: root.closedAt !== null,
      issueId: root.issue?.id ?? null,
      issueTitle: root.issue?.title ?? null,
      turns: ordered.map((t) => ({ createdAt: t.createdAt, startedAt: t.startedAt, endedAt: t.endedAt })),
      lastAnswer: state.resultText === null ? null : clip(state.resultText, ANSWER_CHARS)
    })
  }
  return out
}

/**
 * 여러 workspace의 기간 데이터를 고른다 (`docs/sdlc/period-report/` FR-1~5). 읽기만 하고, 로그 파일은 읽지 않는다.
 *
 * **MCP를 거치지 않는다** — workspace를 넘는 이 읽기는 사람이 연 화면만 한다(전체 설계 §8).
 * "기간 안"의 판정은 MCP와 같은 `core/period/` 함수다(FR-2).
 */
export function buildReport(src: ReportSources, input: BuildReportInput): ReportData {
  const byId = new Map(src.workspaces().map((w) => [w.id, w]))
  const workspaces: ReportWorkspace[] = []
  for (const id of input.workspaceIds) {
    const workspace = byId.get(id)
    if (!workspace) continue
    workspaces.push({
      id,
      name: workspace.name,
      issues: src.issues(id).filter((i) => issueTouchedIn(i, input)).map((i) => ({
        id: i.id, title: i.title, status: i.status, priority: i.priority,
        createdAt: i.createdAt, startedAt: i.startedAt, closedAt: i.closedAt, updatedAt: i.updatedAt
      })),
      memos: src.memos(id).filter((m) => memoTouchedIn(m, input)).map((m) => ({
        id: m.id, title: m.title, createdAt: m.createdAt, updatedAt: m.updatedAt
      })),
      conversations: conversationsIn(src.runs(id), input)
    })
  }
  return { since: input.since, until: input.until, workspaces }
}
