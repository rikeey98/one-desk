import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { ScheduleInput } from '@shared/models'
import type { ScheduleTrigger } from '@shared/scheduleTrigger'

/** 정기 실행 (docs/sdlc/scheduled-runs/ FR-24). 핸들러는 core 호출 한 줄이다 — 검증은 core가 한다 */
export function registerScheduleHandlers(core: Core) {
  ipcMain.handle(CHANNELS.schedulesList, () => core.schedules.list())
  ipcMain.handle(CHANNELS.schedulesCreate, (_e, input: ScheduleInput) => core.schedules.create(input))
  ipcMain.handle(CHANNELS.schedulesUpdate, (_e, id: string, input: ScheduleInput) => core.schedules.update(id, input))
  ipcMain.handle(CHANNELS.schedulesSetEnabled, (_e, id: string, enabled: boolean) => core.schedules.setEnabled(id, enabled))
  ipcMain.handle(CHANNELS.schedulesRemove, (_e, id: string) => core.schedules.remove(id))
  ipcMain.handle(CHANNELS.schedulesRunNow, (_e, id: string) => core.schedules.runNow(id))
  ipcMain.handle(CHANNELS.schedulesFires, (_e, id: string) => core.schedules.fires(id))
  ipcMain.handle(
    CHANNELS.schedulesPreview,
    (_e, trigger: ScheduleTrigger, timeZone: string) => core.schedules.preview(trigger, timeZone)
  )
}
