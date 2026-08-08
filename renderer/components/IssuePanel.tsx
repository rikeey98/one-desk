import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { useIssues } from '../hooks/useIssues'
import { useClient } from '../client/ClientProvider'

export function IssuePanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const client = useClient()
  const { issues, refresh } = useIssues(workspaceId, repoId)

  async function addIssue(title: string) {
    await client.issues.create({
      workspaceId,
      title,
      repoIds: repoId ? [repoId] : []
    })
    await refresh()
  }

  return (
    <Panel title="Issues">
      <AddForm placeholder="새 이슈 제목…" onSubmit={addIssue} />
      {issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}
      <ul className="item-list">
        {issues.map((i) => (
          <li key={i.id} className="item">
            <span className="item-title">{i.title}</span>
            <button
              type="button"
              className={`status status-${i.status}`}
              onClick={async () => {
                const next = i.status === 'open' ? 'doing' : i.status === 'doing' ? 'done' : 'open'
                await client.issues.update({ id: i.id, status: next })
                await refresh()
              }}
            >
              {i.status}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
