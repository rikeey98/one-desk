import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { CHANNELS, EVENT_CHANNELS } from '@shared/channels'
import { revealDir } from '@core/app/reveal'
import type { Core } from '@core/index'
import type { AppInfo } from '@shared/models'
import type { Windows } from './index'

export function registerAppHandlers(core: Core, windows: Windows) {
  // 버전은 electron의 것이라 core가 모른다 — 여기서 합친다(경계 규칙 1).
  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => ({
    ...core.paths(), version: app.getVersion()
  }))
  // 대상을 실제 경로로 바꾸는 판정은 core의 순수 함수가 한다. 정해진 둘 밖의 값은
  // 거기서 던진다 — 렌더러가 임의 경로를 열 수 없어야 한다(spec NFR-3).
  ipcMain.handle(CHANNELS.appReveal, async (_e, target: unknown) => {
    const failure = await shell.openPath(revealDir(target, core.paths()))
    if (failure) throw new Error(failure)
  })
  // 경로를 고르는 것은 사람이고, 고른 경로의 검증은 여느 때처럼 repos.create가 한다.
  // 부모 창을 주어야 대화상자가 앱 창 뒤로 숨지 않는다(모달).
  ipcMain.handle(CHANNELS.appPickDirectory, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  // 범위의 검증은 core가 한다(없는 workspace·남의 repo는 던진다). 여기는 창을 여는 것뿐이다.
  ipcMain.handle(CHANNELS.appOpenPanelWindow, (_e, scope: unknown) => {
    windows.openPanelWindow(core.panelScope(scope))
  })
  // 바뀜 알림은 모든 창으로 간다 (docs/sdlc/item-windows/ FR-17·19).
  core.onItemChanged((change) => {
    for (const win of windows.getAllWindows()) win.webContents.send(EVENT_CHANNELS.itemChanged, change)
  })
}
