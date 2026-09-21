import { ipcMain, shell } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateRepoInput, UpdateRepoInput } from '@shared/models'

export function registerRepoHandlers(core: Core) {
  ipcMain.handle(CHANNELS.reposList, (_e, workspaceId: string) =>
    core.repos.list(workspaceId))
  ipcMain.handle(CHANNELS.reposCreate, (_e, input: CreateRepoInput) =>
    core.repos.create(input))
  ipcMain.handle(CHANNELS.reposRename, (_e, id: string, name: string) =>
    core.repos.rename(id, name)
  )
  ipcMain.handle(CHANNELS.reposUpdate, (_e, input: UpdateRepoInput) =>
    core.repos.update(input))
  ipcMain.handle(CHANNELS.reposRemove, (_e, id: string) =>
    core.repos.remove(id))
  // core가 VS Code를 **새 창**으로 띄운다. CLI를 못 찾았을 때만 URL을 돌려주고,
  // `shell`은 electron 전용이라 그 마지막 한 걸음만 여기서 한다.
  ipcMain.handle(CHANNELS.reposOpenInEditor, async (_e, id: string) => {
    const { fallbackUrl } = await core.repos.openInEditor(id)
    if (fallbackUrl) await shell.openExternal(fallbackUrl)
  })
}
