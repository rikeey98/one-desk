import { describe, it, expect } from 'vitest'
import { inboxCategory, CATEGORY_LABELS, ACTIONABLE, CATEGORIES } from './inbox'

describe('inboxCategory', () => {
  it('needsAnswer면 답변 필요다', () => {
    expect(inboxCategory({ status: 'succeeded', needsAnswer: true })).toBe('needs-answer')
  })

  it('succeeded인데 needsAnswer가 아니면 완료·미확인이다', () => {
    expect(inboxCategory({ status: 'succeeded', needsAnswer: false })).toBe('done')
  })

  it('failed는 실패다', () => {
    expect(inboxCategory({ status: 'failed', needsAnswer: false })).toBe('failed')
  })

  it('interrupted는 중단됨이다', () => {
    expect(inboxCategory({ status: 'interrupted', needsAnswer: false })).toBe('interrupted')
  })

  it('canceled는 대기 중 취소됨이다', () => {
    // 사용자가 취소한 것은 execution.cancel이 확인 표시를 찍어 인박스에 오지 않는다.
    // 여기 오는 canceled는 앱이 재시작하며 취소한 것뿐이다.
    expect(inboxCategory({ status: 'canceled', needsAnswer: false })).toBe('dropped')
  })

  it('모든 카테고리에 한국어 라벨이 있다', () => {
    for (const key of CATEGORIES) {
      expect(CATEGORY_LABELS[key]).toBeTruthy()
    }
  })

  // `Run` 전체가 아니라 두 필드만 받는다 (spec FR-2). 슬림한 select로 세는
  // `inboxCounts()`가 이 함수를 쓸 수 있어야 한다 — 전체 행을 요구하면 리뷰 I-2가
  // 없앤 비용(assembled_prompt까지 나르기)이 그대로 되돌아온다.
  it('status와 needsAnswer 둘만으로 판정한다', () => {
    const slim: { status: 'failed'; needsAnswer: boolean } = { status: 'failed', needsAnswer: false }
    expect(inboxCategory(slim)).toBe('failed')
  })
})

describe('ACTIONABLE', () => {
  it('행동을 요구하는 것은 답변 필요·실패·중단됨 셋이다', () => {
    expect(ACTIONABLE['needs-answer']).toBe(true)
    expect(ACTIONABLE.failed).toBe(true)
    expect(ACTIONABLE.interrupted).toBe(true)
  })

  it('완료·미확인과 대기 중 취소됨은 행동을 요구하지 않는다', () => {
    expect(ACTIONABLE.done).toBe(false)
    expect(ACTIONABLE.dropped).toBe(false)
  })

  /**
   * **배지가 세는 것과 열었을 때 자동 확인하는 것은 서로의 부정이다** (spec FR-3).
   *
   * 표를 둘로 나누면 "배지엔 안 잡히는데 자동 확인도 안 되는" 칸이 조용히 생겨
   * 그 대화는 영원히 인박스 목록에만 남는다. 상수 하나에서 양쪽이 나오는 것이
   * 이 불변의 전부이고, 이 테스트가 그것을 고정한다.
   */
  it('모든 카테고리가 표에 있고 값이 boolean이다', () => {
    for (const key of CATEGORIES) {
      expect(typeof ACTIONABLE[key]).toBe('boolean')
    }
    expect(Object.keys(ACTIONABLE).sort()).toEqual([...CATEGORIES].sort())
  })
})
