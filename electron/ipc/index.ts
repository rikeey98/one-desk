import type { BrowserWindow } from 'electron'
import type { Core } from '@core/index'
import { registerWorkspaceHandlers } from './workspaces'
import { registerRepoHandlers } from './repos'
import { registerIssueHandlers } from './issues'
import { registerMemoHandlers } from './memos'
import { registerReportHandlers } from './reports'
import { registerAssetHandlers } from './assets'
import { registerCommandHandlers } from './commands'
import { registerFileHandlers } from './files'
import { registerSettingHandlers } from './settings'
import { registerRunHandlers } from './runs'
import { registerAppHandlers } from './app'

import type { PanelScope } from '@shared/panelWindow'

/**
 * 창 접근자. main.ts에서 import하면 main → ipc/index → ipc/runs → main 순환이 생기고,
 * main.ts는 최상위 부수효과를 가진 진입점이라 평가 순서에 기대는 구조가 된다.
 * 주입으로 끊는다. 앱 창이 닫히면 null이므로 호출자는 항상 존재 여부를 확인해야 한다.
 */
export type GetWindow = () => BrowserWindow | null

/**
 * 창이 여럿이다 (docs/sdlc/item-windows/). run·큐·인박스·MCP·요금제는 앱 창에만, 바뀜 알림만 전부로
 * 간다(FR-19) — 패널 창은 그것을 그리지 않고, run 이벤트 스트림을 창마다 복제할 이유가 없다.
 */
export interface Windows {
  getMainWindow: GetWindow
  getAllWindows: () => BrowserWindow[]
  openPanelWindow: (scope: PanelScope) => void
}

export function registerIpc(core: Core, windows: Windows) {
  registerWorkspaceHandlers(core)
  registerRepoHandlers(core)
  registerIssueHandlers(core)
  registerMemoHandlers(core)
  registerReportHandlers(core)
  registerAssetHandlers(core)
  registerCommandHandlers(core)
  registerFileHandlers(core)
  registerSettingHandlers(core)
  registerRunHandlers(core, windows.getMainWindow)
  registerAppHandlers(core, windows)
}
