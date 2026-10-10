import { app, nativeTheme, shell, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { externalLinkOf, isAppNavigation } from '@shared/links'
import { panelHash, panelScopeKey, type PanelScope } from '@shared/panelWindow'
import { TITLEBAR_COLORS, TITLEBAR_HEIGHT } from '@shared/titleBar'

/**
 * 앱의 창들 (docs/sdlc/item-windows/). 앱 창 하나와, (종류, workspace, repo)마다 하나인 패널 창들.
 *
 * **모든 창은 `createWindow` 한 길로 만든다** — webPreferences와 탐색 가드(FR-14)를 창마다 따로 적으면
 * 새 창 하나에서 빠뜨리는 순간 그 창이 원격 문서로 넘어가고, preload의 앱 API가 그 문서에 붙는다.
 */

function appDocument(): { devUrl: string | undefined; indexFile: string; appUrl: string } {
  const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
  const indexFile = join(__dirname, '../renderer/index.html')
  // 앱 자신의 주소. 아래 will-navigate가 이것 말고는 전부 막는다.
  return { devUrl, indexFile, appUrl: devUrl || pathToFileURL(indexFile).href }
}

/**
 * 앱 창은 앱 문서 말고는 아무것도 열지 않는다 (docs/sdlc/conversation-timeline/ spec FR-24).
 * 렌더러의 마크다운이 이미 거르지만(FR-22) 거기에만 기대지 않는다 — 창이 원격 문서로 넘어가면
 * preload가 그 문서에도 붙어 window.oneDesk가 그 문서의 것이 된다. 판정은 shared/links.ts 하나를
 * 렌더러와 같이 쓴다(main에는 단위 테스트가 없어 거기서 고정한다).
 */
function hardenWindow(win: BrowserWindow, appUrl: string): void {
  // 새 창 요청: http(s)만 OS 브라우저로 넘기고 나머지(javascript:·file:·data:…)는 조용히
  // 거부한다. 창은 어느 쪽이든 만들지 않는다 — 패널 창도 main이 IPC로만 만든다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const link = externalLinkOf(url)
    if (link !== null) {
      shell.openExternal(link).catch((error: unknown) => {
        console.error('one-desk: 외부 링크를 열지 못했습니다', link, error)
      })
    }
    return { action: 'deny' }
  })

  // 창 안 탐색: 앱 문서(개발 서버는 같은 origin — Vite의 전체 새로고침, file:은 같은
  // index.html)가 아니면 막는다. loadURL·loadFile 같은 프로그램 탐색에는 불리지 않는다.
  // 해시만 바뀌는 탐색은 문서 안의 이동이라 여기 오지 않는다.
  win.webContents.on('will-navigate', (event) => {
    if (!isAppNavigation(event.url, appUrl)) event.preventDefault()
  })
}

/** OS 창 단추(최소화·최대화·닫기)의 높이·색 — 지금 테마의 것. 렌더러의 `.titlebar`와 같은 값이다(shared/titleBar.ts). */
function titleBarOverlay(): { color: string; symbolColor: string; height: number } {
  return { ...TITLEBAR_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'], height: TITLEBAR_HEIGHT }
}

/**
 * 앱 창의 제목 줄 (`docs/sdlc/code-editor/` FR-1, 2026-10-10) — OS 제목 표시줄을 숨기고 렌더러가 그린 줄(`.titlebar`)을 쓴다.
 * 그 오른쪽 끝, OS 창 단추 바로 왼쪽에 코드 칸 버튼이 선다(Claude Code 데스크톱과 같은 자리). Windows·Linux는 OS가 창
 * 단추를 그 줄 위에 겹쳐 그리고(Window Controls Overlay), macOS는 신호등이 왼쪽에 그대로 선다 — 어느 쪽이든 렌더러는
 * CSS의 `env(titlebar-area-*)`로 그 자리를 비운다.
 */
function customTitleBar(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') return { titleBarStyle: 'hidden', titleBarOverlay: true }
  return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() }
}

function createWindow(opts: {
  width: number
  height: number
  hash?: string
  /** 창 틀 — 앱 창만 `customTitleBar()`를 넘긴다. 패널 창은 OS 제목 표시줄 그대로다 */
  frame?: BrowserWindowConstructorOptions
}): BrowserWindow {
  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    show: false,
    autoHideMenuBar: true,
    ...opts.frame,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  const { devUrl, indexFile, appUrl } = appDocument()
  hardenWindow(win, appUrl)
  win.on('ready-to-show', () => { win.show() })

  const hash = opts.hash?.replace(/^#/, '')
  if (devUrl) {
    void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  } else {
    void win.loadFile(indexFile, hash ? { hash } : undefined)
  }
  return win
}

let mainWindow: BrowserWindow | null = null
const panelWindows = new Map<string, BrowserWindow>()

/** 실행 중인 앱 창. 닫혔으면 null — 호출자는 항상 존재 여부를 확인한다. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 바뀜 알림(FR-17)을 보낼 창 전부. */
export function getAllWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
}

export function createMainWindow(): BrowserWindow {
  const win = createWindow({ width: 1440, height: 900, frame: customTitleBar() })
  mainWindow = win
  // 테마가 바뀌면 OS 창 단추의 색도 따라간다 — 렌더러는 prefers-color-scheme로 이미 바뀐다. macOS는 신호등이 스스로 맞춘다.
  if (process.platform !== 'darwin') {
    const syncOverlay = () => { if (!win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlay()) }
    nativeTheme.on('updated', syncOverlay)
    win.on('closed', () => { nativeTheme.off('updated', syncOverlay) })
  }
  win.on('closed', () => {
    mainWindow = null
    // 패널 창만 남은 앱은 만들지 않는다 (FR-16). close()라서 각 창의 beforeunload — 대기 중인
    // 저장을 흘려보내는 것(FR-15) — 을 탄다.
    for (const panel of panelWindows.values()) if (!panel.isDestroyed()) panel.close()
  })
  return win
}

/**
 * 범위 하나에 창 하나다 (FR-3). 있으면 앞으로 가져오고, 없으면 만든다. 범위는 core가 이미 검증했다.
 * 창 제목은 렌더러가 `document.title`로 정한다 — 이름이 바뀌면 렌더러가 바뀜 알림으로 안다(FR-4).
 */
export function openPanelWindow(scope: PanelScope): void {
  const key = panelScopeKey(scope)
  const existing = panelWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }
  const win = createWindow({ width: 1100, height: 800, hash: panelHash(scope) })
  panelWindows.set(key, win)
  win.on('closed', () => {
    if (panelWindows.get(key) === win) panelWindows.delete(key)
  })
}
