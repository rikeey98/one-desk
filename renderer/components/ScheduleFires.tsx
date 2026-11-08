import { useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { RUN_STATUS_LABELS } from '../runStatus'
import { CAUSE_LABELS, dayTimeLabel, fireLabel } from '../schedules/labels'
import type { ScheduleFireView } from '@shared/models'

/**
 * 정기 실행의 실행 기록 (`docs/sdlc/scheduled-runs/` spec FR-32), 최신 순. `version`이 바뀌면(마지막 기록·그 run의 상태) 다시 읽는다.
 */
export function ScheduleFires({ scheduleId, version, now, onOpenConversation }: {
  scheduleId: string
  version: string
  now: number
  onOpenConversation: (conversationId: string) => void
}) {
  const client = useClient()
  const [fires, setFires] = useState<ScheduleFireView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    client.schedules.fires(scheduleId).then(
      (rows) => { if (alive) { setFires(rows); setError(null) } },
      (err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) }
    )
    return () => { alive = false }
  }, [client, scheduleId, version, attempt])

  return (
    <section className="schedule-fires" aria-label="실행 기록">
      <h3>실행 기록</h3>
      {error && (
        <div role="alert" className="form-error report-error">
          기록을 읽지 못했습니다: {error}
          <button type="button" className="report-btn" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      {fires && fires.length === 0 && <p className="schedule-muted">아직 돈 적이 없습니다.</p>}
      {fires && fires.length > 0 && (
        <ul>
          {fires.map((f) => {
            const text = fireLabel(f)
            return (
              <li key={f.id} className={`schedule-fire schedule-fire-${f.outcome}`}>
                <span className="schedule-fire-when">{dayTimeLabel(f.slotAt ?? f.firedAt, now)}</span>
                <span className="schedule-fire-cause">{CAUSE_LABELS[f.cause]}</span>
                {f.runStatus && (
                  <span className={`status status-${f.runStatus}`}>
                    {f.needsAnswer ? '답변 필요' : RUN_STATUS_LABELS[f.runStatus]}
                  </span>
                )}
                {text && <span className="schedule-fire-text">{text}</span>}
                {f.droppedContext > 0 && (
                  <span className="schedule-muted">지워진 맥락 {f.droppedContext}개는 빠졌습니다</span>
                )}
                {f.conversationId && (
                  <button type="button" className="report-btn" onClick={() => onOpenConversation(f.conversationId!)}>
                    대화 열기
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
