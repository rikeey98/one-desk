import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// driver.ts와 같은 이유로 이 파일 위치에서 저장소 루트를 뽑는다 — process.cwd()에
// 기대면 저장소 루트에서 실행할 때만 맞다.
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('e2e 하네스', () => {
  it('빌드 산출물이 있다', () => {
    expect(existsSync(resolve(APP_ROOT, 'out/main/index.js'))).toBe(true)
    expect(existsSync(resolve(APP_ROOT, 'out/preload/index.mjs'))).toBe(true)
    expect(existsSync(resolve(APP_ROOT, 'out/renderer/index.html'))).toBe(true)
  })
})
