import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Workspace } from '@shared/models'

export function useWorkspaces() {
  const client = useClient()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setWorkspaces(await client.workspaces.list())
    setLoading(false)
  }, [client])

  useEffect(() => { void refresh() }, [refresh])

  return { workspaces, loading, refresh }
}
