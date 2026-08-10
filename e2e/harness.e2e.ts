import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('e2e 하네스', () => {
  it('빌드 산출물이 있다', () => {
    expect(existsSync(resolve('out/main/index.js'))).toBe(true)
    expect(existsSync(resolve('out/preload/index.mjs'))).toBe(true)
    expect(existsSync(resolve('out/renderer/index.html'))).toBe(true)
  })
})
