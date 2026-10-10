import { CATEGORY_LABELS, inboxCategory, type InboxCategory } from '@shared/inbox'
import type { Repo, Run, Workspace } from '@shared/models'
import { repoOfCwd } from './conversation'

/**
 * 인박스의 보기 · 정렬 · 묶기 (`docs/sdlc/inbox-views/`). 판정은 전부 여기 있고 `InboxPanel`은 그리기만 한다(NFR-1) —
 * 경계값을 렌더링 없이 고정하려는 것이다.
 */

export type InboxMode = 'time' | 'workspace' | 'status'
export type InboxOrder = 'desc' | 'asc'
export interface InboxView { mode: InboxMode; order: InboxOrder }

const MODES: readonly InboxMode[] = ['time', 'workspace', 'status']
const ORDERS: readonly InboxOrder[] = ['desc', 'asc']

/** 지금 화면 그대로 (FR-3) */
export const DEFAULT_INBOX_VIEW: InboxView = { mode: 'time', order: 'desc' }

/** workspace id → 그 workspace의 repo. 인박스는 workspace를 넘는 목록이라 App이 workspace마다 읽어 내린다(FR-16) */
export type ReposByWorkspace = Readonly<Record<string, readonly Repo[]>>

export const MISSING_WORKSPACE = '(사라진 workspace)'
export const OTHER_REPO = '기타'

/**
 * 끝난 시각으로 정렬한다 (FR-2). 최신 먼저는 안정 정렬이라 같은 시각은 core가 준 순서 그대로이고, 오래된 먼저는 그 결과를
 * **정확히 뒤집는다** — 같은 시각끼리의 순서까지 뒤집혀 정렬 버튼을 두 번 누르면 제자리다.
 */
export function sortInbox(items: readonly Run[], order: InboxOrder): Run[] {
  const latestFirst = [...items].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return order === 'desc' ? latestFirst : latestFirst.reverse()
}

/**
 * 항목의 repo (FR-6) — 대표 턴의 `cwd`와 경로가 같은 **그 workspace의** 등록 repo. 이어 가는 대화는 작업 디렉토리가 잠기므로
 * 대표 턴의 `cwd`가 곧 뿌리의 `cwd`다. 다른 workspace의 같은 경로 repo를 잡으면 workspace 묶음과 repo 묶음이 어긋난다.
 */
export function repoOfItem(run: Run, repos: ReposByWorkspace): Repo | null {
  return repoOfCwd(run.cwd, repos[run.workspaceId] ?? [])
}

function workspaceName(workspaceId: string, workspaces: readonly Workspace[]): string {
  return workspaces.find((w) => w.id === workspaceId)?.name ?? MISSING_WORKSPACE
}

/** 항목 머리의 소속 (FR-5) — `workspace · repo`, repo를 모르면 workspace만 */
export function sourceLabel(run: Run, workspaces: readonly Workspace[], repos: ReposByWorkspace): string {
  const ws = workspaceName(run.workspaceId, workspaces)
  const repo = repoOfItem(run, repos)
  return repo ? `${ws} · ${repo.name}` : ws
}

function hasNeedsAnswer(items: readonly Run[]): boolean {
  return items.some((r) => inboxCategory(r) === 'needs-answer')
}

export interface RepoGroup {
  /** `repo:<id>` 또는 `other:<workspaceId>` — 접힘을 기억하는 키(FR-14) */
  key: string
  /** null이면 `기타` */
  repo: Repo | null
  label: string
  items: Run[]
  needsAnswer: boolean
}

export interface WorkspaceGroup {
  /** `ws:<id>` */
  key: string
  /** null이면 목록에 없는 workspace(지워지는 중) */
  workspace: Workspace | null
  label: string
  repos: RepoGroup[]
  count: number
  needsAnswer: boolean
}

/**
 * workspace → repo 두 단으로 묶는다 (FR-6·7). 묶음 순서는 **정렬한 목록에서 첫 항목이 나온 순**이라 정렬을 따른다 —
 * 최신 먼저면 가장 최근에 끝난 대화가 있는 묶음이, 오래된 먼저면 가장 오래 기다린 대화가 있는 묶음이 위다. `기타`는 그
 * workspace 안에서, 사라진 workspace는 전체에서 늘 맨 아래다. 묶음 안은 정렬 그대로다.
 */
export function groupByWorkspace(
  items: readonly Run[], order: InboxOrder, workspaces: readonly Workspace[], repos: ReposByWorkspace
): WorkspaceGroup[] {
  const groups: Array<{ workspace: Workspace | null; workspaceId: string; repos: RepoGroup[] }> = []
  const byWorkspace = new Map<string, (typeof groups)[number]>()
  for (const run of sortInbox(items, order)) {
    let group = byWorkspace.get(run.workspaceId)
    if (!group) {
      group = { workspace: workspaces.find((w) => w.id === run.workspaceId) ?? null, workspaceId: run.workspaceId, repos: [] }
      byWorkspace.set(run.workspaceId, group)
      groups.push(group)
    }
    const repo = repoOfItem(run, repos)
    const key = repo ? `repo:${repo.id}` : `other:${run.workspaceId}`
    let repoGroup = group.repos.find((r) => r.key === key)
    if (!repoGroup) {
      repoGroup = { key, repo, label: repo?.name ?? OTHER_REPO, items: [], needsAnswer: false }
      group.repos.push(repoGroup)
    }
    repoGroup.items.push(run)
  }
  const done = groups.map((g): WorkspaceGroup => {
    const sorted = [...g.repos.filter((r) => r.repo !== null), ...g.repos.filter((r) => r.repo === null)]
      .map((r) => ({ ...r, needsAnswer: hasNeedsAnswer(r.items) }))
    return {
      key: `ws:${g.workspaceId}`,
      workspace: g.workspace,
      label: g.workspace?.name ?? MISSING_WORKSPACE,
      repos: sorted,
      count: sorted.reduce((n, r) => n + r.items.length, 0),
      needsAnswer: sorted.some((r) => r.needsAnswer)
    }
  })
  return [...done.filter((g) => g.workspace !== null), ...done.filter((g) => g.workspace === null)]
}

/**
 * 상태별 묶음의 순서 (FR-10) — 손이 필요한 것이 위다. 배지가 세는 셋(답변 필요·실패·중단됨)이 먼저 온다. 정렬과 무관하게
 * 고정이다. **모든 카테고리를 담아야 한다** — 빠진 카테고리의 대화는 상태별 보기에서 사라진다(`inboxView.test`가 지킨다).
 */
export const STATUS_ORDER: readonly InboxCategory[] = ['needs-answer', 'failed', 'interrupted', 'done', 'dropped']

export interface StatusGroup {
  /** `status:<카테고리>` */
  key: string
  category: InboxCategory
  label: string
  items: Run[]
  needsAnswer: boolean
}

/** 인박스 카테고리로 묶는다 (FR-10). 항목이 없는 카테고리는 묶음이 없고, 묶음 안은 정렬 그대로다. */
export function groupByStatus(items: readonly Run[], order: InboxOrder): StatusGroup[] {
  const sorted = sortInbox(items, order)
  return STATUS_ORDER
    .map((category): StatusGroup => {
      const inGroup = sorted.filter((r) => inboxCategory(r) === category)
      return {
        key: `status:${category}`, category, label: CATEGORY_LABELS[category], items: inGroup, needsAnswer: hasNeedsAnswer(inGroup)
      }
    })
    .filter((g) => g.items.length > 0)
}

// ── 기억 (FR-3·14) — 보기 취향이라 core가 아니라 이 장비의 localStorage에 둔다(`dockSections.ts`와 같은 방식) ──

const VIEW_KEY = 'one-desk.inbox.view'
const COLLAPSED_KEY = 'one-desk.inbox.collapsed'

/** 저장소 접근은 막힐 수 있다(사이트 데이터 차단 등) — 그때는 기본값으로 돈다. */
function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 기억만 못 할 뿐이다 */ }
}

/** 고른 보기와 정렬. 모르는 값(다른 버전이 남긴 것)은 그 칸만 기본이다 */
export function readInboxView(): InboxView {
  const raw = readJson(VIEW_KEY)
  const obj = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return {
    mode: MODES.find((m) => m === obj.mode) ?? DEFAULT_INBOX_VIEW.mode,
    order: ORDERS.find((o) => o === obj.order) ?? DEFAULT_INBOX_VIEW.order
  }
}

export function writeInboxView(view: InboxView): void {
  writeJson(VIEW_KEY, view)
}

/** 접은 묶음의 키 (`ws:<id>` · `repo:<id>` · `other:<workspaceId>` · `status:<카테고리>`) */
export function readInboxCollapsed(): Set<string> {
  const raw = readJson(COLLAPSED_KEY)
  return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [])
}

export function writeInboxCollapsed(keys: ReadonlySet<string>): void {
  writeJson(COLLAPSED_KEY, [...keys])
}
