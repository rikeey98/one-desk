import { useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { QueueSnapshot } from '@shared/models'

/**
 * 전역 실행 슬롯 현황. workspace와 무관하다.
 * 초기 1회 조회한 뒤 push로만 갱신된다 — 큐는 run 하나 단위가 아니라서
 * onRunUpdate로는 표현되지 않는다.
 */
export function useQueue() {
  const client = useClient()
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    client.runs.queueSnapshot().then(
      (s) => { if (alive) setSnapshot(s) },
      (err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) }
    )
    return () => { alive = false }
  }, [client])

  useEffect(() => client.events.onQueueUpdate(setSnapshot), [client])

  return { snapshot, error }
}
