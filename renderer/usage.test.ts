import { describe, it, expect } from 'vitest'
import { formatTokens, formatContext, contextPercent, usagePieces, usageTitle, conversationUsage } from './usage'
import type { RunUsage } from '@shared/events'
import type { Run } from '@shared/models'

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

/**
 * 링 곁의 퍼센트 글자 (`docs/sdlc/conversation-timeline/` spec §8의 2, 결정 2026-09-27) — 링은 낮은
 * 점유에서 스피너와 구별되지 않았다. 글자는 접근성 이름(`사용량, 컨텍스트 5%`)과 **같은 수**여야
 * 한다 — 둘이 따로 반올림하면 화면과 스크린리더가 다른 값을 말한다.
 */
describe('contextPercent', () => {
  it('formatContext의 비율과 같은 글자다 — 경계(<1%·>99%)까지', () => {
    expect(contextPercent(53347, 1000000)).toBe('5%')
    expect(contextPercent(400, 1000000)).toBe('<1%')
    expect(contextPercent(1200000, 1000000)).toBe('>99%')
    for (const tokens of [400, 5000, 53347, 494999, 995000, 1200000]) {
      expect(formatContext(tokens, 1000000)).toBe(`컨텍스트 ${contextPercent(tokens, 1000000)}`)
    }
  })

  it('창이나 점유를 모르면 없다 — 비율을 지어내지 않는다', () => {
    expect(contextPercent(6000, null)).toBeNull()
    expect(contextPercent(6000, 0)).toBeNull()
    expect(contextPercent(null, 1000000)).toBeNull()
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

describe('conversationUsage', () => {
  function turn(createdAt: number, known: Partial<RunUsage> | null): Run {
    return {
      id: `r${createdAt}`, workspaceId: 'ws', agentKind: 'claude-code', model: null,
      effort: null, cwd: '/repo', permission: 'edit', userPrompt: '지시',
      assembledPrompt: '지시', status: 'succeeded', externalSessionId: null,
      parentRunId: null, rootRunId: 'r0', title: null, closedAt: null, resultText: null,
      needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
      logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
      endedAt: null, createdAt, contextItems: [], usage: known ? usage(known) : null
    }
  }

  it('토큰과 비용은 턴마다 더한다', () => {
    expect(conversationUsage([
      turn(0, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 7, costUsd: 0.25 }),
      turn(1, { inputTokens: 3, outputTokens: 2, cacheReadTokens: 50, cacheWriteTokens: 1, costUsd: 0.125 })
    ])).toEqual({
      inputTokens: 13, outputTokens: 7, cacheReadTokens: 150, cacheWriteTokens: 8,
      costUsd: 0.375, contextTokens: null, contextWindow: null
    })
  })

  it('모르는 값은 아는 값을 지우지 않는다 — 아는 것만 더한다', () => {
    const total = conversationUsage([
      turn(0, { inputTokens: 10, costUsd: null }),
      turn(1, { inputTokens: null, costUsd: 0.5 })
    ])
    expect(total).toMatchObject({ inputTokens: 10, costUsd: 0.5, outputTokens: null })
  })

  it('컨텍스트는 더하지 않고 마지막으로 안 값이다 — 점유는 마지막 요청의 크기다', () => {
    const total = conversationUsage([
      turn(0, { contextTokens: 40_000, contextWindow: 1_000_000 }),
      turn(1, { contextTokens: 53_347, contextWindow: 1_000_000 }),
      // 컨텍스트를 모르는 턴이 앞의 값을 지우지 않는다.
      turn(2, { inputTokens: 1 })
    ])
    expect(total).toMatchObject({ contextTokens: 53_347, contextWindow: 1_000_000 })
  })

  it('점유와 창은 같은 턴의 짝이다 — 창을 모르는 턴의 점유를 앞 턴의 창으로 나누지 않는다', () => {
    // 모델을 바꾼 턴이 창 크기 없이 끝나면, 두 칸을 따로 "마지막 non-null"로 고를 때 새 점유(150k)를
    // 앞 턴의 창(1M)으로 나눠 15%로 그린다 — 실제 창이 200k면 75%다(리뷰가 찾은 것). 모르는 창을
    // 지어내지 않고 토큰 수로 그리게 둔다.
    const total = conversationUsage([
      turn(0, { contextTokens: 53_347, contextWindow: 1_000_000 }),
      turn(1, { contextTokens: 150_000, contextWindow: null })
    ])
    expect(total).toMatchObject({ contextTokens: 150_000, contextWindow: null })
  })

  it('만든 순서로 본다 — 목록이 최신순으로 와도 마지막 턴의 컨텍스트다', () => {
    const total = conversationUsage([
      turn(2, { contextTokens: 900 }),
      turn(1, { contextTokens: 500 })
    ])
    expect(total!.contextTokens).toBe(900)
  })

  it('사용량이 하나도 없으면 null이다', () => {
    expect(conversationUsage([])).toBeNull()
    expect(conversationUsage([turn(0, null), turn(1, null)])).toBeNull()
    expect(conversationUsage([turn(0, {})])).toBeNull()
  })

  it('모델과 추론 토큰은 담지 않는다', () => {
    const total = conversationUsage([turn(0, { model: 'm', reasoningTokens: 9, inputTokens: 1 })])!
    expect(Object.keys(total).sort()).toEqual([
      'cacheReadTokens', 'cacheWriteTokens', 'contextTokens', 'contextWindow',
      'costUsd', 'inputTokens', 'outputTokens'
    ])
  })
})
