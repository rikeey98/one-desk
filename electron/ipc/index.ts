import type { Core } from '@core/index'
import { registerWorkspaceHandlers } from './workspaces'
import { registerRepoHandlers } from './repos'

export function registerIpc(core: Core) {
  registerWorkspaceHandlers(core)
  registerRepoHandlers(core)
}
