import type { AgentEnv, AgentKind, Repo, WslDistros } from '@shared/models'
import { isWslUnc, parseWslPath } from '@shared/wslPath'

/**
 * 화면 쪽의 실행 환경 판정 (`docs/sdlc/wsl-support/` FR-6·FR-7). 순수 함수다 — 컴포넌트는 적용만 한다(plan 위험 8).
 */

/** 그 작업 디렉토리(repo 경로)의 실행 환경. 등록된 repo가 아니면 host — core의 `envOfCwd`와 같은 규칙 */
export function agentEnvOfCwd(repos: readonly Repo[], cwd: string): AgentEnv {
  return repos.find((r) => r.path === cwd)?.agentEnv ?? 'host'
}

/** 이 작업 디렉토리에서 그 agent를 고를 수 없는 이유. 고를 수 있으면 null (FR-7) */
export function agentBlockedReason(env: AgentEnv, kind: AgentKind): string | null {
  if (env === 'wsl' && kind === 'opencode') return 'WSL repo에서는 OpenCode를 아직 쓸 수 없습니다'
  return null
}

/** repo 탭의 파싱 결과 — WSL을 고른 경로가 가리키는 배포판과 Linux 경로, 모양이 아니면 거부 문구 (FR-6) */
export function describeWslPath(path: string): { ok: true; distro: string; linuxPath: string } | { ok: false; reason: string } {
  const parsed = parseWslPath(path.trim())
  return parsed
    ? { ok: true, ...parsed }
    : { ok: false, reason: 'WSL repo의 경로는 \\\\wsl$\\<배포판>\\… 이어야 합니다' }
}

/** 그 배포판이 `wsl --list`에 있는가 — 대소문자를 가리지 않는다(wsl.exe가 그렇다). repo 탭과 등록 폼의 경고가 같이 쓴다 */
export function isKnownDistro(distros: readonly string[], distro: string): boolean {
  return distros.some((d) => d.toLowerCase() === distro.toLowerCase())
}

/**
 * 등록 폼의 실행 환경 칸 (`docs/sdlc/wsl-repo-setup/` FR-3·4·5). WSL을 쓸 수 있고 경로가 WSL 경로면 체크를 **켜진 채** 내놓는다 —
 * 사람이 끈 것(`optedOut`)만 host다. 그 밖에는 체크가 없고 host다(보내는 모양도 지금 그대로). 목록에 없는 배포판은 표시만 하고
 * 막지 않는다(repo 탭과 같다 — 잠시 꺼져 있을 수 있다).
 */
export type RegisterEnv =
  | { offered: false; agentEnv: 'host' }
  | { offered: true; agentEnv: AgentEnv; distro: string; linuxPath: string; unknownDistro: boolean }

export function registerEnvOf(path: string, wsl: WslDistros | null, optedOut: boolean): RegisterEnv {
  const parsed = wsl?.supported ? parseWslPath(path.trim()) : null
  if (!wsl || !parsed) return { offered: false, agentEnv: 'host' }
  return {
    offered: true,
    agentEnv: optedOut ? 'host' : 'wsl',
    distro: parsed.distro,
    linuxPath: parsed.linuxPath,
    unknownDistro: !isKnownDistro(wsl.distros, parsed.distro)
  }
}

/**
 * 등록 폼의 `WSL` 버튼이 서는가, 선다면 어느 배포판의 홈에서 여는가 (FR-1). 시작 폴더 자체는 core가 정한다(`wsl.folderStart`) —
 * 이 이름은 풍선에 쓸 뿐이고 같은 규칙(기본, 없으면 첫 배포판)이다.
 */
export function wslPickerOf(wsl: WslDistros | null): { distro: string } | null {
  if (!wsl?.supported) return null
  const distro = wsl.defaultDistro ?? wsl.distros[0]
  return distro ? { distro } : null
}

/** WSL 탭의 repo 한 줄 (FR-8의 3). 경로가 WSL 모양이 아니면(실행 환경만 WSL) 배포판·Linux 경로가 null이다 */
export interface WslRepoRow {
  repo: Repo
  distro: string | null
  linuxPath: string | null
  agentEnv: AgentEnv
}

/** 실행 환경이 WSL이거나 경로가 WSL 폴더인 repo — 후자는 Windows claude가 UNC에서 도는 줄이라 같이 보여야 한다 */
export function wslRepoRowsOf(repos: readonly Repo[]): WslRepoRow[] {
  return repos.flatMap((repo) => {
    if (repo.agentEnv !== 'wsl' && !isWslUnc(repo.path)) return []
    const parsed = parseWslPath(repo.path)
    return [{ repo, distro: parsed?.distro ?? null, linuxPath: parsed?.linuxPath ?? null, agentEnv: repo.agentEnv }]
  })
}

/** 사이드바 repo 카드의 풍선 (FR-6) — WSL repo는 UNC보다 읽히는 배포판 · Linux 경로, 그 밖에는 경로 그대로 */
export function repoTitleOf(repo: Repo): string {
  const parsed = repo.agentEnv === 'wsl' ? parseWslPath(repo.path) : null
  return parsed ? `WSL · ${parsed.distro} · ${parsed.linuxPath}` : repo.path
}
