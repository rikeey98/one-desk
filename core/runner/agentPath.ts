import type { AgentKind, AgentPaths, Workspace } from '@shared/models'

type PathSource = Pick<Workspace, 'claudePath' | 'opencodePath'>

/**
 * 어댑터 preflight에 넘길 명시 경로를 고른다.
 * 우선순위: 환경변수 → workspace 설정(예외) → 앱 기본값 → null(어댑터가 PATH를 뒤진다).
 *
 * 환경변수는 e2e가 가짜 CLI를 물리는 통로다. 실행 파일 경로만 바꿀 뿐
 * 권한 플래그는 그대로 적용되므로 새로 생기는 능력은 없다.
 *
 * **앱 기본값은 필수 인자다** (`docs/sdlc/agent-path-default/` FR-1). 선택이면 호출 자리 하나만
 * 빠뜨려도 조용히 컴파일되고, 그러면 설정 화면은 초록인데 실행은 막히는 상태가 생긴다.
 */
export function resolveAgentPath(
  agentKind: AgentKind,
  workspace: PathSource | null,
  appDefaults: AgentPaths,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const override = env['ONE_DESK_AGENT_PATH']
  if (override) return override
  const configured = agentKind === 'claude-code'
    ? workspace?.claudePath
    : workspace?.opencodePath
  if (configured) return configured
  return (agentKind === 'claude-code' ? appDefaults.claude : appDefaults.opencode) ?? null
}
