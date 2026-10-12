import type { AgentKind, AgentPaths, Workspace } from '@shared/models'
import type { ProcessEnvSpec } from '../wsl/env'

type PathSource = Pick<Workspace, 'claudePath' | 'opencodePath'>

/**
 * 앱 기본 경로 — Windows 둘(`agents.path.*`)에 **WSL claude 경로**(`agents.path.claude.wsl`, Linux 경로)를 더한 것.
 * `claudeWsl`이 필수인 이유는 `appDefaults` 자체가 필수인 이유와 같다 — 선택이면 index.ts가 빠뜨려도 조용히
 * 컴파일되고 WSL repo의 claude 경로 설정이 영영 무시된다.
 */
export interface AgentDefaults extends AgentPaths {
  claudeWsl: string | null
}

/**
 * 어댑터 preflight에 넘길 명시 경로를 고른다.
 *
 * host: 환경변수 → workspace 설정(예외) → 앱 기본값 → null(어댑터가 PATH를 뒤진다).
 * wsl (`docs/sdlc/wsl-support/` spec FR-12): 환경변수 → **앱 탭의 WSL claude 경로** → null(WSL 안에서 `command -v`).
 * workspace 예외(`claudePath`)는 Windows 경로라 WSL에는 쓰지 않는다.
 *
 * 환경변수는 e2e가 가짜 CLI를 물리는 통로다. 실행 파일 경로만 바꿀 뿐
 * 권한 플래그는 그대로 적용되므로 새로 생기는 능력은 없다.
 *
 * **앱 기본값은 필수 인자다** (`docs/sdlc/agent-path-default/` FR-1). 선택이면 호출 자리 하나만
 * 빠뜨려도 조용히 컴파일되고, 그러면 설정 화면은 초록인데 실행은 막히는 상태가 생긴다.
 * **실행 환경도 같은 이유로 필수다**(wsl-support FR-9).
 */
export function resolveAgentPath(
  agentKind: AgentKind,
  env: ProcessEnvSpec,
  workspace: PathSource | null,
  appDefaults: AgentDefaults,
  processEnv: NodeJS.ProcessEnv = process.env
): string | null {
  const override = processEnv['ONE_DESK_AGENT_PATH']
  if (override) return override
  if (env.kind === 'wsl') return appDefaults.claudeWsl ?? null
  const configured = agentKind === 'claude-code'
    ? workspace?.claudePath
    : workspace?.opencodePath
  if (configured) return configured
  return (agentKind === 'claude-code' ? appDefaults.claude : appDefaults.opencode) ?? null
}
