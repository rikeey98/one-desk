import type { HomeRunning as Running } from '@shared/models'
import { formatDuration } from '../../timeline'
import { IconStop } from '../icons'

/**
 * 지금 돌고 있는 것 (`docs/sdlc/home/` FR-10) — 대화마다 한 줄, 경과·도구·마지막 텍스트는 요약의 스냅샷이다(홈은 run 이벤트
 * 스토어를 보지 않는다). `멈추기`는 그 대화의 running 턴을 겨눈다 — 도크의 세 멈추기와 같은 턴이고 예약은 건드리지 않는다.
 * 이름은 `<제목> 실행 멈추기`다(`실행` exact·도크의 셋과 부딪히지 않는다).
 */
export function HomeRunning({
  running, queued, slots, now, onOpen, onStop
}: {
  running: Running[]
  queued: number
  slots: { used: number; limit: number }
  now: number
  onOpen: (workspaceId: string, conversationId: string) => void
  onStop: (runId: string) => void
}) {
  return (
    <section className="home-card home-running" aria-labelledby="home-running-head">
      <header className="home-card-head">
        <h2 id="home-running-head">지금 돌고 있는 것</h2>
        <span className="home-card-meta">
          실행 슬롯 <span className="group-count">{slots.used}/{slots.limit}</span>
          {queued > 0 && <> · 대기 <span className="group-count">{queued}</span></>}
        </span>
      </header>
      {running.length === 0
        ? <p className="home-empty">돌고 있는 대화 없음</p>
        : (
          <ul className="home-rows">
            {running.map((r) => (
              <li key={r.runId} className="home-row">
                <span className="status-dot status-running" aria-label="실행 중" title="실행 중" />
                <div className="home-row-body">
                  <div className="home-row-title">{r.title}</div>
                  <div className="home-row-sub">
                    {r.currentTool && <span className="home-row-tool">{r.currentTool}</span>}
                    {r.lastText ? <span>{r.lastText}</span> : <span className="home-row-faint">진행 중</span>}
                  </div>
                  <div className="home-row-scope">
                    <span className="path-text">{r.repoName ? `${r.workspaceName} · ${r.repoName}` : r.workspaceName}</span>
                    <span>턴 {r.turns}</span>
                    {r.startedAt !== null && <span>{formatDuration(now - r.startedAt)}</span>}
                  </div>
                </div>
                <div className="home-row-actions">
                  <button type="button" onClick={() => onOpen(r.workspaceId, r.conversationId)}>대화 열기</button>
                  <button type="button" className="home-row-icon" aria-label={`${r.title} 실행 멈추기`} title="멈추기" onClick={() => onStop(r.runId)}>
                    <IconStop />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
