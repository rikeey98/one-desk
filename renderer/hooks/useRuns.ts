import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Run } from '@shared/models'

/**
 * workspace의 run 목록. 시작 이후의 상태 변화는 onRunUpdate로만 오므로
 * 구독해서 같은 id를 덮어쓴다 (실행 서비스가 완료를 기다리지 않는다).
 */
export function useRuns(workspaceId: string | null) {
  const client = useClient()
  const [runs, setRuns] = useState<Run[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setRuns([]); return }
    try {
      setRuns(await client.runs.list(workspaceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    return client.events.onRunUpdate((updated) => {
      if (updated.workspaceId !== workspaceId) return
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.id === updated.id)
        if (i < 0) return [updated, ...prev]
        const next = [...prev]
        next[i] = updated
        return next
      })
    })
  }, [client, workspaceId])

  return { runs, error, refresh }
}
