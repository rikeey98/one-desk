import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { KILL_GRACE_MS, taskkillTreeSync, terminate, type TreeKiller } from './terminate'

/**
 * `terminate`의 플랫폼 갈래 (`docs/sdlc/conversation-fixes/` spec FR-18).
 *
 * **플랫폼은 인자로 준다** — 개발 장비가 어느 OS든 두 갈래를 모두 검증한다
 * (`core/runner/executable.ts`와 같은 원칙). 진짜 프로세스 트리를 죽이는 검증은
 * 호스트가 Windows일 때만 돈다 — 실제 프로세스에 다른 플랫폼 규칙을 씌우면 검증하려던
 * 것과 다른 것을 보게 된다(CLAUDE.md).
 */

/**
 * kill 호출만 기록하는 가짜 자식. 종료 상태는 테스트가 세운다.
 * pid가 없는 자식(spawn 실패)은 null로 부른다 — 기본 인자는 undefined를 삼킨다.
 */
function fakeChild(pid: number | null = 4242) {
  const child = new EventEmitter() as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> }
  Object.assign(child, { pid: pid ?? undefined, exitCode: null, signalCode: null, kill: vi.fn(() => true) })
  return child
}

afterEach(() => { vi.useRealTimers() })

describe('terminate — Windows', () => {
  it('taskkill /T /F로 트리째 죽인다 — 직계만 죽이면 Bash 도구가 띄운 손자가 남는다', () => {
    const child = fakeChild(4242)
    const killTree = vi.fn<TreeKiller>()

    terminate(child, { platform: 'win32', killTree })

    expect(killTree).toHaveBeenCalledWith(4242, expect.any(Function))
    // 트리 종료가 성공하는 한 child.kill은 부르지 않는다 — 부르면 직계가 먼저 죽어
    // taskkill이 트리를 찾을 부모를 잃을 수 있다.
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('taskkill이 실패하면 child.kill()로 되돌아간다', () => {
    const child = fakeChild(4242)
    const killTree: TreeKiller = (_pid, onFail) => onFail(new Error('taskkill 없음'))

    terminate(child, { platform: 'win32', killTree })

    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('pid가 없으면(spawn 실패) taskkill을 부르지 않고 child.kill()만 부른다', () => {
    const child = fakeChild(null)
    const killTree = vi.fn<TreeKiller>()

    terminate(child, { platform: 'win32', killTree })

    expect(killTree).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('Windows에서는 SIGKILL 유예 타이머를 걸지 않는다 — taskkill /F가 이미 강제 종료다', () => {
    vi.useFakeTimers()
    const child = fakeChild(4242)

    terminate(child, { platform: 'win32', killTree: vi.fn<TreeKiller>() })
    vi.advanceTimersByTime(KILL_GRACE_MS + 10)

    expect(child.kill).not.toHaveBeenCalled()
  })
})

describe('terminate — POSIX', () => {
  it('SIGTERM을 보내고, 유예 뒤에도 살아 있으면 SIGKILL을 보낸다', () => {
    vi.useFakeTimers()
    const child = fakeChild(4242)
    const killTree = vi.fn<TreeKiller>()

    terminate(child, { platform: 'darwin', killTree })

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(KILL_GRACE_MS)
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL')
    // taskkill 갈래를 타지 않는다
    expect(killTree).not.toHaveBeenCalled()
  })

  it('유예 안에 끝났으면 SIGKILL을 보내지 않는다', () => {
    vi.useFakeTimers()
    const child = fakeChild(4242)

    terminate(child, { platform: 'linux' })
    Object.assign(child, { exitCode: 0 })
    vi.advanceTimersByTime(KILL_GRACE_MS)

    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

describe('taskkillTreeSync — 앱 종료 경로의 동기 트리 종료', () => {
  it('실패하면(없는 pid, taskkill이 없는 OS) 던지지 않고 onFail을 부른다', () => {
    // will-quit 안에서 던지면 뒤따르는 MCP 정리·DB 닫기가 통째로 건너뛰어진다.
    // 4의 배수가 아닌 pid는 Windows에 존재할 수 없다. POSIX에는 taskkill 자체가 없다.
    const onFail = vi.fn()
    expect(() => taskkillTreeSync(999_999_999, onFail)).not.toThrow()
    expect(onFail).toHaveBeenCalledTimes(1)
    expect(onFail.mock.calls[0]![0]).toBeInstanceOf(Error)
  })
})

/** pid가 살아 있는가. 신호 0은 존재만 본다(Windows에서도 된다) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.runIf(process.platform === 'win32')('terminate — 실제 Windows 프로세스 트리', () => {
  let grandchild: number | null = null

  afterEach(() => {
    // 실패해도 손자를 남기지 않는다 — 고아 node가 다음 실행을 방해한다.
    if (grandchild !== null && alive(grandchild)) process.kill(grandchild)
    grandchild = null
  })

  it('자식이 띄운 손자 프로세스까지 죽인다', async () => {
    // 자식이 손자를 띄우고 그 pid를 알린 뒤 둘 다 계속 산다 — Bash 도구가 dev 서버를
    // 띄운 채로 도는 claude의 모양이다.
    //
    // **손자는 detached여야 한다.** libuv는 detached가 아닌 자식을 "부모가 죽으면 같이
    // 죽는" job 객체에 넣으므로, node가 node를 띄운 트리는 child.kill()만으로도 손자가
    // 따라 죽는다 — 옛 코드로도 초록인 테스트가 된다(실측). Git Bash처럼 libuv가 아닌
    // 프로그램이 띄운 손자는 그 job에 없다. detached가 그 모양을 흉내낸다.
    const script = [
      "const { spawn } = require('node:child_process')",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true })",
      'process.stdout.write(String(g.pid) + "\\n")',
      'setInterval(() => {}, 1000)'
    ].join('\n')
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] })

    grandchild = await new Promise<number>((resolve, reject) => {
      child.stdout!.once('data', (chunk: Buffer) => resolve(Number(chunk.toString('utf8').trim())))
      child.once('error', reject)
    })
    expect(alive(grandchild)).toBe(true)

    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    terminate(child)
    await closed

    // taskkill은 비동기로 돈다 — 자식이 닫힌 뒤에도 손자가 사라지는 데 잠깐 걸릴 수 있다.
    const deadline = Date.now() + 5_000
    while (alive(grandchild) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(alive(grandchild)).toBe(false)
  })
})
