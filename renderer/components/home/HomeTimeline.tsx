import type { HomeTimelineRow } from '@shared/models'
import { RUN_STATUS_LABELS } from '../../runStatus'
import { barBox, barTitle, ticksOf } from '../../home/timeline'

/**
 * 오늘 타임라인 (`docs/sdlc/home/` FR-5) — workspace마다 한 줄, 오늘의 대화를 시간 위에 막대로. 리포트의 요일 보드를 하루로 줄인
 * 것이다. 막대 색은 `.status-<enum>` 토큰, 답변 필요는 따로, 지금은 `--danger` 선. 1280px 아래에서는 `HomePanel`이 아예 그리지
 * 않는다(FR-13).
 */
export function HomeTimeline({
  rows, dayStart, now
}: {
  rows: HomeTimelineRow[]
  dayStart: number
  now: number
}) {
  const ticks = ticksOf(dayStart, now)
  const nowAt = Math.min(1, Math.max(0, (now - dayStart) / Math.max(1, now - dayStart)))
  return (
    <section className="home-card home-timeline" aria-labelledby="home-timeline-head">
      <header className="home-card-head">
        <h2 id="home-timeline-head">오늘 타임라인</h2>
        <span className="home-card-meta">자정부터 지금까지</span>
      </header>
      <div className="home-tl">
        <div className="home-tl-ticks" aria-hidden="true">
          {ticks.map((t) => <span key={t.label} style={{ left: `${t.at * 100}%` }}>{t.label}</span>)}
        </div>
        {rows.map((row) => (
          <div key={row.workspaceId} className="home-tl-row">
            <span className="home-tl-name">{row.name}</span>
            <div className="home-tl-track">
              {row.bars.map((bar) => {
                const box = barBox(bar, dayStart, now)
                const cls = bar.needsAnswer ? 'home-tl-bar status-needs-answer' : `home-tl-bar status-${bar.status}`
                return (
                  <span
                    key={bar.conversationId}
                    className={cls}
                    style={{ left: `${box.left * 100}%`, width: `${box.width * 100}%` }}
                    title={barTitle(bar, bar.needsAnswer ? '답변 필요' : RUN_STATUS_LABELS[bar.status])}
                  />
                )
              })}
              <span className="home-tl-now" style={{ left: `${nowAt * 100}%` }} aria-hidden="true" />
            </div>
          </div>
        ))}
        {rows.every((r) => r.bars.length === 0) && <p className="home-empty">오늘은 아직 대화가 없습니다</p>}
      </div>
    </section>
  )
}
