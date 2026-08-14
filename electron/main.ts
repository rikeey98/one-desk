import { app, dialog, shell, BrowserWindow } from 'electron'
import { isAbsolute, join } from 'node:path'
import { createCore, type Core } from '@core/index'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let core: Core | null = null

function resolveMigrationsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}

/**
 * MCP stdio 브리지의 경로.
 *
 * claude가 이 파일을 자식 프로세스로 띄운다. 번들되지 않는 원본 `.mjs`라
 * 마이그레이션과 같은 방식으로 패키징 시 위치가 달라진다.
 */
function resolveBridgePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mcp-bridge.mjs')
    : join(app.getAppPath(), 'core/mcp/bridge.mjs')
}

/**
 * 실행 중인 창. run 이벤트를 webContents.send로 흘릴 때 쓴다.
 * 창이 닫히면 null이 되므로 호출자는 항상 존재 여부를 확인해야 한다.
 * export하지 않는다 — 필요한 곳에는 registerIpc로 주입한다(순환 import 방지).
 */
function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// e2e와 개발용으로 데이터 디렉토리를 갈아끼운다. app 이벤트 등록보다,
// 그리고 아래 requestSingleInstanceLock()보다 먼저 해야 한다 — 잠금이 userData
// 디렉토리를 기준으로 걸리기 때문이다(아래 주석 참고).
//
// 공백만 있는 값은 지정하지 않은 것으로 본다. 상대 경로는 여기서 걸러낸다:
// app.setPath에 그대로 넘기면 "Path must be absolute"가 모듈 최상위에서 던져지는데,
// 그 자리는 아래 createCore의 try/catch 바깥이라 아무 메시지도 남기지 않고 종료도
// 하지 않는 앱이 된다(실측). dialog.showErrorBox는 whenReady 전에도 부를 수 있으므로
// 나머지 실패와 같은 경로(showErrorBox + quit)로 보낸다.
const testDataDir = process.env['ONE_DESK_USER_DATA']?.trim()
const dataDirError = testDataDir && !isAbsolute(testDataDir)
  ? `ONE_DESK_USER_DATA는 절대 경로여야 합니다: ${testDataDir}`
  : null
if (testDataDir && !dataDirError) app.setPath('userData', testDataDir)

// 두 인스턴스가 같은 SQLite를 열면 서로의 종료 정리가 상대를 덮어쓴다.
// 2단계부터는 같은 run을 두 번 spawn하는 문제까지 생긴다.
// 잠금을 얻지 못하면 quit만 하고 아무것도 초기화하지 않는다 —
// 아래 초기화 전체가 else 안에 있어야 하는 이유다.
//
// 데이터 디렉토리를 돌린 인스턴스에도 잠금을 똑같이 건다. Electron의 단일 인스턴스
// 잠금은 userData 디렉토리를 기준으로 잡히고 위의 app.setPath가 그보다 먼저 실행되므로,
// ONE_DESK_USER_DATA를 준 인스턴스는 기본 디렉토리의 잠금과 애초에 경쟁하지 않는다
// (Electron 43.3.0 실측). 즉 pnpm dev가 떠 있어도 e2e는 정상적으로 뜬다.
// 반대로 같은 ONE_DESK_USER_DATA를 공유하는 두 인스턴스는 이 잠금이 막아준다 —
// 위에 적은 위험이 정확히 그 경우이므로 여기를 건너뛰게 만들지 말 것.
if (dataDirError) {
  dialog.showErrorBox('one-desk를 시작할 수 없습니다', dataDirError)
  app.quit()
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    try {
      core = createCore({
        dataDir: app.getPath('userData'),
        migrationsDir: resolveMigrationsDir(),
        bridgePath: resolveBridgePath(),
        // core는 목적지를 모른다. main이 정한다.
        onError: (message, err) => { console.error(message, err) }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox('one-desk를 시작할 수 없습니다', message)
      app.quit()
      return
    }

    registerIpc(core, getMainWindow)
    createWindow()

    app.on('activate', () => {
      // macOS에서 dock 아이콘을 눌렀을 때. 창이 살아 있으면 새로 만들지 않고 포커스만 준다.
      const existing = getMainWindow()
      if (existing) {
        existing.focus()
      } else {
        createWindow()
      }
    })
  })

  // will-quit에서 DB를 닫는다 (before-quit이 아니다).
  // Electron 종료 순서: before-quit → 각 창의 close → will-quit → quit.
  // 창의 close가 취소되면(예: "실행 중인 run이 있습니다" 확인 대화상자) 종료 자체가
  // 취소되는데, before-quit에서 이미 DB를 닫아버리면 앱이 죽은 DB 연결로 계속
  // 살아남아 이후 모든 읽기/쓰기가 "The database connection is not open"으로
  // 실패한다. will-quit은 모든 창이 닫힌 뒤에만 실행되므로 취소 경로가 없다.
  // 실행 중인 agent 프로세스 정리도 반드시 여기(will-quit)에 붙여라
  // — before-quit으로 되돌리지 말 것.
  app.on('will-quit', () => {
    core?.shutdown()
    core = null
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
