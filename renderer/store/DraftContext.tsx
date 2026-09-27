import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { isBlankDraft, type DraftStore } from './drafts'

const DraftContext = createContext<DraftStore | null>(null)

/**
 * 초안 스토어는 main.tsx에서 하나만 만들어 내려보낸다 (`docs/sdlc/conversation-timeline/`
 * spec FR-31) — `RunEventProvider`와 같은 자리·같은 모양이다.
 *
 * **기본값을 두지 않는다.** 모듈 전역 스토어를 기본으로 두면 Provider 한 줄을 빠뜨려도
 * 조용히 돌고, 테스트끼리 초안이 샌다. 없으면 던진다.
 */
export function DraftProvider({ store, children }: {
  store: DraftStore
  children: ReactNode
}) {
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>
}

export function useDraftStore(): DraftStore {
  const store = useContext(DraftContext)
  if (!store) throw new Error('DraftProvider 안에서만 사용할 수 있습니다')
  return store
}

/**
 * 이 키에 보낼 것이 있는 초안이 있는가 (spec §8의 3, 결정 2026-09-27) — 대화 헤더의 `멈추기`가
 * 이것으로 선다. 입력부가 칠 때마다 스토어에 쓰므로 여기서 들으면 된다. 값은 "비었나" 하나라
 * 한 글자마다가 아니라 비고 차는 순간에만 다시 그린다.
 */
export function useDraftFilled(key: string): boolean {
  const store = useDraftStore()
  const read = useCallback(() => !isBlankDraft(store.get(key)), [store, key])
  return useSyncExternalStore(store.subscribe, read)
}
