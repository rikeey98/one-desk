import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/**
 * xterm.js를 감싸는 얇은 껍데기 (`docs/sdlc/code-editor/terminal-spec.md` FR-15·16). **판정을 두지 않는다** — jsdom에서는 xterm을
 * 그릴 수 없어 테스트가 이 파일을 대역으로 바꾼다(편집기와 같은 규칙). 셸에 붙는 일·이어 붙이기는 `TerminalPane`과
 * `code/terminalStream.ts`에 있다. 칸이 처음 터미널을 열 때만 불러온다(`TerminalPane`의 `lazy`).
 */

export interface TerminalViewHandle {
  write(text: string): void
  /** 화면과 스크롤백을 비운다 — `셸 다시 시작` */
  clear(): void
  size(): { cols: number; rows: number }
  focus(): void
}

export interface TerminalViewProps {
  /** 그릴 준비가 됐다(열·행을 잴 수 있다) — 한 번 부른다 */
  onReady: (handle: TerminalViewHandle) => void
  /** 키 입력·붙여넣기 */
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
}

/** 색은 토큰에서 온다 — 테마가 바뀌면 다시 읽는다(DESIGN.md: 색은 `:root` 토큰에서만) */
function themeFromTokens(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  const ansi = {
    black: v('--term-black'), red: v('--term-red'), green: v('--term-green'), yellow: v('--term-yellow'),
    blue: v('--term-blue'), magenta: v('--term-magenta'), cyan: v('--term-cyan'), white: v('--term-white')
  }
  return {
    background: v('--bg'),
    foreground: v('--text'),
    cursor: v('--text'),
    cursorAccent: v('--bg'),
    selectionBackground: v('--accent-bg-strong'),
    ...ansi,
    brightBlack: ansi.black, brightRed: ansi.red, brightGreen: ansi.green, brightYellow: ansi.yellow,
    brightBlue: ansi.blue, brightMagenta: ansi.magenta, brightCyan: ansi.cyan, brightWhite: ansi.white
  }
}

export function TerminalView({ onReady, onData, onResize }: TerminalViewProps) {
  const host = useRef<HTMLDivElement | null>(null)
  // 콜백은 마운트 한 번에 걸린다 — 바뀐 콜백을 ref로 따라간다
  const handlers = useRef({ onReady, onData, onResize })
  handlers.current = { onReady, onData, onResize }

  useEffect(() => {
    const el = host.current
    if (!el) return
    const css = getComputedStyle(document.documentElement)
    const term = new Terminal({
      fontFamily: css.getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: 12,
      lineHeight: 1.15,
      scrollback: 5000,
      cursorBlink: true,
      theme: themeFromTokens()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    // Ctrl+C는 선택이 있으면 복사, 없으면 셸로(중단). Ctrl+V는 xterm이 먹지 않게 넘겨 브라우저의 붙여넣기가 돈다 (FR-16)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.shiftKey || e.altKey) return true
      const key = e.key.toLowerCase()
      if (key === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (key === 'v') return false
      return true
    })

    const dataSub = term.onData((data) => { handlers.current.onData(data) })
    const resizeSub = term.onResize(({ cols, rows }) => { handlers.current.onResize(cols, rows) })
    // 칸의 폭(경계 끌기)·높이(창 크기)가 바뀌면 열·행을 다시 잰다
    const observer = new ResizeObserver(() => {
      try { fit.fit() } catch { /* 칸이 접히는 순간에는 잴 수 없다 */ }
    })
    observer.observe(el)
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => { term.options.theme = themeFromTokens() }
    scheme.addEventListener('change', onScheme)

    handlers.current.onReady({
      write: (text) => { term.write(text) },
      clear: () => { term.reset() },
      size: () => ({ cols: term.cols, rows: term.rows }),
      focus: () => { term.focus() }
    })

    return () => {
      scheme.removeEventListener('change', onScheme)
      observer.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      term.dispose()
    }
  }, [])

  return <div className="terminal-view" ref={host} />
}
