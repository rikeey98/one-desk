import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateRepoInput } from '@shared/models'

export function registerRepoHandlers(core: Core) {
  ipcMain.handle(CHANNELS.reposList, (_e, workspaceId: string) =>
    core.repos.list(workspaceId))
  ipcMain.handle(CHANNELS.reposCreate, (_e, input: CreateRepoInput) =>
    core.repos.create(input))
  ipcMain.handle(CHANNELS.reposRename, (_e, id: string, name: string) =>
    core.repos.rename(id, name)
  )
  ipcMain.handle(CHANNELS.reposRemove, (_e, id: string) =>
    core.repos.remove(id))
}
