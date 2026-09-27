import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isNearBottom } from '../followBottom'

/**
 * 대화록의 바닥 따라가기 (`docs/sdlc/conversation-timeline/` spec FR-42).
 *
 * - 바닥에서 24px 안이면 "붙어 있다". 붙어 있을 때 **내용 버전**(`version`)이 바뀌면 바닥으로
 *   내린다. 마운트도 한 번의 버전 변화라 대화를 바꾸면(재마운트) 바닥에서 시작한다.
 * - **사용자가 펼치거나 접어서 높이가 바뀐 것으로는 움직이지 않는다** — 그것은 내용 버전이
 *   아니다. 지난 턴의 `자세히`를 눌렀는데 화면이 바닥으로 튀면 방금 누른 것이 사라진다.
 *   그래서 **내용의** 높이 변화(ResizeObserver로 안쪽을 보는 것)를 계기로 쓰지 않는다. 관찰하는
 *   것은 대화록 칸 **자신의** 높이뿐이다(아래 effect).
 * - 붙어 있는지는 스크롤할 때 다시 재고, **대화록 안을 누른 뒤에도** 한 프레임 뒤에 다시 잰다
 *   (다듬음 2026-09-27, plan 6단계). 펼침은 scrollTop을 바꾸지 않아 스크롤 이벤트가 없다 —
 *   바닥에 있다가 턴을 펼쳐 내용이 아래로 길어졌는데 "붙어 있다"가 낡은 채로 남으면, 다음 이벤트가
 *   올 때 펼쳐 둔 것을 두고 바닥으로 끌려간다. 누른 뒤에 재면 그때부터는 떨어져 있는 것이고
 *   `최신으로 이동`이 뜬다. 움직이는 것이 아니라 판정만 고치는 것이라 위 규칙과 어긋나지 않는다.
 */
export function useFollowBottom(
  ref: RefObject<HTMLElement | null>, version: string
): { atBottom: boolean; jump(): void } {
  // 판정은 ref가 쥔다 — 레이아웃 effect가 렌더를 기다리지 않고 지금 값을 읽어야 한다.
  // 화면(버튼)에 쓰는 것만 state로 따로 둔다.
  const stuck = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  // 아래 관찰자가 마지막으로 처리한 대화록 칸의 높이. 관찰자가 없으면(jsdom) null이다.
  const boxHeight = useRef<number | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    // 칸이 줄었는데 관찰자가 아직 처리하지 않았으면 재지 않는다 — 관찰자에게 맡긴다. 도크를 끄는
    // 동안 줄어든 칸의 스크롤 이벤트가 관찰자보다 먼저 오는데(스크롤 이벤트는 프레임의 레이아웃
    // 앞에서, 관찰자는 뒤에서 돈다), 여기서 재면 줄어든 만큼 바닥에서 떨어져 보여 "붙어 있다"가
    // 풀리고 관찰자가 바닥을 지키지 않는다(실측: 하한까지 끌면 바닥에서 72px 떨어져 멈췄다).
    if (boxHeight.current !== null && el.clientHeight !== boxHeight.current) return
    const near = isNearBottom(el)
    stuck.current = near
    setAtBottom(near)
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame: number | null = null
    // 누른 것이 다시 그려진 뒤에 잰다 — React는 이 리스너(스크롤러)보다 바깥(루트)에서 click을
    // 받으므로, 여기서 바로 재면 펼치기 전의 높이다.
    function onClick() {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        measure()
      })
    }
    el.addEventListener('scroll', measure, { passive: true })
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('scroll', measure)
      el.removeEventListener('click', onClick)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [ref, measure])

  // **대화록 칸 자신의 높이가 바뀌면**(도크를 끌거나 최대화하거나, 입력부에 예약 칩이 떠 칸이
  // 줄면) 붙어 있을 때 바닥을 지킨다 — 상자가 줄어도 scrollTop은 위를 기준으로 남아 바닥이 가려지고,
  // 스크롤 이벤트도 없어 "붙어 있다"가 낡는다. **내용의 높이 변화가 아니다**: 스크롤러의 상자는
  // 안의 턴을 펼치거나 새 줄이 붙어도 그대로라 이 관찰자가 돌지 않고, 돌더라도 칸 높이가 같으면
  // 아무것도 하지 않는다(다듬음 2026-09-27, plan 6단계). jsdom에는 ResizeObserver가 없다.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    boxHeight.current = el.clientHeight
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === boxHeight.current) return
      boxHeight.current = el.clientHeight
      if (stuck.current) el.scrollTop = el.scrollHeight
      else measure()
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      boxHeight.current = null
    }
  }, [ref, measure])

  // 그리기 전에 내린다 — effect면 새 줄이 한 프레임 바닥 밖에 그려졌다가 튄다.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !stuck.current) return
    el.scrollTop = el.scrollHeight
  }, [ref, version])

  const jump = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stuck.current = true
    setAtBottom(true)
  }, [ref])

  return { atBottom, jump }
}
