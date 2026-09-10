import type {
  Workspace, Repo, Issue, Memo, Run,
  CreateWorkspaceInput, CreateRepoInput,
  CreateIssueInput, UpdateIssueInput,
  GuardedUpdateIssueInput, IssueUpdateResult,
  CreateMemoInput, UpdateMemoInput,
  GuardedUpdateMemoInput, MemoUpdateResult,
  ListQuery, StartRunInput, QueueSnapshot,
  InboxCounts,
  McpStatus, ResumeRunInput,
  Asset, CreateAuthoredAssetInput, GuardedUpdateAssetInput, AssetUpdateResult, ListAssetQuery,
  GlobalRoots
} from './models'
import type { RunEvent } from './events'

export type Unsubscribe = () => void

export interface OneDeskClient {
  workspaces: {
    list(): Promise<Workspace[]>
    create(input: CreateWorkspaceInput): Promise<Workspace>
    /** 이름만 바꾼다. description 등은 건드리지 않는다. */
    rename(id: string, name: string): Promise<Workspace>
    remove(id: string): Promise<void>
  }
  repos: {
    list(workspaceId: string): Promise<Repo[]>
    create(input: CreateRepoInput): Promise<Repo>
    /** 이름만 바꾼다. path는 실행이 도는 실제 디렉토리라 건드리지 않는다. */
    rename(id: string, name: string): Promise<Repo>
    remove(id: string): Promise<void>
  }
  issues: {
    list(query: ListQuery): Promise<Issue[]>
    create(input: CreateIssueInput): Promise<Issue>
    update(input: UpdateIssueInput): Promise<Issue>
    /**
     * 낙관적 잠금 갱신 (설계 §6). 충돌은 던지지 않고 `{ ok: false, current }`로 온다 —
     * preload가 IPC 오류의 클래스를 벗겨내 메시지만 남기므로 예외로는 가려낼 수 없다.
     */
    updateIfUnchanged(input: GuardedUpdateIssueInput): Promise<IssueUpdateResult>
    remove(id: string): Promise<void>
    /**
     * 사람이 이 이슈를 열었다고 기록한다. **updatedAt을 올리지 않는다** —
     * 올리면 열려 있는 상세의 낙관적 잠금 기대값이 낡는다.
     *
     * 부르는 쪽은 이 호출 뒤에 목록을 다시 읽지 않는다. 정렬이 seenAt 오래된
     * 순이라, 읽으면 방금 클릭한 항목이 눈앞에서 맨 아래로 도망간다.
     */
    markSeen(id: string): Promise<void>
  }
  memos: {
    list(query: ListQuery): Promise<Memo[]>
    create(input: CreateMemoInput): Promise<Memo>
    update(input: UpdateMemoInput): Promise<Memo>
    /**
     * 낙관적 잠금 갱신 (설계 §6). 충돌은 던지지 않고 `{ ok: false, current }`로 온다 —
     * preload가 IPC 오류의 클래스를 벗겨내 메시지만 남기므로 예외로는 가려낼 수 없다.
     */
    updateIfUnchanged(input: GuardedUpdateMemoInput): Promise<MemoUpdateResult>
    remove(id: string): Promise<void>
  }
  assets: {
    list(query: ListAssetQuery): Promise<Asset[]>
    createAuthored(input: CreateAuthoredAssetInput): Promise<Asset>
    /**
     * 낙관적 잠금 갱신. 충돌은 던지지 않고 `{ ok: false, current }`로 온다 —
     * preload가 IPC 오류의 클래스를 벗겨내 메시지만 남기므로 예외로는 가려낼 수 없다.
     */
    updateIfUnchanged(input: GuardedUpdateAssetInput): Promise<AssetUpdateResult>
    remove(id: string): Promise<void>
    /** 다시 훑고, 갱신된 목록을 돌려준다 */
    rescan(workspaceId: string): Promise<Asset[]>
  }
  settings: {
    globalRoots(): Promise<GlobalRoots>
    /** 저장하고 곧바로 다시 훑는다. 저장된 값을 돌려준다 */
    setGlobalRoots(roots: GlobalRoots): Promise<GlobalRoots>
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
  mcp: {
    /** 지금 상태를 한 번 읽는다. 창이 기동보다 늦게 떴을 때 필요하다. */
    status(): Promise<McpStatus>
  }
  events: {
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe
    onRunUpdate(cb: (run: Run) => void): Unsubscribe
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe
    onInboxUpdate(cb: (counts: InboxCounts) => void): Unsubscribe
    /** 창이 기동보다 먼저 떴을 때 필요하다. status()와 짝이다. */
    onMcpStatus(cb: (status: McpStatus) => void): Unsubscribe
  }
}
