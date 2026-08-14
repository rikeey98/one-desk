import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENT_CHANNELS } from '@shared/channels'
import type { OneDeskClient, Unsubscribe } from '@shared/client'
import type { Workspace, Repo, Issue, Memo, Run, QueueSnapshot, InboxCounts, McpStatus, IssueUpdateResult, MemoUpdateResult } from '@shared/models'
import type { RunEvent } from '@shared/events'

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
    updateIfUnchanged: (input) =>
      call<IssueUpdateResult>(CHANNELS.issuesUpdateIfUnchanged, input),
    remove: (id) => call<void>(CHANNELS.issuesRemove, id)
  },
  memos: {
    list: (query) => call<Memo[]>(CHANNELS.memosList, query),
    create: (input) => call<Memo>(CHANNELS.memosCreate, input),
    update: (input) => call<Memo>(CHANNELS.memosUpdate, input),
    updateIfUnchanged: (input) =>
      call<MemoUpdateResult>(CHANNELS.memosUpdateIfUnchanged, input),
    remove: (id) => call<void>(CHANNELS.memosRemove, id)
  },
  runs: {
    list: (workspaceId) => call<Run[]>(CHANNELS.runsList, workspaceId),
    start: (input) => call<Run>(CHANNELS.runsStart, input),
    cancel: (runId) => call<void>(CHANNELS.runsCancel, runId),
    readLog: (runId) => call<RunEvent[]>(CHANNELS.runsReadLog, runId),
    queueSnapshot: () => call<QueueSnapshot>(CHANNELS.runsQueueSnapshot),
    setConcurrencyLimit: (n) => call<QueueSnapshot>(CHANNELS.runsSetConcurrencyLimit, n),
    inbox: () => call<Run[]>(CHANNELS.runsInbox),
    inboxCounts: () => call<InboxCounts>(CHANNELS.runsInboxCounts),
    markReviewed: (runId, kind) => call<Run>(CHANNELS.runsMarkReviewed, runId, kind),
    resume: (input) => call<Run>(CHANNELS.runsResume, input)
  },
  mcp: {
    status: () => call<McpStatus>(CHANNELS.mcpStatus)
  },
  events: {
    // contextBridge는 함수를 프록시로 넘기므로 이 클로저가 렌더러에서 호출 가능하다.
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe {
      const listener = (_e: IpcRendererEvent, event: RunEvent) => cb(event)
      ipcRenderer.on(EVENT_CHANNELS.runEvent, listener)
      return () => { ipcRenderer.off(EVENT_CHANNELS.runEvent, listener) }
    },
    onRunUpdate(cb: (run: Run) => void): Unsubscribe {
      const listener = (_e: IpcRendererEvent, run: Run) => cb(run)
      ipcRenderer.on(EVENT_CHANNELS.runUpdate, listener)
      return () => { ipcRenderer.off(EVENT_CHANNELS.runUpdate, listener) }
    },
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe {
      const listener = (_e: IpcRendererEvent, snapshot: QueueSnapshot) => cb(snapshot)
      ipcRenderer.on(EVENT_CHANNELS.queueUpdate, listener)
      return () => { ipcRenderer.off(EVENT_CHANNELS.queueUpdate, listener) }
    },
    onInboxUpdate(cb: (counts: InboxCounts) => void): Unsubscribe {
      const listener = (_e: IpcRendererEvent, counts: InboxCounts) => cb(counts)
      ipcRenderer.on(EVENT_CHANNELS.inboxUpdate, listener)
      return () => { ipcRenderer.off(EVENT_CHANNELS.inboxUpdate, listener) }
    },
    onMcpStatus(cb: (status: McpStatus) => void): Unsubscribe {
      const listener = (_e: IpcRendererEvent, status: McpStatus) => cb(status)
      ipcRenderer.on(EVENT_CHANNELS.mcpStatusUpdate, listener)
      return () => { ipcRenderer.off(EVENT_CHANNELS.mcpStatusUpdate, listener) }
    }
  }
}

contextBridge.exposeInMainWorld('oneDesk', client)
