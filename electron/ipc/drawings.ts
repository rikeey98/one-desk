import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateDrawingInput, DrawingListQuery, SaveSceneInput } from '@shared/models'

/** repo의 그림 (docs/sdlc/drawings/ spec §4). 핸들러는 core 호출 한 줄이다 */
export function registerDrawingHandlers(core: Core) {
  ipcMain.handle(CHANNELS.drawingsList, (_e, q: DrawingListQuery) => core.drawings.list(q))
  ipcMain.handle(CHANNELS.drawingsGet, (_e, id: string) => core.drawings.find(id))
  ipcMain.handle(CHANNELS.drawingsCreate, (_e, i: CreateDrawingInput) => core.drawings.create(i))
  ipcMain.handle(CHANNELS.drawingsRename, (_e, id: string, title: string) => core.drawings.rename(id, title))
  ipcMain.handle(CHANNELS.drawingsSaveScene, (_e, i: SaveSceneInput) => core.drawings.saveScene(i))
  ipcMain.handle(CHANNELS.drawingsRemove, (_e, id: string) => core.drawings.remove(id))
}
