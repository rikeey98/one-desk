import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useClient } from '../client/ClientProvider'
import { useRunEventStore } from '../store/RunEventContext'
import type { RunEvent } from '@shared/events'

const EMPTY: readonly RunEvent[] = []

/**
 * 스토어에 지금 있는 그 run의 이벤트 — **로그 파일을 읽지 않는다**
 * (`docs/sdlc/conversation-timeline/` spec FR-14).
 *
 * 접힌 턴이 쓴다. 대화를 열 때마다 모든 턴의 로그를 읽지 않는다는 원칙(설계 §4-1) 그대로다
 * — 그 대가로 앱을 다시 켠 뒤의 끝난 턴은 한 번 펼치기 전까지 활동 요약이 없다(spec §6 우려 4).
 * 펼친 턴의 `useRunEvents`가 스토어를 채우면 같은 스토어를 보므로 여기에도 나타난다.
 */
export function useRunEventSnapshot(runId: string | null): readonly RunEvent[] {
  const store = useRunEventStore()
  return useSyncExternalStore(
    store.subscribe,
    useCallback(() => (runId ? store.getSnapshot(runId) : EMPTY), [store, runId])
  )
}

/**
 * 선택한 run의 이벤트. 실시간 스트림은 스토어에 쌓이고,
 * 스토어가 비어 있으면(앱 재시작 등) 로그 파일에서 되살린다.
 *
 * 요청과 응답 사이에 push된 이벤트는 `hydrate`가 seq로 병합해 살린다 — 응답으로
 * 스토어를 통째로 바꾸면 그 줄이 사라진다(`docs/sdlc/conversation-fixes/` spec FR-19).
 */
export function useRunEvents(runId: string | null) {
  const store = useRunEventStore()
  const client = useClient()
  const [error, setError] = useState<string | null>(null)

  const events = useRunEventSnapshot(runId)

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
