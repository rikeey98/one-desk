import type { ReportConversation, ReportIssue } from '@shared/models'
import { addDays, dayCount, startOfWeek, type Period } from './period'
import { inPeriod } from './project'

/**
 * 이슈 흐름 보기의 한 줄 (`docs/sdlc/period-report/` FR-11). 위치는 전부 기간 대비 0~1 비율이다.
 */

export function ratio(at: number, period: Period): number {
  const span = period.until - period.since
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (at - period.since) / span))
}

export interface Tick {
  at: number
  ratio: number
}

/** 축 눈금 — 14일까지는 날마다, 그보다 길면 월요일마다 */
export function ticksOf(period: Period): Tick[] {
  const out: Tick[] = []
  if (dayCount(period) <= 14) {
    for (let d = period.since; d < period.until; d = addDays(d, 1)) out.push({ at: d, ratio: ratio(d, period) })
    return out
  }
  let monday = startOfWeek(period.since)
  if (monday < period.since) monday = addDays(monday, 7)
  for (let d = monday; d < period.until; d = addDays(d, 7)) out.push({ at: d, ratio: ratio(d, period) })
  return out
}

export interface IssueTrack {
  created: number | null
  started: number | null
  done: number | null
  /** 시작~완료(또는 기간 끝) 막대. 시작한 적이 없으면 null */
  bar: { from: number; to: number; done: boolean; clippedStart: boolean; clippedEnd: boolean } | null
  /** 기간 안에 보낸 턴마다 점 하나 */
  dots: number[]
}

/**
 * `now`가 기간 안이면 끝나지 않은 막대는 지금에서 멈춘다 — 이번 주 보기의 끝(다음 월요일)까지 그리면 아직 오지 않은
 * 날까지 진행 중인 것처럼 보인다.
 */
export function issueTrack(
  issue: ReportIssue, conversations: readonly ReportConversation[], period: Period, now: number = period.until
): IssueTrack {
  const done = issue.status === 'done' && inPeriod(issue.closedAt, period)
  let bar: IssueTrack['bar'] = null
  const start = issue.startedAt
  // 기간 끝 이후에 시작했거나, 기간 시작 전에 끝난 막대는 이 축에 없다
  const endedBefore = issue.status === 'done' && issue.closedAt !== null && issue.closedAt < period.since
  if (start !== null && start < period.until && !endedBefore) {
    const end = done ? issue.closedAt! : null
    bar = {
      from: ratio(start, period),
      to: end === null ? ratio(Math.min(now, period.until), period) : ratio(end, period),
      done,
      clippedStart: start < period.since,
      clippedEnd: end === null
    }
  }
  const dots = conversations
    .flatMap((c) => c.turns)
    .filter((t) => inPeriod(t.createdAt, period))
    .map((t) => ratio(t.createdAt, period))
    .sort((a, b) => a - b)
  return {
    created: inPeriod(issue.createdAt, period) ? ratio(issue.createdAt, period) : null,
    started: inPeriod(issue.startedAt, period) ? ratio(issue.startedAt, period) : null,
    done: done ? ratio(issue.closedAt!, period) : null,
    bar,
    dots
  }
}

/** 이슈 흐름의 줄 순서 — 완료 → 진행 중 → 나머지, 각 안에서 마지막 사건 최신순 (FR-18) */
export function flowOrder(issues: readonly ReportIssue[], period: Period): ReportIssue[] {
  const rank = (i: ReportIssue) => (i.status === 'done' && inPeriod(i.closedAt, period) ? 0 : i.status === 'doing' ? 1 : 2)
  const last = (i: ReportIssue) => Math.max(
    ...[i.createdAt, i.startedAt, i.closedAt, i.updatedAt].filter((t): t is number => inPeriod(t, period)), 0
  )
  return [...issues].sort((a, b) => rank(a) - rank(b) || last(b) - last(a))
}
