export type AgentKind = 'claude-code' | 'opencode'
export type Permission = 'read_only' | 'edit' | 'full'

/**
 * MCP 서버의 기동 상태. 앱이 켜져 있는 동안 이 셋 중 하나다.
 *
 * `stopped`가 없는 이유: 부팅이 곧 기동이다. close() 이후는 앱이 종료되는
 * 중이라 아무도 보지 않는다.
 */
export type McpStatus =
  | { state: 'starting' }
  | { state: 'listening'; port: number }
  | { state: 'failed'; message: string }
export type IssueStatus = 'open' | 'doing' | 'done'
/** 이슈가 어디서 왔는가 */
export type IssueSource = 'customer' | 'plan' | 'meeting' | 'dev'
/** 무슨 일인가 */
export type IssueKind = 'bug' | 'feature' | 'refactor' | 'docs' | 'research'
/** 얼마나 급한가. **나열 순서가 곧 급한 순서다** — 그룹 순서가 여기서 나온다. */
export type IssuePriority = 'urgent' | 'week' | 'someday'

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
  source: IssueSource | null
  kind: IssueKind | null
  priority: IssuePriority | null
  /** 축 셋이 다 채워진 시각. null이면 훑기 대기열이다. **저장소가 파생한다.** */
  triagedAt: number | null
  /** 사람이 상세를 연 시각. updatedAt과 분리돼 있다 — agent는 이것을 못 올린다. */
  seenAt: number | null
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
  source?: IssueSource
  kind?: IssueKind
  priority?: IssuePriority
}

export interface UpdateIssueInput {
  id: string
  title?: string
  body?: string
  status?: IssueStatus
  repoIds?: string[]
  source?: IssueSource
  kind?: IssueKind
  priority?: IssuePriority
}

/**
 * 낙관적 잠금을 쓰는 갱신 (설계 §6). 사람의 편집 화면만 쓴다.
 * agent(MCP)는 잠기지 않는 `update`를 그대로 쓴다.
 */
export interface GuardedUpdateIssueInput extends UpdateIssueInput {
  /** 화면이 마지막으로 읽은 updatedAt. 이것과 다르면 저장하지 않는다. */
  expectedUpdatedAt: number
}

/** 충돌은 던지지 않고 값으로 온다 — preload가 오류 클래스를 벗겨내기 때문이다. */
export type IssueUpdateResult =
  | { ok: true; issue: Issue }
  | { ok: false; current: Issue }

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

export interface GuardedUpdateMemoInput extends UpdateMemoInput {
  expectedUpdatedAt: number
}

export type MemoUpdateResult =
  | { ok: true; memo: Memo }
  | { ok: false; current: Memo }

/** repoId가 주어지면 그 repo에 태그된 항목 + 태그가 없는 공통 항목을 함께 반환한다 (설계 §9). */
export interface ListQuery {
  workspaceId: string
  repoId?: string
}

export type RunStatus =
  | 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'interrupted'

export type ContextItemType = 'repo' | 'issue' | 'memo' | 'asset'

export interface ContextItemRef {
  type: ContextItemType
  id: string
}

export interface Run {
  id: string
  workspaceId: string
  agentKind: AgentKind
  model: string | null
  cwd: string
  permission: Permission
  userPrompt: string
  assembledPrompt: string
  status: RunStatus
  externalSessionId: string | null
  parentRunId: string | null
  /** 대화의 뿌리. 낡은 행은 null이고 그때는 자기 자신이 뿌리다 (설계 §2) */
  rootRunId: string | null
  resultText: string | null
  needsAnswer: boolean
  timeoutMs: number | null
  exitCode: number | null
  errorMessage: string | null
  logPath: string
  reviewedAt: number | null
  reviewedKind: 'confirmed' | 'archived' | null
  startedAt: number | null
  endedAt: number | null
  createdAt: number
  contextItems: ContextItemRef[]
}

/** 렌더러가 실행을 요청할 때 넘기는 것 */
export interface StartRunInput {
  workspaceId: string
  agentKind: AgentKind
  model?: string | null
  /** 작업 디렉토리. repo를 고르지 않으면 workspace의 첫 repo 경로 */
  cwd: string
  permission: Permission
  userPrompt: string
  context: ContextItemRef[]
  /** 이어서 실행할 원본 run */
  parentRunId?: string
  timeoutMs?: number | null
}

/**
 * 대화를 이어받아 실행한다.
 *
 * StartRunInput에도 parentRunId가 있지만 그것은 "원본을 가리키는 기록"일 뿐
 * 세션을 이어받지 않는다. resume은 external_session_id까지 이어받는다.
 */
export interface ResumeRunInput {
  /** 이어받을 대화 (= root run의 id) */
  conversationId: string
  model?: string | null
  permission: Permission
  userPrompt: string
  /** 기본은 빈 배열 — 이전 대화가 이미 세션에 있다 (설계 §6) */
  context: ContextItemRef[]
}

/** 도크의 슬롯 표시기가 쓰는 전역 실행 현황. workspace와 무관하다. */
export interface QueueSnapshot {
  /** 지금 슬롯을 쥔 run 수. 상한을 낮추면 일시적으로 limit보다 클 수 있다. */
  running: number
  limit: number
  waiting: number
}

/** 사이드바 배지가 쓰는 미처리 건수. 인박스는 모든 workspace를 가로지른다. */
export interface InboxCounts {
  total: number
  /** workspace id → 그 workspace의 미처리 건수. 0인 workspace는 키가 없다. */
  byWorkspace: Record<string, number>
}

export type AssetKind = 'skill' | 'agent'
export type AssetSource = 'discovered' | 'authored'

export interface Asset {
  id: string
  workspaceId: string
  kind: AssetKind
  source: AssetSource
  name: string
  description: string | null
  /** discovered일 때 발견된 repo */
  repoId: string | null
  /** discovered일 때 절대 경로 */
  filePath: string | null
  /** authored일 때만 본문이 여기 있다. discovered는 실행 시점에 디스크에서 읽는다 */
  content: string | null
  /** discovered일 때 마지막으로 파일을 본 시각. null이면 authored다 */
  lastSeenAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreateAuthoredAssetInput {
  workspaceId: string
  kind: AssetKind
  name: string
  description?: string | null
  content?: string
}

export interface GuardedUpdateAssetInput {
  id: string
  expectedUpdatedAt: number
  name?: string
  description?: string | null
  content?: string
}

export type AssetUpdateResult =
  | { ok: true; asset: Asset }
  | { ok: false; current: Asset }

export interface ListAssetQuery {
  workspaceId: string
  /** 주면 글로벌·그 repo·앱에서 작성한 것만 돌려준다 */
  repoId?: string | null
}
