import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useClient } from '../../client/ClientProvider'
import { useDrawings } from '../../hooks/useDrawings'
import { pickOpenDrawing, readOpenDrawing, writeOpenDrawing } from '../../drawing/openDrawing'
import { ConfirmButton } from '../ConfirmButton'
import { RenameField } from '../RenameField'
import { IconChevronDown, IconClose, IconNewWindow, IconPencil, IconPlus, IconTrash } from '../icons'
import type { SaveStatus } from './DrawingCanvas'
import type { Drawing, Repo } from '@shared/models'

/** Excalidraw는 칸을 처음 열 때 불러온다 — JS만 수 MB다 (spec FR-20). CodeMirror·xterm과 같다 */
const DrawingCanvas = lazy(() => import('./DrawingCanvas'))

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 머리의 저장 상태 글자 */
export function statusText(status: SaveStatus | null): string | null {
  if (!status) return null
  if (status.kind === 'saving') return '저장 중…'
  if (status.kind === 'saved') return '저장됨'
  return `그림을 저장하지 못했습니다: ${status.message}`
}

/**
 * 코드 칸의 그림 칸 (docs/sdlc/drawings/ spec §6). 대상 repo의 그림을 고르고, 만들고, 이름을 바꾸고, 지우고, 별도 창으로 연다.
 * 캔버스(`DrawingCanvas`)는 그림이 바뀔 때마다 key로 갈아끼운다 — 그림 하나에 동기화 하나다.
 */
export function DrawingPane({ workspaceId, repo, onClose }: {
  workspaceId: string
  repo: Repo
  onClose: () => void
}) {
  const client = useClient()
  const { drawings, loaded, refresh } = useDrawings(workspaceId, repo.id)
  const [chosen, setChosen] = useState<{ repoId: string; id: string } | null>(null)
  const [opened, setOpened] = useState<{ id: string; drawing: Drawing | null } | null>(null)
  const [status, setStatus] = useState<{ id: string; status: SaveStatus } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuBox = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // 무엇을 여나 (FR-14) — 이 칸에서 고른 것, 아니면 이 장비가 기억한 것, 아니면 가장 최근에 고친 것
  const preferred = chosen && chosen.repoId === repo.id ? chosen.id : readOpenDrawing(repo.id)
  const openId = loaded ? pickOpenDrawing(drawings, preferred) : null
  const current = drawings.find((d) => d.id === openId) ?? null

  useEffect(() => { if (openId) writeOpenDrawing(repo.id, openId) }, [repo.id, openId])

  // 연 그림의 장면을 읽는다 — 목록에는 장면이 없다
  useEffect(() => {
    if (!openId) return
    let live = true
    client.drawings.get(openId).then(
      (drawing) => { if (live) setOpened({ id: openId, drawing }) },
      (err: unknown) => { if (live) setError(message(err)) }
    )
    return () => { live = false }
  }, [client, openId])

  const shown = opened && opened.id === openId ? opened : null
  const shownStatus = status && status.id === openId ? status.status : null

  function choose(id: string) {
    setMenuOpen(false)
    setRenaming(false)
    setChosen({ repoId: repo.id, id })
  }

  async function create() {
    setMenuOpen(false)
    setError(null)
    try {
      const made = await client.drawings.create({ workspaceId, repoId: repo.id })
      await refresh()
      choose(made.id)
    } catch (err) {
      setError(message(err))
    }
  }

  async function rename(title: string) {
    setRenaming(false)
    if (!current) return
    try {
      await client.drawings.rename(current.id, title)
      await refresh()
    } catch (err) {
      setError(message(err))
    }
  }

  async function remove() {
    if (!current) return
    try {
      await client.drawings.remove(current.id)
      // 남은 것 중 가장 최근에 고친 것을 연다 (FR-16)
      setChosen(null)
      await refresh()
    } catch (err) {
      setError(message(err))
    }
  }

  async function openWindow() {
    if (!current) return
    setError(null)
    try {
      await client.app.openDrawingWindow(current.id)
    } catch (err) {
      setError(message(err))
    }
  }

  // 메뉴는 최상위 레이어에 뜬다 — 칸에 잘리지 않게(셸 고르기와 같다). jsdom에는 togglePopover가 없다
  useLayoutEffect(() => {
    if (!menuOpen) return
    menuBox.current?.togglePopover?.(true)
    const items = [...(menuBox.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    ;(items.find((i) => i.getAttribute('aria-current') === 'true') ?? items[0])?.focus()
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: Event) {
      const target = e.target as Node | null
      if (target && (menuBox.current?.contains(target) || menuButton.current?.contains(target))) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [menuOpen])

  function onMenuKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!menuOpen) return
    if (e.key === 'Escape') {
      // 메뉴만 닫는다 — 칸 밖으로 새지 않게(도크 최대화·열린 항목 닫기)
      e.preventDefault()
      e.stopPropagation()
      setMenuOpen(false)
      menuButton.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = [...(menuBox.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      return
    }
    if (e.key === 'Tab') setMenuOpen(false)
  }

  return (
    <section className="code-pane drawing-pane" aria-label="그림 칸">
      <header className="code-pane-head drawing-head">
        <span className="code-pane-repo">{repo.name}</span>
        <span className="drawing-menu-wrap" onKeyDown={onMenuKeyDown}>
          <button
            ref={menuButton}
            type="button"
            className="drawing-picker"
            aria-label="그림 고르기"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            disabled={drawings.length === 0}
            title={current ? current.title : '그림 없음'}
            onClick={() => { setMenuOpen((v) => !v) }}
          >
            <span className="drawing-picker-title">{current ? current.title : '그림 없음'}</span>
            <IconChevronDown width="11" height="11" />
          </button>
          {menuOpen && (
            <div ref={menuBox} id={menuId} role="menu" aria-label="그림 고르기" className="drawing-menu" popover="manual">
              {drawings.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-current={d.id === openId ? 'true' : undefined}
                  onClick={() => { choose(d.id) }}
                >
                  {d.title}
                </button>
              ))}
            </div>
          )}
        </span>
        <div className="code-pane-actions">
          <button type="button" className="row-action" aria-label="새 그림" title="새 그림" onClick={() => { void create() }}>
            <IconPlus width="12" height="12" />
          </button>
          <button
            type="button"
            className="row-action"
            aria-label="그림 새 창으로 열기"
            title="그림 새 창으로 열기"
            disabled={!current}
            onClick={() => { void openWindow() }}
          >
            <IconNewWindow width="13" height="13" />
          </button>
          <button type="button" className="row-action" aria-label="코드 칸 닫기" title="코드 칸 닫기" onClick={onClose}>
            <IconClose width="12" height="12" />
          </button>
        </div>
      </header>

      {current && (
        <div className="drawing-actions">
          {renaming
            ? (
              <RenameField
                initial={current.title}
                label={`${current.title} 새 이름`}
                onSubmit={(title) => { void rename(title) }}
                onCancel={() => { setRenaming(false) }}
              />
            )
            : (
              <button type="button" className="row-action drawing-rename" aria-label="그림 이름 바꾸기" title="그림 이름 바꾸기" onClick={() => { setRenaming(true) }}>
                <IconPencil width="11" height="11" />
                <span>{current.title}</span>
              </button>
            )}
          {statusText(shownStatus) && (
            <span className={shownStatus?.kind === 'failed' ? 'code-pane-status drawing-failed' : 'code-pane-status'} role="status">
              {statusText(shownStatus)}
            </span>
          )}
          <ConfirmButton
            className="row-action row-action-danger drawing-delete"
            label={<IconTrash width="12" height="12" />}
            confirmLabel="정말 삭제?"
            ariaLabel="그림 삭제"
            onConfirm={() => { void remove() }}
          />
        </div>
      )}
      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="drawing-body">
        {!loaded
          ? <p className="code-pane-hint">그림 목록을 읽는 중…</p>
          : drawings.length === 0
            ? (
              <div className="code-pane-reason drawing-empty">
                <p>이 repo에 그림이 없습니다</p>
                <button type="button" onClick={() => { void create() }}>첫 그림 만들기</button>
              </div>
            )
            : shown === null
              ? <p className="code-pane-hint">그림을 여는 중…</p>
              : shown.drawing === null
                ? <p role="alert" className="code-pane-hint">이 그림은 삭제됐습니다</p>
                : (
                  <Suspense fallback={<p className="code-pane-hint">그림판을 불러오는 중…</p>}>
                    <DrawingCanvas
                      key={shown.drawing.id}
                      drawing={shown.drawing}
                      onStatus={(s) => { setStatus({ id: shown.id, status: s }) }}
                      onDeleted={() => { void refresh() }}
                    />
                  </Suspense>
                )}
      </div>
    </section>
  )
}
