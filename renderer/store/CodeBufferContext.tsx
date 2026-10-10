import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { CodeBufferStore } from './codeBuffers'
import type { CloseGuard } from './closeGuard'

const CodeBufferContext = createContext<{ store: CodeBufferStore; guard: CloseGuard } | null>(null)

/**
 * 코드 칸의 버퍼 스토어와 닫기 가드 (docs/sdlc/code-editor/ FR-20·FR-21). `main.tsx`가 **앱 창에만** 하나 만들어
 * 내린다 — 초안 스토어(`DraftProvider`)와 같은 자리·같은 모양이다.
 *
 * **기본값을 두지 않는다.** 모듈 전역 스토어를 기본으로 두면 Provider 한 줄을 빠뜨려도 조용히 돌고, 테스트끼리 고친
 * 글이 샌다. 없으면 던진다.
 */
export function CodeBufferProvider({ store, guard, children }: {
  store: CodeBufferStore
  guard: CloseGuard
  children: ReactNode
}) {
  return <CodeBufferContext.Provider value={{ store, guard }}>{children}</CodeBufferContext.Provider>
}

function useCodeBufferContext() {
  const value = useContext(CodeBufferContext)
  if (!value) throw new Error('CodeBufferProvider 안에서만 사용할 수 있습니다')
  return value
}

/** 스토어를 듣는다 — 바뀔 때마다 다시 그린다. 읽기는 돌려받은 스토어로 렌더 중에 한다 */
export function useCodeBuffers(): CodeBufferStore {
  const { store } = useCodeBufferContext()
  useSyncExternalStore(store.subscribe, store.version)
  return store
}

export function useCloseGuard(): CloseGuard {
  return useCodeBufferContext().guard
}
