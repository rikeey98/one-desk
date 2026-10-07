import type { ReportWorkspace } from '@shared/models'
import { flowOrder, issueTrack, ratio, ticksOf, type IssueTrack } from '../report/track'
import { conversationLine, inPeriod, type ReportView } from '../report/project'
import { dayCount, type Period } from '../report/period'
import { dayLabel, durationLabel, oneLine, weekdayOf } from '../report/format'
import { IconCheck, IconPlay } from './icons'

const pct = (r: number) => `${(r * 100).toFixed(2)}%`

function Track({ track, ticks, label }: { track: IssueTrack; ticks: number[]; label: string }) {
  const bar = track.bar
  return (
    <div className="report-track" role="img" aria-label={label}>
      {ticks.map((r) => <i key={r} className="report-track-tick" style={{ left: pct(r) }} />)}
      {bar && (
        <span
          className={[
            'report-track-bar', bar.done && 'report-track-bar-done',
            bar.clippedStart && 'report-track-clip-start', bar.clippedEnd && 'report-track-clip-end'
          ].filter(Boolean).join(' ')}
          style={{ left: pct(bar.from), width: pct(Math.max(0, bar.to - bar.from)) }}
        />
      )}
      {track.dots.map((r, i) => <i key={`d${i}`} className="report-track-dot" style={{ left: pct(r) }} />)}
      {track.created !== null && <span className="report-mark report-mark-new" style={{ left: pct(track.created) }} />}
      {track.started !== null && (
        <span className="report-mark report-mark-start" style={{ left: pct(track.started) }}><IconPlay /></span>
      )}
      {track.done !== null && (
        <span className="report-mark report-mark-done" style={{ left: pct(track.done) }}><IconCheck /></span>
      )}
    </div>
  )
}

function trackLabel(t: IssueTrack, period: Period): string {
  const at = (r: number) => dayLabel(period.since + r * (period.until - period.since))
  const parts: string[] = []
  if (t.created !== null) parts.push(`만듦 ${at(t.created)}`)
  if (t.bar?.clippedStart) parts.push('기간 전에 시작')
  if (t.started !== null) parts.push(`시작 ${at(t.started)}`)
  if (t.done !== null) parts.push(`완료 ${at(t.done)}`)
  if (t.dots.length > 0) parts.push(`대화 턴 ${t.dots.length}`)
  return parts.join(', ') || '이 기간의 사건 없음'
}

/**
 * 이슈 흐름 보기 (`docs/sdlc/period-report/` FR-18, 시안 안 C). 이슈마다 기간 축 위에 만듦·시작·완료와 대화 턴을 찍는다.
 */
export function ReportFlow({ view, workspaces, now, onOpenIssue, onOpenConversation }: {
  view: ReportView
  now: number
  workspaces: ReportWorkspace[]
  onOpenIssue: (workspaceId: string, issueId: string) => void
  onOpenConversation: (workspaceId: string, conversationId: string) => void
}) {
  const period = view.period
  const ticks = ticksOf(period)
  const tickRatios = ticks.map((t) => t.ratio)
  const daily = dayCount(period) <= 14

  return (
    <div className="report-flow">
      <div className="report-flow-axis report-flow-row" aria-hidden="true">
        <span>이슈</span>
        <div className="report-flow-ticks">
          {ticks.map((t) => (
            <span key={t.at} style={{ left: pct(t.ratio) }}>
              {daily ? `${weekdayOf(t.at)} ${new Date(t.at).getDate()}` : dayLabel(t.at)}
            </span>
          ))}
        </div>
        <span className="report-flow-conv">대화</span>
      </div>

      {workspaces.map((ws) => {
        const loose = view.workspaces.find((w) => w.id === ws.id)!.loose
        const issues = flowOrder(ws.issues, period)
        if (issues.length === 0 && loose.length === 0) return null
        return (
          <section key={ws.id} aria-label={`${ws.name} 흐름`}>
            <h3 className="report-flow-ws">{ws.name} <span className="group-count">{issues.length}</span></h3>
            <ul>
              {issues.map((issue) => {
                const convs = ws.conversations.filter((c) => c.issueId === issue.id)
                const track = issueTrack(issue, convs, period, now)
                const lines = convs.map((c) => conversationLine(c, period))
                const seconds = lines.reduce((s, l) => s + l.seconds, 0)
                return (
                  <li key={issue.id}>
                    <button type="button" className="report-flow-row report-flow-line" onClick={() => onOpenIssue(ws.id, issue.id)}>
                      <span className="report-flow-title">
                        <span className={`status status-${issue.status}`}>{issue.status}</span>
                        <span className="report-line-title">{oneLine(issue.title)}</span>
                      </span>
                      <Track track={track} ticks={tickRatios} label={trackLabel(track, period)} />
                      <span className="report-flow-conv">
                        {convs.length === 0 ? <span className="report-muted">대화 없음</span> : <><b>{convs.length}</b> · {durationLabel(seconds)}</>}
                      </span>
                    </button>
                  </li>
                )
              })}
              {loose.length > 0 && (
                <li>
                  <div className="report-flow-row report-flow-line report-flow-loose">
                    <span className="report-flow-title"><span className="report-line-title report-muted">이슈 없는 대화</span></span>
                    <div className="report-track" role="img" aria-label={`이슈 없는 대화 ${loose.length}개`}>
                      {tickRatios.map((r) => <i key={r} className="report-track-tick" style={{ left: pct(r) }} />)}
                      {loose.flatMap((l) => l.conversation.turns
                        .filter((t) => inPeriod(t.createdAt, period))
                        .map((t, i) => (
                          <button
                            key={`${l.conversation.id}:${i}`}
                            type="button"
                            className="report-track-dot report-track-dot-button"
                            style={{ left: pct(ratio(t.createdAt, period)) }}
                            aria-label={`${oneLine(l.conversation.title)} 열기`}
                            title={oneLine(l.conversation.title)}
                            onClick={() => onOpenConversation(ws.id, l.conversation.id)}
                          />
                        )))}
                    </div>
                    <span className="report-flow-conv">
                      <b>{loose.length}</b> · {durationLabel(loose.reduce((s, l) => s + l.seconds, 0))}
                    </span>
                  </div>
                </li>
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
