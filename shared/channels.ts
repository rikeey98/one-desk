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
  memosRemove: 'memos:remove'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
