import { describe, it, expect } from 'vitest'
import { dueOf, MISSED_GRACE_MS } from './due'
import type { ScheduleTrigger } from '@shared/scheduleTrigger'

const MON_9_KST = Date.parse('2026-11-02T00:00:00Z')
const MIN = 60_000
const DAY = 24 * 60 * MIN
const trigger: ScheduleTrigger = { kind: 'weekdays', time: '09:00' }

function schedule(over: Partial<{ enabled: boolean; anchorAt: number }> = {}) {
  return { enabled: true, trigger, timeZone: 'Asia/Seoul', anchorAt: MON_9_KST - 10 * MIN, ...over }
}

describe('dueOf (spec FR-10·11)', () => {
  it('꺼져 있으면 돌지 않는다', () => {
    expect(dueOf(schedule({ enabled: false }), MON_9_KST)).toBeNull()
  })

  it('회차가 없으면 null', () => {
    expect(dueOf(schedule(), MON_9_KST - MIN)).toBeNull()
  })

  it('정시 — 2분 안이면 on_time', () => {
    expect(dueOf(schedule(), MON_9_KST)).toEqual({ slotAt: MON_9_KST, cause: 'on_time' })
    expect(dueOf(schedule(), MON_9_KST + MISSED_GRACE_MS)).toEqual({ slotAt: MON_9_KST, cause: 'on_time' })
  })

  it('2분을 넘기면 놓친 것이다', () => {
    expect(MISSED_GRACE_MS).toBe(2 * MIN)
    expect(dueOf(schedule(), MON_9_KST + MISSED_GRACE_MS + 1)).toEqual({ slotAt: MON_9_KST, cause: 'missed' })
  })

  it('이틀 꺼 두어도 가장 늦은 회차 한 번이다', () => {
    const now = MON_9_KST + 2 * DAY + 3 * 60 * MIN // 수 12:00
    expect(dueOf(schedule({ anchorAt: MON_9_KST - DAY }), now)).toEqual({ slotAt: MON_9_KST + 2 * DAY, cause: 'missed' })
  })

  it('anchor까지의 회차는 이미 처리했다', () => {
    expect(dueOf(schedule({ anchorAt: MON_9_KST }), MON_9_KST + 30 * MIN)).toBeNull()
  })
})
