import { describe, it, expect } from 'vitest'
import { parseBound, toIso } from './time'

/** 시간대에 기대지 않는다 — CI와 개발 장비의 TZ가 다르다. 왕복과 모양만 본다. */
describe('toIso (docs/sdlc/timestamps/ FR-4)', () => {
  it('시간대가 붙은 ISO이고 같은 순간으로 되읽힌다', () => {
    const ms = Date.UTC(2026, 8, 29, 5, 3, 7, 42)
    const iso = toIso(ms)!
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
    expect(Date.parse(iso)).toBe(ms)
  })

  it('앱의 시간대로 적는다 — 벽시계 시각이 로컬과 같다', () => {
    const local = new Date(2026, 8, 29, 14, 3, 0)
    expect(toIso(local.getTime())!.slice(0, 19)).toBe('2026-09-29T14:03:00')
  })

  it('null은 null이다', () => {
    expect(toIso(null)).toBeNull()
  })
})

describe('parseBound (FR-6)', () => {
  it('날짜만이면 앱의 시간대로 그 날 0시다', () => {
    expect(parseBound('2026-09-28', 'since')).toBe(new Date(2026, 8, 28).getTime())
  })

  it('날짜시각은 그 순간이다', () => {
    expect(parseBound('2026-09-28T09:00:00+09:00', 'since')).toBe(Date.parse('2026-09-28T09:00:00+09:00'))
  })

  it('못 읽는 값은 어느 인자인지 말하며 던진다', () => {
    expect(() => parseBound('지난주', 'until')).toThrow(/until/)
    expect(() => parseBound('2026-13-45', 'since')).toThrow(/since/)
  })
})
