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
  reportsBuild: 'reports:build',
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
  filesSearch: 'files:search',
  filesTree: 'files:tree',
  filesOpen: 'files:open',
  filesSave: 'files:save',
  filesProbe: 'files:probe',
  settingsGetGlobalRoots: 'settings:getGlobalRoots',
  settingsSetGlobalRoots: 'settings:setGlobalRoots',
  settingsGetAgentPaths: 'settings:getAgentPaths',
  settingsSetAgentPaths: 'settings:setAgentPaths',
  runsList: 'runs:list',
  runsStart: 'runs:start',
  runsCancel: 'runs:cancel',
  runsReadLog: 'runs:readLog',
  runsQueueSnapshot: 'runs:queueSnapshot',
  runsSetConcurrencyLimit: 'runs:setConcurrencyLimit',
  runsInbox: 'runs:inbox',
  runsInboxCounts: 'runs:inboxCounts',
  mcpStatus: 'mcp:status',
  /** 계정의 요금제 사용률 — 메모리의 마지막 값 (docs/sdlc/plan-usage/) */
  accountPlanUsage: 'account:planUsage',
  appInfo: 'app:info',
  /** 정해진 두 위치(data·logs)만 파일 탐색기로 연다 */
  appReveal: 'app:reveal',
  /** repo 등록 — OS의 폴더 선택 대화상자를 띄운다 */
  appPickDirectory: 'app:pickDirectory',
  /** 이슈·메모·asset 패널을 repo마다 별도 창으로 연다 (docs/sdlc/item-windows/) */
  appOpenPanelWindow: 'app:openPanelWindow',
  runsMarkReviewed: 'runs:markReviewed',
  runsResume: 'runs:resume',
  runsClose: 'runs:close',
  runsRename: 'runs:rename',
  runsAssignIssue: 'runs:assignIssue'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** main → renderer 단방향 이벤트 채널 */
export const EVENT_CHANNELS = {
  runEvent: 'event:run',
  runUpdate: 'event:runUpdate',
  queueUpdate: 'event:queueUpdate',
  inboxUpdate: 'event:inboxUpdate',
  mcpStatusUpdate: 'event:mcpStatus',
  planUsageUpdate: 'event:planUsage',
  /** 모든 창으로 간다 — 나머지는 앱 창에만 (docs/sdlc/item-windows/ FR-19) */
  itemChanged: 'event:itemChanged'
} as const

export type EventChannelName = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS]
