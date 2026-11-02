/**
 * 새 그림의 이름 (docs/sdlc/drawings/ spec FR-5) — `그림 N`에서 비어 있는 가장 작은 N. 터미널 탭 이름과 같은 규칙이다.
 * 정확히 그 모양인 이름만 번호를 차지한다(`그림 01`·`그림 1 사본`은 아니다).
 */
const PATTERN = /^그림 ([1-9]\d*)$/

export function nextDrawingTitle(titles: readonly string[]): string {
  const used = new Set<number>()
  for (const t of titles) {
    const m = PATTERN.exec(t)
    if (m) used.add(Number(m[1]))
  }
  let n = 1
  while (used.has(n)) n += 1
  return `그림 ${n}`
}
