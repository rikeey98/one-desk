import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateIssueInput, UpdateIssueInput, GuardedUpdateIssueInput, ListQuery } from '@shared/models'

export function registerIssueHandlers(core: Core) {
  ipcMain.handle(CHANNELS.issuesList, (_e, q: ListQuery) => core.issues.list(q))
  ipcMain.handle(CHANNELS.issuesCreate, (_e, i: CreateIssueInput) => core.issues.create(i))
  ipcMain.handle(CHANNELS.issuesUpdate, (_e, i: UpdateIssueInput) => core.issues.update(i))
  ipcMain.handle(
    CHANNELS.issuesUpdateIfUnchanged,
    (_e, i: GuardedUpdateIssueInput) => core.issues.updateIfUnchanged(i)
  )
  ipcMain.handle(CHANNELS.issuesRemove, (_e, id: string) => core.issues.remove(id))
}
