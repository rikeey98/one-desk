import type { ReportWorkspace } from '@shared/models'
import { BUCKETS, type ConversationLine, type ReportView } from '../report/project'
import { countsByDay, daysOf } from '../report/days'
import { STATE_NOTE, reportTitle, type Include } from '../report/markdown'
import { dayLabel, durationLabel, oneLine, periodLabel, weekdayOf } from '../report/format'
import { RUN_STATUS_LABELS } from '../runStatus'

/** 대화 줄의 상태 — 답변 필요가 실패·완료보다 먼저 보인다(인박스와 같은 순서) */
function ConversationStatus({ line }: { line: ConversationLine }) {
  const c = line.conversation
  if (c.needsAnswer) return <span className="status report-status-warn">답변 필요</span>
  return <span className={`status status-${c.status}`}>{RUN_STATUS_LABELS[c.status]}</span>
}

function conversationMeta(line: ConversationLine): string {
  const bits = [`${line.turns}턴`]
  if (line.seconds > 0) bits.push(durationLabel(line.seconds))
  return bits.join(' · ')
}

/**
 * 문서 보기 (`docs/sdlc/period-report/` FR-16, 시안 안 A). 내보낼 마크다운과 같은 순서로 그린다 — 보이는 것이 곧 복사되는
 * 것이다. 줄을 누르면 그 이슈·대화로 간다.
 */
export function ReportDocument({ view, workspaces, include, now, onOpenIssue, onOpenConversation }: {
  view: ReportView
  /** 하루 막대가 쓰는 원본 — view와 같은 workspace만 */
  workspaces: ReportWorkspace[]
  include: Include
  now: number
  onOpenIssue: (workspaceId: string, issueId: string) => void
  onOpenConversation: (workspaceId: string, conversationId: string) => void
}) {
  const { period, totals } = view
  const days = daysOf(period, now)
  const counts = countsByDay(workspaces, period, days)
  const peak = Math.max(1, ...counts.map((c) => c.created + c.done + c.conversations))
  const BAR_PX = 40

  function convRow(wsId: string, line: ConversationLine, nested: boolean) {
    const c = line.conversation
    const side = !nested && c.issueTitle ? c.issueTitle : null
    return (
      <li key={c.id} className="report-line-item">
        <button
          type="button"
          className={nested ? 'report-line report-line-conv' : 'report-line'}
          onClick={() => onOpenConversation(wsId, c.id)}
        >
          <ConversationStatus line={line} />
          <span className="report-line-title">{oneLine(c.title)}</span>
          {side && <span className="report-line-side">이슈 · {oneLine(side)}</span>}
          <span className="report-line-when">{conversationMeta(line)}</span>
        </button>
        {include.answers && c.lastAnswer && (
          <p className="report-answer">{oneLine(c.lastAnswer)}</p>
        )}
      </li>
    )
  }

  return (
    <article className="report-doc" aria-label="리포트 문서">
      <header className="report-doc-head">
        <h2>{reportTitle(view.period)}</h2>
        <p className="report-doc-sub">{periodLabel(period)} · {workspaces.map((w) => w.name).join(', ')}</p>
      </header>

      <dl className="report-tally">
        {include.issues && (
          <>
            <div><dt>새 이슈</dt><dd>{totals.created}</dd></div>
            <div><dt>완료</dt><dd>{totals.done}</dd></div>
            <div><dt>진행 중</dt><dd>{totals.doing}</dd></div>
          </>
        )}
        {include.conversations && (
          <>
            <div><dt>대화</dt><dd>{totals.conversations}</dd></div>
            <div><dt>agent 실행</dt><dd>{durationLabel(totals.seconds)}</dd></div>
          </>
        )}
      </dl>

      <figure className="report-days" aria-label="날마다 새 이슈·완료·대화">
        <div className="report-days-bars" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d, i) => {
            const c = counts[i]!
            const label = `${dayLabel(d.start)} 새 이슈 ${c.created} · 완료 ${c.done} · 대화 ${c.conversations}`
            const px = (n: number) => `${Math.round((n / peak) * BAR_PX)}px`
            return (
              <div key={d.start} className={d.isToday ? 'report-day report-day-today' : 'report-day'} title={label}>
                <div className="report-day-stack" style={{ height: `${BAR_PX}px` }}>
                  {c.conversations > 0 && <i className="report-bar-conv" style={{ height: px(c.conversations) }} />}
                  {c.done > 0 && <i className="report-bar-done" style={{ height: px(c.done) }} />}
                  {c.created > 0 && <i className="report-bar-new" style={{ height: px(c.created) }} />}
                </div>
                <span className="report-day-label">
                  {days.length <= 14 ? `${weekdayOf(d.start)} ${new Date(d.start).getDate()}` : new Date(d.start).getDate()}
                </span>
              </div>
            )
          })}
        </div>
        <figcaption className="report-legend">
          <span><i className="report-bar-new" />새 이슈</span>
          <span><i className="report-bar-done" />완료</span>
          <span><i className="report-bar-conv" />대화</span>
        </figcaption>
      </figure>

      {view.workspaces.map((ws) => {
        const issueRows = include.issues ? BUCKETS.filter((b) => ws.buckets[b.id].length > 0) : []
        const loose = include.conversations
          ? (include.issues ? ws.loose : [...ws.loose, ...Object.values(ws.buckets).flat().flatMap((l) => l.conversations)])
          : []
        const memos = include.memos ? ws.memos : []
        if (issueRows.length === 0 && loose.length === 0 && memos.length === 0) return null
        return (
          <section key={ws.id} className="report-ws-section" aria-label={`${ws.name} 리포트`}>
            <h3>
              {ws.name}
              <span className="report-ws-sum">
                새 {ws.totals.created} · 완료 {ws.totals.done} · 대화 {ws.totals.conversations}
              </span>
            </h3>
            {issueRows.map(({ id, label }) => (
              <div key={id} className="report-group">
                <h4>{label} <span className="group-count">{ws.buckets[id].length}</span></h4>
                <ul>
                  {ws.buckets[id].map((line) => (
                    <li key={line.issue.id} className="report-line-item">
                      <button type="button" className="report-line" onClick={() => onOpenIssue(ws.id, line.issue.id)}>
                        <span className={`status status-${line.issue.status}`}>{line.issue.status}</span>
                        <span className="report-line-title">{oneLine(line.issue.title)}</span>
                        <span className="report-line-when">{dayLabel(line.at)}</span>
                      </button>
                      {include.conversations && line.conversations.length > 0 && (
                        <ul className="report-convs">{line.conversations.map((c) => convRow(ws.id, c, true))}</ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {loose.length > 0 && (
              <div className="report-group">
                <h4>{include.issues ? '이슈 없는 대화' : '대화'} <span className="group-count">{loose.length}</span></h4>
                <ul>{loose.map((c) => convRow(ws.id, c, false))}</ul>
              </div>
            )}
            {memos.length > 0 && (
              <div className="report-group">
                <h4>메모 <span className="group-count">{memos.length}</span></h4>
                <ul>
                  {memos.map((m) => (
                    <li key={m.id} className="report-line-item">
                      <div className="report-line report-line-static">
                        <span className="report-line-title">{oneLine(m.title)}</span>
                        <span className="report-line-when">{dayLabel(m.updatedAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )
      })}

      <p className="report-note">{STATE_NOTE}</p>
    </article>
  )
}
