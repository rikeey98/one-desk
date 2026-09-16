import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CommandTarget } from '@shared/models'

export function registerCommandHandlers(core: Core) {
  ipcMain.handle(CHANNELS.commandsList, (_e, target: CommandTarget) => core.commands.list(target))
  ipcMain.handle(CHANNELS.commandsRefresh, (_e, target: CommandTarget) => core.commands.refresh(target))
}
