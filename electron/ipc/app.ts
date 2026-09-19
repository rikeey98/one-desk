import { app, ipcMain, shell } from 'electron'
import { CHANNELS } from '@shared/channels'
import { revealDir } from '@core/app/reveal'
import type { Core } from '@core/index'
import type { AppInfo } from '@shared/models'

export function registerAppHandlers(core: Core) {
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
}
