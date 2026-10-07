import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { ReportData } from '@shared/models'
import type { Period } from '../report/period'

/** 조건이 바뀐 뒤 다시 만들기까지 (FR-21) — 날짜를 한 글자씩 고칠 때마다 읽지 않게 */
export const REPORT_DEBOUNCE_MS = 250

/**
 * 기간 리포트를 읽는다 (`docs/sdlc/period-report/` FR-21). **workspace는 전부 읽는다** — 고른 것만 그리는 것은 화면의
 * 일이다. 그래야 고르지 않은 workspace 옆에도 그 기간의 항목 수가 보이고, 체크 한 번에 다시 읽지 않는다.
 *
 * 늦게 온 응답은 버린다(조건을 빨리 바꾸면 응답 순서가 뒤집힐 수 있다). run이 끝나거나 이슈·메모가 바뀌면 다시 읽는다 —
 * 이 훅은 리포트 화면이 떠 있을 때만 산다.
 */
export function useReport(workspaceIds: readonly string[], period: Period) {
  const client = useClient()
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const key = `${workspaceIds.join(',')}|${period.since}|${period.until}`
  const latest = useRef({ workspaceIds, period })
  latest.current = { workspaceIds, period }

  const load = useCallback(async () => {
    const mine = ++seq.current
    const { workspaceIds: ids, period: p } = latest.current
    try {
      const next = await client.reports.build({ workspaceIds: [...ids], since: p.since, until: p.until })
      if (mine !== seq.current) return
      setData(next)
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => { void load() }, REPORT_DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [key, load])

  useEffect(() => {
    const offRun = client.events.onRunUpdate((run) => {
      if (run.endedAt !== null) void load()
    })
    const offItem = client.events.onItemChanged((change) => {
      if (change.kind === 'issue' || change.kind === 'memo' || change.kind === 'workspace') void load()
    })
    return () => { offRun(); offItem() }
  }, [client, load])

  return { data, error, loading, retry: load }
}
