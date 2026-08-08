import type {
  Workspace, Repo, Issue, Memo, Run,
  CreateWorkspaceInput, CreateRepoInput,
  CreateIssueInput, UpdateIssueInput,
  CreateMemoInput, UpdateMemoInput,
  ListQuery, StartRunInput
} from './models'
import type { RunEvent } from './events'

export type Unsubscribe = () => void

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
  runs: {
    list(workspaceId: string): Promise<Run[]>
    /** 완료를 기다리지 않는다. running 상태의 run이 곧바로 돌아온다. */
    start(input: StartRunInput): Promise<Run>
    cancel(runId: string): Promise<void>
    readLog(runId: string): Promise<RunEvent[]>
  }
  events: {
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe
    onRunUpdate(cb: (run: Run) => void): Unsubscribe
  }
}
