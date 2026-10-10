import type { AssignedIssue, ContextItemView, Issue, Repo, Run } from '@shared/models'
import { representativeTurn } from '@shared/inbox'
import { collectContext, conversationTitle, titleOf } from '@shared/conversationTitle'

export { titleOf }

/**
 * 한 대화. run 목록에서 파생하며 **일부만 저장된다** (설계 §2).
 *
 * `title`·`closedAt`은 뿌리 run 행의 컬럼이고(`docs/sdlc/conversation-lifecycle/` FR-9),
 * 나머지는 여기서 계산한다. inbox.ts가 status에서 카테고리를 파생하는 것과 같은 패턴이다.
 */
export interface Conversation {
  /** root run의 id */
  id: string
  /** 오래된 순 — 대화록은 위에서 아래로 읽는다 */
  runs: Run[]
  /**
   * **가장 최근에 만든 턴.** 이어갈 때의 agent·cwd·권한 기본값, 목록 정렬처럼 "마지막에
   * 무엇을 보냈나"가 필요한 자리에 쓴다. **대화의 상태로 읽지 말 것** — 그것은 `state`다.
   */
  last: Run
  /**
   * **대표 턴** — 대화의 지금 상태를 정한다 (`docs/sdlc/conversation-fixes/` spec FR-1·FR-3).
   * 시작하지 못하고 취소된 예약을 건너뛴 가장 최근 턴이다. 도크 목록의 상태 점·답변 필요
   * 표시·자동 확인 판정이 이것을 본다. 규칙은 core의 인박스·배지와 같은 한 함수
   * (`shared/inbox.ts`의 `representativeTurn`)다 — 따로 적으면 배지와 도크가 다른 턴을 본다.
   */
  state: Run
  /** 지금 도는 턴. running이 있으면 그것, 없으면 pending, 둘 다 없으면 null이다 (FR-3) */
  active: Run | null
  /** 폴백 사다리로 정한 이름 (FR-11) */
  title: string
  /** 사용자가 직접 붙인 이름인가. 이름 바꾸기 폼의 초기값을 정한다 */
  named: boolean
  /** 끝낸 시각. null이면 진행 중이다 */
  closedAt: number | null
  /** 뿌리에 할당된 이슈 (`docs/sdlc/conversation-issue/` FR-2). null이면 공통 대화다 */
  issue: AssignedIssue | null
}

/**
 * 이슈 상세가 그 이슈의 대화를 보고 여는 통로 (`docs/sdlc/conversation-issue/` FR-13~19). **패널 창에는 없다** —
 * 창에는 도크가 없다. 패널의 `context` prop처럼 선택이고 App만 넘긴다(FR-18).
 */
export interface IssueConversations {
  /** 그 이슈가 할당된 대화들. 마지막 턴 최신순(도크 목록과 같다) */
  of(issueId: string): Conversation[]
  /** 도크에서 그 대화를 연다 — 도크 목록에서 누른 것처럼 확인도 된다(FR-17) */
  open(conversation: Conversation): void
  /** 그 이슈가 할당될 새 대화 칸을 연다(FR-15) */
  start(issue: Issue): void
}

/** 낡은 행은 rootRunId가 없다 — 그때는 자기 자신이 뿌리다 (설계 §2). */
export function conversationIdOf(run: Run): string {
  return run.rootRunId ?? run.id
}

export function contextOf(conversation: Conversation): ContextItemView[] {
  return collectContext(conversation.runs)
}

/**
 * 최신순 run 목록을 대화 목록으로 묶는다.
 *
 * useRuns는 최신순으로 준다. 대화록은 오래된 순으로 읽으므로 안에서 뒤집는다.
 */
export function groupConversations(runs: Run[]): Conversation[] {
  const byId = new Map<string, Run[]>()
  for (const run of runs) {
    const id = conversationIdOf(run)
    const list = byId.get(id)
    if (list) list.push(run)
    else byId.set(id, [run])
  }

  const out: Conversation[] = []
  for (const [id, list] of byId) {
    const ordered = [...list].reverse()
    // **뿌리 행을 id로 찾는다.** `ordered[0]`이 뿌리라는 것은 "목록이 그 대화의 모든
    // 턴을 담고 있다"에 얹힌 가정이고, `title`·`closedAt`처럼 **뿌리에만 있는 값**을
    // 읽기 시작하면 그 가정이 깨지는 날(예: 목록에 개수 제한이 붙는 날) 조용히
    // null이 된다.
    const root = ordered.find((r) => r.id === id) ?? ordered[0]!
    const named = (root.title ?? '').trim()
    out.push({
      id,
      runs: ordered,
      last: ordered[ordered.length - 1]!,
      // representativeTurn은 최신순을 받는다 — list가 useRuns의 최신순 그대로다.
      state: representativeTurn(list)!,
      // 대화당 running은 하나뿐이고(RunQueue의 groupKey) 예약도 하나뿐이다(설계 §3-2).
      active: ordered.find((r) => r.status === 'running')
        ?? ordered.find((r) => r.status === 'pending')
        ?? null,
      // 사다리는 shared에 있다 — 기간 리포트가 같은 이름으로 부르게 (period-report FR-4).
      title: conversationTitle(root, ordered),
      named: named !== '',
      closedAt: root.closedAt,
      issue: root.issue
    })
  }
  return out.sort((a, b) => b.last.createdAt - a.last.createdAt)
}

/** 도크 목록의 한 줄 — 대화 하나, 또는 대화가 둘 이상인 이슈 하나 (`docs/sdlc/conversation-issue/` FR-28) */
export type ConversationListEntry =
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'issue'; issue: AssignedIssue; conversations: Conversation[] }

/**
 * 도크 목록을 이슈로 접는다 (`docs/sdlc/conversation-issue/` FR-28).
 *
 * **최신순 목록 하나를 그대로 둔다** — 바뀌는 것은 "같은 이슈의 대화가 둘 이상이면 한 줄로"뿐이다. 그 줄은 이슈의
 * 가장 최근 대화가 서던 자리에 선다. 대화가 하나뿐인 이슈는 접지 않는다 — 제목이 이미 이슈 이름이라(FR-22) 접으면
 * 누를 것만 하나 는다. 공통 대화(이슈 없음)는 지금처럼 각자 한 줄이다. 입력은 최신순이어야 한다(`groupConversations`).
 */
export function foldByIssue(conversations: Conversation[]): ConversationListEntry[] {
  const byIssue = new Map<string, Conversation[]>()
  for (const conv of conversations) {
    if (!conv.issue) continue
    const list = byIssue.get(conv.issue.id)
    if (list) list.push(conv)
    else byIssue.set(conv.issue.id, [conv])
  }

  const out: ConversationListEntry[] = []
  const placed = new Set<string>()
  for (const conv of conversations) {
    const group = conv.issue ? byIssue.get(conv.issue.id)! : null
    if (!group || group.length < 2) {
      out.push({ kind: 'conversation', conversation: conv })
      continue
    }
    if (placed.has(conv.issue!.id)) continue
    placed.add(conv.issue!.id)
    out.push({ kind: 'issue', issue: conv.issue!, conversations: group })
  }
  return out
}

/**
 * 경로 비교용 정규형 (`docs/sdlc/dock-repo-sections/` FR-1). 끝의 구분자를 떼고, Windows 경로(드라이브 문자로 시작하거나
 * `\`를 품은 것)는 구분자를 `\`로 맞추고 대소문자를 가리지 않는다 — posix 경로는 대소문자가 다르면 다른 디렉토리다.
 *
 * 코드 칸의 대상 repo(`code/target.ts`)와 편집 줄 경로(`code/editPath.ts`)도 이 규칙을 쓴다 — 따로 적으면 구획은 `api`인데
 * 칸은 "등록된 repo가 아닙니다"인 어긋남이 생긴다.
 */
export function pathKey(path: string): string {
  const windows = /^[a-zA-Z]:/.test(path) || path.includes('\\')
  const trimmed = path.replace(/[\\/]+$/, '')
  return windows ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed
}

/** 뿌리 행 — `groupConversations`처럼 id로 찾는다 */
function rootOf(conv: Conversation): Run {
  return conv.runs.find((r) => r.id === conv.id) ?? conv.runs[0]!
}

/**
 * 대화의 repo (FR-1) — **뿌리 턴의 `cwd`**와 경로가 같은 등록 repo. 이어 가는 대화는 작업 디렉토리를 바꿀 수 없으므로
 * 뿌리 하나로 정해진다. 없으면(등록하지 않은 경로, 지운 repo) null — 목록에서는 `기타`다.
 */
export function repoOfConversation(conv: Conversation, repos: readonly Repo[]): Repo | null {
  const key = pathKey(rootOf(conv).cwd)
  return repos.find((r) => pathKey(r.path) === key) ?? null
}

/** 구획이 없는 대화의 이름 — 작업 디렉토리 경로의 마지막 조각 */
export function cwdName(conv: Conversation): string {
  const cwd = rootOf(conv).cwd
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

export interface RepoSection {
  /** `repo:<id>` 또는 `other` — 접힘을 기억하는 키 */
  key: string
  /** null이면 `기타` */
  repo: Repo | null
  /** 받은 순서 그대로(최신순) */
  conversations: Conversation[]
}

/**
 * 끝나지 않은 대화를 repo 구획으로 나눈다 (FR-3). 구획 순서는 **그 구획의 가장 최근 대화**가 받은 목록에서 앞선 순 —
 * 받은 목록이 최신순이므로 최근 활동순이다. `기타`는 늘 맨 아래. 구획 안의 순서는 바꾸지 않는다(FR-4).
 */
export function sectionByRepo(conversations: readonly Conversation[], repos: readonly Repo[]): RepoSection[] {
  const sections: RepoSection[] = []
  const byKey = new Map<string, RepoSection>()
  for (const conv of conversations) {
    const repo = repoOfConversation(conv, repos)
    const key = repo ? `repo:${repo.id}` : 'other'
    let section = byKey.get(key)
    if (!section) {
      section = { key, repo, conversations: [] }
      byKey.set(key, section)
      sections.push(section)
    }
    section.conversations.push(conv)
  }
  return [...sections.filter((s) => s.repo !== null), ...sections.filter((s) => s.repo === null)]
}

/** 사이드바에서 고른 repo의 대화만 (FR-8) */
export function filterByRepo(conversations: readonly Conversation[], repos: readonly Repo[], repoId: string): Conversation[] {
  return conversations.filter((c) => repoOfConversation(c, repos)?.id === repoId)
}
