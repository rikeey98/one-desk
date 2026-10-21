import type { AgentProbes, AgentStatuses, HomeSetup } from '@shared/models'

/** CLI 칸의 판정 — 설정 화면 실행 탭과 같은 데이터에서 센다 (home FR-15) */
export type CliReadiness = 'ready' | 'pending' | 'none'

/** 준비 단계 넷 — core의 셋(`HomeSetup`)에 CLI 칸과 `done`을 합친 것 (FR-14, plan 개정 8) */
export interface SetupState extends HomeSetup {
  cli: CliReadiness
  done: boolean
}

/**
 * 어느 하나가 실행 파일 · 인증 · 모델까지 통과했는가 (spec §0 — OpenCode만 준비돼도 끝). 모델 칸이 `skipped`인 것은
 * opencode(관측 수단이 없다)이므로 인증까지로 친다. `statuses`가 아직 없으면 `pending`이고, 실행 파일이 하나도 없으면
 * probe를 기다릴 것도 없이 `none`이다 — 실행 파일이 없는 CLI는 core도 probe를 돌리지 않는다.
 */
export function cliReadinessOf(statuses: AgentStatuses | null, probes: AgentProbes | null): CliReadiness {
  if (statuses === null) return 'pending'
  const kinds = (['claude-code', 'opencode', 'wsl'] as const).filter((k) => statuses[k]?.ok === true)
  if (kinds.length === 0) return 'none'
  if (probes === null) return 'pending'
  const ready = kinds.some((k) => {
    const probe = probes[k]
    if (!probe) return false
    if (probe.auth.state !== 'ok') return false
    return probe.model.state === 'resolved' || probe.model.state === 'skipped'
  })
  return ready ? 'ready' : 'none'
}

/** 네 조건을 합친다. `done`은 넷 다다 — 하나라도 거짓이 되면 다시 준비 단계다(FR-14) */
export function setupStateOf(setup: HomeSetup, cli: CliReadiness): SetupState {
  return { ...setup, cli, done: setup.workspace && setup.repo && cli === 'ready' && setup.firstRun }
}
