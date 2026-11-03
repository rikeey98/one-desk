import { describe, it, expect, beforeEach } from 'vitest'
import { readHomeDockOpen, writeHomeDockOpen } from './homeDock'

describe('홈 도크의 펼침 (docs/sdlc/home-conversation/ FR-13a)', () => {
  beforeEach(() => { localStorage.clear() })

  it('처음에는 접힘이다', () => {
    expect(readHomeDockOpen()).toBe(false)
  })

  it('펼침을 기억하고 다시 접으면 접힘이다', () => {
    writeHomeDockOpen(true)
    expect(readHomeDockOpen()).toBe(true)
    writeHomeDockOpen(false)
    expect(readHomeDockOpen()).toBe(false)
  })
})
