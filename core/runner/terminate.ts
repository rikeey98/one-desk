import { execFile, execFileSync, type ChildProcess } from 'node:child_process'

/** SIGTERM 후 SIGKILL까지의 유예 */
export const KILL_GRACE_MS = 3000

/**
 * pid를 뿌리로 한 프로세스 트리를 죽인다. 실패하면(이미 끝났다, taskkill이 없다,
 * 권한이 없다) `onFail`을 부른다. 테스트가 바꿔 끼우는 이음매다.
 */
export type TreeKiller = (pid: number, onFail: (err: Error) => void) => void

/**
 * `taskkill /PID <pid> /T /F`. **비동기다** — `execFileSync`로 부르면 이벤트 루프가
 * 막혀 같은 프로세스의 MCP 서버가 멈춘다(CLAUDE.md).
 */
export const taskkillTree: TreeKiller = (pid, onFail) => {
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (err) => {
    if (err) onFail(err)
  })
}

/** 종료 경로의 taskkill이 매달려도 앱 종료를 붙잡지 않게 하는 상한 */
export const SHUTDOWN_KILL_TIMEOUT_MS = 5_000

/**
 * `taskkillTree`의 동기판. **앱 종료 경로 전용이다**(`RunManager.cancelAll`).
 *
 * 종료 경로에서 비동기 taskkill은 끝까지 돌지 못한다. libuv는 detached가 아닌 자식을
 * "부모가 죽으면 같이 죽는" job 객체에 넣는데 taskkill 자신도 그 자식이라, will-quit이
 * 돌려준 직후 메인 프로세스가 끝나면 taskkill도 함께 죽는다 — 직계 agent는 job 때문에
 * 죽지만 그 job을 빠져나간 손자(Bash 도구의 dev 서버 등)는 남는다(2026-09-27 실측:
 * 비동기 8/8 생존, 동기 8/8 종료). 이벤트 루프가 막히는 것은 여기서는 문제가 아니다 —
 * 앱은 이미 끝나는 중이고 MCP 서버도 곧 닫힌다. **일반 취소에 쓰지 말 것**(CLAUDE.md의
 * `execFileSync` 함정).
 */
export const taskkillTreeSync: TreeKiller = (pid, onFail) => {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore', timeout: SHUTDOWN_KILL_TIMEOUT_MS
    })
  } catch (err) {
    onFail(err instanceof Error ? err : new Error(String(err)))
  }
}

export interface TerminateOptions {
  /** 기본은 `process.platform`. 개발 장비에서 다른 OS의 갈래를 검증하려고 받는다 */
  platform?: NodeJS.Platform
  /** Windows 트리 종료. 기본은 `taskkillTree` */
  killTree?: TreeKiller
}

/**
 * 실행 중인 agent를 끝낸다. 일반 실행 취소·타임아웃에서 쓴다. 목록 탐색(probe)은 유예
 * 없이 따로 종료한다.
 *
 * **Windows는 트리째 죽인다** (`docs/sdlc/conversation-fixes/` spec FR-18). `child.kill`은
 * 직계만 즉시 강제 종료하므로, claude의 Bash 도구가 띄운 손자(dev 서버 등)가 주인 없이
 * 남는다 — Windows에는 프로세스 그룹 신호가 없다. taskkill `/T`가 부모-자식 관계를 따라
 * 내려가고, `/F`가 강제 종료라 SIGKILL 유예를 따로 두지 않는다. taskkill이 실패하면
 * `child.kill()`로 되돌아간다 — 적어도 직계는 죽어야 run이 끝나고 슬롯이 풀린다.
 *
 * POSIX는 지금대로다: SIGTERM을 보내고, 유예 뒤에도 살아 있으면 SIGKILL.
 */
export function terminate(child: ChildProcess, opts: TerminateOptions = {}): void {
  const platform = opts.platform ?? process.platform

  if (platform === 'win32') {
    // spawn이 실패하면 pid가 없다. 죽일 트리도 없으니 직계 경로만 탄다.
    if (child.pid === undefined) {
      child.kill()
      return
    }
    // 트리 종료가 도는 동안 child.kill을 먼저 부르지 않는다 — 직계가 먼저 죽으면
    // taskkill이 뿌리 pid를 못 찾아 손자를 놓친다.
    ;(opts.killTree ?? taskkillTree)(child.pid, () => { child.kill() })
    return
  }

  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS).unref()
}
