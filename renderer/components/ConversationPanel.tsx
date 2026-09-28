import { useRef, useState } from 'react'
import { Transcript, reservationOf } from './Transcript'
import { RunPanel } from './RunPanel'
import { useClient } from '../client/ClientProvider'
import type { Conversation } from '../conversation'
import type { ContextChip } from '../context'
import type { Repo, Run, Workspace } from '@shared/models'

/**
 * 대화 하나. 위는 대화록, 아래는 입력이다 (설계 §4-1).
 *
 * 새 대화는 conversation이 null일 뿐 같은 컴포넌트다 — 대화록이 비어 있고
 * 입력부가 작업 디렉토리를 고르게 한다.
 *
 * 헤더(제목·메뉴·링)와 "이 대화에 담긴 것" 줄은 여기 없다 — Dock이 그리는 `ConversationHeader`로
 * 옮겨 갔다(`docs/sdlc/conversation-timeline/` spec FR-33, plan 다듬은 것 5). 대화록만 스크롤하고
 * 입력부는 바닥에 고정된다(FR-41).
 */
export function ConversationPanel({
  conversation, workspaceId, workspaces, repos, reposError, chips, onRemoveChip,
  onStarted, onCancel, draftPrompt, draftCwd
}: {
  conversation: Conversation | null
  workspaceId: string
  workspaces: Workspace[]
  repos: Repo[]
  reposError: string | null
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onStarted: (run: Run) => void
  onCancel: (runId: string) => void
  draftPrompt: string
  draftCwd: string | null
}) {
  const client = useClient()
  const [resendError, setResendError] = useState<string | null>(null)
  // 입력칸 — 대화록의 답하기(FR-44)가 여기에 포커스를 준다. 입력부와 대화록이 둘 다 이 칸의
  // 자식이라 여기서 잇는다.
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 대화당 예약은 하나다. 이미 있으면 입력부가 전송을 잠근다 (설계 §3-2).
  const reserved = conversation?.runs.some((r) => r.status === 'pending') ?? false
  // 입력부가 보는 대화의 지금 (`docs/sdlc/conversation-timeline/` spec FR-28·FR-30). 규칙은
  // `reserved`처럼 여기서 세우고 입력부는 그리기만 한다. 도는 턴은 대화의 활성 턴 중 running
  // 이다(`docs/sdlc/conversation-fixes/` FR-3 — 예약이 있어도 도는 턴이 먼저다).
  const running = conversation?.active?.status === 'running' ? conversation.active : null
  const reservation = conversation ? reservationOf(conversation) : null
  const waitingFirst = conversation?.runs.some(
    (r) => r.id === conversation.id && r.status === 'pending'
  ) ?? false

  /**
   * 다시 보내기 (`docs/sdlc/conversation-timeline/` spec FR-43) — 그 턴의 지시·맥락·조건
   * **그대로** 이 대화에 새 턴을 잇는다. 인박스의 "다시 실행"은 새 대화를 열어 조건을 잃는다
   * — 하는 일이 달라 이름도 다르다. 맥락은 id만 보낸다: 이름은 core가 읽는 시점에 다시 붙이고,
   * 지워진 항목은 core가 이미 뺐다.
   *
   * 나갔으면 true다. 실패하면 이유를 보이고 false를 돌려준다 — 대화록의 버튼이 다시 풀린다.
   */
  async function resend(run: Run): Promise<boolean> {
    if (!conversation) return false
    setResendError(null)
    try {
      const next = await client.runs.resume({
        conversationId: conversation.id,
        userPrompt: run.userPrompt,
        // 파일은 빼고 보낸다 — 원문 지시문의 `@`가 다시 가져오고, 요청으로 오면 core가 거부한다
        // (docs/sdlc/input-triggers/ FR-9·FR-18).
        context: run.contextItems.filter((item) => item.type !== 'file').map(({ type, id }) => ({ type, id })),
        model: run.model,
        effort: run.effort,
        permission: run.permission
      })
      onStarted(next)
      return true
    } catch (err) {
      setResendError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  return (
    <div className="conversation-panel">
      {/* 답하기(FR-44)는 입력칸에 포커스를 준다 — 보낼 대상은 이미 이 대화다. */}
      {conversation
        ? (
          <Transcript
            conversation={conversation}
            onCancel={onCancel}
            onResend={resend}
            onAnswer={() => inputRef.current?.focus()}
          />
        )
        : <div className="panel-empty">지시를 입력하면 대화가 시작됩니다</div>}
      {resendError && <div role="alert" className="form-error">{resendError}</div>}
      <RunPanel
        conversation={conversation}
        workspaceId={workspaceId}
        workspaces={workspaces}
        repos={repos}
        reposError={reposError}
        chips={chips}
        onRemoveChip={onRemoveChip}
        onStarted={onStarted}
        draftPrompt={draftPrompt}
        draftCwd={draftCwd}
        reserved={reserved}
        running={running}
        reservation={reservation}
        waitingFirst={waitingFirst}
        onCancel={onCancel}
        inputRef={inputRef}
      />
    </div>
  )
}
