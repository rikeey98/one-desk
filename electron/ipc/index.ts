import type { BrowserWindow } from 'electron'
import type { Core } from '@core/index'
import { registerWorkspaceHandlers } from './workspaces'
import { registerRepoHandlers } from './repos'
import { registerIssueHandlers } from './issues'
import { registerMemoHandlers } from './memos'
import { registerRunHandlers } from './runs'

/**
 * 창 접근자. main.ts에서 import하면 main → ipc/index → ipc/runs → main 순환이 생기고,
 * main.ts는 최상위 부수효과를 가진 진입점이라 평가 순서에 기대는 구조가 된다.
 * 주입으로 끊는다. 창이 닫히면 null이므로 호출자는 항상 존재 여부를 확인해야 한다.
 */
export type GetWindow = () => BrowserWindow | null

export function registerIpc(core: Core, getWindow: GetWindow) {
  registerWorkspaceHandlers(core)
  registerRepoHandlers(core)
  registerIssueHandlers(core)
  registerMemoHandlers(core)
  registerRunHandlers(core, getWindow)
}
