import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Issue } from '@shared/models'

/** 완료가 아닌 것이 먼저(최근에 만든 순), 완료가 뒤 (`docs/sdlc/conversation-issue/` FR-21) */
function ordered(issues: Issue[]): Issue[] {
  const byNewest = (a: Issue, b: Issue) => b.createdAt - a.createdAt
  return [
    ...issues.filter((i) => i.status !== 'done').sort(byNewest),
    ...issues.filter((i) => i.status === 'done').sort(byNewest)
  ]
}

/**
 * 대화에 할당할 이슈를 고른다 (conversation-issue FR-21). 대화 헤더의 `⋯` 단추 아래에 뜬다 — popover(최상위 레이어)와
 * anchor positioning이라 도크 본문의 overflow에 잘리지 않는다(`⋯` 메뉴와 같은 자리, 같은 방식).
 *
 * 목록은 **열 때 한 번** 읽는다 — 그 workspace의 이슈 전부이고 repo로 거르지 않는다(FR-6). 위의 칸이 제목으로 거르고
 * Enter는 맨 위 것을 고른다. **Esc는 여기서 멈춘다**(안쪽부터 푼다 — 도크 최대화·열린 항목 닫기까지 풀리면 안 된다).
 */
export function IssuePicker({ workspaceId, currentId, onPick, onClose }: {
  workspaceId: string
  /** 지금 할당된 이슈. 목록에서 표시만 한다 */
  currentId: string | null
  onPick: (issueId: string) => void
  onClose: () => void
}) {
  const client = useClient()
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const latestClose = useRef(onClose)
  latestClose.current = onClose

  useLayoutEffect(() => {
    box.current?.togglePopover?.(true)
  }, [])

  useEffect(() => {
    let alive = true
    client.issues.list({ workspaceId })
      .then((list) => { if (alive) setIssues(list) })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [client, workspaceId])

  // 바깥을 누르면 닫는다.
  useEffect(() => {
    function onPointerDown(e: Event) {
      const target = e.target as Node | null
      if (target && box.current?.contains(target)) return
      latestClose.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = ordered(issues ?? [])
    return needle === '' ? list : list.filter((i) => i.title.toLowerCase().includes(needle))
  }, [issues, query])

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  return (
    <div
      ref={box}
      popover="manual"
      role="dialog"
      aria-label="할당할 이슈"
      className="issue-picker"
      onKeyDown={onKeyDown}
    >
      <input
        className="issue-picker-input"
        aria-label="할당할 이슈 찾기"
        placeholder="이슈 제목으로 찾기"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && shown[0]) {
            e.preventDefault()
            onPick(shown[0].id)
          }
        }}
      />
      {error && <div role="alert" className="form-error">{error}</div>}
      {issues === null && !error && <div className="issue-picker-empty">불러오는 중…</div>}
      {issues !== null && shown.length === 0 && (
        <div className="issue-picker-empty">{issues.length === 0 ? '이 workspace에 이슈가 없습니다' : '맞는 이슈가 없습니다'}</div>
      )}
      <ul className="issue-picker-list" aria-label="할당할 이슈 목록">
        {shown.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              className={issue.id === currentId ? 'issue-picker-item issue-picker-current' : 'issue-picker-item'}
              onClick={() => onPick(issue.id)}
            >
              <span className="issue-picker-status">{issue.status}</span>
              <span className="issue-picker-title">{issue.title}</span>
              {issue.id === currentId && <span className="issue-picker-mark">할당됨</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
