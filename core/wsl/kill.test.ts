import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { groupKillArgs, killGroup, killGroupSync, killSession, killSessionSync, sessionKillArgs, type GroupKiller } from './kill'

/**
 * WSL 안의 프로세스 종료 (`docs/sdlc/wsl-support/` spec FR-18·FR-30). run은 그룹(`kill -<SIG> -- -<pgid>` — 음수 pid가 그룹),
 * 터미널은 세션(`pkill -<SIG> -s <sid>`)이다. 비동기판은 일반 취소·셸 다시 시작, 동기판은 앱 종료 경로 전용이다.
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

  it('pgid가 2 이상의 정수가 아니면 던진다 — 0·음수·NaN은 엉뚱한 것을, 1은 그 사용자의 모든 프로세스를 맞힌다', () => {
    for (const bad of [0, 1, -1, Number.NaN, 1.5]) expect(() => groupKillArgs('Ubuntu', bad, 'TERM', {})).toThrow()
  })
})

describe('sessionKillArgs', () => {
  it('pkill -<SIG> -s <sid>를 그 distro 안에서 — 인자는 배열 그대로다', () => {
    expect(sessionKillArgs('Ubuntu', 4242, 'KILL', {})).toEqual({
      cmd: 'wsl.exe', args: ['-d', 'Ubuntu', '--exec', 'pkill', '-KILL', '-s', '4242'], cwd: undefined
    })
    expect(sessionKillArgs('Ubuntu', 7, 'TERM', {}).args.slice(-3)).toEqual(['-TERM', '-s', '7'])
  })

  it('sid가 2 이상의 정수가 아니면 던진다 — pkill -s 0은 pkill 자신의 세션이다', () => {
    for (const bad of [0, 1, -1, Number.NaN, 1.5]) expect(() => sessionKillArgs('Ubuntu', bad, 'KILL', {})).toThrow()
  })
})

/**
 * 가짜 wsl.exe(`.mjs`)는 `ONE_DESK_AGENT_LAUNCHER`(node)로 뜨므로 **Windows에서도 돈다** — 건너뛰면 이 장비에서 "되돌려 빨개지는지"를
 * 볼 수 없다. 가짜는 kill·pkill을 받아도 신호를 보내지 않는다.
 */
describe('비동기·동기 killer — 가짜 wsl.exe', () => {
  function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
    const previous = Object.keys(vars).map((k) => [k, process.env[k]] as const)
    Object.assign(process.env, vars)
    try { return fn() } finally {
      for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
  }

  const cases: { name: string; async: GroupKiller; sync: GroupKiller; tail: (sig: string) => string[] }[] = [
    { name: '그룹(run)', async: killGroup, sync: killGroupSync, tail: (sig) => ['kill', `-${sig}`, '--', '-2147483644'] },
    { name: '세션(터미널)', async: killSession, sync: killSessionSync, tail: (sig) => ['pkill', `-${sig}`, '-s', '2147483644'] }
  ]

  for (const c of cases) {
    it(`${c.name} — 비동기판은 wsl.exe를 띄워 신호를 보내고 실패하면 onFail을 부른다`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'one-desk-kill-'))
      const capture = join(dir, 'c.jsonl')
      try {
        await withEnv({ ONE_DESK_WSL_PATH: FAKE_WSL, ONE_DESK_AGENT_LAUNCHER: process.execPath, ONE_DESK_WSL_CAPTURE: capture }, () =>
          new Promise<void>((done, fail) => {
            const onFail = vi.fn()
            c.async('Ubuntu', 2147483644, 'TERM', onFail, () => {
              try {
                expect(onFail).not.toHaveBeenCalled()
                const line = JSON.parse(readFileSync(capture, 'utf8').trim()) as { argv: string[] }
                expect(line.argv).toEqual(['-d', 'Ubuntu', '--exec', ...c.tail('TERM')])
                done()
              } catch (err) { fail(err) }
            })
          }))
        await withEnv({ ONE_DESK_WSL_PATH: join(dir, '없는-wsl.mjs'), ONE_DESK_AGENT_LAUNCHER: process.execPath }, () =>
          new Promise<void>((done) => {
            c.async('Ubuntu', 2147483644, 'TERM', (err) => { expect(err).toBeInstanceOf(Error); done() })
          }))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it(`${c.name} — 동기판은 돌아오기 전에 끝나고, 실패해도 던지지 않는다`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'one-desk-kill-'))
      const capture = join(dir, 'c.jsonl')
      try {
        withEnv({ ONE_DESK_WSL_PATH: FAKE_WSL, ONE_DESK_AGENT_LAUNCHER: process.execPath, ONE_DESK_WSL_CAPTURE: capture }, () => {
          const onFail = vi.fn()
          c.sync('Ubuntu', 2147483644, 'KILL', onFail)
          expect(onFail).not.toHaveBeenCalled()
          // 돌아온 순간 이미 캡처가 있다 — 기다리지 않았다
          expect((JSON.parse(readFileSync(capture, 'utf8').trim()) as { argv: string[] }).argv.slice(2)).toEqual(['--exec', ...c.tail('KILL')])
        })
        withEnv({ ONE_DESK_WSL_PATH: join(dir, '없는-wsl.mjs'), ONE_DESK_AGENT_LAUNCHER: process.execPath }, () => {
          const onFail = vi.fn()
          expect(() => c.sync('Ubuntu', 2147483644, 'KILL', onFail)).not.toThrow()
          expect(onFail).toHaveBeenCalledTimes(1)
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
