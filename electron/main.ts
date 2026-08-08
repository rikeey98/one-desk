import { app, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createCore, type Core } from '@core/index'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let core: Core | null = null

function resolveMigrationsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}

/**
 * 실행 중인 창. 2단계에서 run 이벤트를 webContents.send로 흘릴 때 쓴다.
 * 창이 닫히면 null이 되므로 호출자는 항상 존재 여부를 확인해야 한다.
 */
export function getMainWindow(): BrowserWindow | null {
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

app.whenReady().then(() => {
  try {
    core = createCore({
      dataDir: app.getPath('userData'),
      migrationsDir: resolveMigrationsDir()
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('one-desk를 시작할 수 없습니다', message)
    app.quit()
    return
  }

  registerIpc(core)
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
// 2단계에서 실행 중인 agent 프로세스 정리를 추가할 때도 반드시 여기(will-quit)에
// 붙여라 — before-quit으로 되돌리지 말 것.
app.on('will-quit', () => {
  core?.close()
  core = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
