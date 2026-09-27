import type { ContextItemView, Run } from '@shared/models'

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
  last: Run
  /** 폴백 사다리로 정한 이름 (FR-11) */
  title: string
  /** 사용자가 직접 붙인 이름인가. 이름 바꾸기 폼의 초기값을 정한다 */
  named: boolean
  /** 끝낸 시각. null이면 진행 중이다 */
  closedAt: number | null
}

/** 낡은 행은 rootRunId가 없다 — 그때는 자기 자신이 뿌리다 (설계 §2). */
export function conversationIdOf(run: Run): string {
  return run.rootRunId ?? run.id
}

/** 지시에서 뽑은 이름. 제목 사다리의 마지막 단이다. */
export function titleOf(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || '(빈 지시)'
}

/**
 * 담긴 맥락에서 뽑은 이름 (FR-11의 2·3단). 이름이 없으면 null.
 *
 * **이슈·메모가 repo·asset을 이긴다** — 이슈·메모가 그 대화의 주제이고 repo·asset은
 * 배경이다. 개수도 이슈·메모만 센다: repo를 세면 이슈 하나짜리 대화에 "+3"이 붙어
 * 무엇이 더 있다는 뜻인지 알 수 없게 된다.
 */
function titleFromContext(items: ContextItemView[]): string | null {
  const topics = items.filter((i) => i.type === 'issue' || i.type === 'memo')
  const first = topics[0]
  if (first) {
    const rest = topics.length - 1
    return rest > 0 ? `${first.label} +${rest}` : first.label
  }
  const repo = items.find((i) => i.type === 'repo')
  return repo ? repo.label : null
}

/**
 * 대화가 지금까지 담은 항목의 합집합 (설계 `docs/sdlc/conversation-context/`).
 *
 * 저장하지 않는 파생값이다 — `groupConversations`·`titleOf`와 같은 자리, 같은 패턴.
 * 이름은 core가 읽는 시점에 붙여 준 것이고(`run.ts` `loadContext`), 지워진 항목은
 * 거기서 이미 빠져 있다.
 */
function collectContext(runs: Run[]): ContextItemView[] {
  const seen = new Set<string>()
  const out: ContextItemView[] = []
  for (const run of runs) {
    // 취소된 턴은 담으려다 만 것이다 (spec FR-6).
    if (run.status === 'canceled') continue
    for (const item of run.contextItems) {
      const key = `${item.type}:${item.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
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
      // 사용자가 붙인 이름 > 담긴 이슈·메모 > repo > 첫 지시 (FR-11).
      title: named || titleFromContext(collectContext(ordered)) || titleOf(ordered[0]!),
      named: named !== '',
      closedAt: root.closedAt
    })
  }
  return out.sort((a, b) => b.last.createdAt - a.last.createdAt)
}
