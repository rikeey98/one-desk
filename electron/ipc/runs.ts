import { ipcMain } from 'electron'
import { CHANNELS, EVENT_CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { StartRunInput } from '@shared/models'
import type { GetWindow } from './index'

export function registerRunHandlers(core: Core, getWindow: GetWindow) {
  ipcMain.handle(CHANNELS.runsList, (_e, workspaceId: string) => core.runs.list(workspaceId))
  ipcMain.handle(CHANNELS.runsStart, (_e, input: StartRunInput) => core.execution.start(input))
  ipcMain.handle(CHANNELS.runsCancel, (_e, runId: string) => core.execution.cancel(runId))
  ipcMain.handle(CHANNELS.runsReadLog, (_e, runId: string) => core.runs.readLog(runId))

  // core의 이벤트를 렌더러로 중계한다. 데몬화 시 바뀌는 곳은 여기 한 지점뿐이다.
  core.onRunEvent((event) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.runEvent, event)
  })
  core.onRunUpdate((run) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.runUpdate, run)
  })
}
