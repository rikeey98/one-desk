import { useWorkspaces } from '../hooks/useWorkspaces'

export function Sidebar({ selectedId, onSelect }: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { workspaces, loading } = useWorkspaces()

  return (
    <nav className="sidebar">
      <div className="sidebar-label">Workspaces</div>
      {loading && <div className="sidebar-empty">불러오는 중…</div>}
      {!loading && workspaces.length === 0 && (
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
