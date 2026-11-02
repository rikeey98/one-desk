import { describe, it, expect } from 'vitest'
import { nextDrawingTitle } from './title'

describe('새 그림의 이름 (docs/sdlc/drawings/ spec FR-5)', () => {
  it('없으면 그림 1이다', () => {
    expect(nextDrawingTitle([])).toBe('그림 1')
  })

  it('비어 있는 가장 작은 번호를 채운다', () => {
    expect(nextDrawingTitle(['그림 1', '그림 2'])).toBe('그림 3')
    expect(nextDrawingTitle(['그림 2'])).toBe('그림 1')
    expect(nextDrawingTitle(['그림 1', '그림 3'])).toBe('그림 2')
  })

  it('그 모양이 아닌 이름은 번호를 차지하지 않는다', () => {
    expect(nextDrawingTitle(['구조도', '그림 1 사본', '그림 01', '그림1'])).toBe('그림 1')
  })
})
