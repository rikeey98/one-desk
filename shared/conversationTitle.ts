import type { ContextItemView, Run } from './models'

/**
 * 대화의 제목 사다리 — 도크 목록(`renderer/conversation.ts`)과 기간 리포트(`core/reports/`)가 같이 쓴다
 * (`docs/sdlc/period-report/` FR-4). 따로 두면 같은 대화를 두 화면이 다른 이름으로 부른다.
 *
 * 사용자가 붙인 이름 > 할당된 이슈 > 담긴 이슈·메모 > repo > 첫 지시
 * (lifecycle FR-11, conversation-issue FR-22가 할당 칸을 넣었다).
 */

/** 지시에서 뽑은 이름. 제목 사다리의 마지막 단이다. */
export function titleOf(run: Pick<Run, 'userPrompt'>): string {
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
export function titleFromContext(items: readonly ContextItemView[]): string | null {
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
 * 저장하지 않는 파생값이다. 이름은 core가 읽는 시점에 붙여 준 것이고(`run.ts` `loadContext`), 지워진 항목은
 * 거기서 이미 빠져 있다.
 */
export function collectContext(runs: ReadonlyArray<Pick<Run, 'status' | 'contextItems'>>): ContextItemView[] {
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

/** 사다리 전체. `ordered`는 오래된 순, `root`는 id로 찾은 뿌리 행이다 */
export function conversationTitle(
  root: Pick<Run, 'title' | 'issue'>,
  ordered: ReadonlyArray<Pick<Run, 'status' | 'contextItems' | 'userPrompt'>>
): string {
  const named = (root.title ?? '').trim()
  return named || root.issue?.title || titleFromContext(collectContext(ordered)) || titleOf(ordered[0]!)
}
