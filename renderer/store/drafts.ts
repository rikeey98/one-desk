/**
 * 대화마다 쓰던 지시 (`docs/sdlc/conversation-timeline/` spec FR-31).
 *
 * **스토어가 쥐는 이유**: Dock은 인박스·설정에 가면 언마운트되고, ConversationPanel은
 * 대화를 바꿀 때마다 key로 재마운트된다 — 그 안의 state에 두면 쓰던 지시가 사라진다
 * (설정 화면 FR-11과 같은 이유). App state에 두면 한 글자마다 App 전체가 다시 그려진다.
 * 그래서 `main.tsx`에서 하나 만들어 Context로 내린다 — `RunEventStore`와 같은 자리다.
 *
 * **저장하지 않는다.** 앱을 끄면 사라진다(localStorage도 쓰지 않는다 — 대화 id가 남는
 * 곳이 늘 뿐이다). RunPanel은 마운트할 때 읽고, 칠 때마다 쓴다.
 *
 * **듣는 쪽은 대화 헤더 하나다**(`useDraftFilled`, spec §8의 3 — 결정 2026-09-27). 헤더의
 * `멈추기`는 초안이 있을 때만 선다 — 입력칸이 비면 같은 자리의 전송 버튼이 이미 중지다. 알림은
 * 값이 바뀔 때만 가고, 듣는 쪽은 "비었나" 하나만 보므로 한 글자마다 다시 그리지 않는다.
 */
export function createDraftStore() {
  const drafts = new Map<string, string>()
  const listeners = new Set<() => void>()

  return {
    get(key: string): string {
      return drafts.get(key) ?? ''
    },

    /** 빈 값은 지운다 — 전송이 성공하면 그 키를 비운다. 값이 바뀌었을 때만 알린다. */
    set(key: string, value: string): void {
      if ((drafts.get(key) ?? '') === value) return
      if (value === '') drafts.delete(key)
      else drafts.set(key, value)
      for (const listener of listeners) listener()
    },

    /** 바뀔 때마다 부른다. 돌려준 함수로 끊는다 — `useSyncExternalStore`의 모양이다. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
}

/**
 * 보낼 것이 없는 초안인가 — 앞뒤 공백을 걷어 비면 그렇다. 입력부의 중지(spec FR-28)와 헤더의
 * 멈추기(FR-29)가 **같은 판정**을 쓴다: 둘이 따로 재면 공백만 친 입력칸에서 둘 다 서거나 둘 다
 * 사라진다.
 */
export function isBlankDraft(text: string): boolean {
  return text.trim() === ''
}

export type DraftStore = ReturnType<typeof createDraftStore>

/**
 * 초안의 키. 대화가 있으면 그 id, 새 대화면 `new:<workspaceId>`다.
 *
 * 새 대화의 키에 workspace를 넣는 것은 새 대화 칸이 workspace를 넘어 같은 초안으로
 * 이어지지 않게 하기 위해서다 — 도크의 `ConversationPanel` key도 이 값이다.
 */
export function draftKeyOf(conversationId: string | null, workspaceId: string): string {
  return conversationId ?? `new:${workspaceId}`
}
