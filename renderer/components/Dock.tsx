import { useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useRunEvents } from '../hooks/useRunEvents'
import { RunLog } from './RunLog'
import { RunPanel } from './RunPanel'
import { SlotIndicator } from './SlotIndicator'
import type { ContextChip } from '../context'
import type { QueueSnapshot, Repo, Run, Workspace } from '@shared/models'

function label(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || '(빈 지시)'
}

export function Dock({
  runs, error, workspaceId, workspaces, repos, reposError, queue, queueError, onChangeLimit, chips, onRemoveChip,
  onRunStarted, resumeFrom, draftPrompt, draftCwd, onExitResume
}: {
  runs: Run[]
  error: string | null
  workspaceId: string
  /** RunPanel까지 그대로 흘려 보낸다 — App이 useWorkspaces()로 한 번만 조회한 것이다. */
  workspaces: Workspace[]
  repos: Repo[]
  reposError: string | null
  queue: QueueSnapshot | null
  queueError: string | null
  onChangeLimit: (n: number) => void
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onRunStarted: (run: Run) => void
  resumeFrom: Run | null
  draftPrompt: string
  /** RunPanel까지 그대로 흘려 보낸다 — "다시 실행"이 요구하는 작업 디렉토리다. */
  draftCwd: string | null
  onExitResume: () => void
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
  // 큐 조회가 실패하면 표시기가 그냥 안 보인다 — 이 기능이 메우려던 "왜 안 보이지"라는
  // 공백이 오류 상황에서 되살아난다. 새 배너를 만들지 않고 기존 경로로 흘려 보인다.
  const shown = actionError ?? error ?? queueError ?? logError

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
      {/* 토글과 슬롯 표시기는 스크롤되는 탭 스트립 밖에 둔다. 안에 두면 run 탭이
          늘어났을 때 "왜 내 run이 안 시작하지"를 설명하는 유일한 한 줄이 화면 밖으로
          밀려난다 — 표시기를 둔 이유(스펙 §7)와 정면으로 어긋난다. */}
      <header className="dock-header">
        <button type="button" className="dock-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▴'} 실행
        </button>
        <SlotIndicator snapshot={queue} onChangeLimit={onChangeLimit} />
        <div className="dock-tabs">
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
          {/* 대기 중인 run도 취소할 수 있어야 한다 — 프로세스가 없을 뿐 사용자에겐 똑같이 걸려 있다. */}
          {view === 'log' && (selected?.status === 'running' || selected?.status === 'pending') && (
            <button type="button" className="dock-cancel" onClick={() => void cancel(selected.id)}>
              취소
            </button>
          )}
        </div>
      </header>

      {open && (
        <div className="dock-body">
          {shown && <div role="alert" className="form-error">{shown}</div>}
          {view === 'new' ? (
            <RunPanel
              workspaceId={workspaceId}
              workspaces={workspaces}
              repos={repos}
              reposError={reposError}
              chips={chips}
              onRemoveChip={onRemoveChip}
              onStarted={started}
              resumeFrom={resumeFrom}
              draftPrompt={draftPrompt}
              draftCwd={draftCwd}
              onExitResume={onExitResume}
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
