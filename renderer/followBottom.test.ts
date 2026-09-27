import { describe, it, expect } from 'vitest'
import { isNearBottom } from './followBottom'

/** 바닥까지 남은 거리가 gap px인 스크롤 상자 */
function box(gap: number) {
  return { scrollTop: 1000 - 300 - gap, scrollHeight: 1000, clientHeight: 300 }
}

describe('isNearBottom', () => {
  it('바닥에서 24px 안이면 붙어 있다', () => {
    expect(isNearBottom(box(0))).toBe(true)
    expect(isNearBottom(box(23))).toBe(true)
    expect(isNearBottom(box(24))).toBe(true)
  })

  it('24px을 넘으면 붙어 있지 않다', () => {
    expect(isNearBottom(box(25))).toBe(false)
    expect(isNearBottom(box(400))).toBe(false)
  })

  it('소수점 스크롤 값도 다룬다 — 고배율 화면에서 바닥이 0.5px 모자랄 수 있다', () => {
    expect(isNearBottom({ scrollTop: 699.5, scrollHeight: 1000, clientHeight: 300 })).toBe(true)
  })

  it('내용이 상자보다 짧으면 붙어 있다', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 })).toBe(true)
  })

  it('문턱을 바꿀 수 있다', () => {
    expect(isNearBottom(box(30), 40)).toBe(true)
    expect(isNearBottom(box(30), 10)).toBe(false)
  })
})
