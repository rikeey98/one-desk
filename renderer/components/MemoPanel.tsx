import { Panel } from './Panel'
import { useMemos } from '../hooks/useMemos'

export function MemoPanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const { memos } = useMemos(workspaceId, repoId)

  return (
    <Panel title="Memos">
      {memos.length === 0 && <div className="panel-empty">메모가 없습니다</div>}
      <ul className="item-list">
        {memos.map((m) => (
          <li key={m.id} className="item">
            <span className="item-title">{m.title}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
