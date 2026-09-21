import { describe, it, expect } from 'vitest'
import { formatTokens, formatContext, usagePieces, usageTitle } from './usage'
import type { RunUsage } from '@shared/events'

function usage(known: Partial<RunUsage>): RunUsage {
  return {
    model: null, inputTokens: null, outputTokens: null,
    cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null,
    costUsd: null, contextTokens: null, contextWindow: null, ...known
  }
}

describe('formatTokens', () => {
  it('1,000 미만은 그대로 적는다', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })

  it('1,000부터는 k로 줄인다', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(12431)).toBe('12.4k')
  })

  it('1,000,000부터는 M으로 줄인다', () => {
    expect(formatTokens(1000000)).toBe('1.0M')
    expect(formatTokens(1234567)).toBe('1.2M')
  })
})

describe('formatContext', () => {
  it('창을 알면 비율로 적는다', () => {
    expect(formatContext(53347, 1000000)).toBe('컨텍스트 5%')
  })

  it('0.5% 미만은 <1%다 — 0%는 "안 썼다"로 읽힌다', () => {
    expect(formatContext(400, 1000000)).toBe('컨텍스트 <1%')
  })

  it('창을 모르면 토큰 수만 적는다 — 비율을 지어내지 않는다', () => {
    expect(formatContext(6000, null)).toBe('컨텍스트 6.0k')
  })

  it('창을 넘겨도 100%를 넘겨 적지 않는다', () => {
    // iterations가 없는 옛 버전에서 과대평가될 수 있다 (spec §8).
    expect(formatContext(1200000, 1000000)).toBe('컨텍스트 >99%')
  })

  it('컨텍스트를 모르면 조각이 없다', () => {
    expect(formatContext(null, 1000000)).toBeNull()
  })
})

describe('usagePieces', () => {
  it('모델·토큰·컨텍스트 세 조각을 이 순서로 만든다', () => {
    expect(usagePieces(usage({
      model: 'claude-opus-5[1m]', inputTokens: 12431, outputTokens: 1203,
      contextTokens: 53347, contextWindow: 1000000
    }))).toEqual(['claude-opus-5[1m]', '12.4k↑ 1.2k↓', '컨텍스트 5%'])
  })

  it('모르는 조각은 아예 빠진다 — 0으로 채우지 않는다', () => {
    // OpenCode는 모델도 창 크기도 알려주지 않는다.
    expect(usagePieces(usage({
      inputTokens: 3815, outputTokens: 31, contextTokens: 6000
    }))).toEqual(['3.8k↑ 31↓', '컨텍스트 6.0k'])
  })

  it('토큰 한쪽만 알아도 그 조각은 만든다', () => {
    expect(usagePieces(usage({ outputTokens: 31 }))).toEqual(['31↓'])
  })

  it('아무것도 모르면 조각이 없다 — 줄을 그리지 않는다', () => {
    expect(usagePieces(usage({}))).toEqual([])
    expect(usagePieces(null)).toEqual([])
  })

  it('비용만 아는 사용량은 줄을 만들지 않는다', () => {
    // 비용은 한 줄에 올리지 않는다 (FR-4) — title로만 읽는다.
    expect(usagePieces(usage({ costUsd: 0.39 }))).toEqual([])
  })
})

describe('usageTitle', () => {
  it('줄임 없는 수치와 비용을 담는다', () => {
    const title = usageTitle(usage({
      inputTokens: 12431, outputTokens: 1203,
      cacheReadTokens: 15428, cacheWriteTokens: 37917,
      reasoningTokens: 0, costUsd: 0.386994
    }))!
    expect(title).toContain('입력 12,431')
    expect(title).toContain('출력 1,203')
    expect(title).toContain('캐시 읽기 15,428')
    expect(title).toContain('캐시 쓰기 37,917')
    expect(title).toContain('추론 0')
    expect(title).toContain('$0.3870')
  })

  it('모르는 값은 title에서도 빠진다', () => {
    const title = usageTitle(usage({ inputTokens: 5 }))!
    expect(title).toBe('입력 5')
  })

  it('아무것도 모르면 title이 없다', () => {
    expect(usageTitle(usage({}))).toBeNull()
    expect(usageTitle(null)).toBeNull()
  })
})
