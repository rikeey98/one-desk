export const CHANNELS = {
  workspacesList: 'workspaces:list',
  workspacesCreate: 'workspaces:create',
  workspacesRename: 'workspaces:rename',
  workspacesUpdateDefaults: 'workspaces:updateDefaults',
  workspacesUpdatePaths: 'workspaces:updatePaths',
  workspacesCheckAgents: 'workspaces:checkAgents',
  workspacesProbeAgents: 'workspaces:probeAgents',
  workspacesRemove: 'workspaces:remove',
  reposList: 'repos:list',
  reposCreate: 'repos:create',
  reposRename: 'repos:rename',
  reposUpdate: 'repos:update',
  reposRemove: 'repos:remove',
  reposOpenInEditor: 'repos:openInEditor',
  issuesList: 'issues:list',
  issuesCreate: 'issues:create',
  issuesUpdate: 'issues:update',
  issuesUpdateIfUnchanged: 'issues:updateIfUnchanged',
  issuesRemove: 'issues:remove',
  issuesMarkSeen: 'issues:markSeen',
  memosList: 'memos:list',
  memosCreate: 'memos:create',
  memosUpdate: 'memos:update',
  memosUpdateIfUnchanged: 'memos:updateIfUnchanged',
  memosRemove: 'memos:remove',
  commandsList: 'commands:list',
  commandsRefresh: 'commands:refresh',
  assetsList: 'assets:list',
  assetsCreateAuthored: 'assets:createAuthored',
  assetsUpdateIfUnchanged: 'assets:updateIfUnchanged',
  assetsRemove: 'assets:remove',
  /** 지금 workspace의 모든 repo를 다시 훑는다 */
  assetsRescan: 'assets:rescan',
  assetsReadBody: 'assets:readBody',
  settingsGetGlobalRoots: 'settings:getGlobalRoots',
  settingsSetGlobalRoots: 'settings:setGlobalRoots',
  runsList: 'runs:list',
  runsStart: 'runs:start',
  runsCancel: 'runs:cancel',
  runsReadLog: 'runs:readLog',
  runsQueueSnapshot: 'runs:queueSnapshot',
  runsSetConcurrencyLimit: 'runs:setConcurrencyLimit',
  runsInbox: 'runs:inbox',
  runsInboxCounts: 'runs:inboxCounts',
  mcpStatus: 'mcp:status',
  appInfo: 'app:info',
  /** 정해진 두 위치(data·logs)만 파일 탐색기로 연다 */
  appReveal: 'app:reveal',
  runsMarkReviewed: 'runs:markReviewed',
  runsResume: 'runs:resume'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** main → renderer 단방향 이벤트 채널 */
export const EVENT_CHANNELS = {
  runEvent: 'event:run',
  runUpdate: 'event:runUpdate',
  queueUpdate: 'event:queueUpdate',
  inboxUpdate: 'event:inboxUpdate',
  mcpStatusUpdate: 'event:mcpStatus'
} as const

export type EventChannelName = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS]
