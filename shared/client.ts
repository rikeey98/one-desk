import type {
  Workspace, Repo, Issue, Memo,
  CreateWorkspaceInput, CreateRepoInput,
  CreateIssueInput, UpdateIssueInput,
  CreateMemoInput, UpdateMemoInput,
  ListQuery
} from './models'

export interface OneDeskClient {
  workspaces: {
    list(): Promise<Workspace[]>
    create(input: CreateWorkspaceInput): Promise<Workspace>
    remove(id: string): Promise<void>
  }
  repos: {
    list(workspaceId: string): Promise<Repo[]>
    create(input: CreateRepoInput): Promise<Repo>
    remove(id: string): Promise<void>
  }
  issues: {
    list(query: ListQuery): Promise<Issue[]>
    create(input: CreateIssueInput): Promise<Issue>
    update(input: UpdateIssueInput): Promise<Issue>
    remove(id: string): Promise<void>
  }
  memos: {
    list(query: ListQuery): Promise<Memo[]>
    create(input: CreateMemoInput): Promise<Memo>
    update(input: UpdateMemoInput): Promise<Memo>
    remove(id: string): Promise<void>
  }
}
