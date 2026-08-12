import { AddForm } from './AddForm'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts, Workspace } from '@shared/models'

/** workspace 목록은 App이 useWorkspaces()로 한 번만 조회해 내려준다 — 이 컴포넌트가
 * 자기 인스턴스를 따로 가지면 다른 인스턴스(App→InboxPanel 등)가 새 workspace를
 * 모르게 된다(App.tsx의 주석 참고). */
export function Sidebar({ workspaces, loading, error, refresh, selectedId, onSelect, view, onSelectInbox, counts }: {
  workspaces: Workspace[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  selectedId: string | null
  onSelect: (id: string) => void
  view: 'workspace' | 'inbox'
  onSelectInbox: () => void
  counts: InboxCounts
}) {
  const client = useClient()

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
