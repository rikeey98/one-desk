import type { AgentKind, Workspace } from '@shared/models'

type PathSource = Pick<Workspace, 'claudePath' | 'opencodePath'>

/**
 * 어댑터 preflight에 넘길 명시 경로를 고른다.
 * 우선순위: 환경변수 → workspace 설정 → null(어댑터가 PATH를 뒤진다).
 *
 * 환경변수는 e2e가 가짜 CLI를 물리는 통로다. 실행 파일 경로만 바꿀 뿐
 * 권한 플래그는 그대로 적용되므로 새로 생기는 능력은 없다.
 */
export function resolveAgentPath(
  agentKind: AgentKind,
  workspace: PathSource | null,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const override = env['ONE_DESK_AGENT_PATH']
  if (override) return override
  const configured = agentKind === 'claude-code'
    ? workspace?.claudePath
    : workspace?.opencodePath
  return configured ?? null
}
