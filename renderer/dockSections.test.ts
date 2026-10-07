import { describe, it, expect, beforeEach } from 'vitest'
import { readCollapsedSections, writeCollapsedSections } from './dockSections'

beforeEach(() => { localStorage.clear() })

describe('dockSections', () => {
  it('접은 구획을 쓰고 다시 읽는다', () => {
    writeCollapsedSections(new Set(['repo:a', 'other']))
    expect(readCollapsedSections()).toEqual(new Set(['repo:a', 'other']))
  })

  it('깨진 값·모양이 다른 값은 빈 집합이다 — 예전 값이 화면을 깨지 않게', () => {
    localStorage.setItem('one-desk.dock.collapsedSections', '{깨짐')
    expect(readCollapsedSections()).toEqual(new Set())
    localStorage.setItem('one-desk.dock.collapsedSections', '{"a":1}')
    expect(readCollapsedSections()).toEqual(new Set())
    localStorage.setItem('one-desk.dock.collapsedSections', '["repo:a", 3]')
    expect(readCollapsedSections()).toEqual(new Set(['repo:a']))
  })
})
