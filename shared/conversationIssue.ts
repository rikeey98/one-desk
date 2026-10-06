import type { ContextItemType, RunStatus } from './models'

/**
 * 대화에 할당된 이슈의 규칙 (`docs/sdlc/conversation-issue/`).
 *
 * core(실행할 때 맥락에 더한다)와 renderer(입력부에 "이번 턴에 실린다"를 보인다)가 **같은 함수**를 쓴다 —
 * 따로 적으면 화면은 실린다는데 실리지 않는 날이 온다(spec FR-10, `INBOX_RULES`를 `shared/`에 둔 것과 같은 이유).
 */

interface TurnContext {
  status: RunStatus
  contextItems: ReadonlyArray<{ type: ContextItemType; id: string }>
}

/**
 * 다음 턴에 실을 할당 이슈의 id (spec FR-9). 할당이 없거나, 그 대화의 어느 턴 맥락에 이미 있으면 null이다.
 *
 * 취소된 턴은 세지 않는다 — 담으려다 만 것이다(`renderer/conversation.ts`의 `collectContext`와 같다).
 * 실린 적이 있으면 다시 싣지 않는다: 할당을 뗐다 다시 붙여도 마찬가지다.
 */
export function issueToCarry(issueId: string | null, turns: readonly TurnContext[]): string | null {
  if (issueId === null) return null
  const sent = turns.some((turn) => turn.status !== 'canceled'
    && turn.contextItems.some((item) => item.type === 'issue' && item.id === issueId))
  return sent ? null : issueId
}

/**
 * 새 대화의 첫 턴에 담은 이슈가 **정확히 하나**면 그 id (spec FR-27 — 자동 할당). 둘 이상이거나 없으면 null이다.
 * 같은 이슈를 두 번 담은 것은 하나로 센다.
 */
export function soleIssueOf(context: ReadonlyArray<{ type: ContextItemType; id: string }>): string | null {
  const ids = new Set(context.filter((item) => item.type === 'issue').map((item) => item.id))
  return ids.size === 1 ? [...ids][0]! : null
}
