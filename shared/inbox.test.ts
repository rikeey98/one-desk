import { describe, it, expect } from 'vitest'
import { inboxCategory, CATEGORY_LABELS, INBOX_RULES, CATEGORIES, representativeTurn } from './inbox'
import type { RunStatus } from './models'

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

/**
 * 인박스 규칙 표 (`docs/sdlc/conversation-fixes/` spec FR-4·FR-5).
 *
 * 예전의 `ACTIONABLE` 한 칸짜리 표를 두 칸으로 넓혔다 — 표는 여전히 **하나**다.
 * 칸이 하나였을 때 "배지가 센다"와 "열면 확인된다"는 서로의 부정이었지만, 이제
 * 실패·중단은 배지에 세면서도 열면 확인된다(intent 결정: 사용자 보고 "실패한 세션은
 * 클릭해도 1이 안 없어진다"). 부정 관계가 풀린 자리를 아래 불변식 둘이 지킨다.
 */
describe('INBOX_RULES', () => {
  it('답변 필요는 배지에 세고, 열어 봐도 남는다', () => {
    // 다음 턴으로만 풀린다 — agent가 사람의 답을 기다린다.
    expect(INBOX_RULES['needs-answer']).toEqual({ badge: true, clearsOnView: false })
  })

  it('실패·중단됨은 배지에 세되, 열면 확인된다', () => {
    expect(INBOX_RULES.failed).toEqual({ badge: true, clearsOnView: true })
    expect(INBOX_RULES.interrupted).toEqual({ badge: true, clearsOnView: true })
  })

  it('완료·미확인과 대기 중 취소됨은 배지에 세지 않고, 열면 확인된다', () => {
    expect(INBOX_RULES.done).toEqual({ badge: false, clearsOnView: true })
    expect(INBOX_RULES.dropped).toEqual({ badge: false, clearsOnView: true })
  })

  it('모든 카테고리가 표에 있고 두 칸이 모두 boolean이다', () => {
    for (const key of CATEGORIES) {
      expect(typeof INBOX_RULES[key].badge).toBe('boolean')
      expect(typeof INBOX_RULES[key].clearsOnView).toBe('boolean')
    }
    expect(Object.keys(INBOX_RULES).sort()).toEqual([...CATEGORIES].sort())
  })

  /**
   * **배지에 세지 않는 것은 반드시 열면 확인된다** (FR-5).
   *
   * 둘 다 false인 칸이 생기면 그 대화는 배지에도 안 잡히고 열어도 안 내려가
   * **인박스 목록에만 영원히 남는다** — 한 칸짜리 표가 구조로 막던 바로 그 구멍이다.
   */
  it('불변식 — badge가 false면 clearsOnView는 true다', () => {
    for (const key of CATEGORIES) {
      if (!INBOX_RULES[key].badge) expect(INBOX_RULES[key].clearsOnView, key).toBe(true)
    }
  })

  /**
   * **열어 봐도 남는 것은 답변 필요 하나뿐이다** (FR-5).
   *
   * 답변 필요는 사람이 다음 턴을 보내면 `create(parentRunId)`가 뿌리의 확인 표시를
   * 지워 스스로 풀린다. 다른 카테고리가 여기 들어오면 그것을 내릴 길이 인박스의
   * 확인함 버튼밖에 남지 않는다.
   */
  it('불변식 — clearsOnView가 false인 카테고리는 답변 필요 하나뿐이다', () => {
    const sticky = CATEGORIES.filter((key) => !INBOX_RULES[key].clearsOnView)
    expect(sticky).toEqual(['needs-answer'])
  })
})

/**
 * 대화의 대표 턴 (spec FR-1).
 *
 * 대화의 상태를 "가장 최근에 만든 턴"으로 보면 예약했다가 취소한 턴이 앞 턴의 결과를
 * 가린다 — 2턴이 실패로 끝났는데 3턴 예약이 취소되면 대화가 "대기 중 취소됨"이 되어
 * 배지에서 빠진다. core(인박스·배지)와 renderer(도크 목록·자동 확인)가 이 한 함수를
 * 같이 써야 둘이 갈리지 않는다.
 */
describe('representativeTurn', () => {
  type Turn = { id: string; status: RunStatus; startedAt: number | null }
  const turn = (id: string, status: RunStatus, startedAt: number | null): Turn =>
    ({ id, status, startedAt })

  it('건너뛸 것이 없으면 가장 최근 턴이다', () => {
    expect(representativeTurn([
      turn('t2', 'failed', 20), turn('t1', 'succeeded', 10)
    ])?.id).toBe('t2')
  })

  it('시작하지 못하고 취소된 턴은 건너뛴다', () => {
    expect(representativeTurn([
      turn('t3', 'canceled', null), turn('t2', 'failed', 20), turn('t1', 'succeeded', 10)
    ])?.id).toBe('t2')
  })

  it('그런 턴이 여럿 이어져도 모두 건너뛴다', () => {
    // 앱 재시작(reapStale)은 대기 중이던 예약을 전부 canceled로 만든다.
    expect(representativeTurn([
      turn('t4', 'canceled', null), turn('t3', 'canceled', null), turn('t2', 'interrupted', 20)
    ])?.id).toBe('t2')
  })

  it('시작한 뒤 취소된 턴은 건너뛰지 않는다', () => {
    // 돌다가 멈춘 것이다 — 그 턴이 대화의 지금 상태다.
    expect(representativeTurn([
      turn('t2', 'canceled', 20), turn('t1', 'failed', 10)
    ])?.id).toBe('t2')
  })

  it('아직 시작하지 않은 예약(pending)은 건너뛰지 않는다', () => {
    // 취소된 것이 아니라 기다리는 중이다. 대화는 아직 진행 중이다.
    expect(representativeTurn([
      turn('t2', 'pending', null), turn('t1', 'failed', 10)
    ])?.id).toBe('t2')
  })

  it('전부 시작하지 못하고 취소된 턴이면 가장 최근 턴이다', () => {
    expect(representativeTurn([
      turn('t2', 'canceled', null), turn('t1', 'canceled', null)
    ])?.id).toBe('t2')
  })

  it('빈 목록이면 undefined다', () => {
    expect(representativeTurn([])).toBeUndefined()
  })

  // `inboxCategory`와 같은 이유다: core의 슬림한 select가 그대로 들어가야
  // `assembled_prompt`를 나르지 않는다.
  it('status와 startedAt 둘만으로 판정한다', () => {
    const slim: { status: RunStatus; startedAt: number | null }[] = [
      { status: 'canceled', startedAt: null }, { status: 'failed', startedAt: 1 }
    ]
    expect(representativeTurn(slim)).toBe(slim[1])
  })
})
