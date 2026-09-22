import { spawn } from 'node:child_process'
import { agentCommand } from '../runner/executable'
import type { CliOutput, RunCli } from './types'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * agent CLI를 한 번 띄워 출력을 모두 모은다. **던지지 않는다** — 띄우지 못한 것도
 * 시간이 초과된 것도 `failure`에 담아 돌려준다.
 *
 * `probeCommands`와 달리 **스트림을 읽지 않는다.** 여기 오는 명령
 * (`auth status`·`auth list`·`models`)은 전부 짧게 끝나고 모델을 부르지 않는다 —
 * 요금이 들지 않고, `RunManager`를 타지 않으므로 슬롯·큐·`run` 테이블에도 흔적이
 * 없다(spec FR-4·FR-5).
 *
 * Windows에서 `.mjs` 같은 것을 직접 실행하지 못하는 문제는 `agentCommand`가
 * 이미 푼다 — 여기서 따로 흉내내면 판정이 두 벌이 된다.
 */
export const runCli: RunCli = (input) => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<CliOutput>((resolve) => {
    let child
    try {
      const launch = agentCommand(input.executable, input.args)
      child = spawn(launch.cmd, launch.args, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      // .cmd처럼 spawn이 동기로 던지는 경우(EINVAL). 아직 치울 것이 없다.
      resolve({ code: null, stdout: '', stderr: '', failure: message(err) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false

    const settle = (out: CliOutput): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(out)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle({ code: null, stdout, stderr, failure: `${timeoutMs}ms 안에 끝나지 않았습니다` })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    // 없는 경로는 여기로 온다(ENOENT). 'close'가 뒤따르지 않을 수 있다.
    child.on('error', (err) => settle({ code: null, stdout, stderr, failure: err.message }))
    child.on('close', (code) => settle({ code, stdout, stderr, failure: null }))
  })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
