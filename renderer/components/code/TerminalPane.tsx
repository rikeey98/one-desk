import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  TERMINAL_TABS_PER_REPO, type Repo, type TerminalSession, type TerminalShellKey, type TerminalShellOption, type TerminalTab
} from '@shared/models'
import { useClient } from '../../client/ClientProvider'
import { nextActiveAfterClose, pickTab, readActiveTab, writeActiveTab } from '../../code/terminalTabs'
import { ConfirmButton } from '../ConfirmButton'
import { IconChevronDown, IconClose, IconPlus } from '../icons'
import { TerminalTabView } from './TerminalTabView'

const LIMIT_TITLE = `터미널은 repo당 ${TERMINAL_TABS_PER_REPO}개까지입니다 — 하나를 닫으세요`

/**
 * 코드 칸의 터미널 (`docs/sdlc/terminal-tabs/spec.md`, `docs/sdlc/code-editor/terminal-spec.md`). 탭 목록의 진실은 core에 있다 — 이 칸은
 * 탭 줄·셸 메뉴·빈 칸만 그리고, 보이는 탭 하나의 본문은 `TerminalTabView`가 그 탭의 셸에 **붙었다 떨어진다**. 칸을 닫거나 다른 repo로
 * 옮겨도 셸은 돈다(terminal-spec FR-6). 렌더러가 쥐는 것은 어느 탭을 보고 있나 하나다(FR-6, `code/terminalTabs.ts`).
 */
export function TerminalPane({ workspaceId, repo, onClose, onSendSelection }: {
  workspaceId: string
  repo: Repo
  onClose: () => void
  /** `대화에 붙이기` — 고른 글을 도크가 보는 대화의 입력칸으로 보낸다(도크가 정한다) */
  onSendSelection: (text: string) => void
}) {
  const client = useClient()
  const [tabs, setTabs] = useState<TerminalTab[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 열린 셸 메뉴 — null이면 닫힘, 빈 배열이면 묻는 중 */
  const [menu, setMenu] = useState<TerminalShellOption[] | null>(null)
  /** 마지막으로 잰 칸의 크기 — 새 탭을 그 크기로 연다(아직 잰 적이 없으면 80×24 — 붙은 뒤 크기를 맞춘다) */
  const size = useRef({ cols: 80, rows: 24 })
  const tabButtons = useRef(new Map<string, HTMLButtonElement>())
  const menuButton = useRef<HTMLButtonElement>(null)
  const menuBox = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const defaultHintId = useId()

  // 보이지 않는 탭의 끝남도 탭 줄에 보인다 (FR-17) — 데이터는 보이는 탭(TerminalTabView)만 받는다
  useEffect(() => client.events.onTerminalExit((exit) => {
    setTabs((list) => list?.some((t) => t.tabId === exit.tabId)
      ? list.map((t) => (t.tabId === exit.tabId ? { ...t, exited: { exitCode: exit.exitCode } } : t))
      : list)
  }), [client])

  /** core의 목록을 읽는다 — 탭이 없으면 core가 기본 셸 탭 하나를 띄운다(FR-5). `remembered`가 있으면 그 탭을 본다 */
  const load = useCallback(async (keep: string | null) => {
    try {
      const list = await client.terminal.open({ workspaceId, repoId: repo.id, ...size.current })
      setTabs(list)
      setActive(pickTab(list, keep ?? readActiveTab(repo.id)))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setTabs((list) => list ?? [])
      return false
    }
  }, [client, workspaceId, repo.id])

  useEffect(() => { void load(null) }, [load])

  useEffect(() => { if (active !== null) writeActiveTab(repo.id, active) }, [repo.id, active])

  const full = (tabs?.length ?? 0) >= TERMINAL_TABS_PER_REPO

  async function create(shell: TerminalShellKey) {
    setMenu(null)
    if (full) return
    try {
      const made = await client.terminal.create({ workspaceId, repoId: repo.id, shell, ...size.current })
      setError(null)
      setTabs((list) => [...(list ?? []), made])
      setActive(made.tabId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function close(tabId: string) {
    try {
      await client.terminal.close({ workspaceId, tabId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setActive((current) => nextActiveAfterClose(tabs ?? [], tabId, current))
    setTabs((list) => list?.filter((t) => t.tabId !== tabId) ?? list)
  }

  async function openMenu() {
    if (menu !== null) { setMenu(null); return }
    if (full) return
    setMenu([])
    try {
      setMenu(await client.terminal.shells({ workspaceId, repoId: repo.id }))
    } catch (err) {
      setMenu(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // 메뉴는 최상위 레이어에 뜬다(대화 헤더의 `⋯` 메뉴와 같은 결) — 칸에 잘리지 않게. jsdom에는 togglePopover가 없다
  useLayoutEffect(() => {
    if (!menu || menu.length === 0) return
    menuBox.current?.togglePopover?.(true)
    menuBox.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [menu])

  // 바깥을 누르면 메뉴만 닫는다 — 메뉴와 그 단추는 안쪽이다(단추를 바깥으로 치면 눌러 닫았다가 click이 다시 연다)
  const menuOpen = menu !== null
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: Event) {
      const target = e.target as Node | null
      if (target && (menuBox.current?.contains(target) || menuButton.current?.contains(target))) return
      setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [menuOpen])

  function onMenuKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!menuOpen) return
    if (e.key === 'Escape') {
      // 메뉴만 닫는다 — 밖으로 새지 않는 것은 칸의 Esc 규칙(아래 onKeyDown)이 맡는다. 메뉴는 칸 안에 그려진다(popover도 DOM은 칸 안)
      setMenu(null)
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
    if (e.key === 'Tab') setMenu(null)
  }

  /** ARIA 탭 패턴 — ←→·Home·End로 탭 사이를 옮기고, 옮긴 탭을 본다 (FR-4) */
  function onTabsKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!tabs || tabs.length === 0) return
    const at = tabs.findIndex((t) => t.tabId === active)
    const to = e.key === 'ArrowRight' ? (at + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : null
    if (to === null) return
    e.preventDefault()
    const next = tabs[to]!.tabId
    setActive(next)
    tabButtons.current.get(next)?.focus()
  }

  function onKeyDown(e: KeyboardEvent) {
    // 터미널의 Esc는 셸의 것이다 — 도크 최대화 풀기·App의 "열린 항목 닫기"로 새지 않게 (terminal-spec FR-16, CLAUDE.md의 Esc 규칙)
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
  }

  const onSize = useCallback((cols: number, rows: number) => { size.current = { cols, rows } }, [])
  const onSession = useCallback((s: TerminalSession) => {
    setError(null)
    setTabs((list) => list?.map((t) => (t.tabId === s.tabId
      ? { tabId: s.tabId, repoId: s.repoId, label: s.label, shellKey: s.shellKey, shellPath: s.shellPath, exited: s.exited }
      : t)) ?? list)
  }, [])
  // 붙기·다시 시작이 실패하면 그 탭은 core에 없을 수 있다(다시 시작하다 셸을 못 띄우면 탭이 사라진다) — 이유를 남긴 채 목록을 다시 읽는다
  const onFailed = useCallback((message: string) => {
    setError(message)
    void load(active)
  }, [load, active])

  const activeTab = tabs?.find((t) => t.tabId === active) ?? null

  return (
    <section className="code-pane terminal-pane" aria-label="터미널 칸" onKeyDown={onKeyDown}>
      <header className="code-pane-head terminal-head">
        <span className="code-pane-repo">{repo.name}</span>
        <div className="terminal-tabs" role="tablist" aria-label="터미널 탭" onKeyDown={onTabsKeyDown}>
          {(tabs ?? []).map((t) => {
            const selected = t.tabId === active
            return (
              <div key={t.tabId} className={selected ? 'terminal-tab terminal-tab-active' : 'terminal-tab'}>
                <button
                  ref={(el) => { if (el) tabButtons.current.set(t.tabId, el); else tabButtons.current.delete(t.tabId) }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className="terminal-tab-name"
                  title={t.exited ? `끝남 (종료 코드 ${t.exited.exitCode})` : t.shellPath}
                  onClick={() => { setActive(t.tabId) }}
                >
                  {t.exited && <span className="terminal-tab-ended" aria-hidden="true" />}
                  {t.label}
                </button>
                {/* 도는 탭은 두 번 눌러야 닫힌다 — dev 서버까지 끝난다(spec §0-B의 2). 끝난 탭은 끝낼 것이 없어 한 번이다 */}
                {t.exited ? (
                  <button type="button" className="row-action terminal-tab-close" aria-label={`${t.label} 터미널 닫기`} onClick={() => { void close(t.tabId) }}>
                    <IconClose width="10" height="10" />
                  </button>
                ) : (
                  <ConfirmButton
                    className="row-action terminal-tab-close"
                    label={<IconClose width="10" height="10" />}
                    confirmLabel="정말 닫기"
                    ariaLabel={`${t.label} 터미널 닫기`}
                    onConfirm={() => { void close(t.tabId) }}
                  />
                )}
              </div>
            )
          })}
        </div>
        <div className="code-pane-actions">
          {/* 상한이면 잠그되 `disabled`가 아니라 aria-disabled다 — `title`의 이유가 풍선으로 보여야 한다 (FR-3) */}
          <button
            type="button"
            className="row-action"
            aria-label="새 터미널"
            aria-disabled={full ? true : undefined}
            title={full ? LIMIT_TITLE : '기본 셸로 새 터미널'}
            onClick={() => { void create('default') }}
          >
            <IconPlus width="12" height="12" />
          </button>
          <span className="terminal-menu-wrap" onKeyDown={onMenuKeyDown}>
            <button
              ref={menuButton}
              type="button"
              className="row-action terminal-menu-button"
              aria-label="셸 고르기"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              aria-disabled={full ? true : undefined}
              title={full ? LIMIT_TITLE : '셸을 골라 새 터미널'}
              onClick={() => { void openMenu() }}
            >
              <IconChevronDown width="12" height="12" />
            </button>
            {menu && menu.length > 0 && (
              <div ref={menuBox} id={menuId} role="menu" aria-label="셸 고르기" className="terminal-menu" popover="manual">
                {menu.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    title={option.path}
                    aria-describedby={option.isDefault ? defaultHintId : undefined}
                    onClick={() => { void create(option.key) }}
                  >
                    {option.label}
                    {option.isDefault && <span className="terminal-menu-default" aria-hidden="true">기본</span>}
                  </button>
                ))}
                <span id={defaultHintId} hidden>지금 기본 셸</span>
              </div>
            )}
          </span>
          <button type="button" className="row-action" aria-label="코드 칸 닫기" title="코드 칸 닫기 — 셸은 계속 돕니다" onClick={onClose}>
            <IconClose width="12" height="12" />
          </button>
        </div>
      </header>
      {error && (
        <div className="terminal-error" role="alert">
          <span>{error} — 설정의 앱 탭에서 터미널 셸을 확인하세요.</span>
          <button type="button" onClick={() => { setError(null); void load(active) }}>다시 시도</button>
        </div>
      )}
      {activeTab ? (
        <TerminalTabView
          key={activeTab.tabId}
          workspaceId={workspaceId}
          tab={activeTab}
          onSendSelection={onSendSelection}
          onSize={onSize}
          onSession={onSession}
          onFailed={onFailed}
        />
      ) : tabs && tabs.length === 0 && !error && (
        <p className="code-pane-hint terminal-empty">열린 터미널이 없습니다</p>
      )}
    </section>
  )
}
