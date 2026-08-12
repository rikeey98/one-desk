import type {
  Workspace, Repo, Issue, Memo, Run,
  CreateWorkspaceInput, CreateRepoInput,
  CreateIssueInput, UpdateIssueInput,
  CreateMemoInput, UpdateMemoInput,
  ListQuery, StartRunInput, QueueSnapshot,
  InboxCounts, ResumeRunInput
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
    /**
     * 완료를 기다리지 않는다. 슬롯이 있으면 running, 상한에 걸리면 pending run이
     * 곧바로 돌아온다. 이후 상태 변화는 events.onRunUpdate로만 알 수 있다.
     */
    start(input: StartRunInput): Promise<Run>
    cancel(runId: string): Promise<void>
    readLog(runId: string): Promise<RunEvent[]>
    /** 전역 실행 슬롯 현황. workspace와 무관하다. */
    queueSnapshot(): Promise<QueueSnapshot>
    setConcurrencyLimit(n: number): Promise<QueueSnapshot>
    /** 지금 사용자의 손이 필요한 run. 모든 workspace를 가로지른다. */
    inbox(): Promise<Run[]>
    inboxCounts(): Promise<InboxCounts>
    /** 인박스에서 내린다. 확인함은 'confirmed', 보관은 'archived'. */
    markReviewed(runId: string, kind: 'confirmed' | 'archived'): Promise<Run>
    /** 원본의 세션을 이어받아 실행한다. agentKind와 cwd는 원본에서 온다. */
    resume(input: ResumeRunInput): Promise<Run>
  }
  events: {
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe
    onRunUpdate(cb: (run: Run) => void): Unsubscribe
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe
    onInboxUpdate(cb: (counts: InboxCounts) => void): Unsubscribe
  }
}
