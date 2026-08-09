import { useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useRunEvents } from '../hooks/useRunEvents'
import { RunLog } from './RunLog'
import { RunPanel } from './RunPanel'
import type { ContextChip } from '../context'
import type { Run } from '@shared/models'

function label(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || '(빈 지시)'
}

export function Dock({ runs, error, workspaceId, chips, onRemoveChip, onRunStarted }: {
  runs: Run[]
  error: string | null
  workspaceId: string
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onRunStarted: (run: Run) => void
}) {
  const client = useClient()
  const [open, setOpen] = useState(true)
  // 실행 패널은 모달이 아니라 도크가 확장된 형태다 —
  // 모달이 뜨면 뒤의 issue/memo를 클릭해 맥락을 담을 수 없다 (설계 §9).
  const [view, setView] = useState<'log' | 'new'>('new')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 고른 적이 없으면 가장 최근 run을 보여준다.
  const selected = runs.find((r) => r.id === pickedId) ?? runs[0] ?? null
  const { events, error: logError } = useRunEvents(view === 'log' ? selected?.id ?? null : null)
  const shown = actionError ?? error ?? logError

  async function cancel(runId: string) {
    setActionError(null)
    try {
      await client.runs.cancel(runId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  function started(run: Run) {
    setPickedId(run.id)
    setView('log')
    setOpen(true)
    onRunStarted(run)
  }

  return (
    <section className={open ? 'dock dock-open' : 'dock'}>
      <header className="dock-tabs">
        <button type="button" className="dock-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▴'} 실행
        </button>
        <button
          type="button"
          className={view === 'new' ? 'dock-tab dock-tab-selected' : 'dock-tab'}
          onClick={() => { setView('new'); setOpen(true) }}
        >
          + 새 실행
        </button>
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className={view === 'log' && run.id === selected?.id ? 'dock-tab dock-tab-selected' : 'dock-tab'}
            onClick={() => { setPickedId(run.id); setView('log'); setOpen(true) }}
          >
            <span className={`status status-${run.status}`}>{run.status}</span>
            {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. 배지가 없으면 구분이 안 된다. */}
            {run.needsAnswer && <span className="needs-answer">답변 필요</span>}
            {label(run)}
          </button>
        ))}
        {view === 'log' && selected?.status === 'running' && (
          <button type="button" className="dock-cancel" onClick={() => void cancel(selected.id)}>
            취소
          </button>
        )}
      </header>

      {open && (
        <div className="dock-body">
          {shown && <div role="alert" className="form-error">{shown}</div>}
          {view === 'new' ? (
            <RunPanel
              workspaceId={workspaceId}
              chips={chips}
              onRemoveChip={onRemoveChip}
              onStarted={started}
            />
          ) : selected ? (
            <>
              {selected.errorMessage && <div role="alert" className="form-error">{selected.errorMessage}</div>}
              <RunLog events={events} />
            </>
          ) : (
            <div className="panel-empty">실행을 시작하면 여기에 로그가 흐릅니다</div>
          )}
        </div>
      )}
    </section>
  )
}
