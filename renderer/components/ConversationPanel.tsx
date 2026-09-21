import { Transcript } from './Transcript'
import { RunPanel } from './RunPanel'
import { contextOf } from '../conversation'
import type { Conversation } from '../conversation'
import type { ContextChip } from '../context'
import type { ContextItemType, Repo, Run, Workspace } from '@shared/models'

/** 담긴 항목의 종류 이름. asset의 skill·agent 구분은 이번 범위 밖이다 (spec 범위 밖). */
const TYPE_LABELS: Record<ContextItemType, string> = {
  repo: 'repo', issue: '이슈', memo: '메모', asset: 'asset'
}

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

  /**
   * 이 대화가 이미 받은 것. 아래 칩 줄("이번 턴에 담을 것")과 짝을 이룬다 —
   * 실행하면 칩은 비워지지만(설계 §4-1) 대화는 그것을 기억하고 있고,
   * 그 사실을 보여주는 것이 이 줄이다. 보기 전용이다 (spec FR-4).
   */
  const applied = conversation ? contextOf(conversation) : []

  return (
    <div className="conversation-panel">
      {conversation
        ? <Transcript conversation={conversation} onCancel={onCancel} />
        : <div className="panel-empty">지시를 입력하면 대화가 시작됩니다</div>}
      {applied.length > 0 && (
        <div className="applied-context">
          <span className="applied-label">이 대화에 담긴 것</span>
          {applied.map((item) => {
            const text = `${TYPE_LABELS[item.type]} · ${item.label}`
            // 잘린 이름은 호버로 읽는다.
            return (
              <span className="applied-chip" key={`${item.type}:${item.id}`} title={text}>
                {text}
              </span>
            )
          })}
        </div>
      )}
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
