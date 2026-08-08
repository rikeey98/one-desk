import type { Core } from '@core/index'
import { registerWorkspaceHandlers } from './workspaces'
import { registerRepoHandlers } from './repos'
import { registerIssueHandlers } from './issues'
import { registerMemoHandlers } from './memos'

export function registerIpc(core: Core) {
  registerWorkspaceHandlers(core)
  registerRepoHandlers(core)
  registerIssueHandlers(core)
  registerMemoHandlers(core)
}
