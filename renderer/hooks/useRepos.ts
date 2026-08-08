import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Repo } from '@shared/models'

export function useRepos(workspaceId: string | null) {
  const client = useClient()
  const [repos, setRepos] = useState<Repo[]>([])

  const refresh = useCallback(async () => {
    if (!workspaceId) { setRepos([]); return }
    setRepos(await client.repos.list(workspaceId))
  }, [client, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  return { repos, refresh }
}
