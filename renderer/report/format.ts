import { lastDayOf, type Period } from './period'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

const pad = (n: number) => String(n).padStart(2, '0')

export function weekdayOf(ms: number): string {
  return WEEKDAYS[new Date(ms).getDay()]!
}

/** `10-02(금)` — 리포트의 날짜는 이 한 형식이다 (spec §4) */
export function dayLabel(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}(${weekdayOf(ms)})`
}

/** `2026-09-28 ~ 10-04`. 해가 바뀌면 끝에도 해를 쓴다. 하루면 그날 하나 */
export function periodLabel(period: Period): string {
  const a = new Date(period.since)
  const b = new Date(lastDayOf(period))
  const head = `${a.getFullYear()}-${pad(a.getMonth() + 1)}-${pad(a.getDate())}`
  if (a.getTime() === b.getTime()) return head
  const tail = a.getFullYear() === b.getFullYear()
    ? `${pad(b.getMonth() + 1)}-${pad(b.getDate())}`
    : `${b.getFullYear()}-${pad(b.getMonth() + 1)}-${pad(b.getDate())}`
  return `${head} ~ ${tail}`
}

/** agent 실행 시간 — `40초`·`38분`·`3시간 42분`·`2시간` (FR-9) */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}초`
  const minutes = Math.round(s / 60)
  if (minutes < 60) return `${minutes}분`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

/** 줄바꿈을 공백 하나로 접는다 — 제목·답 한 줄 (FR-12) */
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}
