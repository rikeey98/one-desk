import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeAdapter } from './claudeCode'

let dir: string

/** 실행 비트가 선 파일을 만든다. POSIX 탐색이 X_OK를 보기 때문에 0o755여야 한다. */
async function makeExecutable(path: string): Promise<string> {
  await writeFile(path, '#!/bin/sh\n', { mode: 0o755 })
  return path
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'one-desk-preflight-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('preflight — 명시 경로', () => {
  it('실행 가능한 명시 경로를 그대로 쓴다', async () => {
    const exe = await makeExecutable(join(dir, 'claude'))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out).toEqual({ ok: true, executable: exe })
  })

  it('없는 명시 경로는 사유와 함께 거부한다', async () => {
    const out = await claudeCodeAdapter.preflight(join(dir, 'nope'))
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('설정된 경로')
  })

  it('명시 경로가 .cmd면 거부한다 — shell 없이 spawn하면 EINVAL이다', async () => {
    const exe = await makeExecutable(join(dir, 'claude.cmd'))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out.ok).toBe(false)
    expect(out.executable).toBeUndefined()
    expect(out.reason).toContain('claude.exe')
  })

  it('명시 경로가 .bat여도 거부한다', async () => {
    const exe = await makeExecutable(join(dir, 'claude.bat'))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out.ok).toBe(false)
    expect(out.executable).toBeUndefined()
  })
})

describe('preflight — PATH 탐색', () => {
  it('PATH에서 찾은 실행 파일을 쓴다', async () => {
    const exe = await makeExecutable(join(dir, 'claude'))
    const out = await claudeCodeAdapter.preflight(null, {
      platform: 'linux',
      env: { PATH: dir }
    })
    expect(out).toEqual({ ok: true, executable: exe })
  })

  it('PATH가 비어도 홈 폴백에서 찾는다', async () => {
    const bin = join(dir, '.local', 'bin')
    await mkdir(bin, { recursive: true })
    const exe = await makeExecutable(join(bin, 'claude'))
    const out = await claudeCodeAdapter.preflight(null, {
      platform: 'linux',
      env: { PATH: '', HOME: dir }
    })
    expect(out).toEqual({ ok: true, executable: exe })
  })

  it('못 찾으면 workspace 설정을 가리키는 사유를 준다', async () => {
    const out = await claudeCodeAdapter.preflight(null, {
      platform: 'linux',
      env: { PATH: dir, HOME: dir }
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('workspace 설정')
  })

  it('PATH보다 폴백이 뒤에 온다 — PATH에서 찾으면 폴백을 보지 않는다', async () => {
    const onPath = await makeExecutable(join(dir, 'claude'))
    const bin = join(dir, '.local', 'bin')
    await mkdir(bin, { recursive: true })
    await makeExecutable(join(bin, 'claude'))
    const out = await claudeCodeAdapter.preflight(null, {
      platform: 'linux',
      env: { PATH: dir, HOME: dir }
    })
    expect(out.executable).toBe(onPath)
  })
})
