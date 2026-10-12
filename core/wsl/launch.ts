import { fileURLToPath } from 'node:url'
import { parseWslPath } from '@shared/wslPath'
import type { ProcessEnvSpec } from './env'

/** e2e가 가짜 `wsl.exe`를 물리는 통로 — `ONE_DESK_AGENT_PATH`와 같은 성격의 테스트 이음매다 */
export const WSL_EXE_ENV = 'ONE_DESK_WSL_PATH'
const DEFAULT_WSL_EXE = 'wsl.exe'

/** 런처 스크립트의 **Windows 쪽** 경로(이 파일 기준). WSL에 넘길 때는 `WslPaths.toLinux`로 바꾼다. 패키징 앱은 main이 넘긴다 */
export const LAUNCHER_FILE = fileURLToPath(new URL('./launcher.sh', import.meta.url))

export interface Launch {
  cmd: string
  args: string[]
  /** spawn의 cwd 옵션. wsl이면 **없다** — 디렉토리는 `--cd`로 wsl.exe에 넘겼다 */
  cwd: string | undefined
}

export interface WrapOptions {
  /** Windows 쪽 작업 디렉토리. wsl이면 그 repo의 UNC여야 하고 Linux 경로로 바꿔 `--cd`에 준다 */
  cwd?: string
  /** 런처(FR-10) — 둘 다 **Linux 경로**. 있으면 `/bin/sh <path> <pidfile>`이 명령 앞에 선다 */
  launcher?: { path: string; pidfile: string }
}

/**
 * spawn 직전의 마지막 변환 (`docs/sdlc/wsl-support/` spec FR-8).
 *
 * host면 그대로다. wsl이면 `wsl.exe -d <distro> [--cd <linux cwd>] --exec [/bin/sh <launcher> <pidfile>] <cmd> <args…>`.
 * **인자는 배열 원소 그대로 간다**(FR-33) — 어느 갈래에서도 셸 문자열에 끼워 넣지 않는다. 런처의 `bash -lc`도 고정
 * 상수(`exec "$0" "$@"`)이고 사용자 값은 인자로만 들어간다.
 *
 * **`--`가 아니라 `--exec`다.** wsl.exe는 `--` 뒤의 명령줄을 그 배포판의 기본 셸에 `bash -c` **문자열**로 넘긴다 — 배열로
 * 보낸 인자가 셸 문법이 되어 Windows 경로의 `\`가 이스케이프로 먹히고(`C:\WINDOWS\…` → `C:WINDOWS…`, 그래서 `wslpath`가
 * 실패해 모든 run이 시작조차 못 했다) `$(…)`가 실행된다. `--exec`만 셸 없이 argv를 그대로 넘긴다(2026-10-12 실측,
 * WSL 3.0.1 · Ubuntu-24.04 — spec FR-8 다듬음). 그래서 안쪽 명령은 셸 내장이 아니라 실행 파일이어야 하고(`kill`은
 * `/usr/bin/kill`), 셸이 필요하면 `sh -c`·`bash -lc`를 명시한다.
 *
 * `ONE_DESK_AGENT_LAUNCHER`(Windows에서 `.mjs`를 node로 띄우는 e2e 이음매)는 **안쪽 명령에는 붙지 않는다** — 안쪽은
 * Linux라 뜻이 없다. 붙는 자리는 하나, `ONE_DESK_WSL_PATH`로 가짜 wsl.exe(`.mjs`)를 물렸을 때 그 픽스처를 띄우는 것이다.
 */
export function wrapForEnv(
  env: ProcessEnvSpec,
  cmd: string,
  args: readonly string[],
  opts: WrapOptions = {},
  processEnv: NodeJS.ProcessEnv = process.env
): Launch {
  if (env.kind === 'host') return { cmd, args: [...args], cwd: opts.cwd }

  if (env.distro === '' || env.distro.startsWith('-')) {
    throw new Error(`배포판 이름이 올바르지 않습니다: ${env.distro}`)
  }
  const out: string[] = ['-d', env.distro]
  if (opts.cwd !== undefined) {
    const parsed = parseWslPath(opts.cwd)
    if (!parsed) throw new Error(`WSL 안의 경로가 아닙니다: ${opts.cwd}`)
    if (parsed.distro.toLowerCase() !== env.distro.toLowerCase()) {
      throw new Error(`작업 디렉토리의 배포판(${parsed.distro})이 repo의 배포판(${env.distro})과 다릅니다`)
    }
    out.push('--cd', parsed.linuxPath)
  }
  // `--`로 되돌리지 말 것 — 위 주석. 가짜 wsl.exe(`fake-wsl.mjs`)는 `--`를 받으면 실패한다
  out.push('--exec')
  if (opts.launcher) out.push('/bin/sh', opts.launcher.path, opts.launcher.pidfile)
  out.push(cmd, ...args)
  return { ...wslExeLaunch(out, processEnv), cwd: undefined }
}

/**
 * `wsl.exe <args>`를 띄우는 모양 — `wrapForEnv`와 `listDistros`가 같이 쓴다. 가짜 wsl.exe(`.mjs` 픽스처)는 Windows에서
 * 셔뱅으로 뜨지 않으므로(`spawn EFTYPE`) agent 픽스처와 같은 런처(`ONE_DESK_AGENT_LAUNCHER`)로 띄운다 — 한 자리에만
 * 두면 다른 자리가 Windows CI에서만 깨진다(v0.24.0 첫 빌드가 그랬다).
 */
export function wslExeLaunch(args: readonly string[], processEnv: NodeJS.ProcessEnv = process.env): { cmd: string; args: string[] } {
  const exe = processEnv[WSL_EXE_ENV]
  if (!exe) return { cmd: DEFAULT_WSL_EXE, args: [...args] }
  const launcher = processEnv['ONE_DESK_AGENT_LAUNCHER']
  return launcher ? { cmd: launcher, args: [exe, ...args] } : { cmd: exe, args: [...args] }
}
