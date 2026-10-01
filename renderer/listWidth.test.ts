import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clampListWidth, readListWidth, writeListWidth, readListHidden, writeListHidden, DEFAULT_LIST_PX, MIN_LIST_PX
} from './listWidth'

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('clampListWidth', () => {
  it('하한 200px, 상한 창 폭의 60%', () => {
    expect(clampListWidth(100, 1000)).toBe(MIN_LIST_PX)
    expect(clampListWidth(900, 1000)).toBe(600)
    expect(clampListWidth(400, 1000)).toBe(400)
  })

  it('숫자가 아니면 기본 폭', () => {
    expect(clampListWidth(Number.NaN, 2000)).toBe(DEFAULT_LIST_PX)
  })

  it('창이 하한보다 좁으면 상한이 이긴다', () => {
    expect(clampListWidth(300, 300)).toBe(180)
  })
})

describe('저장', () => {
  it('폭과 숨김을 종류마다 따로 기억한다', () => {
    writeListWidth('issue', 420.4)
    writeListHidden('memo', true)
    expect(readListWidth('issue')).toBe(420)
    expect(readListWidth('memo')).toBe(DEFAULT_LIST_PX)
    expect(readListHidden('memo')).toBe(true)
    expect(readListHidden('issue')).toBe(false)
  })

  it('망가진 값이나 막힌 저장소에서도 기본값으로 돈다', () => {
    localStorage.setItem('one-desk.panelWindow.asset.listWidth', 'abc')
    expect(readListWidth('asset')).toBe(DEFAULT_LIST_PX)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readListWidth('issue')).toBe(DEFAULT_LIST_PX)
    expect(readListHidden('issue')).toBe(false)
    expect(() => writeListWidth('issue', 300)).not.toThrow()
  })
})
