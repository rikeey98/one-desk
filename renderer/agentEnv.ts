import type { AgentEnv, AgentKind, Repo } from '@shared/models'
import { parseWslPath } from '@shared/wslPath'

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
