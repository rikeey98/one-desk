import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Issue } from '@shared/models'

export function useIssues(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [issues, setIssues] = useState<Issue[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setIssues([]); return }
    try {
      setIssues(await client.issues.list({
        workspaceId,
        ...(repoId ? { repoId } : {})
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])
  return { issues, error, refresh }
}
