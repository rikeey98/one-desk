import type { Core } from '@core/index'
import { registerWorkspaceHandlers } from './workspaces'

export function registerIpc(core: Core) {
  registerWorkspaceHandlers(core)
}
