import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { BuildReportInput } from '@shared/models'

export function registerReportHandlers(core: Core) {
  ipcMain.handle(CHANNELS.reportsBuild, (_e, i: BuildReportInput) => core.reports.build(i))
}
