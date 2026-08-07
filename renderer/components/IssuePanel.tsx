import { Panel } from './Panel'
import { useIssues } from '../hooks/useIssues'

export function IssuePanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const { issues } = useIssues(workspaceId, repoId)

  return (
    <Panel title="Issues">
      {issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}
      <ul className="item-list">
        {issues.map((i) => (
          <li key={i.id} className="item">
            <span className="item-title">{i.title}</span>
            <span className={`status status-${i.status}`}>{i.status}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
