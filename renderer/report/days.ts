import type { ReportWorkspace } from '@shared/models'
import { addDays, startOfDay, type Period } from './period'
import { inPeriod } from './project'

/**
 * 요일 보기의 칸 (`docs/sdlc/period-report/` FR-10). 날은 앱 시간대로 가른다.
 */

export interface Day {
  start: number
  end: number
  isToday: boolean
}

export function daysOf(period: Period, now: number): Day[] {
  const today = startOfDay(now)
  const out: Day[] = []
  for (let d = period.since; d < period.until; d = addDays(d, 1)) {
    out.push({ start: d, end: addDays(d, 1), isToday: d === today })
  }
  return out
}

export type DayEvent =
  | { kind: 'created' | 'started' | 'done'; key: string; at: number; issueId: string; title: string }
  | { kind: 'conversation'; key: string; at: number; conversationId: string; title: string; turns: number; seconds: number }

/**
 * 한 workspace의 사건을 날마다 편다. 이슈는 만듦·시작·완료(그 시각이 기간 안일 때, 완료는 지금 done일 때만 —
 * 문서 보기의 칸과 같은 판정), 대화는 **그날 보낸 턴이 있는 날마다** 한 번(그날의 턴 수와 시간). 칸 안은 시각순.
 */
export function eventsByDay(ws: ReportWorkspace, period: Period, days: readonly Day[]): DayEvent[][] {
  const out: DayEvent[][] = days.map(() => [])
  const indexOf = (at: number) => days.findIndex((d) => at >= d.start && at < d.end)
  const put = (event: DayEvent) => {
    const i = indexOf(event.at)
    if (i >= 0) out[i]!.push(event)
  }

  for (const issue of ws.issues) {
    if (inPeriod(issue.createdAt, period)) {
      put({ kind: 'created', key: `c:${issue.id}`, at: issue.createdAt, issueId: issue.id, title: issue.title })
    }
    if (inPeriod(issue.startedAt, period)) {
      put({ kind: 'started', key: `s:${issue.id}`, at: issue.startedAt, issueId: issue.id, title: issue.title })
    }
    if (issue.status === 'done' && inPeriod(issue.closedAt, period)) {
      put({ kind: 'done', key: `d:${issue.id}`, at: issue.closedAt, issueId: issue.id, title: issue.title })
    }
  }

  for (const conv of ws.conversations) {
    const perDay = new Map<number, { turns: number; ms: number; at: number }>()
    for (const t of conv.turns) {
      if (!inPeriod(t.createdAt, period)) continue
      const i = indexOf(t.createdAt)
      if (i < 0) continue
      const slot = perDay.get(i) ?? { turns: 0, ms: 0, at: t.createdAt }
      slot.turns += 1
      if (t.startedAt !== null && t.endedAt !== null) slot.ms += Math.max(0, t.endedAt - t.startedAt)
      slot.at = Math.min(slot.at, t.createdAt)
      perDay.set(i, slot)
    }
    for (const [i, slot] of perDay) {
      out[i]!.push({
        kind: 'conversation', key: `v:${conv.id}:${i}`, at: slot.at, conversationId: conv.id,
        title: conv.title, turns: slot.turns, seconds: slot.ms / 1000
      })
    }
  }

  for (const list of out) list.sort((a, b) => a.at - b.at)
  return out
}

/** 날마다 세 수 — 문서 보기의 하루 막대 (FR-16) */
export interface DayCounts {
  created: number
  done: number
  conversations: number
}

export function countsByDay(workspaces: readonly ReportWorkspace[], period: Period, days: readonly Day[]): DayCounts[] {
  const counts = days.map(() => ({ created: 0, done: 0, conversations: 0 }))
  for (const ws of workspaces) {
    eventsByDay(ws, period, days).forEach((events, i) => {
      for (const e of events) {
        if (e.kind === 'created') counts[i]!.created += 1
        else if (e.kind === 'done') counts[i]!.done += 1
        else if (e.kind === 'conversation') counts[i]!.conversations += 1
      }
    })
  }
  return counts
}
