import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { OneDeskClient } from '@shared/client'

const client: OneDeskClient = {
  workspaces: {
    list: () => ipcRenderer.invoke(CHANNELS.workspacesList),
    create: (input) => ipcRenderer.invoke(CHANNELS.workspacesCreate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.workspacesRemove, id)
  },
  repos: {
    list: (workspaceId) => ipcRenderer.invoke(CHANNELS.reposList, workspaceId),
    create: (input) => ipcRenderer.invoke(CHANNELS.reposCreate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.reposRemove, id)
  },
  issues: {
    list: (query) => ipcRenderer.invoke(CHANNELS.issuesList, query),
    create: (input) => ipcRenderer.invoke(CHANNELS.issuesCreate, input),
    update: (input) => ipcRenderer.invoke(CHANNELS.issuesUpdate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.issuesRemove, id)
  },
  memos: {
    list: (query) => ipcRenderer.invoke(CHANNELS.memosList, query),
    create: (input) => ipcRenderer.invoke(CHANNELS.memosCreate, input),
    update: (input) => ipcRenderer.invoke(CHANNELS.memosUpdate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.memosRemove, id)
  }
}

contextBridge.exposeInMainWorld('oneDesk', client)
