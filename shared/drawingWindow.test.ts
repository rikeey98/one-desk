import { describe, it, expect } from 'vitest'
import { drawingHash, parseDrawingHash, isDrawingHash } from './drawingWindow'
import { isPanelHash } from './panelWindow'

describe('그림 창의 해시 (docs/sdlc/drawings/ spec FR-8)', () => {
  it('그림 id를 왕복한다', () => {
    expect(drawingHash('d1')).toBe('#drawing/d1')
    expect(parseDrawingHash(drawingHash('d1'))).toBe('d1')
  })

  it('id 안의 / 와 % 는 인코딩되어 왕복한다', () => {
    expect(parseDrawingHash(drawingHash('a/b%c'))).toBe('a/b%c')
  })

  it('# 없이도 읽는다', () => {
    expect(parseDrawingHash('drawing/x')).toBe('x')
  })

  it('틀린 모양은 null이다', () => {
    expect(parseDrawingHash('')).toBeNull()
    expect(parseDrawingHash('#drawing/')).toBeNull()
    expect(parseDrawingHash('#drawing/a/b')).toBeNull()
    expect(parseDrawingHash('#panel/issue/w/r')).toBeNull()
    expect(parseDrawingHash('#drawing/%E0%A4%A')).toBeNull()
  })

  it('그림 창과 패널 창은 서로의 해시를 자기 것으로 보지 않는다', () => {
    expect(isDrawingHash('#drawing/d1')).toBe(true)
    expect(isDrawingHash('#drawing/')).toBe(true) // 모양이 틀려도 그림 창이다 — 앱 창을 그리지 않는다
    expect(isDrawingHash('#panel/issue/w/r')).toBe(false)
    expect(isDrawingHash('')).toBe(false)
    expect(isPanelHash('#drawing/d1')).toBe(false)
  })
})
