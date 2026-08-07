import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Issue } from '@shared/models'

export function useIssues(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [issues, setIssues] = useState<Issue[]>([])

  const refresh = useCallback(async () => {
    if (!workspaceId) { setIssues([]); return }
    setIssues(await client.issues.list({
      workspaceId,
      ...(repoId ? { repoId } : {})
    }))
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])
  return { issues, refresh }
}
