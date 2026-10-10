import type {
  Workspace, Repo, Issue, Memo, Run,
  CreateWorkspaceInput, CreateRepoInput,
  CreateIssueInput, UpdateIssueInput,
  GuardedUpdateIssueInput, IssueUpdateResult,
  CreateMemoInput, UpdateMemoInput,
  GuardedUpdateMemoInput, MemoUpdateResult,
  ListQuery, StartRunInput, QueueSnapshot, BuildReportInput, ReportData,
  UpdateWorkspaceDefaultsInput, UpdateWorkspacePathsInput, AgentStatuses, AgentProbes,
  InboxCounts,
  McpStatus, PlanUsage, ResumeRunInput, ItemChange,
  Asset, CreateAuthoredAssetInput, GuardedUpdateAssetInput, AssetUpdateResult, ListAssetQuery,
  GlobalRoots, AgentPaths, CommandTarget, CommandListResult,
  UpdateRepoInput, AppInfo, RevealTarget, AssetBody, FileSearchInput, FileSearchResult,
  FileRef, FileTreeInput, FileTreeResult, FileOpenResult, FileSaveInput, FileSaveResult, FileProbeResult,
  TerminalOpenInput, TerminalSession, TerminalData, TerminalExit, TerminalShellSetting
} from './models'
import type { RunEvent } from './events'
import type { PanelScope } from './panelWindow'

export type Unsubscribe = () => void

export interface OneDeskClient {
  workspaces: {
    list(): Promise<Workspace[]>
    create(input: CreateWorkspaceInput): Promise<Workspace>
    /** 이름만 바꾼다. description 등은 건드리지 않는다. */
    rename(id: string, name: string): Promise<Workspace>
    /**
     * 실행 기본값(agent·모델 둘)을 한 번에 세운다 (설계 §403).
     * 부분 갱신이 아니다 — 세 값을 전부 넘긴다. 모델의 빈 문자열은 null로 저장된다.
     */
    updateDefaults(input: UpdateWorkspaceDefaultsInput): Promise<Workspace>
    /**
     * CLI 실행 파일 경로를 세운다 (설계 §595). 기본값과 따로 저장하는 이유는
     * 고치는 때가 다르기 때문이다 — 저장소 주석 참고.
     */
    updatePaths(input: UpdateWorkspacePathsInput): Promise<Workspace>
    /**
     * 지금 이 workspace로 실행하면 두 CLI가 각각 어디서 잡히는지 확인한다.
     * 실행을 막는 것과 같은 판정이라, 화면의 표시와 실행 버튼이 어긋나지 않는다.
     */
    checkAgents(workspaceId: string): Promise<AgentStatuses>
    /**
     * 느린 칸 — 인증과 모델 (docs/sdlc/agent-setup/).
     *
     * `checkAgents`와 **따로** 부른다. 화면은 둘을 같이 띄워 빠른 것으로 먼저
     * 그리고 이 결과가 오면 채운다 — 합치면 workspace를 고를 때마다 실행 파일
     * 줄까지 1초씩 비어 있게 된다(spec NFR-4).
     *
     * `refresh`가 참이면 캐시를 버린다. `다시 확인` 버튼이 쓴다.
     */
    probeAgents(workspaceId: string, refresh?: boolean): Promise<AgentProbes>
    remove(id: string): Promise<void>
  }
  repos: {
    list(workspaceId: string): Promise<Repo[]>
    create(input: CreateRepoInput): Promise<Repo>
    /** 이름만 바꾼다. path는 실행이 도는 실제 디렉토리라 건드리지 않는다. */
    rename(id: string, name: string): Promise<Repo>
    /**
     * 이름·설명·경로를 고친다 (settings-screen spec FR-8). 경로를 바꾸면 그 아래
     * asset의 file_path가 함께 옮겨지고 다시 훑는다(FR-9). 존재하지 않는 경로는 거부된다.
     */
    update(input: UpdateRepoInput): Promise<Repo>
    remove(id: string): Promise<void>
    /**
     * repo 디렉토리를 VS Code에서 연다. 경로가 아니라 id를 넘긴다 — 렌더러가
     * 등록되지 않은 아무 경로나 열어달라고 할 수 없어야 한다.
     *
     * VS Code가 없거나 `vscode://` 스킴이 등록되지 않았으면 던진다.
     */
    openInEditor(id: string): Promise<void>
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
  reports: {
    /**
     * 기간 리포트 (`docs/sdlc/period-report/` FR-1). workspace를 넘어 읽는다 — MCP가 아니라 사람이 연
     * 화면만 이 길을 탄다. 읽기만 한다.
     */
    build(input: BuildReportInput): Promise<ReportData>
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
    /**
     * 본문을 읽는다. discovered는 그 파일의 지금 내용이고 authored는 DB 본문이다.
     * **id로만 요청한다** — 경로를 넘기는 통로는 없다 (docs/sdlc/repo-instructions/ FR-3).
     */
    readBody(id: string): Promise<AssetBody>
  }
  files: {
    /**
     * `@` 피커의 검색 (docs/sdlc/input-triggers/ §5-1). **경로를 넘기지 않는다** — repo id로만
     * 받고, core가 그 repo의 git 목록에서 찾는다.
     */
    search(input: FileSearchInput): Promise<FileSearchResult>
    /**
     * 코드 칸의 트리 (docs/sdlc/code-editor/ FR-8). 피커와 같은 git 목록이다. `fresh`면 core의 10초 캐시를 건너뛴다.
     */
    tree(input: FileTreeInput): Promise<FileTreeResult>
    /**
     * 파일 하나를 연다 (FR-15). 목록에 없는 파일(무시된 것·`.git` 안)과 열 수 없는 파일(크기·바이너리·인코딩)은
     * 던지지 않고 이유로 온다.
     */
    open(ref: FileRef): Promise<FileOpenResult>
    /**
     * 저장 (FR-17~19). `content`는 `
` 텍스트다 — 줄바꿈·BOM은 core가 디스크 파일의 것으로 되살린다. 연 뒤 디스크가
     * 바뀌었으면 쓰지 않고 `conflict`로 온다. 목록에 없는 경로·다른 workspace는 던진다.
     */
    save(input: FileSaveInput): Promise<FileSaveResult>
    /** 바뀜 확인 (FR-22) — 지금 디스크 해시, 지워졌으면 null. 칸이 보이는 동안 몇 초마다 부른다 */
    probe(ref: FileRef): Promise<FileProbeResult>
  }
  commands: {
    list(target: CommandTarget): Promise<CommandListResult>
    refresh(target: CommandTarget): Promise<CommandListResult>
  }
  settings: {
    globalRoots(): Promise<GlobalRoots>
    /** 저장하고 곧바로 다시 훑는다. 저장된 값을 돌려준다 */
    setGlobalRoots(roots: GlobalRoots): Promise<GlobalRoots>
    /** CLI 기본 경로 — workspace가 비워 둔 agent에 쓴다. null이면 PATH에서 찾는다 */
    agentPaths(): Promise<AgentPaths>
    /** 둘을 함께 덮는다. 다듬어 저장된 값을 돌려준다 */
    setAgentPaths(paths: AgentPaths): Promise<AgentPaths>
    /** 터미널 셸 (docs/sdlc/code-editor/terminal-spec.md FR-11). 비었으면 기본값이고 `resolved`가 그것을 말한다 */
    terminalShell(): Promise<TerminalShellSetting>
    /** 없는 파일이면 던진다. 빈 값은 기본값으로 돌아간다 */
    setTerminalShell(path: string | null): Promise<TerminalShellSetting>
  }
  /**
   * 코드 칸의 터미널 (terminal-spec). **repo id만 넘긴다** — 작업 디렉토리·셸·명령은 core가 정한다(FR-18). 셸은 repo당 하나다.
   */
  terminal: {
    /** 그 repo의 셸에 붙는다 — 없으면 띄운다. 지금까지의 출력(스냅샷)을 준다 */
    open(input: TerminalOpenInput): Promise<TerminalSession>
    /** 키 입력. 응답을 기다리지 않는다(키마다 왕복하지 않는다) */
    write(repoId: string, data: string): void
    resize(repoId: string, cols: number, rows: number): void
    /** 도는 셸을 트리째 끝내고 새로 띄운다 */
    restart(input: TerminalOpenInput): Promise<TerminalSession>
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
    /**
     * 대화를 끝낸다 (`docs/sdlc/conversation-lifecycle/` FR-12). 도크 목록에서
     * 내려가고 배지에서도 빠진다 — 기록은 지우지 않는다. 뿌리 run의 id를 받는다.
     */
    close(rootRunId: string): Promise<Run>
    /** 대화에 이름을 붙인다. 빈 값을 주면 파생 제목으로 되돌린다 (FR-14). */
    rename(rootRunId: string, title: string): Promise<Run>
    /**
     * 대화의 할당 이슈를 바꾼다. null이면 뗀다 (`docs/sdlc/conversation-issue/` FR-6). 뿌리 run의 id를
     * 받는다. 아직 실린 적 없는 할당 이슈는 다음 턴에 실린다(FR-9).
     */
    assignIssue(rootRunId: string, issueId: string | null): Promise<Run>
  }
  mcp: {
    /** 지금 상태를 한 번 읽는다. 창이 기동보다 늦게 떴을 때 필요하다. */
    status(): Promise<McpStatus>
  }
  account: {
    /**
     * 마지막으로 받은 Claude 요금제 사용률. 앱을 켠 뒤 claude 실행이 없었거나 구독이 아니면 null.
     * 저장하지 않는 값이다 (`docs/sdlc/plan-usage/` FR-1).
     */
    planUsage(): Promise<PlanUsage | null>
  }
  app: {
    /** 정보 탭 — 앱 버전과 core가 실제로 여는 위치 */
    info(): Promise<AppInfo>
    /** 정해진 두 위치만 파일 탐색기로 연다. 경로가 아니라 이름을 받는다 (spec NFR-3) */
    reveal(target: RevealTarget): Promise<void>
    /** 폴더 선택 대화상자. 고른 절대 경로를, 취소하면 null을 돌려준다 */
    pickDirectory(): Promise<string | null>
    /**
     * (종류, workspace, repo) 범위의 패널 창을 연다. 이미 열려 있으면 그 창을 앞으로 가져온다.
     * **범위만 받는다** — URL·경로를 넘기는 통로가 아니다 (docs/sdlc/item-windows/ FR-12).
     */
    openPanelWindow(scope: PanelScope): Promise<void>
  }
  events: {
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe
    onRunUpdate(cb: (run: Run) => void): Unsubscribe
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe
    onInboxUpdate(cb: (counts: InboxCounts) => void): Unsubscribe
    /** 창이 기동보다 먼저 떴을 때 필요하다. status()와 짝이다. */
    onMcpStatus(cb: (status: McpStatus) => void): Unsubscribe
    /** planUsage()와 짝이다 — 창이 뜬 뒤 도착한 값을 받는다. */
    onPlanUsage(cb: (usage: PlanUsage) => void): Unsubscribe
    /** 이슈·메모·asset·repo·workspace가 바뀌었다. 모든 창이 받는다 (docs/sdlc/item-windows/ FR-17) */
    onItemChanged(cb: (change: ItemChange) => void): Unsubscribe
    /** 셸 출력 — 16ms마다 모은 덩어리 (terminal-spec FR-20) */
    onTerminalData(cb: (data: TerminalData) => void): Unsubscribe
    onTerminalExit(cb: (exit: TerminalExit) => void): Unsubscribe
  }
}
