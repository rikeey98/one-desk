import { useRepos } from '../hooks/useRepos'
import { AddRepoForm } from './AddRepoForm'

export function RepoStrip({ workspaceId, selectedRepoId, onSelect }: {
  workspaceId: string
  selectedRepoId: string | null
  onSelect: (repoId: string | null) => void
}) {
  const { repos, error, refresh } = useRepos(workspaceId)

  return (
    <div className="repo-strip">
      {error && <div role="alert" className="form-error">{error}</div>}
      {repos.map((r) => (
        <button
          key={r.id}
          type="button"
          className={r.id === selectedRepoId ? 'repo-card repo-card-selected' : 'repo-card'}
          onClick={() => onSelect(r.id === selectedRepoId ? null : r.id)}
        >
          <span className="repo-name">{r.name}</span>
          <span className="repo-path">{r.path}</span>
        </button>
      ))}
      {!error && repos.length === 0 && <div className="repo-empty">등록된 repo가 없습니다</div>}
      <AddRepoForm workspaceId={workspaceId} onAdded={refresh} />
    </div>
  )
}
