import { execFileSync, spawn } from 'node:child_process'
import { wrapForEnv, type Launch } from './launch'

export type GroupSignal = 'TERM' | 'KILL'

/**
 * WSL 안의 프로세스 그룹(run)이나 세션(터미널)을 끝낸다 (`docs/sdlc/wsl-support/` spec FR-18·FR-30). 실패하면(wsl.exe가 없다,
 * distro가 꺼졌다, 대상이 이미 없다) `onFail`. `onDone`은 테스트 이음매 — 비동기판이 끝난 때.
 */
export type GroupKiller = (
  distro: string,
  pgid: number,
  signal: GroupSignal,
  onFail: (err: Error) => void,
  onDone?: () => void
) => void

/** 앱 종료 경로의 동기 kill이 매달려도 종료를 붙잡지 않게 하는 상한 — `SHUTDOWN_KILL_TIMEOUT_MS`와 같은 뜻 */
export const GROUP_KILL_TIMEOUT_MS = 5_000

/**
 * 런처가 pidfile에 쓴 수는 **2 이상**이어야 한다. 0·음수는 `kill -- -0`(호출자의 그룹)·`pkill -s 0`(pkill 자신의 세션)이 되고,
 * 1은 `kill -- -1` — **그 사용자가 신호를 보낼 수 있는 모든 프로세스**다(사용자가 따로 띄운 claude 세션까지). wsl.exe 아래 pid 1은
 * `/init`이라 런처의 `$$`가 1일 수 없으므로 1은 언제나 깨진 pidfile이다.
 */
function assertTarget(id: number, what: string): void {
  if (!Number.isInteger(id) || id <= 1) throw new Error(`${what}가 올바르지 않습니다: ${id}`)
}

/** `wsl.exe -d <distro> --exec kill -<SIG> -- -<pgid>` — 음수 pid가 그룹이다. run의 취소가 쓴다 */
export function groupKillArgs(distro: string, pgid: number, signal: GroupSignal, env: NodeJS.ProcessEnv = process.env): Launch {
  assertTarget(pgid, '프로세스 그룹 id')
  return wrapForEnv({ kind: 'wsl', distro }, 'kill', [`-${signal}`, '--', `-${pgid}`], {}, env)
}

/**
 * `wsl.exe -d <distro> --exec pkill -<SIG> -s <sid>` — 그 **세션**의 모든 프로세스(procps). 터미널이 쓴다: 대화형 bash는 작업
 * 제어로 작업마다 그룹을 따로 만들어 그룹 KILL은 셸만 맞히고 `npm run dev &`가 앱을 끈 뒤에도 남았다(2026-10-12 실측). wsl.exe의
 * `--exec`는 명령을 세션 리더로 띄우므로(pid = pgid = sid, 실측) 런처가 pidfile에 쓴 수가 곧 sid다.
 */
export function sessionKillArgs(distro: string, sid: number, signal: GroupSignal, env: NodeJS.ProcessEnv = process.env): Launch {
  assertTarget(sid, '세션 id')
  return wrapForEnv({ kind: 'wsl', distro }, 'pkill', [`-${signal}`, '-s', String(sid)], {}, env)
}

/** 비동기판 — 일반 취소·셸 다시 시작. `execFileSync`로 부르면 이벤트 루프가 막혀 같은 프로세스의 MCP 서버가 멈춘다(CLAUDE.md) */
function asyncKiller(argsOf: typeof groupKillArgs): GroupKiller {
  return (distro, id, signal, onFail, onDone) => {
    let launch: Launch
    try {
      launch = argsOf(distro, id, signal)
    } catch (err) {
      onFail(err instanceof Error ? err : new Error(String(err)))
      onDone?.()
      return
    }
    let child
    try {
      child = spawn(launch.cmd, launch.args, { stdio: 'ignore', windowsHide: true })
    } catch (err) {
      onFail(err instanceof Error ? err : new Error(String(err)))
      onDone?.()
      return
    }
    let settled = false
    const settle = (err: Error | null) => {
      if (settled) return
      settled = true
      if (err) onFail(err)
      onDone?.()
    }
    child.on('error', (err) => settle(err))
    child.on('close', (code) => settle(code === 0 ? null : new Error(`종료 신호를 보내지 못했습니다 (종료 코드 ${code})`)))
  }
}

/**
 * 동기판 — **앱 종료 경로 전용**(`RunManager.cancelAll`·터미널 `killAll`). 비동기 kill은 메인 프로세스가 끝나며 함께 죽어
 * WSL 안의 agent와 그 손자가 남는다 — `taskkillTreeSync`와 같은 이유(CLAUDE.md). 일반 취소에 쓰지 말 것.
 */
function syncKiller(argsOf: typeof groupKillArgs): GroupKiller {
  return (distro, id, signal, onFail, onDone) => {
    try {
      const launch = argsOf(distro, id, signal)
      execFileSync(launch.cmd, launch.args, { stdio: 'ignore', windowsHide: true, timeout: GROUP_KILL_TIMEOUT_MS })
    } catch (err) {
      onFail(err instanceof Error ? err : new Error(String(err)))
    }
    onDone?.()
  }
}

/** run — 그룹. claude가 TERM을 받고 Bash 도구의 자식(detached라 세션부터 다르다)을 거둔다(§4-B 실측) */
export const killGroup: GroupKiller = asyncKiller(groupKillArgs)
export const killGroupSync: GroupKiller = syncKiller(groupKillArgs)
/** 터미널 — 세션. `nohup`·`disown`·`( … &)`까지 끝난다(트리째 — Windows 셸의 `taskkill /T`와 같다). `setsid`로 세션을 떠난 것만 남는다 */
export const killSession: GroupKiller = asyncKiller(sessionKillArgs)
export const killSessionSync: GroupKiller = syncKiller(sessionKillArgs)
