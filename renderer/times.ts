/**
 * 상세의 시각 한 줄 (`docs/sdlc/timestamps/` FR-8) — `만듦 9월 28일 · 완료 9월 29일`.
 *
 * 순수 함수라 시계를 인자로 받는다. 모르는 시각(null)은 줄에서 뺀다 — 0년으로 채우지 않는다.
 * 올해가 아니면 연도를 붙인다. 날짜·시·분은 `title`에만 있다(한 줄이 길어지지 않게).
 */
export function timesView(
  entries: ReadonlyArray<readonly [label: string, at: number | null]>, now: number
): { text: string; title: string } {
  const year = new Date(now).getFullYear()
  const known = entries.filter((e): e is readonly [string, number] => e[1] !== null)
  const day = (ms: number) => {
    const d = new Date(ms)
    const md = `${d.getMonth() + 1}월 ${d.getDate()}일`
    return d.getFullYear() === year ? md : `${d.getFullYear()}년 ${md}`
  }
  const exact = (ms: number) => {
    const d = new Date(ms)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`
  }
  return {
    text: known.map(([label, ms]) => `${label} ${day(ms)}`).join(' · '),
    title: known.map(([label, ms]) => `${label} ${exact(ms)}`).join('\n')
  }
}
