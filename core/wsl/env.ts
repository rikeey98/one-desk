import type { Repo } from '@shared/models'
import { parseWslPath } from '@shared/wslPath'

/**
 * 프로세스를 **어디서** 띄우나 (`docs/sdlc/wsl-support/` spec FR-8).
 *
 * `host`는 앱이 도는 OS 그대로, `wsl`은 `wsl.exe -d <distro>` 안이다. **repo에서만 나온다**(`envOfRepo`) —
 * 렌더러가 distro를 정하는 통로는 없다(FR-32). spawn하는 자리는 전부 이 값을 `wrapForEnv`(`launch.ts`)에 넘긴다.
 */
export type ProcessEnvSpec =
  | { kind: 'host' }
  | { kind: 'wsl'; distro: string }

export const HOST_ENV: ProcessEnvSpec = { kind: 'host' }

/**
 * repo의 실행 환경. `agentEnv`가 `wsl`이면 경로(`\\wsl$\<distro>\…`)에서 distro를 판다 — 저장할 때 모양을 검증했으므로
 * 여기서 null이 나오면 데이터가 깨진 것이라 던진다. `host`면 경로가 WSL 폴더여도 host다(FR-2 — Windows의 claude로
 * WSL 폴더를 쓰는 것은 막지 않는다).
 */
export function envOfRepo(repo: Pick<Repo, 'path' | 'agentEnv'>): ProcessEnvSpec {
  if (repo.agentEnv !== 'wsl') return HOST_ENV
  const parsed = parseWslPath(repo.path)
  if (!parsed) throw new Error(`WSL repo의 경로가 \\\\wsl$\\<배포판>\\… 모양이 아닙니다: ${repo.path}`)
  return { kind: 'wsl', distro: parsed.distro }
}
