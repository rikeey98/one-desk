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

// 종료 직전에 DB를 닫는다. 2단계에서는 여기에 실행 중인 agent 프로세스 정리도 붙는다.
app.on('before-quit', () => {
  core?.close()
  core = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
