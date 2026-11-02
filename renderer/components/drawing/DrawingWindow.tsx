import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useClient } from '../../client/ClientProvider'
import { useRepos } from '../../hooks/useRepos'
import { useItemChanged } from '../../hooks/useItemChanged'
import { statusText } from './DrawingPane'
import type { SaveStatus } from './DrawingCanvas'
import type { Drawing } from '@shared/models'

const DrawingCanvas = lazy(() => import('./DrawingCanvas'))

/**
 * 그림 하나의 창 (docs/sdlc/drawings/ spec FR-10). 머리 한 줄(제목 · repo · 저장 상태)과 캔버스뿐이다 — 이름 바꾸기 · 지우기는 코드 칸에만
 * 있다(창은 "크게 보기"다). 같은 그림이 코드 칸에도 열려 있으면 둘이 저장하며 합친다(FR-21).
 *
 * `drawingId`가 null이면 해시가 그림 창 모양인데 읽을 수 없는 것이다.
 */
export function DrawingWindow({ drawingId }: { drawingId: string | null }) {
  if (drawingId === null) {
    return (
      <div className="drawing-window-root">
        <p role="alert" className="drawing-window-gone">열 수 없는 창입니다</p>
      </div>
    )
  }
  return <LoadedDrawingWindow drawingId={drawingId} />
}

function LoadedDrawingWindow({ drawingId }: { drawingId: string }) {
  const client = useClient()
  // 연 순간의 그림(캔버스는 이것으로 시작하고 다시 마운트하지 않는다)과, 바뀜 알림으로 따라가는 제목
  const [initial, setInitial] = useState<Drawing | null | undefined>(undefined)
  const [title, setTitle] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    client.drawings.get(drawingId).then(
      (d) => {
        if (!live) return
        setInitial(d)
        if (d === null) setGone(true)
        else setTitle(d.title)
      },
      (err: unknown) => { if (live) setError(err instanceof Error ? err.message : String(err)) }
    )
    return () => { live = false }
  }, [client, drawingId])

  const workspaceId = initial?.workspaceId ?? null
  const { repos } = useRepos(workspaceId)
  const repo = initial ? repos.find((r) => r.id === initial.repoId) ?? null : null

  // 코드 칸에서 이름을 바꾸거나 지우면 따라간다 — 장면은 캔버스가 스스로 합친다
  const follow = useCallback(async () => {
    try {
      const d = await client.drawings.get(drawingId)
      if (d === null) setGone(true)
      else setTitle(d.title)
    } catch { /* 다음 알림이 다시 본다 */ }
  }, [client, drawingId])
  useItemChanged(workspaceId ?? undefined, 'drawing', follow)

  const windowTitle = title ? `그림 · ${title}` : '그림'
  useEffect(() => { document.title = windowTitle }, [windowTitle])

  if (error) {
    return (
      <div className="drawing-window-root">
        <p role="alert" className="drawing-window-gone">{error}</p>
      </div>
    )
  }
  if (gone) {
    return (
      <div className="drawing-window-root">
        <p role="alert" className="drawing-window-gone">이 그림은 삭제됐습니다</p>
      </div>
    )
  }
  if (!initial) return <div className="drawing-window-root" />

  const shownStatus = statusText(status)
  return (
    <div className="drawing-window-root">
      <header className="drawing-window-head">
        <h1>{title}</h1>
        {repo && <span className="drawing-window-repo">{repo.name}</span>}
        {shownStatus && (
          <span className={status?.kind === 'failed' ? 'code-pane-status drawing-failed' : 'code-pane-status'} role="status">
            {shownStatus}
          </span>
        )}
      </header>
      <Suspense fallback={<p className="code-pane-hint">그림판을 불러오는 중…</p>}>
        <DrawingCanvas drawing={initial} onStatus={setStatus} onDeleted={() => { setGone(true) }} />
      </Suspense>
    </div>
  )
}
