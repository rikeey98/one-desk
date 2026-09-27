import { useEffect, useState } from 'react'

/** 경과 시간이 한 칸 바뀌는 주기. 화면이 초 단위로만 적는다(`formatDuration`). */
const TICK_MS = 1000

/**
 * 지금 시각 — `active`인 동안만 1초마다 다시 그린다
 * (`docs/sdlc/conversation-timeline/` spec FR-11·FR-12).
 *
 * 진행 중인 턴의 상태 줄·메타 조각이 흐르는 시간을 적는 데 쓴다. **끝난 턴은 멈춘다** —
 * 그때 소요 시간은 `endedAt`에서 오고, 대화록의 모든 턴이 1초마다 다시 그려질 이유가 없다.
 * 켜지는 순간 한 번 새로 읽는다: 마운트 때 잡은 값이 낡아 있으면 시작하자마자 시간이 뒤로
 * 가는 것처럼 보인다.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [active])

  return now
}
