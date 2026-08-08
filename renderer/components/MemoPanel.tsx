import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { useMemos } from '../hooks/useMemos'
import { useClient } from '../client/ClientProvider'

export function MemoPanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const client = useClient()
  const { memos, refresh } = useMemos(workspaceId, repoId)

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
      <AddForm placeholder="새 메모 제목…" onSubmit={addMemo} />
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
