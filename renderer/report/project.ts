import type { ReportConversation, ReportData, ReportIssue, ReportMemo, ReportWorkspace } from '@shared/models'
import type { Period } from './period'

/**
 * 리포트의 투영 (`docs/sdlc/period-report/` FR-6~9). core가 고른 데이터를 화면과 마크다운이 쓰는 모양으로 편다.
 * 세 탭(문서·요일·이슈 흐름)과 `toMarkdown`이 전부 이 함수들을 거친다 — 컴포넌트에 규칙을 두지 않는다.
 */

export type Bucket = 'done' | 'started' | 'created' | 'touched'

/** 칸의 순서이자 화면·마크다운의 머리 */
export const BUCKETS: ReadonlyArray<{ id: Bucket; label: string }> = [
  { id: 'done', label: '완료' },
  { id: 'started', label: '시작' },
  { id: 'created', label: '새로 만듦' },
  { id: 'touched', label: '손댐' }
]

export function inPeriod(at: number | null, period: Period): at is number {
  return at !== null && at >= period.since && at < period.until
}

/**
 * 이슈를 **한 칸에만** 넣는다 — 위에서부터 처음 맞는 칸(FR-6). 완료는 `closedAt`이 기간 안이고 **지금** done인 것뿐이다:
 * 기간 안에 끝냈다가 다시 연 이슈는 완료가 아니다(활동 기록이 없다 — spec §6의 1).
 */
export function classify(issue: ReportIssue, period: Period): Bucket {
  if (issue.status === 'done' && inPeriod(issue.closedAt, period)) return 'done'
  if (inPeriod(issue.startedAt, period)) return 'started'
  if (inPeriod(issue.createdAt, period)) return 'created'
  return 'touched'
}

/** 칸 안의 정렬 기준 시각 — 그 칸이 말하는 사건 */
function bucketTime(issue: ReportIssue, bucket: Bucket): number {
  switch (bucket) {
    case 'done': return issue.closedAt ?? issue.updatedAt
    case 'started': return issue.startedAt ?? issue.updatedAt
    case 'created': return issue.createdAt
    case 'touched': return issue.updatedAt
  }
}

type Turn = ReportConversation['turns'][number]

/** 기간 안에서 만든(보낸) 턴 */
export function turnsIn(turns: readonly Turn[], period: Period): Turn[] {
  return turns.filter((t) => inPeriod(t.createdAt, period))
}

/**
 * agent 실행 시간(초) — 기간 안에서 **시작한** 턴들의 `endedAt − startedAt` 합(FR-9). 끝나지 않은 턴과 시작하지 못한
 * 턴은 0이다. 사람이 일한 시간이 아니다.
 */
export function runSeconds(turns: readonly Turn[], period: Period): number {
  let ms = 0
  for (const t of turns) {
    if (!inPeriod(t.startedAt, period) || t.endedAt === null) continue
    ms += Math.max(0, t.endedAt - t.startedAt)
  }
  return ms / 1000
}

/** 대화 한 줄에 붙는 수 — 기간 안의 턴 수와 실행 시간 */
export interface ConversationLine {
  conversation: ReportConversation
  turns: number
  seconds: number
  /** 기간 안의 마지막 활동 — 정렬과 요일 칸에 쓴다 */
  lastAt: number
}

export function conversationLine(conversation: ReportConversation, period: Period): ConversationLine {
  const inside = turnsIn(conversation.turns, period)
  const times = conversation.turns.flatMap((t) => [t.createdAt, t.startedAt, t.endedAt])
    .filter((at): at is number => inPeriod(at, period))
  return {
    conversation,
    turns: inside.length,
    seconds: runSeconds(conversation.turns, period),
    lastAt: times.length > 0 ? Math.max(...times) : period.since
  }
}

export interface IssueLine {
  issue: ReportIssue
  bucket: Bucket
  /** 그 칸이 말하는 사건의 시각 */
  at: number
  /** 이 이슈에 할당된, 기간과 겹친 대화 — 최근 활동순 */
  conversations: ConversationLine[]
}

export interface WorkspaceTotals {
  /** `createdAt`이 기간 안인 이슈 수 — 칸과 다른 질문이다(완료된 새 이슈는 완료 칸에 있다, FR-7) */
  created: number
  done: number
  /** 지금 doing이고 기간 안에 손댄 수 — 기간 끝 시점이 아니라 지금이다(spec §6의 2) */
  doing: number
  conversations: number
  seconds: number
}

export interface WorkspaceView {
  id: string
  name: string
  buckets: Record<Bucket, IssueLine[]>
  /** 이슈가 없거나, 할당된 이슈가 이 리포트에 없는 대화(FR-8) — 최근 활동순 */
  loose: ConversationLine[]
  memos: ReportMemo[]
  totals: WorkspaceTotals
}

const byLatest = <T extends { lastAt: number }>(a: T, b: T) => b.lastAt - a.lastAt

export function projectWorkspace(ws: ReportWorkspace, period: Period): WorkspaceView {
  const lines = ws.conversations.map((c) => conversationLine(c, period))
  const issueIds = new Set(ws.issues.map((i) => i.id))
  const byIssue = new Map<string, ConversationLine[]>()
  const loose: ConversationLine[] = []
  for (const line of lines) {
    const id = line.conversation.issueId
    if (id !== null && issueIds.has(id)) {
      const list = byIssue.get(id) ?? []
      list.push(line)
      byIssue.set(id, list)
    } else {
      loose.push(line)
    }
  }

  const buckets: Record<Bucket, IssueLine[]> = { done: [], started: [], created: [], touched: [] }
  for (const issue of ws.issues) {
    const bucket = classify(issue, period)
    buckets[bucket].push({
      issue, bucket, at: bucketTime(issue, bucket),
      conversations: (byIssue.get(issue.id) ?? []).sort(byLatest)
    })
  }
  for (const list of Object.values(buckets)) list.sort((a, b) => b.at - a.at)

  return {
    id: ws.id,
    name: ws.name,
    buckets,
    loose: loose.sort(byLatest),
    memos: [...ws.memos].sort((a, b) => b.updatedAt - a.updatedAt),
    totals: {
      created: ws.issues.filter((i) => inPeriod(i.createdAt, period)).length,
      done: buckets.done.length,
      doing: ws.issues.filter((i) => i.status === 'doing').length,
      conversations: lines.length,
      seconds: lines.reduce((sum, l) => sum + l.seconds, 0)
    }
  }
}

export interface ReportView {
  period: Period
  workspaces: WorkspaceView[]
  totals: WorkspaceTotals
}

export function projectReport(data: ReportData): ReportView {
  const period = { since: data.since, until: data.until }
  const workspaces = data.workspaces.map((w) => projectWorkspace(w, period))
  const totals = workspaces.reduce<WorkspaceTotals>((acc, w) => ({
    created: acc.created + w.totals.created,
    done: acc.done + w.totals.done,
    doing: acc.doing + w.totals.doing,
    conversations: acc.conversations + w.totals.conversations,
    seconds: acc.seconds + w.totals.seconds
  }), { created: 0, done: 0, doing: 0, conversations: 0, seconds: 0 })
  return { period, workspaces, totals }
}

/** 리포트에 아무것도 없는가 — 빈 상태(FR-20) */
export function isEmptyReport(data: ReportData): boolean {
  return data.workspaces.every((w) => w.issues.length === 0 && w.memos.length === 0 && w.conversations.length === 0)
}
