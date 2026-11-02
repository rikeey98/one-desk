import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pickOpenDrawing, readOpenDrawing, writeOpenDrawing } from './openDrawing'
import type { DrawingSummary } from '@shared/models'

const d = (id: string, updatedAt: number): DrawingSummary =>
  ({ id, workspaceId: 'w', repoId: 'r', title: id, createdAt: 1, updatedAt })

describe('repo마다 무엇을 여나 (docs/sdlc/drawings/ spec FR-14)', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('기억한 그림이 목록에 있으면 그것이다', () => {
    expect(pickOpenDrawing([d('a', 1), d('b', 5)], 'a')).toBe('a')
  })

  it('기억이 없거나 지워졌으면 가장 최근에 고친 것이다', () => {
    expect(pickOpenDrawing([d('a', 1), d('b', 5), d('c', 3)], null)).toBe('b')
    expect(pickOpenDrawing([d('a', 1), d('b', 5)], 'gone')).toBe('b')
  })

  it('그림이 없으면 null이다', () => {
    expect(pickOpenDrawing([], 'a')).toBeNull()
  })

  it('repo마다 이 장비에 남긴다 — 저장소가 막혀도 던지지 않는다', () => {
    writeOpenDrawing('r1', 'a')
    writeOpenDrawing('r2', 'b')
    expect(readOpenDrawing('r1')).toBe('a')
    expect(readOpenDrawing('r2')).toBe('b')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readOpenDrawing('r1')).toBeNull()
    expect(() => writeOpenDrawing('r1', 'x')).not.toThrow()
  })
})
