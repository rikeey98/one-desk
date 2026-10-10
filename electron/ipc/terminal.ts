import { ipcMain } from 'electron'
import { CHANNELS, EVENT_CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { TerminalOpenInput } from '@shared/models'
import type { Windows } from './index'

/**
 * 코드 칸의 터미널 (docs/sdlc/code-editor/terminal-spec.md). 핸들러는 core 호출 한 줄씩이다(경계 3).
 * 키 입력·크기는 `send`로 온다 — 응답을 기다리지 않으므로 실패를 돌려줄 곳이 없어 로그로만 남긴다(칸은 끝난 셸에 쓰지 않는다).
 * 출력·끝남은 **앱 창에만** 보낸다 — 패널 창에는 터미널이 없다(item-windows FR-17·19).
 */
export function registerTerminalHandlers(core: Core, windows: Pick<Windows, 'getMainWindow'>) {
  ipcMain.handle(CHANNELS.terminalOpen, (_e, input: TerminalOpenInput) => core.terminal.open(input))
  ipcMain.handle(CHANNELS.terminalRestart, (_e, input: TerminalOpenInput) => core.terminal.restart(input))
  ipcMain.on(CHANNELS.terminalWrite, (_e, repoId: string, data: string) => {
    try { core.terminal.write(repoId, data) } catch (err) { console.error('one-desk: 셸에 쓰지 못했습니다', err) }
  })
  ipcMain.on(CHANNELS.terminalResize, (_e, repoId: string, cols: number, rows: number) => {
    core.terminal.resize(repoId, cols, rows)
  })
  core.onTerminalData((data) => {
    windows.getMainWindow()?.webContents.send(EVENT_CHANNELS.terminalData, data)
  })
  core.onTerminalExit((exit) => {
    windows.getMainWindow()?.webContents.send(EVENT_CHANNELS.terminalExit, exit)
  })
}
