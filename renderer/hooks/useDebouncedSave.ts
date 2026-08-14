import { useCallback, useEffect, useRef } from 'react'

const DEFAULT_DELAY_MS = 600

/**
 * 입력이 멎으면 저장한다. 타이머만 담고 도메인은 모른다.
 *
 * flush는 패널을 접거나 다른 항목으로 옮길 때 부른다 — 대기 중인 저장을 잃지 않기
 * 위해서다 (설계 §5).
 *
 * **오류 처리는 save 자신의 몫이다.** `await flush()`로 직접 기다리는 호출자에게는
 * save가 던진 오류가 그대로 전달된다. 하지만 디바운스로 저절로 저장되는 가장 흔한
 * 경로(schedule이 건 setTimeout 콜백 안의 `void flush()`)와 언마운트 시 흘려보내는
 * flush는 둘 다 반환값을 기다리는 사람이 없다 — 타이머가 나중에 콜백을 부를 뿐이라
 * 그 자리에는 애초에 await할 호출자가 없기 때문이다. 이 경로에서 save가 거부되면
 * 처리되지 않은 프라미스 거부(unhandled rejection)로 남을 뿐, 화면 어디에도 뜨지
 * 않는다. 그러므로 save는 스스로 오류를 잡아 자기 오류 상태로 보관해야 한다 — 이
 * 훅은 디바운스 경로의 실패를 사용자에게 보여줄 방법이 없다.
 */
export function useDebouncedSave(
  save: (value: string) => Promise<void>,
  delayMs: number = DEFAULT_DELAY_MS
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  // save가 매 렌더 새 함수여도 타이머를 다시 걸지 않게 최신 것만 들고 있는다.
  const latestSave = useRef(save)
  latestSave.current = save

  const clear = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const flush = useCallback(async () => {
    clear()
    const value = pending.current
    if (value === null) return
    pending.current = null
    await latestSave.current(value)
  }, [clear])

  const schedule = useCallback((value: string) => {
    pending.current = value
    clear()
    // 이 콜백은 나중에 타이머가 부른다 — 여기서 반환되는 promise를 기다릴 호출자가
    // 없다. save가 거부되면 처리되지 않은 프라미스 거부로 남는다(위 docstring 참고).
    timer.current = setTimeout(() => { void flush() }, delayMs)
  }, [clear, flush, delayMs])

  const cancel = useCallback(() => { clear(); pending.current = null }, [clear])

  // 언마운트되면 대기 중인 저장을 흘려보낸다. 패널을 접거나 다른 항목으로 옮기면
  // 상세가 언마운트되는데, 여기서 버리면 디바운스가 끝나기 전에 친 내용이 날아간다.
  // 결과를 받을 컴포넌트가 없어 오류는 관측되지 않지만 쓰기를 잃는 쪽이 더 나쁘다.
  // ref만 읽으므로 이 effect는 마운트/언마운트에만 돈다.
  useEffect(() => () => { void flush() }, [flush])

  return { schedule, flush, cancel }
}
