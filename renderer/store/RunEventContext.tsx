import { createContext, useContext, type ReactNode } from 'react'
import type { RunEventStore } from './runEvents'

const RunEventContext = createContext<RunEventStore | null>(null)

/**
 * 스토어는 main.tsx에서 하나만 만들어 내려보낸다.
 * 컴포넌트가 전역 브리지에 직접 닿지 않게 하는 통로다 (설계 §4 규칙 2).
 */
export function RunEventProvider({ store, children }: {
  store: RunEventStore
  children: ReactNode
}) {
  return <RunEventContext.Provider value={store}>{children}</RunEventContext.Provider>
}

export function useRunEventStore(): RunEventStore {
  const store = useContext(RunEventContext)
  if (!store) throw new Error('RunEventProvider 안에서만 사용할 수 있습니다')
  return store
}
