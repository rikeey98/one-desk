import { isBlankDraft } from './store/drafts'
import type { Conversation } from './conversation'

/**
 * 입력칸의 ↑↓ history (`docs/sdlc/prompt-history/`).
 *
 * **규칙은 여기 두 함수에만 있다** — `RunPanel`은 결과를 적용만 한다(spec NFR-1). 렌더링 없이
 * 경계값을 고정하려는 것이다(`timeline.ts`와 같은 이유).
 */

/** 아무것도 불러오지 않은 상태의 index */
export const NO_HISTORY = -1

/**
 * 이 대화에서 보낸 지시를 **최근 것부터** (spec FR-1). 예약(뿌리가 아닌 pending)도 보낸
 * 지시라 들어간다. 공백뿐인 지시는 빼고, 바로 이웃한 같은 지시는 하나로 접는다(셸의
 * `ignoredups`). 새 대화면 비어 있다 — 범위는 이 대화뿐이다(intent의 결정).
 */
export function historyOf(conversation: Conversation | null): string[] {
  if (!conversation) return []
  const entries: string[] = []
  for (let i = conversation.runs.length - 1; i >= 0; i--) {
    const prompt = conversation.runs[i]!.userPrompt
    if (isBlankDraft(prompt)) continue
    if (entries[entries.length - 1] === prompt) continue
    entries.push(prompt)
  }
  return entries
}

export interface HistoryState {
  /** `historyOf`의 결과 */
  entries: string[]
  /** 지금 보이는 글이 몇 번째 history인가. 불러오지 않았으면 `NO_HISTORY` */
  index: number
  /** 입력칸의 지금 글 */
  text: string
}

/**
 * ↑(`up`) 또는 ↓(`down`)를 history로 처리한 결과. **null이면 history가 아니다** — 키를 기본
 * 동작(줄 이동)에 맡긴다 (spec FR-2·FR-3).
 *
 * history로 보는 것은 입력칸이 **비었거나**, 지금 글이 불러온 그 글을 **손대지 않은 것**일 때뿐이다.
 * 한 글자라도 고치면 초안이 되어 쓰던 글을 덮지 않는다. 가장 오래된 것에서 ↑는 제자리(키를
 * 먹는다 — 줄 이동으로 새면 캐럿이 튄다), 가장 최근 것에서 ↓는 빈 입력이다.
 */
export function stepHistory(
  state: HistoryState, direction: 'up' | 'down'
): { index: number; text: string } | null {
  const { entries, index, text } = state
  const recalled = index >= 0 && index < entries.length && entries[index] === text
  if (!recalled && !(index === NO_HISTORY && isBlankDraft(text))) return null

  if (direction === 'up') {
    if (entries.length === 0) return null
    const next = Math.min(index + 1, entries.length - 1)
    return { index: next, text: entries[next]! }
  }
  if (!recalled) return null
  return index === 0
    ? { index: NO_HISTORY, text: '' }
    : { index: index - 1, text: entries[index - 1]! }
}
