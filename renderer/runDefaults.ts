import type { AgentKind, Workspace } from '@shared/models'

/**
 * 새 run의 기본값 — 입력부(`RunPanel`)와 정기 실행의 편집 칸(`schedules/form.ts`)이 같이 쓴다 (`docs/sdlc/home/` FR-11, plan 개정 1).
 * 따로 적으면 두 자리가 보여준 모델·effort가 갈린다.
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
