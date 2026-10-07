import { useState } from 'react'
import type { ReportWorkspace } from '@shared/models'
import { daysOf, eventsByDay, type DayEvent } from '../report/days'
import { conversationLine, type ReportView } from '../report/project'
import { dayLabel, durationLabel, oneLine, weekdayOf } from '../report/format'
import type { Period } from '../report/period'
import { RUN_STATUS_LABELS } from '../runStatus'
import { IconChat, IconCheck, IconCircle, IconPlay } from './icons'

/** 칸 하나에 펼치지 않고 보이는 사건 수 (FR-17) */
const CELL_LIMIT = 4

const KIND_LABELS: Record<DayEvent['kind'], string> = {
  created: '만듦', started: '시작', done: '완료', conversation: '대화'
}

function EventIcon({ kind }: { kind: DayEvent['kind'] }) {
  switch (kind) {
    case 'created': return <IconCircle />
    case 'started': return <IconPlay />
    case 'done': return <IconCheck />
    case 'conversation': return <IconChat />
  }
}

const time = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * 요일 보기 (`docs/sdlc/period-report/` FR-17, 시안 안 B) — workspace가 줄, 날이 칸. 사건을 누르면 오른쪽 곁 칸에 자세히.
 */
export function ReportDays({ view, workspaces, now, onOpenIssue, onOpenConversation }: {
  view: ReportView
  workspaces: ReportWorkspace[]
  now: number
  onOpenIssue: (workspaceId: string, issueId: string) => void
  onOpenConversation: (workspaceId: string, conversationId: string) => void
}) {
  const period = view.period
  const days = daysOf(period, now)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [picked, setPicked] = useState<{ wsId: string; event: DayEvent } | null>(null)

  const columns = `150px repeat(${days.length}, minmax(${days.length > 14 ? '120px' : '0'}, 1fr))`

  return (
    <div className="report-days-view">
      <div className="report-board" role="table" aria-label="요일 보드">
        <div className="report-board-grid" style={{ gridTemplateColumns: columns }}>
          <div className="report-board-corner" role="columnheader" aria-label="workspace" />
          {days.map((d) => (
            <div key={d.start} role="columnheader" className={d.isToday ? 'report-board-colh report-board-today' : 'report-board-colh'}>
              <span>{weekdayOf(d.start)}</span>
              <span className="report-num">{new Date(d.start).getDate()}</span>
            </div>
          ))}

          {workspaces.map((ws) => {
            const wsView = view.workspaces.find((w) => w.id === ws.id)!
            const perDay = eventsByDay(ws, period, days)
            return [
              <div key={`${ws.id}:h`} role="rowheader" className="report-board-rowh">
                <strong>{ws.name}</strong>
                <span className="report-muted report-num">
                  새 {wsView.totals.created} · 완료 {wsView.totals.done} · 대화 {wsView.totals.conversations}
                </span>
              </div>,
              ...perDay.map((events, i) => {
                const cellKey = `${ws.id}:${i}`
                const open = expanded.has(cellKey)
                const shown = open ? events : events.slice(0, CELL_LIMIT)
                const rest = events.length - shown.length
                return (
                  <div key={cellKey} role="cell" className="report-board-cell">
                    {shown.map((e) => {
                      const on = picked?.event.key === e.key && picked.wsId === ws.id
                      return (
                        <button
                          key={e.key}
                          type="button"
                          className={`report-ev report-ev-${e.kind}${on ? ' report-ev-on' : ''}`}
                          aria-label={`${KIND_LABELS[e.kind]} · ${oneLine(e.title)}`}
                          aria-pressed={on}
                          title={`${KIND_LABELS[e.kind]} · ${oneLine(e.title)} · ${time(e.at)}`}
                          onClick={() => setPicked(on ? null : { wsId: ws.id, event: e })}
                        >
                          <EventIcon kind={e.kind} />
                          <span>{oneLine(e.title)}</span>
                        </button>
                      )
                    })}
                    {rest > 0 && (
                      <button
                        type="button"
                        className="report-ev-more"
                        onClick={() => setExpanded((prev) => new Set(prev).add(cellKey))}
                      >
                        +{rest}
                      </button>
                    )}
                  </div>
                )
              })
            ]
          })}
        </div>
      </div>

      <aside className="report-side" aria-label="고른 사건">
        {picked
          ? <PickedDetail
              ws={workspaces.find((w) => w.id === picked.wsId)!}
              event={picked.event}
              period={period}
              onOpenIssue={onOpenIssue}
              onOpenConversation={onOpenConversation}
            />
          : <p className="report-muted">칸 안의 사건을 누르면 여기에 자세히 보입니다.</p>}
      </aside>
    </div>
  )
}

function PickedDetail({ ws, event, period, onOpenIssue, onOpenConversation }: {
  ws: ReportWorkspace
  event: DayEvent
  period: Period
  onOpenIssue: (workspaceId: string, issueId: string) => void
  onOpenConversation: (workspaceId: string, conversationId: string) => void
}) {
  if (event.kind === 'conversation') {
    const conv = ws.conversations.find((c) => c.id === event.conversationId)
    if (!conv) return null
    const line = conversationLine(conv, period)
    return (
      <>
        <span className={conv.needsAnswer ? 'status report-status-warn' : `status status-${conv.status}`}>
          {conv.needsAnswer ? '답변 필요' : RUN_STATUS_LABELS[conv.status]}
        </span>
        <h4>{oneLine(conv.title)}</h4>
        <dl className="report-kv">
          <dt>workspace</dt><dd>{ws.name}</dd>
          <dt>이 기간</dt><dd>{line.turns}턴 · {durationLabel(line.seconds)}</dd>
          <dt>그날</dt><dd>{dayLabel(event.at)} {event.turns}턴</dd>
          {conv.issueTitle && <><dt>이슈</dt><dd>{oneLine(conv.issueTitle)}</dd></>}
        </dl>
        {conv.lastAnswer && <p className="report-answer">{oneLine(conv.lastAnswer)}</p>}
        <button type="button" className="report-btn" onClick={() => onOpenConversation(ws.id, conv.id)}>대화 열기</button>
      </>
    )
  }
  const issue = ws.issues.find((i) => i.id === event.issueId)
  if (!issue) return null
  const convs = ws.conversations.filter((c) => c.issueId === issue.id).map((c) => conversationLine(c, period))
  const stamp = (at: number | null) => (at === null ? '—' : `${dayLabel(at)} ${time(at)}`)
  return (
    <>
      <span className={`status status-${issue.status}`}>{issue.status}</span>
      <h4>{oneLine(issue.title)}</h4>
      <dl className="report-kv">
        <dt>workspace</dt><dd>{ws.name}</dd>
        <dt>만듦</dt><dd>{stamp(issue.createdAt)}</dd>
        <dt>시작</dt><dd>{stamp(issue.startedAt)}</dd>
        <dt>완료</dt><dd>{stamp(issue.closedAt)}</dd>
      </dl>
      {convs.length > 0 && (
        <>
          <h5>이 기간의 대화 <span className="group-count">{convs.length}</span></h5>
          <ul className="report-side-list">
            {convs.map((l) => (
              <li key={l.conversation.id}>
                <button type="button" className="report-line" onClick={() => onOpenConversation(ws.id, l.conversation.id)}>
                  <span className="report-line-title">{oneLine(l.conversation.title)}</span>
                  <span className="report-line-when">{durationLabel(l.seconds)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="report-btn" onClick={() => onOpenIssue(ws.id, issue.id)}>이슈 열기</button>
    </>
  )
}
