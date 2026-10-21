import type { HomeTimelineBar } from '@shared/models'

/** 눈금 간격 — 2시간 (spec §4) */
export const TICK_MS = 2 * 60 * 60 * 1000

export interface BarBox {
  /** 왼쪽·폭 — 오늘 `[dayStart, now]`에 대한 비율(0~1) */
  left: number
  width: number
}

/**
 * 막대의 자리 — `[dayStart, now]`를 0~1로 편다. 짧은 대화도 보이게 최소 폭을 둔다(`minRatio`). `now`가 `dayStart`와 같으면
 * (자정 직후) 전부 왼쪽 끝이다.
 */
export function barBox(bar: Pick<HomeTimelineBar, 'from' | 'to'>, dayStart: number, now: number, minRatio = 0.006): BarBox {
  const span = Math.max(1, now - dayStart)
  const left = Math.min(1, Math.max(0, (bar.from - dayStart) / span))
  const right = Math.min(1, Math.max(left, (bar.to - dayStart) / span))
  const width = Math.max(minRatio, right - left)
  return { left: Math.min(left, 1 - width), width }
}

export interface Tick {
  /** 0~1 */
  at: number
  label: string
}

/** 자정부터 2시간마다 — 지금까지. `label`은 `HH시` */
export function ticksOf(dayStart: number, now: number): Tick[] {
  const span = Math.max(1, now - dayStart)
  const out: Tick[] = []
  for (let t = dayStart; t <= now; t += TICK_MS) {
    const hour = new Date(t).getHours()
    out.push({ at: (t - dayStart) / span, label: `${hour}시` })
  }
  return out
}

/** 막대의 `title` — 제목 · 상태 · 시각 */
export function barTitle(bar: Pick<HomeTimelineBar, 'title' | 'from' | 'to'>, statusLabel: string): string {
  return `${bar.title} · ${statusLabel} · ${clock(bar.from)}–${clock(bar.to)}`
}

export function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
