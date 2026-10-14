import { describe, it, expect } from 'vitest'
import { pickStartOf } from './pickStart'

describe('pickStartOf (docs/sdlc/wsl-repo-setup/ FR-13)', () => {
  it('{ start: "wsl" }만 WSL이다', () => {
    expect(pickStartOf({ start: 'wsl' })).toBe('wsl')
  })

  it('그 밖의 값은 전부 OS 기본 위치(null)다 — 경로를 넘겨도 쓰지 않는다', () => {
    expect(pickStartOf(undefined)).toBeNull()
    expect(pickStartOf(null)).toBeNull()
    expect(pickStartOf('wsl')).toBeNull()
    expect(pickStartOf({})).toBeNull()
    expect(pickStartOf({ start: 'WSL' })).toBeNull()
    expect(pickStartOf({ start: 'C:\\Windows' })).toBeNull()
    expect(pickStartOf({ defaultPath: '\\\\wsl$\\Ubuntu' })).toBeNull()
  })
})
