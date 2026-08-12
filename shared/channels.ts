export const CHANNELS = {
  workspacesList: 'workspaces:list',
  workspacesCreate: 'workspaces:create',
  workspacesRemove: 'workspaces:remove',
  reposList: 'repos:list',
  reposCreate: 'repos:create',
  reposRemove: 'repos:remove',
  issuesList: 'issues:list',
  issuesCreate: 'issues:create',
  issuesUpdate: 'issues:update',
  issuesRemove: 'issues:remove',
  memosList: 'memos:list',
  memosCreate: 'memos:create',
  memosUpdate: 'memos:update',
  memosRemove: 'memos:remove',
  runsList: 'runs:list',
  runsStart: 'runs:start',
  runsCancel: 'runs:cancel',
  runsReadLog: 'runs:readLog',
  runsQueueSnapshot: 'runs:queueSnapshot',
  runsSetConcurrencyLimit: 'runs:setConcurrencyLimit',
  runsInbox: 'runs:inbox',
  runsInboxCounts: 'runs:inboxCounts',
  runsMarkReviewed: 'runs:markReviewed',
  runsResume: 'runs:resume'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** main → renderer 단방향 이벤트 채널 */
export const EVENT_CHANNELS = {
  runEvent: 'event:run',
  runUpdate: 'event:runUpdate',
  queueUpdate: 'event:queueUpdate',
  inboxUpdate: 'event:inboxUpdate'
} as const

export type EventChannelName = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS]
