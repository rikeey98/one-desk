import { describe, it, expect, vi } from 'vitest'
import { createDraftStore, draftKeyOf, isBlankDraft } from './drafts'

describe('초안 스토어', () => {
  it('쓴 적 없는 키는 빈 문자열이다', () => {
    expect(createDraftStore().get('c1')).toBe('')
  })

  it('쓴 것을 그대로 돌려준다', () => {
    const store = createDraftStore()
    store.set('c1', '테스트도 돌려줘')
    expect(store.get('c1')).toBe('테스트도 돌려줘')
  })

  it('키마다 따로 든다 — 다른 대화의 초안이 섞이지 않는다', () => {
    const store = createDraftStore()
    store.set('c1', 'A에 쓰던 것')
    store.set('c2', 'B에 쓰던 것')
    expect(store.get('c1')).toBe('A에 쓰던 것')
    expect(store.get('c2')).toBe('B에 쓰던 것')
  })

  it('빈 값으로 쓰면 비워진다 — 전송이 성공한 뒤의 모양이다', () => {
    const store = createDraftStore()
    store.set('c1', '보낼 것')
    store.set('c1', '')
    expect(store.get('c1')).toBe('')
  })

  it('스토어끼리 나누지 않는다', () => {
    const a = createDraftStore()
    a.set('c1', 'x')
    expect(createDraftStore().get('c1')).toBe('')
  })

  /**
   * 대화 헤더의 `멈추기`는 초안이 있을 때만 선다 (spec §8의 3, 결정 2026-09-27) — 입력칸이 비면 같은
   * 자리의 전송 버튼이 이미 중지다. 헤더는 입력부 밖이라 초안이 생기고 사라지는 것을 들어야 한다.
   */
  it('쓰면 듣는 쪽에 알린다 — 값이 그대로면 알리지 않고, 끊으면 더 알리지 않는다', () => {
    const store = createDraftStore()
    const heard = vi.fn()
    const off = store.subscribe(heard)
    store.set('c1', '멈추기 전에')
    expect(heard).toHaveBeenCalledTimes(1)
    store.set('c1', '멈추기 전에')
    expect(heard).toHaveBeenCalledTimes(1)
    store.set('c1', '')
    expect(heard).toHaveBeenCalledTimes(2)
    // 없는 키를 비워도 바뀐 것이 없다.
    store.set('c2', '')
    expect(heard).toHaveBeenCalledTimes(2)
    off()
    store.set('c1', '다시')
    expect(heard).toHaveBeenCalledTimes(2)
  })
})

describe('isBlankDraft', () => {
  it('공백뿐이면 빈 초안이다 — 그것으로는 보낼 수 없다', () => {
    expect(isBlankDraft('')).toBe(true)
    expect(isBlankDraft('  \n\t')).toBe(true)
    expect(isBlankDraft(' 다음 말 ')).toBe(false)
  })
})

describe('draftKeyOf', () => {
  it('대화가 있으면 대화 id다', () => {
    expect(draftKeyOf('conv-1', 'ws-1')).toBe('conv-1')
  })

  it('새 대화는 workspace마다 다르다 — 새 대화 칸이 workspace를 넘어 이어지지 않는다', () => {
    expect(draftKeyOf(null, 'ws-1')).toBe('new:ws-1')
    expect(draftKeyOf(null, 'ws-2')).not.toBe(draftKeyOf(null, 'ws-1'))
  })
})
