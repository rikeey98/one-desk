import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { useMemos } from '../hooks/useMemos'
import { useClient } from '../client/ClientProvider'
import { chipKey, type ContextChip } from '../context'

export function MemoPanel({ workspaceId, repoId, chipKeys, onToggleContext }: {
  workspaceId: string
  repoId: string | null
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
}) {
  const client = useClient()
  const { memos, error: listError, refresh } = useMemos(workspaceId, repoId)

  async function addMemo(title: string) {
    await client.memos.create({
      workspaceId,
      title,
      repoIds: repoId ? [repoId] : []
    })
    await refresh()
  }

  return (
    <Panel title="Memos">
      {listError && <div role="alert" className="form-error">{listError}</div>}
      <AddForm placeholder="새 메모 제목…" onSubmit={addMemo} />
      {!listError && memos.length === 0 && <div className="panel-empty">메모가 없습니다</div>}
      <ul className="item-list">
        {memos.map((m) => (
          <li key={m.id} className="item">
            <button
              type="button"
              className={chipKeys.has(chipKey({ type: 'memo', id: m.id }))
                ? 'item-title item-picked' : 'item-title'}
              onClick={() => onToggleContext({ type: 'memo', id: m.id, label: m.title })}
            >
              {m.title}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
