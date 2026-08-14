import { AddForm } from './AddForm'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts, McpStatus, Workspace } from '@shared/models'

/** workspace 목록은 App이 useWorkspaces()로 한 번만 조회해 내려준다 — 이 컴포넌트가
 * 자기 인스턴스를 따로 가지면 다른 인스턴스(App→InboxPanel 등)가 새 workspace를
 * 모르게 된다(App.tsx의 주석 참고). */
export function Sidebar({
  workspaces, loading, error, refresh, selectedId, onSelect, view, onSelectInbox, counts, countsError, mcpStatus
}: {
  workspaces: Workspace[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  selectedId: string | null
  onSelect: (id: string) => void
  view: 'workspace' | 'inbox'
  onSelectInbox: () => void
  counts: InboxCounts
  /** 인박스 조회 실패. 배지 자리에 표식으로 드러낸다 (설계 §9). */
  countsError: string | null
  /** MCP 서버의 기동 상태. 하단 줄이 이걸 보여준다. */
  mcpStatus: McpStatus
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
        {/* 조용히 배지를 숨기면 "처리할 것이 없다"와 "못 읽었다"가 구별되지 않는다.
            인박스를 열지 않아도 실패한 사실이 보여야 한다 (설계 §9). */}
        {countsError
          ? <span className="badge badge-error" title={`인박스를 읽지 못했습니다: ${countsError}`}>!</span>
          : counts.total > 0 && <span className="badge">{counts.total}</span>}
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

      <McpStatusRow status={mcpStatus} />
    </nav>
  )
}

/**
 * 사이드바 하단의 MCP 상태 줄.
 *
 * 포트를 그대로 보여준다 — "서버가 정말 떴는가"와 "몇 번인가"를 눈으로 확인해야
 * 하는 상황이 실제로 있었다. 실패 사유는 길어질 수 있어 title에 넣는다.
 */
function McpStatusRow({ status }: { status: McpStatus }) {
  const label =
    status.state === 'listening' ? `MCP :${status.port}`
    : status.state === 'starting' ? 'MCP 시작 중'
    : 'MCP 연결 실패'

  return (
    <div
      className={`mcp-status mcp-status-${status.state}`}
      aria-live="polite"
      {...(status.state === 'failed' ? { title: status.message } : {})}
    >
      <span className="mcp-dot" aria-hidden="true" />
      {label}
    </div>
  )
}
