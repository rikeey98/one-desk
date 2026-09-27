import type { RunStatus } from './models'

/**
 * 인박스 항목의 카테고리 (3b 설계 §4).
 * 컬럼으로 저장하지 않고 status + needsAnswer에서 파생한다 — 저장하면 둘이 어긋난다.
 *
 * **`shared/`에 있는 이유**: core의 배지 집계(`inboxCounts`)와 renderer의 목록·자동
 * 확인이 **같은 표**를 봐야 한다. 따로 두면 "배지엔 안 잡히는데 자동 확인도 안 되는"
 * 칸이 조용히 생긴다 (docs/sdlc/conversation-lifecycle/ spec FR-1·FR-3).
 */
export type InboxCategory = 'needs-answer' | 'done' | 'failed' | 'interrupted' | 'dropped'

/** 표를 도는 테스트가 카테고리를 옮겨 적지 않도록 목록을 여기서 준다. */
export const CATEGORIES = [
  'needs-answer', 'done', 'failed', 'interrupted', 'dropped'
] as const satisfies readonly InboxCategory[]

export const CATEGORY_LABELS: Record<InboxCategory, string> = {
  'needs-answer': '답변 필요',
  done: '완료 · 미확인',
  failed: '실패',
  interrupted: '중단됨',
  dropped: '대기 중 취소됨'
}

/**
 * **지금 사람의 손이 필요한가.**
 *
 * 이 한 표에서 둘이 나오고 **둘은 서로의 부정이다** (spec FR-3):
 * - `true` — 사이드바 빨간 배지가 센다(`inboxCounts`). 열어 봤다고 내려가지 않는다.
 * - `false` — 배지가 세지 않고, 도크에서 **열면 저절로 확인된다**.
 *
 * 나누지 말 것. 두 곳에 적으면 어느 쪽에도 안 걸리는 카테고리가 생기고, 그 대화는
 * 인박스 목록에만 영원히 남는다.
 */
export const ACTIONABLE: Record<InboxCategory, boolean> = {
  // agent가 질문하고 멈췄다. 사람이 답해야 다음이 없다.
  'needs-answer': true,
  // 왜 실패했는지 보고 다시 돌릴지 정해야 한다.
  failed: true,
  // 앱이 꺼져 끊긴 턴. 스스로 해소되지 않는다.
  interrupted: true,
  // 끝났고 답도 나왔다. 읽는 것 말고 할 일이 없다.
  done: false,
  // 사용자가 스스로 내린 것이다.
  dropped: false
}

export function inboxCategory(
  run: { status: RunStatus; needsAnswer: boolean }
): InboxCategory {
  // needsAnswer가 먼저다. succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다.
  if (run.needsAnswer) return 'needs-answer'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'interrupted') return 'interrupted'
  if (run.status === 'canceled') return 'dropped'
  return 'done'
}
