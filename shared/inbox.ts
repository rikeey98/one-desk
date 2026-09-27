import type { RunStatus } from './models'

/**
 * 인박스 항목의 카테고리 (3b 설계 §4).
 * 컬럼으로 저장하지 않고 status + needsAnswer에서 파생한다 — 저장하면 둘이 어긋난다.
 *
 * **`shared/`에 있는 이유**: core의 배지 집계(`inboxCounts`)와 renderer의 목록·자동
 * 확인이 **같은 표**와 **같은 대표 턴 규칙**을 봐야 한다. 따로 두면 "배지엔 안 잡히는데
 * 자동 확인도 안 되는" 칸이 조용히 생긴다 (docs/sdlc/conversation-lifecycle/ spec
 * FR-1·FR-3, docs/sdlc/conversation-fixes/ spec FR-1·FR-4).
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

/** 카테고리 하나에 걸린 인박스 규칙. */
export interface InboxRule {
  /** 사이드바 빨간 배지가 센다(`inboxCounts`). */
  badge: boolean
  /** 도크 목록에서 그 대화를 **명시적으로 누르면** 저절로 확인된다(`Dock`의 `pick`). */
  clearsOnView: boolean
}

/**
 * **카테고리마다 배지가 세는가, 열면 확인되는가** — 두 칸짜리 **한 표**다
 * (`docs/sdlc/conversation-fixes/` spec FR-4).
 *
 * 예전에는 한 칸(`ACTIONABLE`)이었고 두 판정이 서로의 부정이었다. 실패·중단을 "배지에
 * 세되 열면 확인된다"로 바꾸면서(intent 결정, 2026-09-27) 칸을 둘로 넓혔다. **표를
 * 둘로 나누지 말 것** — 두 곳에 적으면 어느 쪽에도 안 걸리는 카테고리가 생기고, 그
 * 대화는 인박스 목록에만 영원히 남는다. 부정 관계가 풀린 자리는 `inbox.test.ts`의
 * 불변식 둘이 지킨다: 배지에 세지 않는 것은 반드시 열면 확인되고, 열어 봐도 남는 것은
 * 답변 필요 하나뿐이다.
 *
 * 2026-09-23의 "실패는 열어 봐도 남는다"로 되돌리려면 failed·interrupted의
 * `clearsOnView` 둘만 바꾼다.
 */
export const INBOX_RULES: Record<InboxCategory, InboxRule> = {
  // agent가 질문하고 멈췄다. 사람이 답해야 다음이 있다 — 다음 턴이 오면
  // `create(parentRunId)`가 뿌리의 확인 표시를 지워 스스로 풀린다.
  'needs-answer': { badge: true, clearsOnView: false },
  // 왜 실패했는지 봐야 한다. 열어서 봤으면 그것으로 됐다(OpenCode의 오류 알림과 같다).
  failed: { badge: true, clearsOnView: true },
  // 앱이 꺼져 끊긴 턴. 실패와 같다 — 알려야 하지만 본 뒤에는 내린다.
  interrupted: { badge: true, clearsOnView: true },
  // 끝났고 답도 나왔다. 읽는 것 말고 할 일이 없다.
  done: { badge: false, clearsOnView: true },
  // 앱이 재시작하며 내린 예약이다. 알 필요는 있어도 손을 댈 것은 없다.
  dropped: { badge: false, clearsOnView: true }
}

/**
 * **대화의 대표 턴** — 그 대화의 지금 상태를 정하는 턴 (spec FR-1).
 *
 * "가장 최근에 만든 턴"을 그대로 쓰면 **시작하지 못하고 취소된 예약**이 앞 턴의 결과를
 * 가린다: 2턴이 실패로 끝났는데 3턴 예약이 취소되면(사용자가 눌렀든 앱 재시작의
 * `reapStale`이든) 대화가 "대기 중 취소됨"이 되어 배지에서 빠진다. 그런 턴은 아무 일도
 * 하지 않았으므로 건너뛴다. 전부 그런 턴이면 가장 최근 턴을 돌려준다.
 *
 * 시작한 뒤 취소된 턴(돌다가 멈춘 것)과 아직 기다리는 예약(pending)은 건너뛰지 않는다 —
 * 그것이 대화의 지금 상태다.
 *
 * **입력은 최신순이다.** `status`·`startedAt`만 요구한다 — core의 `inboxCounts`가
 * 슬림한 select를 그대로 넣어야 `assembled_prompt`를 나르지 않는다(`inboxCategory`와
 * 같은 이유). **core와 renderer가 이 한 함수를 쓴다** — 따로 적으면 배지와 도크 목록이
 * 다른 턴을 보게 된다.
 */
export function representativeTurn<T extends { status: RunStatus; startedAt: number | null }>(
  turnsLatestFirst: readonly T[]
): T | undefined {
  return turnsLatestFirst.find((t) => !(t.status === 'canceled' && t.startedAt === null))
    ?? turnsLatestFirst[0]
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
