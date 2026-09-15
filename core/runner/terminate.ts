import type { ChildProcess } from 'node:child_process'

/** SIGTERM 후 SIGKILL까지의 유예 */
export const KILL_GRACE_MS = 3000

/** SIGTERM을 보내고, 유예 후에도 살아 있으면 SIGKILL. RunManager와 커맨드 probe가 같이 쓴다. */
export function terminate(child: ChildProcess): void {
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS).unref()
}
