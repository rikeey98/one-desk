import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  clampPaneWidth, DEFAULT_PANE_RATIO, MIN_MAIN_PX, MIN_PANE_PX, readPaneKind, readPaneWidth, resetPaneWidth,
  writePaneKind, writePaneWidth
} from './layout'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

// 쓸 수 있는 폭 = 창에서 사이드바를 뺀 것(본문 + 칸) — 칸은 창 오른쪽 끝, 위아래 전체다(안 B, 2026-10-10)
describe('clampPaneWidth (docs/sdlc/code-editor/ FR-4)', () => {
  it('기억한 값이 없으면 쓸 수 있는 폭의 40%다', () => {
    expect(DEFAULT_PANE_RATIO).toBe(0.4)
    expect(clampPaneWidth(null, 1200)).toBe(480)
    expect(clampPaneWidth(Number.NaN, 1200)).toBe(480)
  })

  it('칸은 320px 아래로, 본문(세 패널 + 도크)은 560px 아래로 가지 않는다', () => {
    expect(clampPaneWidth(100, 1200)).toBe(MIN_PANE_PX)
    expect(clampPaneWidth(1000, 1200)).toBe(1200 - MIN_MAIN_PX)
  })

  it('둘을 다 지킬 수 없으면 칸의 하한이 이긴다 — 그보다 좁은 편집기는 쓸 데가 없다', () => {
    expect(clampPaneWidth(500, 800)).toBe(MIN_PANE_PX)
    expect(clampPaneWidth(null, 700)).toBe(MIN_PANE_PX)
  })
})

describe('칸 열림과 폭의 기억', () => {
  it('열린 종류와 폭을 이 장비에 남긴다', () => {
    expect(readPaneKind()).toBeNull()
    expect(readPaneWidth()).toBeNull()
    writePaneKind('files')
    writePaneWidth(431.6)
    expect(readPaneKind()).toBe('files')
    expect(readPaneWidth()).toBe(432)
    writePaneKind(null)
    expect(readPaneKind()).toBeNull()
    resetPaneWidth()
    expect(readPaneWidth()).toBeNull()
  })

  it('모르는 값은 닫힘이다', () => {
    localStorage.setItem('one-desk.codePane.kind', 'browser')
    expect(readPaneKind()).toBeNull()
  })

  it('저장소가 막혀도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readPaneKind()).toBeNull()
    expect(readPaneWidth()).toBeNull()
    expect(() => { writePaneKind('files'); writePaneWidth(400) }).not.toThrow()
  })
})
