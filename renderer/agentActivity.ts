import { AGENT_KINDS, AGENT_LABELS } from './agents'
import type { AgentStatuses, McpStatus, QueueSnapshot } from '@shared/models'

/**
 * 사이드바 하단 줄 (`docs/sdlc/agent-status/` FR-1·FR-2, 2026-11-03 개정) — **쓸 수 있는 agent와 MCP만 간략히**:
 * `● Claude Code  ● OpenCode  ● MCP`. 포트·실행 수·대기는 풍선과 패널로 옮겼다(사용자 결정 — 포트는 글자로 볼 일이 드물다).
 *
 * "쓸 수 있다"는 설정 실행 탭의 CLI 상태와 **같은 판정**(`checkAgents` — 실행 파일)이다. 인증·모델(느린 칸)은 보지 않는다 —
 * 하단 줄이 늘 떠 있어 매번 CLI를 띄우면 안 된다(패널을 열면 그 칸까지 보인다).
 *
 * 글자에 `대기 N`을 쓰지 않는다 — 도크의 슬롯 표시기가 `· 대기 N`이고 e2e가 그것을 화면 전체에서 `getByText('대기 1')`로
 * 잡는다(부분 일치). 풍선(title)은 글자가 아니라 괜찮다.
 */
export interface ActivityAgent {
  /** `claude-code` · `opencode` · `wsl` */
  key: string
  label: string
}

export interface ActivityView {
  /** 쓸 수 있는 agent. 아직 판정하지 않았으면(workspace가 없거나 조회 전) null, 하나도 없으면 빈 배열 */
  agents: ActivityAgent[] | null
  /** 도는 agent가 있는가 — MCP 점이 숨쉰다(도는 동안 agent가 MCP로 일한다) */
  busy: boolean
  /** 풍선 — 포트·실행 수·대기는 여기와 패널에만 있다. 접힌 사이드바에서는 이것만 보인다 */
  title: string
}

/** 정보 탭·패널이 쓰는 MCP 한 마디 — `MCP :53021` · `MCP 시작 중` · `MCP 연결 실패` */
export function mcpLabel(status: McpStatus): string {
  return status.state === 'listening' ? `MCP :${status.port}`
    : status.state === 'starting' ? 'MCP 시작 중'
    : 'MCP 연결 실패'
}

/** WSL 줄은 짧게 — 하단 줄의 폭이 좁다. 배포판 이름은 풍선과 패널이 말한다 */
const WSL_LABEL = `${AGENT_LABELS['claude-code']} (WSL)`

/** 실행 파일이 잡힌 agent — 순서는 실행 패널·설정 화면과 같은 표(`AGENT_KINDS`), WSL은 끝 */
export function availableAgents(statuses: AgentStatuses | null): ActivityAgent[] | null {
  if (!statuses) return null
  const out: ActivityAgent[] = AGENT_KINDS
    .filter((kind) => statuses[kind].ok)
    .map((kind) => ({ key: kind, label: AGENT_LABELS[kind] }))
  if (statuses.wsl?.ok) out.push({ key: 'wsl', label: WSL_LABEL })
  return out
}

export function activityView(status: McpStatus, queue: QueueSnapshot | null, statuses: AgentStatuses | null): ActivityView {
  const agents = availableAgents(statuses)
  const parts: string[] = []
  if (agents === null) parts.push('agent 확인 전')
  else if (agents.length === 0) parts.push('쓸 수 있는 agent 없음')
  else {
    const names = agents.map((a) => a.key === 'wsl' && statuses?.wsl ? `${AGENT_LABELS['claude-code']} (WSL · ${statuses.wsl.distro})` : a.label)
    parts.push(names.join(' · '))
  }
  const mcp = mcpLabel(status)
  parts.push(status.state === 'failed' ? `${mcp}: ${status.message}` : mcp)
  if (queue) parts.push(`실행 ${queue.running}/${queue.limit}`)
  if (queue && queue.waiting > 0) parts.push(`대기 ${queue.waiting}`)
  return {
    agents,
    busy: (queue?.running ?? 0) > 0,
    title: `${parts.join(' · ')} — 눌러서 에이전트 현황 보기`
  }
}

/**
 * 하단 줄 버튼의 id — 패널이 "바깥 누르기"에서 이 버튼을 안쪽으로 친다. 바깥으로 치면 누르는 순간 닫혔다가 click이 다시 열어
 * 닫히지 않는 패널이 된다(`ConversationHeader`의 `useDismissOnOutside`와 같은 이유). 버튼과 패널이 다른 컴포넌트라 ref 대신 id다.
 */
export const AGENT_ACTIVITY_TRIGGER_ID = 'agent-activity-trigger'
