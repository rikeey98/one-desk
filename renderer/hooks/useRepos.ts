import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Repo } from '@shared/models'

export function useRepos(workspaceId: string | null) {
  const client = useClient()
  const [repos, setRepos] = useState<Repo[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setRepos([]); return }
    try {
      setRepos(await client.repos.list(workspaceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  return { repos, error, refresh }
}
