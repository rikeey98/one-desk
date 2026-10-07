/**
 * 리포트의 기간 (`docs/sdlc/period-report/` FR-3). 전부 **앱의 시간대**로 날을 가른다 — 주의 시작은 월요일이고,
 * 끝은 늘 그날을 포함하지 않는 0시(`[since, until)`)다. `now`를 인자로 받아 테스트가 시계를 세운다.
 */

export type Preset = 'this-week' | 'last-week' | 'last-7' | 'last-30'

export const PRESETS: ReadonlyArray<{ id: Preset; label: string }> = [
  { id: 'this-week', label: '이번 주' },
  { id: 'last-week', label: '지난주' },
  { id: 'last-7', label: '지난 7일' },
  { id: 'last-30', label: '지난 30일' }
]

export interface Period {
  since: number
  until: number
}

/** 그 시각이 속한 날의 0시 */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** n일 뒤의 0시 — 24시간을 더하지 않는다(서머타임이 있는 시간대에서 하루가 23·25시간이다) */
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

/** 그 주 월요일 0시 */
export function startOfWeek(ms: number): number {
  const day = startOfDay(ms)
  const offset = (new Date(day).getDay() + 6) % 7
  return addDays(day, -offset)
}

/**
 * - 이번 주: 이번 주 월요일 ~ 다음 주 월요일(축이 한 주 전체를 그리도록 끝은 앞으로 둔다)
 * - 지난주: 지난 월요일 ~ 이번 월요일
 * - 지난 7일·30일: 오늘을 포함해 7·30일 — 내일 0시까지
 */
export function presetRange(preset: Preset, now: number): Period {
  const today = startOfDay(now)
  const monday = startOfWeek(now)
  switch (preset) {
    case 'this-week': return { since: monday, until: addDays(monday, 7) }
    case 'last-week': return { since: addDays(monday, -7), until: monday }
    case 'last-7': return { since: addDays(today, -6), until: addDays(today, 1) }
    case 'last-30': return { since: addDays(today, -29), until: addDays(today, 1) }
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `<input type="date">`의 값(로컬 날짜)을 그날 0시로. 못 읽으면 null */
export function parseDateInput(value: string): number | null {
  const m = DATE.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(y, mo - 1, d)
  if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) return null
  return at.getTime()
}

/** 0시를 `<input type="date">` 값으로 */
export function toDateInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 직접 지정 — 끝날을 **포함한다**(끝날 다음 날 0시까지). 시작이 끝보다 뒤거나 못 읽으면 null */
export function customRange(from: string, to: string): Period | null {
  const since = parseDateInput(from)
  const last = parseDateInput(to)
  if (since === null || last === null || last < since) return null
  return { since, until: addDays(last, 1) }
}

/** 끝날(포함) — 날짜 칸이 보여줄 값이다 */
export function lastDayOf(period: Period): number {
  return addDays(period.until, -1)
}

/** 기간이 덮는 날 수 */
export function dayCount(period: Period): number {
  let n = 0
  for (let d = period.since; d < period.until; d = addDays(d, 1)) n += 1
  return n
}
