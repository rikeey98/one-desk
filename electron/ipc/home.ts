import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { HomeSummaryInput, HomeTarget } from '@shared/models'

/** 홈 (docs/sdlc/home/). 핸들러는 core 호출 한 줄이다 — MCP에는 없는 길이다(FR-1). */
export function registerHomeHandlers(core: Core) {
  ipcMain.handle(CHANNELS.homeSummary, (_e, i: HomeSummaryInput) => core.home.summary(i))
  ipcMain.handle(CHANNELS.homeCount, (_e, i: Pick<HomeSummaryInput, 'now'>) => core.home.count(i))
  ipcMain.handle(CHANNELS.homeLastTarget, () => core.home.lastTarget())
  ipcMain.handle(CHANNELS.homeSetLastTarget, (_e, t: HomeTarget) => core.home.setLastTarget(t))
}
