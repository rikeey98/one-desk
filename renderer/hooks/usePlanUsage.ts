import { useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { PlanUsage } from '@shared/models'

/**
 * 계정의 요금제 사용률 (`docs/sdlc/plan-usage/` FR-4). 값이 없으면 null.
 *
 * 한 번 읽기와 구독이 둘 다 있는 이유는 `useMcpStatus`와 같다 — 창이 먼저 떴든 실행이 먼저
 * 끝났든 마지막 값이 보여야 한다. 늦게 도착한 읽기가 그 사이 push된 새 값을 덮지 않게, 읽기
 * 결과는 아직 아무것도 받지 않았을 때만 쓴다.
 */
export function usePlanUsage(): PlanUsage | null {
  const client = useClient()
  const [usage, setUsage] = useState<PlanUsage | null>(null)

  useEffect(() => {
    let alive = true
    void client.account.planUsage().then((u) => {
      if (alive && u) setUsage((prev) => prev ?? u)
    })
    const off = client.events.onPlanUsage(setUsage)
    return () => { alive = false; off() }
  }, [client])

  return usage
}
