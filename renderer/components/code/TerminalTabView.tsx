import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalSession, TerminalTab } from '@shared/models'
import { useClient } from '../../client/ClientProvider'
import { createTerminalStream } from '../../code/terminalStream'
import { ConfirmButton } from '../ConfirmButton'
import { IconChat } from '../icons'
import type { TerminalViewHandle } from './TerminalView'

// xterm은 처음 터미널을 열 때만 받는다 — 편집기처럼 지연 로드한다 (terminal-spec FR-15)
const TerminalView = lazy(() => import('./TerminalView').then((m) => ({ default: m.TerminalView })))

/**
 * 보이는 탭 하나의 본문 (`docs/sdlc/terminal-tabs/spec.md` FR-4·17). 칸이 `key={tabId}`로 갈아 끼운다 — 탭을 바꾸면 이 컴포넌트가
 * 새로 마운트되어 그 탭의 셸에 **새로 붙는다**: 구독 → 붙기(스냅샷) → 이어 쓰기. 규칙은 `code/terminalStream.ts`에 있다. 셸은 core가
 * 쥐므로 보이지 않는 동안에도 돈다(terminal-spec FR-6).
 */
export function TerminalTabView({ workspaceId, tab, onSendSelection, onSize, onSession, onFailed }: {
  workspaceId: string
  tab: TerminalTab
  onSendSelection: (text: string) => void
  /** 칸의 크기 — 칸이 새 탭을 그 크기로 연다 */
  onSize: (cols: number, rows: number) => void
  /** 붙었거나 다시 시작했다 — 탭 줄의 이름·끝남을 맞춘다(FR-16) */
  onSession: (session: TerminalSession) => void
  /** 붙기·다시 시작이 실패했다 — 칸이 이유를 보이고 목록을 다시 읽는다 */
  onFailed: (message: string) => void
}) {
  const client = useClient()
  const view = useRef<TerminalViewHandle | null>(null)
  const stream = useRef(createTerminalStream(tab.tabId, (text) => { view.current?.write(text) }))
  /** 지금 붙은 셸 — 끝남 알림을 거르는 데 쓴다 */
  const generation = useRef<number | null>(null)
  /** 응답보다 먼저 온 끝남 — 붙은 뒤에 맞춰 본다 */
  const earlyExits = useRef(new Map<number, number>())
  const [attached, setAttached] = useState(false)
  const [exited, setExited] = useState<{ exitCode: number } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  /** 다시 시작이 도는 중 — 두 번 누르면 둘째가 첫째가 갈아 끼운 탭을 못 찾아 거짓 오류가 선다 */
  const [restarting, setRestarting] = useState(false)

  // 구독은 붙기보다 먼저다 — 붙기 응답이 오는 사이의 출력을 잃지 않는다
  useEffect(() => {
    const offData = client.events.onTerminalData((data) => { stream.current.push(data) })
    const offExit = client.events.onTerminalExit((exit) => {
      if (exit.tabId !== tab.tabId) return
      if (exit.generation === generation.current) setExited({ exitCode: exit.exitCode })
      else if (generation.current === null || exit.generation > generation.current) earlyExits.current.set(exit.generation, exit.exitCode)
    })
    return () => { offData(); offExit() }
  }, [client, tab.tabId])

  const attach = useCallback(async (restart: boolean) => {
    const handle = view.current
    if (!handle) return
    try {
      const size = handle.size()
      onSize(size.cols, size.rows)
      const ref = { workspaceId, tabId: tab.tabId }
      const next = restart ? await client.terminal.restart({ ...ref, ...size }) : await client.terminal.attach(ref)
      // 기다리는 사이 껍데기가 바뀌었으면(StrictMode의 두 번 마운트) 이 응답은 옛 것이다 — 새 껍데기의 응답이 쓴다
      if (view.current !== handle) return
      if (restart) handle.clear()
      // 칸이 탭을 연 크기는 껍데기를 재기 전의 값일 수 있다 — 붙은 셸을 지금 크기로 맞춘다(첫 fit은 onResize를 내지 않는다)
      else client.terminal.resize(tab.tabId, size.cols, size.rows)
      generation.current = next.generation
      stream.current.attach(next.generation, next.snapshot)
      const early = earlyExits.current.get(next.generation)
      setAttached(true)
      setExited(next.exited ?? (early !== undefined ? { exitCode: early } : null))
      onSession(next)
      handle.focus()
    } catch (err) {
      onFailed(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId, tab.tabId, onSize, onSession, onFailed])

  async function restart() {
    setRestarting(true)
    try {
      await attach(true)
    } finally {
      setRestarting(false)
    }
  }

  /** 고른 글은 누른 순간 다시 읽는다 — 보낸 뒤에는 선택을 푼다(복사의 Ctrl+C와 같다) */
  function sendSelection() {
    const handle = view.current
    const text = handle?.getSelection() ?? ''
    if (!handle || text.trim() === '') return
    onSendSelection(text)
    handle.clearSelection()
  }

  return (
    <>
      <div className="terminal-tab-actions">
        {/* 고른 글이 없으면 비활성이고 `title`이 이유를 말한다 — `disabled`면 풍선이 뜨지 않는다 */}
        <button
          type="button"
          className="row-action terminal-send"
          aria-label="선택 영역을 대화에 붙이기"
          aria-disabled={hasSelection ? undefined : true}
          title={hasSelection ? '선택 영역을 대화 입력칸에 붙입니다' : '터미널에서 붙일 글을 먼저 고르세요'}
          onClick={sendSelection}
        >
          <IconChat width="12" height="12" />
          대화에 붙이기
        </button>
        {/* 도는 셸만 — 끝난 셸은 끝남 줄의 단추가 다시 띄운다(끝낼 것이 없어 확인도 없다) */}
        {attached && !exited && (
          <ConfirmButton
            className="row-action terminal-restart"
            label="다시 시작"
            confirmLabel="정말 다시 시작"
            ariaLabel="셸 다시 시작"
            onConfirm={() => { void restart() }}
          />
        )}
      </div>
      <div className="terminal-body">
        <Suspense fallback={<p className="code-pane-hint">터미널을 불러오는 중…</p>}>
          <TerminalView
            onReady={(handle) => { view.current = handle; void attach(false) }}
            onData={(data) => { if (!exited) client.terminal.write(tab.tabId, data) }}
            onResize={(cols, rows) => { onSize(cols, rows); client.terminal.resize(tab.tabId, cols, rows) }}
            onSelectionChange={setHasSelection}
          />
        </Suspense>
      </div>
      {exited && (
        <div className="terminal-exit" role="status">
          <span>셸이 끝났습니다 (종료 코드 {exited.exitCode})</span>
          <button type="button" disabled={restarting} onClick={() => { void restart() }}>셸 다시 시작</button>
        </div>
      )}
    </>
  )
}
