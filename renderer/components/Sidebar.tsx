import { useState } from 'react'
import { AddForm } from './AddForm'
import { RenameField } from './RenameField'
import { DeleteByName } from './DeleteByName'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts, McpStatus, Workspace } from '@shared/models'

/** workspace 목록은 App이 useWorkspaces()로 한 번만 조회해 내려준다 — 이 컴포넌트가
 * 자기 인스턴스를 따로 가지면 다른 인스턴스(App→InboxPanel 등)가 새 workspace를
 * 모르게 된다(App.tsx의 주석 참고). */
export function Sidebar({
  workspaces, loading, error, refresh, selectedId, onSelect, view, onSelectInbox, counts, countsError, mcpStatus, onDeleted
}: {
  workspaces: Workspace[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  selectedId: string | null
  onSelect: (id: string) => void
  view: 'workspace' | 'inbox'
  onSelectInbox: () => void
  /** 삭제한 workspace를 App이 알아야 고른 상태를 풀 수 있다. */
  onDeleted: (id: string) => void
  counts: InboxCounts
  /** 인박스 조회 실패. 배지 자리에 표식으로 드러낸다 (설계 §9). */
  countsError: string | null
  /** MCP 서버의 기동 상태. 하단 줄이 이걸 보여준다. */
  mcpStatus: McpStatus
}) {
  const client = useClient()

  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function addWorkspace(name: string) {
    await client.workspaces.create({ name })
    await refresh()
  }

  async function renameWorkspace(id: string, name: string) {
    setEditing(null)
    await client.workspaces.rename(id, name)
    await refresh()
  }

  async function removeWorkspace(id: string) {
    setDeleting(null)
    await client.workspaces.remove(id)
    // 목록을 다시 읽기 전에 알린다 — App이 고른 상태를 풀어야 사라진 workspace의
    // 화면이 잠깐이라도 남지 않는다.
    onDeleted(id)
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
          <li key={w.id} className="ws-row">
            <div className="ws-line">
            {editing === w.id ? (
              <RenameField
                initial={w.name}
                label={`${w.name} 새 이름`}
                onSubmit={(name) => void renameWorkspace(w.id, name)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
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
                {/* 평소엔 CSS로 감춰 두고 호버·포커스에서 드러낸다. DOM에는 항상
                    있어야 키보드로도 닿는다 — 호버로만 만들면 마우스가 없으면 못 쓴다. */}
                <span className="ws-actions">
                  <button
                    type="button"
                    className="row-action"
                    aria-label={`${w.name} 이름 바꾸기`}
                    onClick={() => { setEditing(w.id); setDeleting(null) }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="row-action row-action-danger"
                    aria-label={`${w.name} 삭제`}
                    onClick={() => { setDeleting(w.id); setEditing(null) }}
                  >
                    🗑
                  </button>
                </span>
              </>
            )}
            </div>
            {deleting === w.id && (
              /* workspace 삭제는 이슈·메모·실행 기록까지 cascade로 지운다.
                 repo 쪽의 두 번 누르기로는 무게가 맞지 않아 이름을 받는다. */
              <DeleteByName
                name={w.name}
                onConfirm={() => void removeWorkspace(w.id)}
                onCancel={() => setDeleting(null)}
              />
            )}
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
