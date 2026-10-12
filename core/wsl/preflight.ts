import type { CliOutput } from '../agent/types'
import type { PreflightResult } from '../runner/types'
import type { ProcessEnvSpec } from './env'

/** WSL 안에서 명령 하나를 띄워 출력을 받는 통로 — `runCliIn(env)`를 감싼 것. 테스트가 바꿔 끼운다 */
export type WslRun = (
  env: Extract<ProcessEnvSpec, { kind: 'wsl' }>,
  executable: string,
  args: string[]
) => Promise<CliOutput>

export interface WslPreflight {
  /** WSL 안의 claude 실행 파일 판정 (FR-13). 설정 화면(`checkAgents`)과 실행이 **같이** 쓴다 */
  claude(distro: string, explicitPath: string | null): Promise<PreflightResult>
  /** 캐시를 비운다 — 설정의 `다시 확인`·실행 환경 변경 */
  clear(): void
}

/**
 * WSL 안의 claude preflight (`docs/sdlc/wsl-support/` spec FR-12·13).
 *
 * 명시 경로(앱 탭의 WSL claude 경로)가 있으면 `test -x <경로>`, 없으면 로그인 셸의 `command -v claude`다 — `-l`이라
 * `~/.profile`의 PATH(네이티브 설치의 `~/.local/bin`)가 보인다. `PATHEXT`·`.cmd` 거부·npm 껍데기 벗기기는 없다 —
 * Linux에는 그 개념이 없다.
 *
 * **통과한 판정만 캐시한다**(distro, 설정값). 못 읽은 판정(wsl.exe 실패·시간 초과)은 캐시하지 않는다 — 꺼져 있던 distro가
 * 첫 조회에서 느렸던 한 번이 앱이 사는 동안 굳으면 안 된다(opencode 버전 게이트와 같은 규칙). "없다"도 캐시하지 않는다 —
 * 설치한 직후의 `다시 확인`이 잡아야 한다. 프로미스째 담아 동시에 온 조회가 프로세스를 한 번만 띄운다.
 */
export function createWslPreflight(deps: { run: WslRun }): WslPreflight {
  const cache = new Map<string, Promise<PreflightResult>>()

  async function judge(distro: string, explicitPath: string | null): Promise<PreflightResult> {
    const env = { kind: 'wsl' as const, distro }
    if (explicitPath) {
      const out = await deps.run(env, 'test', ['-x', explicitPath])
      if (out.failure) return { ok: false, reason: `WSL을 띄우지 못했습니다 (${distro}): ${out.failure}` }
      if (out.code !== 0) return { ok: false, reason: `실행 파일이 없습니다 (${distro}): ${explicitPath}` }
      return { ok: true, executable: explicitPath }
    }
    const out = await deps.run(env, 'bash', ['-lc', 'command -v claude'])
    if (out.failure) return { ok: false, reason: `WSL을 띄우지 못했습니다 (${distro}): ${out.failure}` }
    const found = out.stdout.trim().split('\n').pop()?.trim() ?? ''
    if (out.code !== 0 || found === '') {
      return {
        ok: false,
        reason: `WSL(${distro})의 PATH에서 claude를 찾을 수 없습니다. 앱 설정의 WSL claude 경로를 지정하세요.`
      }
    }
    return { ok: true, executable: found }
  }

  return {
    claude(distro, explicitPath) {
      const key = `${distro.toLowerCase()}\0${explicitPath ?? ''}`
      const hit = cache.get(key)
      if (hit) return hit
      const started = judge(distro, explicitPath)
      cache.set(key, started)
      started.then(
        (result) => { if (!result.ok) cache.delete(key) },
        () => { cache.delete(key) }
      )
      return started
    },
    clear() { cache.clear() }
  }
}
