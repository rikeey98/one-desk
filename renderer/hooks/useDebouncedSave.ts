import { useCallback, useEffect, useRef } from 'react'

const DEFAULT_DELAY_MS = 600

/**
 * 입력이 멎으면 저장한다. 타이머만 담고 도메인은 모른다.
 *
 * flush는 패널을 접거나 다른 항목으로 옮길 때 부른다 — 대기 중인 저장을 잃지 않기
 * 위해서다 (설계 §5). save가 던지면 그대로 올려보내 호출자가 화면에 띄운다.
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
