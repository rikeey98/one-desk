import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { groupKillArgs, killGroup, killGroupSync } from './kill'

/**
 * WSL 안의 프로세스 그룹 종료 (`docs/sdlc/wsl-support/` spec FR-18). `wsl.exe -d <distro> --exec kill -<SIG> -- -<pgid>` —
 * 음수 pid가 그룹이다. 비동기판은 일반 취소, 동기판은 앱 종료 경로 전용(`cancelAll`).
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE_WSL = resolve(HERE, '../runner/fixtures/fake-wsl.mjs')

describe('groupKillArgs', () => {
  it('kill -<SIG> -- -<pgid>를 그 distro 안에서 — 인자는 배열 그대로다', () => {
    expect(groupKillArgs('Ubuntu', 4242, 'TERM', {})).toEqual({
      cmd: 'wsl.exe', args: ['-d', 'Ubuntu', '--exec', 'kill', '-TERM', '--', '-4242'], cwd: undefined
    })
    expect(groupKillArgs('Ubuntu', 7, 'KILL', {}).args.slice(-3)).toEqual(['-KILL', '--', '-7'])
  })

  it('pgid가 양의 정수가 아니면 던진다 — 0·음수·NaN은 "모든 프로세스"가 될 수 있다', () => {
    expect(() => groupKillArgs('Ubuntu', 0, 'TERM', {})).toThrow()
    expect(() => groupKillArgs('Ubuntu', -1, 'TERM', {})).toThrow()
    expect(() => groupKillArgs('Ubuntu', Number.NaN, 'TERM', {})).toThrow()
    expect(() => groupKillArgs('Ubuntu', 1.5, 'TERM', {})).toThrow()
  })
})

describe.skipIf(process.platform === 'win32')('killGroup — 가짜 wsl.exe', () => {
  function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
    const previous = Object.keys(vars).map((k) => [k, process.env[k]] as const)
    Object.assign(process.env, vars)
    try { return fn() } finally {
      for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
  }

  it('비동기판은 wsl.exe를 띄워 kill을 보내고 실패하면 onFail을 부른다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-kill-'))
    const capture = join(dir, 'c.jsonl')
    try {
      await withEnv({ ONE_DESK_WSL_PATH: FAKE_WSL, ONE_DESK_AGENT_LAUNCHER: process.execPath, ONE_DESK_WSL_CAPTURE: capture }, () =>
        new Promise<void>((done) => {
          const onFail = vi.fn()
          killGroup('Ubuntu', 2147483644, 'TERM', onFail, () => {
            expect(onFail).not.toHaveBeenCalled()
            const line = JSON.parse(readFileSync(capture, 'utf8').trim()) as { argv: string[] }
            expect(line.argv).toEqual(['-d', 'Ubuntu', '--exec', 'kill', '-TERM', '--', '-2147483644'])
            done()
          })
        }))
      await withEnv({ ONE_DESK_WSL_PATH: join(dir, '없는-wsl.mjs'), ONE_DESK_AGENT_LAUNCHER: process.execPath }, () =>
        new Promise<void>((done) => {
          killGroup('Ubuntu', 2147483644, 'TERM', (err) => { expect(err).toBeInstanceOf(Error); done() })
        }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('동기판은 돌아오기 전에 끝나고, 실패해도 던지지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-kill-'))
    const capture = join(dir, 'c.jsonl')
    try {
      withEnv({ ONE_DESK_WSL_PATH: FAKE_WSL, ONE_DESK_AGENT_LAUNCHER: process.execPath, ONE_DESK_WSL_CAPTURE: capture }, () => {
        const onFail = vi.fn()
        killGroupSync('Ubuntu', 2147483644, 'KILL', onFail)
        expect(onFail).not.toHaveBeenCalled()
        // 돌아온 순간 이미 캡처가 있다 — 기다리지 않았다
        expect((JSON.parse(readFileSync(capture, 'utf8').trim()) as { argv: string[] }).argv.slice(-3)).toEqual(['-KILL', '--', '-2147483644'])
      })
      withEnv({ ONE_DESK_WSL_PATH: join(dir, '없는-wsl.mjs'), ONE_DESK_AGENT_LAUNCHER: process.execPath }, () => {
        const onFail = vi.fn()
        expect(() => killGroupSync('Ubuntu', 2147483644, 'KILL', onFail)).not.toThrow()
        expect(onFail).toHaveBeenCalledTimes(1)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
