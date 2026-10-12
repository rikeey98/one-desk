import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LAUNCHER_FILE } from './launch'

/**
 * `core/wsl/launcher.sh` (`docs/sdlc/wsl-support/` spec FR-10) — WSL 안에서 돌 스크립트지만 **POSIX sh라 macOS·Linux
 * 개발 장비에서 진짜로 돈다.** Windows 호스트에서는 sh가 없어 건너뛴다.
 *
 * 두 가지만 한다: 새 프로세스 그룹을 만들어 그 id를 pidfile에 쓰고, 로그인 셸(`bash -lc`)로 명령을 exec한다.
 * 인자는 셸 문자열에 끼지 않는다 — `"$0" "$@"`로 그대로 간다.
 */
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function run(args: string[], detached: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'one-desk-launcher-'))
  dirs.push(dir)
  const pidfile = join(dir, 'x.pid')
  return new Promise<{ stdout: string; code: number | null; pidfile: string }>((resolve) => {
    const child = spawn('/bin/sh', [LAUNCHER_FILE, pidfile, ...args], { detached, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8') })
    child.on('close', (code) => resolve({ stdout, code, pidfile }))
  })
}

describe.skipIf(process.platform === 'win32')('launcher.sh', () => {
  it('인자를 그대로 넘겨 명령을 exec한다 — 공백·따옴표·$가 뜻을 잃지 않는다', async () => {
    const out = await run(['/bin/sh', '-c', 'printf "%s|" "$@"', 'sh', 'a b', '"q"', '$HOME', 'x;y'], true)
    expect(out.code).toBe(0)
    expect(out.stdout).toContain('a b|"q"|$HOME|x;y|')
  })

  it('pidfile에 적은 수가 그 명령의 프로세스 그룹이다 (이미 그룹 리더인 경우)', async () => {
    const out = await run(['/bin/sh', '-c', 'ps -o pgid= -p $$'], true)
    expect(out.code).toBe(0)
    const pgid = readFileSync(out.pidfile, 'utf8').trim()
    expect(pgid).toMatch(/^\d+$/)
    expect(out.stdout.trim()).toBe(pgid)
  })

  it.skipIf(process.platform !== 'linux')('그룹 리더가 아니면 setsid로 새 그룹을 만든다 — pidfile이 그 그룹이다', async () => {
    const out = await run(['/bin/sh', '-c', 'ps -o pgid= -p $$; ps -o ppid= -p $$'], false)
    expect(out.code).toBe(0)
    const pgid = readFileSync(out.pidfile, 'utf8').trim()
    const [reported] = out.stdout.trim().split('\n').map((l) => l.trim())
    expect(reported).toBe(pgid)
    // 테스트 프로세스(vitest)의 그룹이 아니다
    expect(pgid).not.toBe(String(process.pid))
  })

  it('명령의 종료 코드가 그대로 나온다', async () => {
    const out = await run(['/bin/sh', '-c', 'exit 7'], true)
    expect(out.code).toBe(7)
  })
})
