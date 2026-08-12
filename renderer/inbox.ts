import type { Run } from '@shared/models'

/**
 * 인박스 항목의 카테고리 (설계 §4).
 * 컬럼으로 저장하지 않고 status + needsAnswer에서 파생한다 — 저장하면 둘이 어긋난다.
 */
export type InboxCategory = 'needs-answer' | 'done' | 'failed' | 'interrupted' | 'dropped'

export const CATEGORY_LABELS: Record<InboxCategory, string> = {
  'needs-answer': '답변 필요',
  done: '완료 · 미확인',
  failed: '실패',
  interrupted: '중단됨',
  dropped: '대기 중 취소됨'
}

export function inboxCategory(run: Run): InboxCategory {
  // needsAnswer가 먼저다. succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다.
  if (run.needsAnswer) return 'needs-answer'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'interrupted') return 'interrupted'
  if (run.status === 'canceled') return 'dropped'
  return 'done'
}
