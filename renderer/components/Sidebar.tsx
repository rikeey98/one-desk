import { useWorkspaces } from '../hooks/useWorkspaces'
import { AddForm } from './AddForm'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts } from '@shared/models'

export function Sidebar({ selectedId, onSelect, view, onSelectInbox, counts }: {
  selectedId: string | null
  onSelect: (id: string) => void
  view: 'workspace' | 'inbox'
  onSelectInbox: () => void
  counts: InboxCounts
}) {
  const client = useClient()
  const { workspaces, loading, error, refresh } = useWorkspaces()

  async function addWorkspace(name: string) {
    await client.workspaces.create({ name })
    await refresh()
  }

  return (
    <nav className="sidebar">
      <button
        type="button"
        className={view === 'inbox' ? 'inbox-link inbox-link-selected' : 'inbox-link'}
        onClick={onSelectInbox}
      >
        인박스
        {counts.total > 0 && <span className="badge">{counts.total}</span>}
      </button>
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
              className={w.id === selectedId && view === 'workspace' ? 'ws ws-selected' : 'ws'}
              onClick={() => onSelect(w.id)}
            >
              {w.name}
              {(counts.byWorkspace[w.id] ?? 0) > 0 && (
                <span className="badge">{counts.byWorkspace[w.id]}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
