import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { OneDeskClient } from '@shared/client'
import type { Workspace, Repo, Issue, Memo } from '@shared/models'

/**
 * ipcRenderer.invoke가 실패하면 Electron이 오류를
 * "Error invoking remote method '<channel>': Error: <원본 메시지>" 형태로
 * 두 번 감싸서 던진다. 렌더러는 전송 계층을 몰라야 하므로(설계 §4 규칙 2)
 * 채널명과 이중 Error: 접두사를 벗겨 원본 메시지만 남긴다.
 * 정규식이 매칭되지 않으면(포맷이 바뀐 경우) 메시지를 잃지 않도록 원본을 그대로 던진다.
 */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const m = raw.match(/^Error invoking remote method '[^']*': (?:\w*Error: )?([\s\S]*)$/)
    throw new Error(m?.[1] ?? raw)
  }
}

const client: OneDeskClient = {
  workspaces: {
    list: () => call<Workspace[]>(CHANNELS.workspacesList),
    create: (input) => call<Workspace>(CHANNELS.workspacesCreate, input),
    remove: (id) => call<void>(CHANNELS.workspacesRemove, id)
  },
  repos: {
    list: (workspaceId) => call<Repo[]>(CHANNELS.reposList, workspaceId),
    create: (input) => call<Repo>(CHANNELS.reposCreate, input),
    remove: (id) => call<void>(CHANNELS.reposRemove, id)
  },
  issues: {
    list: (query) => call<Issue[]>(CHANNELS.issuesList, query),
    create: (input) => call<Issue>(CHANNELS.issuesCreate, input),
    update: (input) => call<Issue>(CHANNELS.issuesUpdate, input),
    remove: (id) => call<void>(CHANNELS.issuesRemove, id)
  },
  memos: {
    list: (query) => call<Memo[]>(CHANNELS.memosList, query),
    create: (input) => call<Memo>(CHANNELS.memosCreate, input),
    update: (input) => call<Memo>(CHANNELS.memosUpdate, input),
    remove: (id) => call<void>(CHANNELS.memosRemove, id)
  }
}

contextBridge.exposeInMainWorld('oneDesk', client)
