import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextActiveAfterClose, pickTab, readActiveTab, writeActiveTab } from './terminalTabs'

const tabs = (...ids: string[]) => ids.map((tabId) => ({ tabId }))

describe('보일 탭 고르기 (docs/sdlc/terminal-tabs/spec.md FR-6)', () => {
  it('기억한 탭이 목록에 있으면 그것, 없으면 맨 왼쪽, 빈 목록이면 없다', () => {
    expect(pickTab(tabs('a', 'b', 'c'), 'b')).toBe('b')
    expect(pickTab(tabs('a', 'b'), 'gone')).toBe('a')
    expect(pickTab(tabs('a', 'b'), null)).toBe('a')
    expect(pickTab([], 'a')).toBeNull()
  })
})

describe('닫은 뒤에 볼 탭 (FR-2)', () => {
  it('보던 탭을 닫으면 그 오른쪽, 없으면 왼쪽이다', () => {
    expect(nextActiveAfterClose(tabs('a', 'b', 'c'), 'b', 'b')).toBe('c')
    expect(nextActiveAfterClose(tabs('a', 'b', 'c'), 'c', 'c')).toBe('b')
    expect(nextActiveAfterClose(tabs('a'), 'a', 'a')).toBeNull()
  })

  it('다른 탭을 닫았으면 보던 탭 그대로다', () => {
    expect(nextActiveAfterClose(tabs('a', 'b', 'c'), 'a', 'c')).toBe('c')
    expect(nextActiveAfterClose(tabs('a', 'b'), 'b', null)).toBeNull()
  })
})

describe('기억 (FR-6)', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('repo마다 하나를 기억한다', () => {
    writeActiveTab('api', 't1')
    writeActiveTab('web', 't2')
    expect(readActiveTab('api')).toBe('t1')
    expect(readActiveTab('web')).toBe('t2')
    expect(localStorage.getItem('one-desk.terminal.tab.api')).toBe('t1')
    expect(readActiveTab('none')).toBeNull()
  })

  it('저장소가 막혀도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readActiveTab('api')).toBeNull()
    expect(() => writeActiveTab('api', 't1')).not.toThrow()
  })
})
