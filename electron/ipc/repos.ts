import { ipcMain, shell } from 'electron'
import { CHANNELS } from '@shared/channels'
import { vscodeFolderUrl } from '@core/editor/vscodeUrl'
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
  // `shell`은 electron 전용이라 core가 부를 수 없다. URL 조립만 순수 함수로
  // 떼어내 core에서 테스트하고, 여기는 경로를 찾아 넘기는 일만 한다.
  ipcMain.handle(CHANNELS.reposOpenInEditor, (_e, id: string) =>
    shell.openExternal(vscodeFolderUrl(core.repos.get(id).path)))
}
