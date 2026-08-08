import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Memo } from '@shared/models'

export function useMemos(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [memos, setMemos] = useState<Memo[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setMemos([]); return }
    try {
      setMemos(await client.memos.list({
        workspaceId,
        ...(repoId ? { repoId } : {})
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])
  return { memos, error, refresh }
}
