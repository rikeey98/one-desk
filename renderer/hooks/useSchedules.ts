import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useItemChanged } from './useItemChanged'
import type { ScheduleView } from '@shared/models'

/**
 * 정기 실행 목록 (`docs/sdlc/scheduled-runs/` spec FR-33) — 모든 workspace. 바뀜 알림 `schedule`(workspace를 가리지 않는다)과 run push
 * (마지막 결과의 점이 바뀐다)에 다시 읽는다.
 */
export function useSchedules() {
  const client = useClient()
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setSchedules(await client.schedules.list())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client])

  useEffect(() => { void refresh() }, [refresh])
  useItemChanged(null, 'schedule', refresh)
  useEffect(() => client.events.onRunUpdate(() => { void refresh() }), [client, refresh])

  return { schedules, error, refresh }
}
