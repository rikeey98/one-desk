import { describe, it, expect } from 'vitest'
import { validateTrigger, nextSlots, latestSlot, MIN_INTERVAL_MS } from './clock'
import type { ScheduleTrigger } from '@shared/scheduleTrigger'

// 2026-11-02(월) 09:00 KST
const MON_9_KST = Date.parse('2026-11-02T00:00:00Z')
const MIN = 60_000
const DAY = 24 * 60 * MIN
const SEOUL = 'Asia/Seoul'
const WEEKDAYS_9: ScheduleTrigger = { kind: 'weekdays', time: '09:00' }

function invalid(trigger: unknown, timeZone: unknown = SEOUL): string {
  const r = validateTrigger(trigger, timeZone, MON_9_KST)
  if (r.ok) throw new Error('받으면 안 된다')
  return r.error
}

describe('validateTrigger (spec FR-7)', () => {
  it('프리셋과 5필드 cron을 받고 cron 문자열을 돌려준다', () => {
    const r = validateTrigger(WEEKDAYS_9, SEOUL, MON_9_KST)
    expect(r).toEqual({ ok: true, trigger: WEEKDAYS_9, cron: '0 9 * * 1-5' })
    expect(validateTrigger({ kind: 'cron', expr: '0 9 1 * MON' }, SEOUL, MON_9_KST).ok).toBe(true)
  })

  it('필드가 정확히 5개여야 한다 — croner는 초 필드와 @daily도 받지만 화면이 그것을 말하지 않는다', () => {
    expect(invalid({ kind: 'cron', expr: '0 */30 * * * *' })).toMatch(/5개/)
    expect(invalid({ kind: 'cron', expr: '@daily' })).toMatch(/5개/)
    expect(invalid({ kind: 'cron', expr: '0 9 * *' })).toMatch(/5개/)
  })

  it('croner가 못 읽는 식은 거부한다', () => {
    expect(invalid({ kind: 'cron', expr: '0 25 * * *' })).toMatch(/cron 식을 읽을 수 없습니다/)
  })

  it('10분보다 잦으면 거부한다 — 5분마다 agent를 돌리는 것은 사용량 사고다 (§8의 4)', () => {
    expect(MIN_INTERVAL_MS).toBe(10 * MIN)
    expect(invalid({ kind: 'cron', expr: '*/5 * * * *' })).toMatch(/10분/)
    // 대부분 넉넉해도 한 번이라도 가까우면 거부한다
    expect(invalid({ kind: 'cron', expr: '0,5 9 * * *' })).toMatch(/10분/)
    expect(validateTrigger({ kind: 'cron', expr: '*/10 * * * *' }, SEOUL, MON_9_KST).ok).toBe(true)
  })

  it('앞으로 돌지 않는 식은 거부한다', () => {
    expect(invalid({ kind: 'cron', expr: '0 9 30 2 *' })).toMatch(/실행되지 않습니다/)
  })

  it('시간대는 IANA 이름이어야 한다 — croner는 만들 때가 아니라 계산할 때 던진다', () => {
    expect(invalid(WEEKDAYS_9, 'Not/AZone')).toMatch(/시간대/)
    expect(invalid(WEEKDAYS_9, '')).toMatch(/시간대/)
    expect(invalid(WEEKDAYS_9, 42)).toMatch(/시간대/)
  })

  it('모양이 틀리면 shared의 문구 그대로다', () => {
    expect(invalid({ kind: 'hourly', everyHours: 5, minute: 0 })).toMatch(/1·2·3·4·6·8·12/)
  })
})

describe('nextSlots', () => {
  it('기준 시각 초과의 회차를 시간대로 계산한다 — 기준이 정확히 회차면 그것은 빼고', () => {
    expect(nextSlots(WEEKDAYS_9, SEOUL, MON_9_KST, 3)).toEqual([MON_9_KST + DAY, MON_9_KST + 2 * DAY, MON_9_KST + 3 * DAY])
    expect(nextSlots(WEEKDAYS_9, SEOUL, MON_9_KST - 1, 1)).toEqual([MON_9_KST])
  })

  it('금요일 다음은 월요일이다', () => {
    const fri = MON_9_KST + 4 * DAY
    expect(nextSlots(WEEKDAYS_9, SEOUL, fri, 1)).toEqual([MON_9_KST + 7 * DAY])
  })

  it('DST가 있는 시간대 — 없는 02:30은 03:30 EDT로 민다', () => {
    const ny = nextSlots({ kind: 'daily', time: '02:30' }, 'America/New_York', Date.parse('2026-03-07T12:00:00Z'), 2)
    expect(ny.map((t) => new Date(t).toISOString())).toEqual(['2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z'])
  })

  it('일과 요일을 둘 다 주면 OR다 (vixie)', () => {
    const slots = nextSlots({ kind: 'cron', expr: '0 9 1 * 5' }, SEOUL, Date.parse('2026-11-01T01:00:00Z'), 6)
    expect(slots.map((t) => new Date(t + 9 * 60 * MIN).toISOString().slice(0, 10)))
      .toEqual(['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27', '2026-12-01', '2026-12-04'])
  })
})

describe('latestSlot (spec FR-8)', () => {
  it('after < s ≤ until인 가장 늦은 회차 하나다', () => {
    // 목 09:00 ~ 다음 주 화 10:00 사이: 금·월·화 09:00 중 화
    const thu = MON_9_KST - 4 * DAY
    expect(latestSlot(WEEKDAYS_9, SEOUL, thu, MON_9_KST + DAY + 60 * MIN)).toBe(MON_9_KST + DAY)
  })

  it('정확히 회차 시각인 until을 포함하고, after와 같은 회차는 빼다', () => {
    expect(latestSlot(WEEKDAYS_9, SEOUL, MON_9_KST - 1, MON_9_KST)).toBe(MON_9_KST)
    expect(latestSlot(WEEKDAYS_9, SEOUL, MON_9_KST, MON_9_KST + 60 * MIN)).toBeNull()
  })

  it('croner가 초 단위로 보므로 1초 뒤로 묻는다 — until이 회차의 0.5초 앞이면 그 회차는 아직이다', () => {
    expect(latestSlot(WEEKDAYS_9, SEOUL, MON_9_KST - 4 * DAY, MON_9_KST - 500)).toBe(MON_9_KST - 3 * DAY)
  })

  it('100일 꺼 두었어도 가장 늦은 회차 하나다', () => {
    const until = MON_9_KST + 30 * MIN
    expect(latestSlot({ kind: 'cron', expr: '*/10 * * * *' }, SEOUL, until - 100 * DAY, until)).toBe(until)
  })
})
