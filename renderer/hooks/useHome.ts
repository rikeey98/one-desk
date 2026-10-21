import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { HomeSummary, HomeTarget } from '@shared/models'
import { startOfDay } from '../report/period'
import { useItemChanged } from './useItemChanged'

/** 도는 턴이 있는 동안 요약을 다시 읽는 주기 (home FR-10, plan 개정 7) — run 이벤트마다 긁지 않는다 */
export const HOME_LIVE_REFRESH_MS = 2000

/**
 * 홈 요약 (`docs/sdlc/home/` FR-1·FR-4·FR-17). `active`일 때만 읽는다 — `useInbox(open)`과 같은 모양이다. 요약 전체를 늘
 * 읽으면 workspace 화면에 있을 때도 매 이슈 변경에 모든 workspace를 긁는다. 배지는 `useHomeCount`가 따로 센다.
 *
 * "오늘"의 경계(`dayStart`)는 여기서 이 장비의 로컬 자정으로 넘긴다 — core는 시간대를 모른다(FR-5).
 *
 * 다시 읽는 계기: run 시작·종료(`onRunUpdate`) · 인박스 변화(`onInboxUpdate`) · 슬롯(`onQueueUpdate`) · 이슈 변경
 * (`onItemChanged` kind issue, 모든 workspace) · 그리고 도는 턴이 있는 동안 2초 타이머(스냅샷의 도구·텍스트).
 */
export function useHome(active: boolean) {
  const client = useClient()
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  // 새 대화 카드의 대상 — 요약과 함께 읽는다(FR-7·FR-11). 요약이 바뀌는 계기마다 같이 읽어 지워진 repo를 따라간다
  const [lastTarget, setLastTarget] = useState<HomeTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 늦게 온 옛 응답이 새 것을 덮지 않게 — 2초 타이머와 이벤트가 겹치면 요청이 교차한다
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const now = Date.now()
      const [next, target] = await Promise.all([
        client.home.summary({ now, dayStart: startOfDay(now) }),
        client.home.lastTarget()
      ])
      if (mine !== seq.current) return
      setSummary(next)
      setLastTarget(target)
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client])

  useEffect(() => {
    if (!active) return
    void refresh()
    const offs = [
      client.events.onRunUpdate(() => { void refresh() }),
      client.events.onInboxUpdate(() => { void refresh() }),
      client.events.onQueueUpdate(() => { void refresh() })
    ]
    return () => { for (const off of offs) off() }
  }, [active, client, refresh])

  // 이슈(할 일)뿐 아니라 workspace·repo도 — 준비 단계 ①·②와 workspace 카드가 그것으로 바뀐다. 홈에 남은 채 사이드바 폼으로 만든다.
  useItemChanged(active ? null : undefined, 'issue', refresh)
  useItemChanged(active ? null : undefined, 'workspace', refresh)
  useItemChanged(active ? null : undefined, 'repo', refresh)

  const hasRunning = (summary?.running.length ?? 0) > 0
  useEffect(() => {
    if (!active || !hasRunning) return
    const timer = setInterval(() => { void refresh() }, HOME_LIVE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, hasRunning, refresh])

  return { summary, lastTarget, error, refresh }
}

/**
 * 홈 배지 — 늘 읽는다(FR-4·FR-17). 계기는 인박스 배지와 같은 `onInboxUpdate`에 이슈 변경(모든 workspace)을 더한 것이다.
 * 요약 전체가 아니라 `core.home.count`다. 실패하면 마지막 값을 그대로 둔다(배지는 참고 수다).
 */
export function useHomeCount(): number {
  const client = useClient()
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setCount(await client.home.count({ now: Date.now() }))
    } catch {
      // 배지는 참고 수다 — 마지막 값을 둔다. 요약 쪽(useHome)이 같은 실패를 화면에 말한다.
    }
  }, [client])

  useEffect(() => {
    void refresh()
    return client.events.onInboxUpdate(() => { void refresh() })
  }, [client, refresh])

  useItemChanged(null, 'issue', refresh)

  return count
}
