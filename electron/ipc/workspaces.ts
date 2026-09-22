import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type {
  CreateWorkspaceInput, UpdateWorkspaceDefaultsInput, UpdateWorkspacePathsInput
} from '@shared/models'

export function registerWorkspaceHandlers(core: Core) {
  ipcMain.handle(CHANNELS.workspacesList, () => core.workspaces.list())
  ipcMain.handle(CHANNELS.workspacesCreate, (_e, input: CreateWorkspaceInput) =>
    core.workspaces.create(input)
  )
  ipcMain.handle(CHANNELS.workspacesRename, (_e, id: string, name: string) =>
    core.workspaces.rename(id, name)
  )
  ipcMain.handle(CHANNELS.workspacesUpdateDefaults, (_e, input: UpdateWorkspaceDefaultsInput) =>
    core.workspaces.updateDefaults(input)
  )
  ipcMain.handle(CHANNELS.workspacesUpdatePaths, (_e, input: UpdateWorkspacePathsInput) =>
    core.workspaces.updatePaths(input)
  )
  ipcMain.handle(CHANNELS.workspacesCheckAgents, (_e, workspaceId: string) =>
    core.workspaces.checkAgents(workspaceId)
  )
  ipcMain.handle(CHANNELS.workspacesProbeAgents, (_e, workspaceId: string, refresh?: boolean) =>
    core.workspaces.probeAgents(workspaceId, refresh)
  )
  ipcMain.handle(CHANNELS.workspacesRemove, (_e, id: string) => core.workspaces.remove(id))
}
