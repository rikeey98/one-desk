import { INBOX_RULES, inboxCategory } from '@shared/inbox'
import type { OneDeskClient } from '@shared/client'
import type { Conversation } from './conversation'

/**
 * 사용자가 골라 연 대화를 인박스에서 내린다 (lifecycle FR-5, `docs/sdlc/conversation-issue/` FR-17).
 *
 * 도크 목록의 클릭과 이슈 상세의 `대화 열기`가 **같은 함수**를 쓴다 — 따로 적으면 같은 대화를 어디서 열었느냐에
 * 따라 배지가 다르게 내려간다. 마운트·폴백·`focusConversationId` 길에는 걸지 않는다(lifecycle FR-6): 보지도 않은
 * 대화가 저절로 내려간다.
 *
 * 판정은 core의 배지 집계와 **같은 표**의 다른 칸에서 온다(`shared/inbox.ts`의 `INBOX_RULES` — 배지는 `badge`,
 * 여기는 `clearsOnView`). 열어 봐도 남는 것은 답변 필요뿐이다. **대표 턴(`conv.state`)으로 판정한다** — 시작도 못
 * 하고 취소된 예약으로 판정하면 앞 턴의 답변 필요가 가려진다(conversation-fixes FR-3).
 *
 * 되돌리는 자리는 core에 이미 있다: `create(parentRunId)`가 뿌리의 `reviewedAt`을 지우므로 새 턴이 오면 배지에
 * 다시 오른다. 실패는 호출자가 다룬다 — 확인이 안 됐다고 대화를 못 보게 할 이유는 없다(FR-8).
 */
export async function confirmSeen(client: OneDeskClient, conv: Conversation): Promise<void> {
  if (!INBOX_RULES[inboxCategory(conv.state)].clearsOnView) return
  // 끝나지 않은 대화는 인박스 소속 자체가 아니다. 대표 턴이 아직 돌거나 기다리는 중이면(예약이 남아 있으면)
  // 대화는 진행 중이다.
  if (conv.state.endedAt === null) return
  // 뿌리가 이미 확인됐으면 부를 것이 없다. core도 같은 가드가 있지만 IPC 왕복을 클릭마다 하는 것이 아깝다.
  const root = conv.runs.find((r) => r.id === conv.id) ?? conv.runs[0]!
  if (root.reviewedAt !== null) return
  // **뿌리 id에 찍는다.** 턴 id에 찍으면 아무 일도 일어나지 않는다 — 대화는 인박스에 그대로 남는다(C-1-a).
  await client.runs.markReviewed(conv.id, 'confirmed')
}
