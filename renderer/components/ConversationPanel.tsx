import { Transcript } from './Transcript'
import { RunPanel } from './RunPanel'
import type { Conversation } from '../conversation'
import type { ContextChip } from '../context'
import type { Repo, Run, Workspace } from '@shared/models'

/**
 * 대화 하나. 위는 대화록, 아래는 입력이다 (설계 §4-1).
 *
 * 새 대화는 conversation이 null일 뿐 같은 컴포넌트다 — 대화록이 비어 있고
 * 입력부가 작업 디렉토리를 고르게 한다.
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
  // 대화당 예약은 하나다. 이미 있으면 입력부가 전송을 잠근다 (설계 §3-2).
  const reserved = conversation?.runs.some((r) => r.status === 'pending') ?? false

  return (
    <div className="conversation-panel">
      {conversation
        ? <Transcript conversation={conversation} onCancel={onCancel} />
        : <div className="panel-empty">지시를 입력하면 대화가 시작됩니다</div>}
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
      />
    </div>
  )
}
