import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Workspace } from '@shared/models'

export function useWorkspaces() {
  const client = useClient()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setWorkspaces(await client.workspaces.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // finally에 두는 것이 핵심이다. try 안에 두면 실패 시 영원히 로딩 상태로 남는다.
      setLoading(false)
    }
  }, [client])

  useEffect(() => { void refresh() }, [refresh])

  return { workspaces, loading, error, refresh }
}
