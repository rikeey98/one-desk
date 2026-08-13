import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateMemoInput, UpdateMemoInput, GuardedUpdateMemoInput, ListQuery } from '@shared/models'

export function registerMemoHandlers(core: Core) {
  ipcMain.handle(CHANNELS.memosList, (_e, q: ListQuery) => core.memos.list(q))
  ipcMain.handle(CHANNELS.memosCreate, (_e, i: CreateMemoInput) => core.memos.create(i))
  ipcMain.handle(CHANNELS.memosUpdate, (_e, i: UpdateMemoInput) => core.memos.update(i))
  ipcMain.handle(
    CHANNELS.memosUpdateIfUnchanged,
    (_e, i: GuardedUpdateMemoInput) => core.memos.updateIfUnchanged(i)
  )
  ipcMain.handle(CHANNELS.memosRemove, (_e, id: string) => core.memos.remove(id))
}
