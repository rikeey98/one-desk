import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useClient } from '../client/ClientProvider'
import { useRunEventStore } from '../store/RunEventContext'
import type { RunEvent } from '@shared/events'

const EMPTY: readonly RunEvent[] = []

/**
 * 선택한 run의 이벤트. 실시간 스트림은 스토어에 쌓이고,
 * 스토어가 비어 있으면(앱 재시작 등) 로그 파일에서 되살린다.
 */
export function useRunEvents(runId: string | null) {
  const store = useRunEventStore()
  const client = useClient()
  const [error, setError] = useState<string | null>(null)

  const events = useSyncExternalStore(
    store.subscribe,
    useCallback(() => (runId ? store.getSnapshot(runId) : EMPTY), [store, runId])
  )

  useEffect(() => {
    if (!runId || store.getSnapshot(runId).length > 0) return
    let alive = true
    setError(null)
    client.runs.readLog(runId)
      .then((loaded) => { if (alive && loaded.length > 0) store.hydrate(runId, loaded) })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => { alive = false }
  }, [runId, client, store])

  return { events, error }
}
