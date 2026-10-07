import { describe, expect, it } from 'vitest'
import { touchedIn, issueTouchedIn, memoTouchedIn } from './range'

describe('touchedIn', () => {
  it('기간이 없으면 늘 참이다', () => {
    expect(touchedIn([null], {})).toBe(true)
  })

  it('[since, until) — since는 들고 until은 들지 않는다', () => {
    expect(touchedIn([100], { since: 100, until: 200 })).toBe(true)
    expect(touchedIn([200], { since: 100, until: 200 })).toBe(false)
    expect(touchedIn([99], { since: 100 })).toBe(false)
  })

  it('null 시각은 건너뛰고 하나라도 안이면 참이다', () => {
    expect(touchedIn([null, 50, 150], { since: 100, until: 200 })).toBe(true)
    expect(touchedIn([null, null], { since: 0 })).toBe(false)
  })
})

describe('issueTouchedIn · memoTouchedIn', () => {
  const range = { since: 100, until: 200 }

  it('이슈는 만듦·시작·완료·수정 중 하나만 안이어도 든다', () => {
    const base = { createdAt: 0, startedAt: null, closedAt: null, updatedAt: 0 }
    expect(issueTouchedIn(base, range)).toBe(false)
    expect(issueTouchedIn({ ...base, startedAt: 150 }, range)).toBe(true)
    expect(issueTouchedIn({ ...base, closedAt: 150 }, range)).toBe(true)
    expect(issueTouchedIn({ ...base, updatedAt: 150 }, range)).toBe(true)
  })

  it('메모는 만듦·수정만 본다', () => {
    expect(memoTouchedIn({ createdAt: 0, updatedAt: 150 }, range)).toBe(true)
    expect(memoTouchedIn({ createdAt: 0, updatedAt: 50 }, range)).toBe(false)
  })
})
