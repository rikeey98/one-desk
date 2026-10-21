import { describe, it, expect } from 'vitest'
import { TICK_MS, barBox, barTitle, clock, ticksOf } from './timeline'

const DAY_START = new Date(2026, 9, 21, 0, 0, 0, 0).getTime()
const HOUR = 60 * 60 * 1000

describe('barBox', () => {
  it('오늘 [자정, 지금]을 0~1로 편다', () => {
    const now = DAY_START + 10 * HOUR
    expect(barBox({ from: DAY_START + 2 * HOUR, to: DAY_START + 4 * HOUR }, DAY_START, now)).toEqual({ left: 0.2, width: 0.2 })
  })

  it('짧은 대화도 최소 폭으로 보이고 오른쪽 끝을 넘지 않는다', () => {
    const now = DAY_START + 10 * HOUR
    const box = barBox({ from: now - 1000, to: now }, DAY_START, now)
    expect(box.width).toBeCloseTo(0.006)
    expect(box.left + box.width).toBeLessThanOrEqual(1)
  })

  it('자정 직후(span 0)에도 던지지 않는다', () => {
    expect(barBox({ from: DAY_START, to: DAY_START }, DAY_START, DAY_START).left).toBe(0)
  })
})

describe('ticksOf', () => {
  it('자정부터 2시간마다 지금까지 — 이름은 "N시"', () => {
    const ticks = ticksOf(DAY_START, DAY_START + 5 * HOUR)
    expect(ticks.map((t) => t.label)).toEqual(['0시', '2시', '4시'])
    expect(ticks[1]?.at).toBeCloseTo(TICK_MS / (5 * HOUR))
  })
})

describe('barTitle · clock', () => {
  it('제목 · 상태 · 시각', () => {
    expect(clock(DAY_START + 9 * HOUR + 5 * 60 * 1000)).toBe('09:05')
    expect(barTitle({ title: '로그인', from: DAY_START + 9 * HOUR, to: DAY_START + 10 * HOUR }, '완료')).toBe('로그인 · 완료 · 09:00–10:00')
  })
})
