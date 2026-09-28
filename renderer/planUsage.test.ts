import { describe, it, expect } from 'vitest'
import { planUsageView } from './planUsage'
import type { PlanUsage } from '@shared/models'

const NOW = 1_790_000_000_000
const HOUR = 3_600_000

function usage(over: Partial<PlanUsage> = {}): PlanUsage {
  return {
    fiveHour: { utilization: 0.06, resetsAt: NOW + HOUR },
    sevenDay: { utilization: 0.02, resetsAt: NOW + 100 * HOUR },
    limited: false,
    observedAt: NOW - 3 * 60_000,
    ...over
  }
}

describe('planUsageView (docs/sdlc/plan-usage/ FR-5)', () => {
  it('두 창의 사용률을 한 줄로 적는다', () => {
    const view = planUsageView(usage(), NOW)
    expect(view.label).toBe('요금제 5h 6% · 7d 2%')
    expect(view.warn).toBe(false)
  })

  it('title에 창마다 리셋과 마지막 확인이 있다', () => {
    const { title } = planUsageView(usage(), NOW)
    expect(title).toMatch(/5시간 한도 6% — .+ 리셋/)
    expect(title).toMatch(/7일 한도 2% — .+ 리셋/)
    expect(title).toContain('마지막 확인 3분 전')
  })

  it('리셋 시각이 지난 창은 —다 — 그 뒤의 사용량을 모른다', () => {
    const view = planUsageView(usage({ fiveHour: { utilization: 0.9, resetsAt: NOW - 1 } }), NOW)
    expect(view.label).toBe('요금제 5h — · 7d 2%')
    // 지난 창의 90%는 경고도 아니다.
    expect(view.warn).toBe(false)
    expect(view.title).toContain('5시간 한도 — 리셋됨')
  })

  it('80%를 넘는 창이 있으면 경고다 — 80%는 아니다', () => {
    expect(planUsageView(usage({ sevenDay: { utilization: 0.81, resetsAt: NOW + HOUR } }), NOW).warn).toBe(true)
    expect(planUsageView(usage({ sevenDay: { utilization: 0.8, resetsAt: NOW + HOUR } }), NOW).warn).toBe(false)
  })

  it('막혔으면 "한도 도달"을 붙이고 경고다', () => {
    const view = planUsageView(usage({ limited: true }), NOW)
    expect(view.label).toBe('요금제 5h 6% · 7d 2% · 한도 도달')
    expect(view.warn).toBe(true)
  })

  it('0보다 크고 1% 미만이면 <1%다 — 0%는 "안 썼다"로 읽힌다', () => {
    expect(planUsageView(usage({ fiveHour: { utilization: 0.004, resetsAt: NOW + HOUR } }), NOW).label)
      .toBe('요금제 5h <1% · 7d 2%')
    expect(planUsageView(usage({ fiveHour: { utilization: 0, resetsAt: NOW + HOUR } }), NOW).label)
      .toBe('요금제 5h 0% · 7d 2%')
  })

  it('모르는 창은 빼고 적는다', () => {
    expect(planUsageView(usage({ sevenDay: null }), NOW).label).toBe('요금제 5h 6%')
  })

  it.each([
    [10_000, '방금'],
    [59 * 60_000, '59분 전'],
    [2 * HOUR + 1, '2시간 전']
  ])('마지막 확인이 %sms 전이면 "%s"', (ago, text) => {
    expect(planUsageView(usage({ observedAt: NOW - ago }), NOW).title).toContain(`마지막 확인 ${text}`)
  })
})
