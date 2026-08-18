import { useEffect, useMemo, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { ConversationPanel } from './ConversationPanel'
import { SlotIndicator } from './SlotIndicator'
import { conversationIdOf, groupConversations } from '../conversation'
import type { ContextChip } from '../context'
import type { QueueSnapshot, Repo, Run, Workspace } from '@shared/models'

export function Dock({
  runs, error, workspaceId, workspaces, repos, reposError, queue, queueError, onChangeLimit, chips, onRemoveChip,
  onRunStarted, draftPrompt, draftCwd, focusConversationId
}: {
  runs: Run[]
  error: string | null
  workspaceId: string
  /** ConversationPanel까지 그대로 흘려 보낸다 — App이 useWorkspaces()로 한 번만 조회한 것이다. */
  workspaces: Workspace[]
  repos: Repo[]
  reposError: string | null
  queue: QueueSnapshot | null
  queueError: string | null
  onChangeLimit: (n: number) => void
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onRunStarted: (run: Run) => void
  draftPrompt: string
  /** ConversationPanel까지 그대로 흘려 보낸다 — "다시 실행"이 요구하는 작업 디렉토리다. */
  draftCwd: string | null
  /** 인박스의 "로그 보기"·"이어서 실행"이 지정한 대화. null이면 기본대로 새 대화 탭이 열린다. */
  focusConversationId: string | null
}) {
  const client = useClient()
  const [open, setOpen] = useState(true)
  // 실행 패널은 모달이 아니라 도크가 확장된 형태다 —
  // 모달이 뜨면 뒤의 issue/memo를 클릭해 맥락을 담을 수 없다 (설계 §9).
  const [view, setView] = useState<'conversation' | 'new'>('new')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // useRuns는 최신순 평평한 목록을 준다. 탭은 run이 아니라 대화 단위다.
  const conversations = useMemo(() => groupConversations(runs), [runs])

  // 인박스에서 "로그 보기"·"이어서 실행"을 누르면 view가 'inbox'→'workspace'로 바뀌며
  // 이 컴포넌트가 다시 마운트된다 — 내부 view 상태가 'new'로 돌아가 사용자는 실행
  // 패널을 보게 된다. 그래서 어느 대화를 열지는 App이 지정할 수 있어야 한다 (설계 §5).
  useEffect(() => {
    if (!focusConversationId) return
    setPickedId(focusConversationId)
    setView('conversation')
    setOpen(true)
  }, [focusConversationId])

  // 고른 적이 없으면 가장 최근 대화를 보여준다.
  const selected = conversations.find((c) => c.id === pickedId) ?? conversations[0] ?? null
  // 큐 조회가 실패하면 표시기가 그냥 안 보인다 — 이 기능이 메우려던 "왜 안 보이지"라는
  // 공백이 오류 상황에서 되살아난다. 새 배너를 만들지 않고 기존 경로로 흘려 보인다.
  const shown = actionError ?? error ?? queueError

  async function cancel(runId: string) {
    setActionError(null)
    try {
      await client.runs.cancel(runId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  function started(run: Run) {
    setPickedId(conversationIdOf(run))
    setView('conversation')
    setOpen(true)
    onRunStarted(run)
  }

  return (
    <section className={open ? 'dock dock-open' : 'dock'}>
      {/* 토글과 슬롯 표시기는 스크롤되는 탭 스트립 밖에 둔다. 안에 두면 대화 탭이
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
            + 새 대화
          </button>
          {conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              className={view === 'conversation' && conv.id === selected?.id ? 'dock-tab dock-tab-selected' : 'dock-tab'}
              onClick={() => { setPickedId(conv.id); setView('conversation'); setOpen(true) }}
            >
              <span className={`status status-${conv.last.status}`}>{conv.last.status}</span>
              {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. 배지가 없으면 구분이 안 된다. */}
              {conv.last.needsAnswer && <span className="needs-answer">답변 필요</span>}
              {conv.title}
            </button>
          ))}
          {/* 대기 중인 턴도 취소할 수 있어야 한다 — 프로세스가 없을 뿐 사용자에겐 똑같이 걸려 있다. */}
          {view === 'conversation' && (selected?.last.status === 'running' || selected?.last.status === 'pending') && (
            <button type="button" className="dock-cancel" onClick={() => void cancel(selected.last.id)}>
              취소
            </button>
          )}
        </div>
      </header>

      {open && (
        <div className="dock-body">
          {shown && <div role="alert" className="form-error">{shown}</div>}
          <ConversationPanel
            conversation={view === 'new' ? null : selected}
            workspaceId={workspaceId}
            workspaces={workspaces}
            repos={repos}
            reposError={reposError}
            chips={chips}
            onRemoveChip={onRemoveChip}
            onStarted={started}
            onCancel={cancel}
            draftPrompt={draftPrompt}
            draftCwd={draftCwd}
          />
        </div>
      )}
    </section>
  )
}
