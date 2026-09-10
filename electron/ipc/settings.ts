import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { GlobalRoots } from '@shared/models'

export function registerSettingHandlers(core: Core) {
  ipcMain.handle(CHANNELS.settingsGetGlobalRoots, () => core.settings.globalRoots())
  ipcMain.handle(
    CHANNELS.settingsSetGlobalRoots,
    (_e, roots: GlobalRoots) => core.settings.setGlobalRoots(roots)
  )
}
