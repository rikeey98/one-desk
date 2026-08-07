export type AgentKind = 'claude-code' | 'opencode'
export type Permission = 'read_only' | 'edit' | 'full'
export type IssueStatus = 'open' | 'doing' | 'done'

export interface Workspace {
  id: string
  name: string
  description: string | null
  defaultAgentKind: AgentKind
  defaultModelClaude: string | null
  defaultModelOpencode: string | null
  defaultPermission: Permission
  claudePath: string | null
  opencodePath: string | null
  createdAt: number
  updatedAt: number
}

export interface Repo {
  id: string
  workspaceId: string
  name: string
  path: string
  description: string | null
  sortOrder: number
  createdAt: number
}

export interface Issue {
  id: string
  workspaceId: string
  title: string
  body: string
  status: IssueStatus
  repoIds: string[]
  createdAt: number
  updatedAt: number
  closedAt: number | null
}

export interface Memo {
  id: string
  workspaceId: string
  title: string
  body: string
  repoIds: string[]
  createdAt: number
  updatedAt: number
}

export interface CreateWorkspaceInput {
  name: string
  description?: string | null
}

export interface CreateRepoInput {
  workspaceId: string
  name: string
  path: string
  description?: string | null
}

export interface CreateIssueInput {
  workspaceId: string
  title: string
  body?: string
  repoIds?: string[]
}

export interface UpdateIssueInput {
  id: string
  title?: string
  body?: string
  status?: IssueStatus
  repoIds?: string[]
}

export interface CreateMemoInput {
  workspaceId: string
  title: string
  body?: string
  repoIds?: string[]
}

export interface UpdateMemoInput {
  id: string
  title?: string
  body?: string
  repoIds?: string[]
}

/** repoId가 주어지면 그 repo에 태그된 항목 + 태그가 없는 공통 항목을 함께 반환한다 (설계 §9). */
export interface ListQuery {
  workspaceId: string
  repoId?: string
}
