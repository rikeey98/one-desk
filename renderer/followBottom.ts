/**
 * 대화록이 바닥에 "붙어 있는가" (`docs/sdlc/conversation-timeline/` spec FR-42).
 *
 * 붙어 있을 때만 새 내용을 따라 내려간다 — 위로 올려 읽는 사람을 끌어내리지 않는다.
 * 판정만 떼어 둔 것은 jsdom에 레이아웃이 없어서다: 경계값(23·24·25px)을 스크롤 속성만으로
 * 고정할 수 있어야 한다.
 */
export const FOLLOW_THRESHOLD_PX = 24

export function isNearBottom(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold: number = FOLLOW_THRESHOLD_PX
): boolean {
  // 고배율 화면에서는 scrollTop이 소수라 바닥에서도 거리가 0.5px쯤 남는다.
  // 내용이 상자보다 짧으면 거리가 음수다 — 그때도 바닥이다.
  return box.scrollHeight - box.scrollTop - box.clientHeight <= threshold
}
