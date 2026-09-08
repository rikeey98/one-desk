import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type {
  CreateAuthoredAssetInput, GuardedUpdateAssetInput, ListAssetQuery
} from '@shared/models'

export function registerAssetHandlers(core: Core) {
  ipcMain.handle(CHANNELS.assetsList, (_e, q: ListAssetQuery) => core.assets.list(q))
  ipcMain.handle(
    CHANNELS.assetsCreateAuthored,
    (_e, i: CreateAuthoredAssetInput) => core.assets.createAuthored(i)
  )
  ipcMain.handle(
    CHANNELS.assetsUpdateIfUnchanged,
    (_e, i: GuardedUpdateAssetInput) => core.assets.updateIfUnchanged(i)
  )
  ipcMain.handle(CHANNELS.assetsRemove, (_e, id: string) => core.assets.remove(id))
  ipcMain.handle(CHANNELS.assetsRescan, (_e, workspaceId: string) =>
    core.assets.rescan(workspaceId))
}
