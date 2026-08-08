import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Memo } from '@shared/models'

export function useMemos(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [memos, setMemos] = useState<Memo[]>([])

  const refresh = useCallback(async () => {
    if (!workspaceId) { setMemos([]); return }
    setMemos(await client.memos.list({
      workspaceId,
      ...(repoId ? { repoId } : {})
    }))
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])
  return { memos, refresh }
}
