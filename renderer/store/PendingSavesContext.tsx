import { createContext, useContext, type ReactNode } from 'react'
import type { PendingSaves } from './pendingSaves'

const PendingSavesContext = createContext<PendingSaves | null>(null)

/**
 * 창마다 하나인 저장 등록부 (docs/sdlc/item-windows/ FR-15). `main.tsx`가 만들어 내려보낸다.
 *
 * **초안 스토어와 달리 Provider가 없어도 던지지 않는다** — 없으면 `useDebouncedSave`가 등록하지 않을 뿐이고
 * 공유되는 전역 상태가 없어 테스트끼리 새는 것도 없다. 대신 `main.tsx`의 Provider 한 줄은 단위 테스트가 못
 * 잡으므로 e2e의 "닫기 직전에 친 글자가 남는다"(앱 창·패널 창)가 맡는다.
 */
export function PendingSavesProvider({ saves, children }: { saves: PendingSaves; children: ReactNode }) {
  return <PendingSavesContext.Provider value={saves}>{children}</PendingSavesContext.Provider>
}

export function usePendingSaves(): PendingSaves | null {
  return useContext(PendingSavesContext)
}
