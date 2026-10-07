import { describe, expect, it } from 'vitest'
import { groupTurns, conversationSpan, spanOverlaps } from './conversations'
import type { Run } from '@shared/models'

function turn(over: Partial<Run>): Run {
  return {
    id: 'r', rootRunId: null, createdAt: 0, startedAt: null, endedAt: null,
    ...over
  } as Run
}

describe('groupTurns', () => {
  it('rootRunId로 묶고, 뿌리는 자기 id로 묶인다', () => {
    const groups = groupTurns([
      turn({ id: 'a' }),
      turn({ id: 'a2', rootRunId: 'a' }),
      turn({ id: 'b' })
    ])
    expect([...groups.keys()].sort()).toEqual(['a', 'b'])
    expect(groups.get('a')!.map((t) => t.id)).toEqual(['a', 'a2'])
  })
})

describe('conversationSpan · spanOverlaps', () => {
  it('시작은 가장 이른 생성, 끝은 가장 늦은 활동(끝 → 시작 → 생성)이다', () => {
    const span = conversationSpan([
      turn({ createdAt: 10, startedAt: 12, endedAt: 30 }),
      turn({ createdAt: 40, startedAt: 45, endedAt: null })
    ])
    expect(span).toEqual({ startedAt: 10, lastAt: 45 })
  })

  it('[시작, 마지막 활동]이 [since, until)과 겹치면 든다', () => {
    const span = { startedAt: 10, lastAt: 45 }
    expect(spanOverlaps(span, { since: 45, until: 100 })).toBe(true)
    expect(spanOverlaps(span, { since: 46 })).toBe(false)
    expect(spanOverlaps(span, { until: 10 })).toBe(false)
    expect(spanOverlaps(span, { until: 11 })).toBe(true)
    expect(spanOverlaps(span, {})).toBe(true)
  })
})
