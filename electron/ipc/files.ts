import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { FileRef, FileSaveInput, FileSearchInput, FileTreeInput } from '@shared/models'

export function registerFileHandlers(core: Core) {
  ipcMain.handle(CHANNELS.filesSearch, (_e, input: FileSearchInput) => core.files.search(input))
  ipcMain.handle(CHANNELS.filesTree, (_e, input: FileTreeInput) => core.files.tree(input))
  ipcMain.handle(CHANNELS.filesOpen, (_e, ref: FileRef) => core.files.open(ref))
  ipcMain.handle(CHANNELS.filesSave, (_e, input: FileSaveInput) => core.files.save(input))
  ipcMain.handle(CHANNELS.filesProbe, (_e, ref: FileRef) => core.files.probe(ref))
}
