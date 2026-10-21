import type { AgentKind, Permission, Repo, StartRunInput, Workspace } from '@shared/models'
import { agentBlockedReason } from './agentEnv'

/**
 * 새 run의 기본값 — 입력부(`RunPanel`)와 홈의 새 대화 카드(`HomeComposer`)가 같이 쓴다 (`docs/sdlc/home/` FR-11, plan 개정 1).
 * 따로 적으면 홈 카드가 보여준 agent·모델·권한과 실제로 보낸 값이 갈린다.
 */

/**
 * 이 agent에 쓸 workspace 기본 모델. 빈 문자열은 "CLI 자신의 기본값"이다.
 *
 * **컬럼이 agent별로 나뉘어 있는 이유가 여기서 드러난다** — claude는 `sonnet`
 * 같은 별칭을, opencode는 `provider/model`을 쓴다(전체 설계 §199). 한쪽 값을
 * 다른 쪽에 넘기면 그 CLI가 모르는 이름이 되므로, 고르는 기준은 workspace가
 * 아니라 **지금 고른 agent**다.
 */
export function defaultModelOf(workspace: Workspace | null, agentKind: AgentKind): string {
  if (!workspace) return ''
  const value = agentKind === 'opencode'
    ? workspace.defaultModelOpencode
    : workspace.defaultModelClaude
  return value ?? ''
}

/**
 * 이 agent에 쓸 workspace 기본 effort/variant. **모델과 같은 규칙이다.**
 *
 * claude의 `high`와 opencode의 `high`는 다른 것을 가리키므로 컬럼이 갈려 있고
 * (전체 설계 §199), 고르는 기준도 workspace가 아니라 **지금 고른 agent**다.
 */
export function defaultEffortOf(workspace: Workspace | null, agentKind: AgentKind): string {
  if (!workspace) return ''
  const value = agentKind === 'opencode'
    ? workspace.defaultVariantOpencode
    : workspace.defaultEffortClaude
  return value ?? ''
}

/** 홈 카드에서 사람이 바꾼 값. 없으면 workspace 기본값이다 */
export interface RunPicks {
  agentKind?: AgentKind
  model?: string
  effort?: string
  permission?: Permission
}

/**
 * 새 대화 한 턴의 입력. 맥락은 싣지 않는다(홈에는 담을 것이 없다). WSL repo에서는 OpenCode를 띄울 수 없으므로
 * (wsl-support FR-7) 고른 agent가 막히면 Claude Code로 떨어뜨린다 — RunPanel의 effect와 같은 규칙이다.
 * 빈 모델·effort는 null(= 그 인자를 붙이지 않는다)이다.
 */
export function newRunInput(
  workspace: Workspace, repo: Pick<Repo, 'path' | 'agentEnv'>, prompt: string, picks: RunPicks = {}
): StartRunInput {
  const wanted = picks.agentKind ?? workspace.defaultAgentKind
  const agentKind: AgentKind = agentBlockedReason(repo.agentEnv, wanted) ? 'claude-code' : wanted
  const model = (picks.model ?? defaultModelOf(workspace, agentKind)).trim()
  const effort = (picks.effort ?? defaultEffortOf(workspace, agentKind)).trim()
  return {
    workspaceId: workspace.id,
    agentKind,
    model: model || null,
    effort: effort || null,
    cwd: repo.path,
    permission: picks.permission ?? workspace.defaultPermission,
    userPrompt: prompt,
    context: []
  }
}
