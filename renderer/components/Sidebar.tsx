import { useWorkspaces } from '../hooks/useWorkspaces'
import { AddForm } from './AddForm'
import { useClient } from '../client/ClientProvider'

export function Sidebar({ selectedId, onSelect }: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const client = useClient()
  const { workspaces, loading, error, refresh } = useWorkspaces()

  async function addWorkspace(name: string) {
    await client.workspaces.create({ name })
    await refresh()
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-label">Workspaces</div>
      <AddForm placeholder="새 workspace 이름…" onSubmit={addWorkspace} />
      {error && <div role="alert" className="form-error">{error}</div>}
      {loading && !error && <div className="sidebar-empty">불러오는 중…</div>}
      {!loading && !error && workspaces.length === 0 && (
        <div className="sidebar-empty">workspace가 없습니다</div>
      )}
      <ul>
        {workspaces.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              className={w.id === selectedId ? 'ws ws-selected' : 'ws'}
              onClick={() => onSelect(w.id)}
            >
              {w.name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
