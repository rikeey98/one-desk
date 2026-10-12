import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LAUNCHER_FILE, LOGIN_SHELL } from './launch'

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

// **Windows에서도 돈다** — 릴리스 CI의 Windows 러너가 이 파일을 체크아웃한 그대로 패키징한다. Git for Windows의 기본값
// (core.autocrlf=true)이 CRLF로 바꾸면 WSL의 dash가 `shift: not found`·`Syntax error`로 거부해 pidfile도 안 쓰고 끝난다 —
// 모든 WSL run과 WSL 터미널이 깨지는데 probe·인증·git은 런처를 안 써서 CLI 상태는 초록이다(spec §4-B). `.gitattributes`가 막는다.
describe('launcher.sh — 모든 플랫폼', () => {
  it('CR이 없다 — LF로만 끝나야 WSL의 /bin/sh가 읽는다', () => {
    const bytes = readFileSync(LAUNCHER_FILE)
    expect(bytes.includes(0x0d)).toBe(false)
  })

  // run은 런처가, 런처 없이 뜨는 인증·probe는 agentCommand가 LOGIN_SHELL로 감싼다 — 둘이 갈리면 설정 화면과 run이 다른 환경을 본다
  // (wsl-support §4-C)
  it('마지막 exec 줄이 LOGIN_SHELL 상수와 같다 — run과 인증·probe가 같은 로그인 셸을 쓴다', () => {
    const text = readFileSync(LAUNCHER_FILE, 'utf8')
    expect(text).toContain(`exec ${LOGIN_SHELL[0]} ${LOGIN_SHELL[1]} '${LOGIN_SHELL[2]}' "$@"`)
  })
})

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
