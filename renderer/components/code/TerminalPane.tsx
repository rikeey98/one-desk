import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Repo, TerminalSession } from '@shared/models'
import { useClient } from '../../client/ClientProvider'
import { createTerminalStream } from '../../code/terminalStream'
import { ConfirmButton } from '../ConfirmButton'
import { IconClose } from '../icons'
import type { TerminalViewHandle } from './TerminalView'

// xterm은 처음 터미널을 열 때만 받는다 — 편집기처럼 지연 로드한다 (terminal-spec FR-15)
const TerminalView = lazy(() => import('./TerminalView').then((m) => ({ default: m.TerminalView })))

/**
 * 코드 칸의 터미널 (`docs/sdlc/code-editor/terminal-spec.md`). 셸은 core가 repo마다 하나씩 쥐고, 이 칸은 **붙었다 떨어진다** — 칸을
 * 닫거나 다른 repo로 옮겨도 셸은 돈다(FR-6). repo가 바뀌면 도크가 key로 이 칸을 다시 마운트해 그 repo의 셸에 붙는다.
 *
 * 붙는 순서가 중요하다: **구독 → 열기 → 스냅샷 쓰기 → 그 뒤 조각 이어 쓰기**. 규칙은 `code/terminalStream.ts`에 있다.
 */
export function TerminalPane({ workspaceId, repo, onClose }: {
  workspaceId: string
  repo: Repo
  onClose: () => void
}) {
  const client = useClient()
  const view = useRef<TerminalViewHandle | null>(null)
  const stream = useRef(createTerminalStream(repo.id, (text) => { view.current?.write(text) }))
  /** 지금 붙은 셸 — 끝남 알림을 거르는 데 쓴다 */
  const generation = useRef<number | null>(null)
  /** 응답보다 먼저 온 끝남 — 붙은 뒤에 맞춰 본다 */
  const earlyExits = useRef(new Map<number, number>())
  const [session, setSession] = useState<TerminalSession | null>(null)
  const [exited, setExited] = useState<{ exitCode: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 구독은 열기보다 먼저다 — 열기 응답이 오는 사이의 출력을 잃지 않는다
  useEffect(() => {
    const offData = client.events.onTerminalData((data) => { stream.current.push(data) })
    const offExit = client.events.onTerminalExit((exit) => {
      if (exit.repoId !== repo.id) return
      if (exit.generation === generation.current) setExited({ exitCode: exit.exitCode })
      else if (generation.current === null || exit.generation > generation.current) earlyExits.current.set(exit.generation, exit.exitCode)
    })
    return () => { offData(); offExit() }
  }, [client, repo.id])

  const attach = useCallback(async (restart: boolean) => {
    const handle = view.current
    if (!handle) return
    setError(null)
    try {
      const input = { workspaceId, repoId: repo.id, ...handle.size() }
      const next = restart ? await client.terminal.restart(input) : await client.terminal.open(input)
      // 기다리는 사이 껍데기가 바뀌었으면(StrictMode의 두 번 마운트, 칸이 다시 붙음) 이 응답은 옛 것이다 — 새 껍데기의 응답이 쓴다
      if (view.current !== handle) return
      if (restart) handle.clear()
      generation.current = next.generation
      stream.current.attach(next.generation, next.snapshot)
      const early = earlyExits.current.get(next.generation)
      setSession(next)
      setExited(next.exited ?? (early !== undefined ? { exitCode: early } : null))
      handle.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId, repo.id])

  function onKeyDown(e: KeyboardEvent) {
    // 터미널의 Esc는 셸의 것이다 — 도크 최대화 풀기·App의 "열린 항목 닫기"로 새지 않게 (FR-16, CLAUDE.md의 Esc 규칙)
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <section className="code-pane terminal-pane" aria-label="터미널 칸" onKeyDown={onKeyDown}>
      <header className="code-pane-head">
        <div className="code-pane-title">
          <span className="code-pane-repo">{repo.name}</span>
          {session && <span className="terminal-shell path-text" title={session.shellPath}>{session.shell}</span>}
        </div>
        <div className="code-pane-actions">
          {/* 도는 셸만 — 끝난 셸은 끝남 줄의 단추가 다시 띄운다(끝낼 것이 없어 확인도 없다) */}
          {session && !exited && (
            <ConfirmButton
              className="row-action terminal-restart"
              label="다시 시작"
              confirmLabel="정말 다시 시작"
              ariaLabel="셸 다시 시작"
              onConfirm={() => { void attach(true) }}
            />
          )}
          <button type="button" className="row-action" aria-label="코드 칸 닫기" title="코드 칸 닫기 — 셸은 계속 돕니다" onClick={onClose}>
            <IconClose width="12" height="12" />
          </button>
        </div>
      </header>
      {error && (
        <div className="terminal-error" role="alert">
          <span>{error} — 설정의 앱 탭에서 터미널 셸을 확인하세요.</span>
          <button type="button" onClick={() => { void attach(false) }}>다시 시도</button>
        </div>
      )}
      <div className="terminal-body">
        <Suspense fallback={<p className="code-pane-hint">터미널을 불러오는 중…</p>}>
          <TerminalView
            onReady={(handle) => { view.current = handle; void attach(false) }}
            onData={(data) => { if (!exited) client.terminal.write(repo.id, data) }}
            onResize={(cols, rows) => { client.terminal.resize(repo.id, cols, rows) }}
          />
        </Suspense>
      </div>
      {exited && (
        <div className="terminal-exit" role="status">
          <span>셸이 끝났습니다 (종료 코드 {exited.exitCode})</span>
          <button type="button" onClick={() => { void attach(true) }}>셸 다시 시작</button>
        </div>
      )}
    </section>
  )
}
