import { createContext, useContext, type ReactNode } from 'react'
import type { OneDeskClient } from '@shared/client'

const ClientContext = createContext<OneDeskClient | null>(null)

export function ClientProvider({ client, children }: {
  client: OneDeskClient
  children: ReactNode
}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function useClient(): OneDeskClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('ClientProvider 안에서만 사용할 수 있습니다')
  return client
}
