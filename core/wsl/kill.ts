import { execFileSync, spawn } from 'node:child_process'
import { wrapForEnv, type Launch } from './launch'

export type GroupSignal = 'TERM' | 'KILL'

/**
 * WSL 안의 프로세스 그룹을 끝낸다 (`docs/sdlc/wsl-support/` spec FR-18). 실패하면(wsl.exe가 없다, distro가 꺼졌다,
 * 그룹이 이미 없다) `onFail`. `onDone`은 테스트 이음매 — 비동기판이 끝난 때.
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
 * `wsl.exe -d <distro> -- kill -<SIG> -- -<pgid>` — 음수 pid가 그룹이다. pgid는 **양의 정수**여야 한다: 0·음수가 섞이면
 * `kill -- -0`·`kill -- 0`이 되어 호출자의 그룹 전체나 엉뚱한 것을 죽인다.
 */
export function groupKillArgs(distro: string, pgid: number, signal: GroupSignal, env: NodeJS.ProcessEnv = process.env): Launch {
  if (!Number.isInteger(pgid) || pgid <= 0) throw new Error(`프로세스 그룹 id가 올바르지 않습니다: ${pgid}`)
  return wrapForEnv({ kind: 'wsl', distro }, 'kill', [`-${signal}`, '--', `-${pgid}`], {}, env)
}

/** 비동기판 — 일반 취소. `execFileSync`로 부르면 이벤트 루프가 막혀 같은 프로세스의 MCP 서버가 멈춘다(CLAUDE.md) */
export const killGroup: GroupKiller = (distro, pgid, signal, onFail, onDone) => {
  let launch: Launch
  try {
    launch = groupKillArgs(distro, pgid, signal)
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
  child.on('close', (code) => settle(code === 0 ? null : new Error(`kill이 실패했습니다 (종료 코드 ${code})`)))
}

/**
 * 동기판 — **앱 종료 경로 전용**(`RunManager.cancelAll`·터미널 `killAll`). 비동기 kill은 메인 프로세스가 끝나며 함께 죽어
 * WSL 안의 agent와 그 손자가 남는다 — `taskkillTreeSync`와 같은 이유(CLAUDE.md). 일반 취소에 쓰지 말 것.
 */
export const killGroupSync: GroupKiller = (distro, pgid, signal, onFail, onDone) => {
  try {
    const launch = groupKillArgs(distro, pgid, signal)
    execFileSync(launch.cmd, launch.args, { stdio: 'ignore', windowsHide: true, timeout: GROUP_KILL_TIMEOUT_MS })
  } catch (err) {
    onFail(err instanceof Error ? err : new Error(String(err)))
  }
  onDone?.()
}
