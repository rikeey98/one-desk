import { ipcMain } from 'electron'
import { CHANNELS, EVENT_CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { ResumeRunInput, StartRunInput } from '@shared/models'
import type { GetWindow } from './index'

export function registerRunHandlers(core: Core, getWindow: GetWindow) {
  ipcMain.handle(CHANNELS.runsList, (_e, workspaceId: string) => core.runs.list(workspaceId))
  ipcMain.handle(CHANNELS.runsStart, (_e, input: StartRunInput) => core.execution.start(input))
  ipcMain.handle(CHANNELS.runsCancel, (_e, runId: string) => core.execution.cancel(runId))
  ipcMain.handle(CHANNELS.runsReadLog, (_e, runId: string) => core.runs.readLog(runId))
  ipcMain.handle(CHANNELS.runsQueueSnapshot, () => core.queue.snapshot())
  ipcMain.handle(CHANNELS.runsSetConcurrencyLimit, (_e, n: number) => core.queue.setLimit(n))
  ipcMain.handle(CHANNELS.runsInbox, () => core.inbox.list())
  ipcMain.handle(CHANNELS.runsInboxCounts, () => core.inbox.counts())
  ipcMain.handle(
    CHANNELS.runsMarkReviewed,
    (_e, runId: string, kind: 'confirmed' | 'archived') => core.inbox.markReviewed(runId, kind)
  )
  ipcMain.handle(CHANNELS.runsResume, (_e, input: ResumeRunInput) => core.execution.resume(input))
  ipcMain.handle(CHANNELS.runsClose, (_e, rootRunId: string) => core.conversations.close(rootRunId))
  ipcMain.handle(
    CHANNELS.runsRename,
    (_e, rootRunId: string, title: string) => core.conversations.rename(rootRunId, title)
  )
  ipcMain.handle(
    CHANNELS.runsAssignIssue,
    (_e, rootRunId: string, issueId: string | null) => core.conversations.assignIssue(rootRunId, issueId)
  )
  ipcMain.handle(CHANNELS.mcpStatus, () => core.mcpStatus())
  ipcMain.handle(CHANNELS.accountPlanUsage, () => core.planUsage())

  // core의 이벤트를 렌더러로 중계한다. 데몬화 시 바뀌는 곳은 여기 한 지점뿐이다.
  core.onRunEvent((event) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.runEvent, event)
  })
  core.onRunUpdate((run) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.runUpdate, run)
  })
  core.onQueueUpdate((snapshot) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.queueUpdate, snapshot)
  })
  core.onInboxUpdate((counts) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.inboxUpdate, counts)
  })
  core.onMcpStatus((status) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.mcpStatusUpdate, status)
  })
  core.onPlanUsage((usage) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.planUsageUpdate, usage)
  })
}
