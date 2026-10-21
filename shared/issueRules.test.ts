import { describe, it, expect } from 'vitest'
import { STALE_MS, isStale, isUntriaged } from './issueRules'

const NOW = 1_800_000_000_000

describe('isStale', () => {
  it('seenAt이 임계값보다 오래되면 방치다', () => {
    expect(isStale({ status: 'open', seenAt: NOW - STALE_MS - 1, createdAt: NOW }, NOW)).toBe(true)
    expect(isStale({ status: 'open', seenAt: NOW - 1000, createdAt: NOW }, NOW)).toBe(false)
  })

  it('한 번도 안 본 이슈는 createdAt으로 판정한다', () => {
    // 폴백이 없으면 가장 잊히기 쉬운 것이 영원히 배지를 못 받는다.
    expect(isStale({ status: 'open', seenAt: null, createdAt: NOW - STALE_MS - 1 }, NOW)).toBe(true)
    expect(isStale({ status: 'open', seenAt: null, createdAt: NOW }, NOW)).toBe(false)
  })

  it('done에는 붙지 않는다', () => {
    expect(isStale({ status: 'done', seenAt: NOW - STALE_MS - 1, createdAt: NOW }, NOW)).toBe(false)
  })

  it('임계값은 14일이다 — 이슈 패널과 홈이 같은 수를 말한다', () => {
    expect(STALE_MS).toBe(14 * 24 * 60 * 60 * 1000)
  })
})

describe('isUntriaged', () => {
  it('triagedAt이 없고 done이 아니면 정리 안 됨이다', () => {
    expect(isUntriaged({ status: 'open', triagedAt: null })).toBe(true)
    expect(isUntriaged({ status: 'doing', triagedAt: null })).toBe(true)
    expect(isUntriaged({ status: 'open', triagedAt: NOW })).toBe(false)
  })

  it('done은 훑지 않는다', () => {
    expect(isUntriaged({ status: 'done', triagedAt: null })).toBe(false)
  })
})
