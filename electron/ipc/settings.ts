import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { AgentPaths, GlobalRoots } from '@shared/models'

export function registerSettingHandlers(core: Core) {
  ipcMain.handle(CHANNELS.settingsGetGlobalRoots, () => core.settings.globalRoots())
  ipcMain.handle(
    CHANNELS.settingsSetGlobalRoots,
    (_e, roots: GlobalRoots) => core.settings.setGlobalRoots(roots)
  )
  ipcMain.handle(CHANNELS.settingsGetAgentPaths, () => core.settings.agentPaths())
  ipcMain.handle(
    CHANNELS.settingsSetAgentPaths,
    (_e, paths: AgentPaths) => core.settings.setAgentPaths(paths)
  )
  ipcMain.handle(CHANNELS.settingsGetTerminalShell, () => core.settings.terminalShell())
  ipcMain.handle(
    CHANNELS.settingsSetTerminalShell,
    (_e, path: string | null) => core.settings.setTerminalShell(path)
  )
  // WSL (docs/sdlc/wsl-support/ FR-4·12·27) — core 호출 한 줄씩
  ipcMain.handle(CHANNELS.settingsGetWslClaudePath, () => core.settings.wslClaudePath())
  ipcMain.handle(CHANNELS.settingsSetWslClaudePath, (_e, path: string | null) => core.settings.setWslClaudePath(path))
  ipcMain.handle(CHANNELS.settingsGetWslGlobalRoots, () => core.settings.wslGlobalRoots())
  ipcMain.handle(CHANNELS.settingsSetWslGlobalRoots, (_e, roots: string[]) => core.settings.setWslGlobalRoots(roots))
  ipcMain.handle(CHANNELS.wslListDistros, () => core.wsl.listDistros())
}
