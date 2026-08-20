import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateWorkspaceInput } from '@shared/models'

export function registerWorkspaceHandlers(core: Core) {
  ipcMain.handle(CHANNELS.workspacesList, () => core.workspaces.list())
  ipcMain.handle(CHANNELS.workspacesCreate, (_e, input: CreateWorkspaceInput) =>
    core.workspaces.create(input)
  )
  ipcMain.handle(CHANNELS.workspacesRename, (_e, id: string, name: string) =>
    core.workspaces.rename(id, name)
  )
  ipcMain.handle(CHANNELS.workspacesRemove, (_e, id: string) => core.workspaces.remove(id))
}
