import { describe, it, expect } from 'vitest'
import { readTrigger, toCron, describeTrigger, type ScheduleTrigger } from './scheduleTrigger'

function ok(value: unknown): ScheduleTrigger {
  const r = readTrigger(value)
  if (!r.ok) throw new Error(r.error)
  return r.trigger
}

function error(value: unknown): string {
  const r = readTrigger(value)
  if (r.ok) throw new Error('받으면 안 된다')
  return r.error
}

describe('toCron · describeTrigger (spec FR-6)', () => {
  it.each([
    [{ kind: 'daily', time: '09:00' }, '0 9 * * *', '매일 09:00'],
    [{ kind: 'weekdays', time: '18:30' }, '30 18 * * 1-5', '평일 18:30'],
    [{ kind: 'weekly', days: [3, 1], time: '07:05' }, '5 7 * * 1,3', '매주 월·수 07:05'],
    [{ kind: 'weekly', days: [0, 6], time: '10:00' }, '0 10 * * 0,6', '매주 토·일 10:00'],
    [{ kind: 'hourly', everyHours: 3, minute: 15 }, '15 */3 * * *', '3시간마다 :15'],
    [{ kind: 'hourly', everyHours: 1, minute: 0 }, '0 * * * *', '1시간마다 :00'],
    [{ kind: 'cron', expr: '  0  9 * *   1-5 ' }, '0 9 * * 1-5', 'cron 0 9 * * 1-5']
  ])('%j → %s · %s', (value, cron, text) => {
    const trigger = ok(value)
    expect(toCron(trigger)).toBe(cron)
    expect(describeTrigger(trigger)).toBe(text)
  })
})

describe('readTrigger — 모양만 본다 (cron 문법·간격은 core의 validateTrigger)', () => {
  it('N시간마다는 24의 약수만이다 — 5시간마다는 자정에 끊겨 말이 거짓이 된다', () => {
    expect(error({ kind: 'hourly', everyHours: 5, minute: 0 })).toMatch(/1·2·3·4·6·8·12/)
    expect(error({ kind: 'hourly', everyHours: 24, minute: 0 })).toMatch(/1·2·3·4·6·8·12/)
  })

  it('분은 0~59의 정수다', () => {
    expect(error({ kind: 'hourly', everyHours: 2, minute: 60 })).toMatch(/분/)
    expect(error({ kind: 'hourly', everyHours: 2, minute: 1.5 })).toMatch(/분/)
  })

  it('시각은 HH:MM이다', () => {
    for (const time of ['24:00', '9:00', '09:60', '0900', '']) {
      expect(error({ kind: 'daily', time })).toMatch(/시각/)
    }
  })

  it('요일은 0~6, 하나 이상, 중복 없이', () => {
    expect(error({ kind: 'weekly', days: [], time: '09:00' })).toMatch(/요일/)
    expect(error({ kind: 'weekly', days: [1, 1], time: '09:00' })).toMatch(/요일/)
    expect(error({ kind: 'weekly', days: [7], time: '09:00' })).toMatch(/요일/)
  })

  it('cron 식은 비울 수 없다', () => {
    expect(error({ kind: 'cron', expr: '   ' })).toMatch(/cron/)
  })

  it('모르는 종류·객체가 아닌 값은 거부한다', () => {
    expect(error({ kind: 'monthly', time: '09:00' })).toMatch(/주기/)
    expect(error(null)).toMatch(/주기/)
    expect(error('0 9 * * *')).toMatch(/주기/)
  })

  it('모르는 키는 버리고, 요일은 정렬해 돌려준다', () => {
    expect(ok({ kind: 'weekly', days: [5, 1], time: '09:00', extra: 1 })).toEqual({ kind: 'weekly', days: [1, 5], time: '09:00' })
  })
})
