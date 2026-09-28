import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { FileSearchInput } from '@shared/models'

export function registerFileHandlers(core: Core) {
  ipcMain.handle(CHANNELS.filesSearch, (_e, input: FileSearchInput) => core.files.search(input))
}
