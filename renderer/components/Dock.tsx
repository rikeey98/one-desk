import { useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useRunEvents } from '../hooks/useRunEvents'
import { RunLog } from './RunLog'
import type { Run } from '@shared/models'

function label(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || '(빈 지시)'
}

export function Dock({ runs, error }: { runs: Run[]; error: string | null }) {
  const client = useClient()
  const [open, setOpen] = useState(true)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 고른 적이 없으면 가장 최근 run을 보여준다. 새 run이 시작되면 그쪽으로 따라간다.
  const selected = runs.find((r) => r.id === pickedId) ?? runs[0] ?? null
  const { events, error: logError } = useRunEvents(selected?.id ?? null)
  const shown = actionError ?? error ?? logError

  async function cancel(runId: string) {
    setActionError(null)
    try {
      await client.runs.cancel(runId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className={open ? 'dock dock-open' : 'dock'}>
      <header className="dock-tabs">
        <button type="button" className="dock-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▴'} 실행
        </button>
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className={run.id === selected?.id ? 'dock-tab dock-tab-selected' : 'dock-tab'}
            onClick={() => { setPickedId(run.id); setOpen(true) }}
          >
            <span className={`status status-${run.status}`}>{run.status}</span>
            {label(run)}
          </button>
        ))}
        {runs.length === 0 && <span className="dock-empty">실행 기록이 없습니다</span>}
        {selected?.status === 'running' && (
          <button type="button" className="dock-cancel" onClick={() => cancel(selected.id)}>
            취소
          </button>
        )}
      </header>
      {open && (
        <div className="dock-body">
          {shown && <div role="alert" className="form-error">{shown}</div>}
          {selected?.errorMessage && <div role="alert" className="form-error">{selected.errorMessage}</div>}
          {selected ? <RunLog events={events} /> : <div className="panel-empty">실행을 시작하면 여기에 로그가 흐릅니다</div>}
        </div>
      )}
    </section>
  )
}
