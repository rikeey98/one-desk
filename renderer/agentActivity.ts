import type { McpStatus, QueueSnapshot } from '@shared/models'

/**
 * 사이드바 하단 줄 (`docs/sdlc/agent-status/` FR-1·FR-2) — MCP 서버와 agent 실행 현황을 한 줄로.
 *
 * 글자에 `대기 N`을 쓰지 않는다 — 도크의 슬롯 표시기가 `· 대기 N`이고 e2e가 그것을 화면 전체에서 `getByText('대기 1')`로
 * 잡는다(부분 일치). 그래서 이 줄은 `+N 대기`다.
 */
export interface ActivityView {
  /** `MCP :53021` · `MCP 시작 중` · `MCP 연결 실패` — 정보 탭과 같은 말 */
  mcp: string
  /** `실행 1/3` — 스냅샷을 아직 못 받았으면 null */
  activity: string | null
  /** `+2 대기` — 대기가 없으면 null */
  waiting: string | null
  /** 도는 agent가 있는가 — 점이 숨쉰다 */
  busy: boolean
  /** 풍선 — 접힌 사이드바에서는 이것만 보인다 */
  title: string
}

export function mcpLabel(status: McpStatus): string {
  return status.state === 'listening' ? `MCP :${status.port}`
    : status.state === 'starting' ? 'MCP 시작 중'
    : 'MCP 연결 실패'
}

export function activityView(status: McpStatus, queue: QueueSnapshot | null): ActivityView {
  const mcp = mcpLabel(status)
  const activity = queue ? `실행 ${queue.running}/${queue.limit}` : null
  const waiting = queue && queue.waiting > 0 ? `+${queue.waiting} 대기` : null
  const parts = [status.state === 'failed' ? `${mcp}: ${status.message}` : mcp]
  if (activity) parts.push(activity)
  if (waiting) parts.push(waiting)
  return {
    mcp,
    activity,
    waiting,
    busy: (queue?.running ?? 0) > 0,
    title: `${parts.join(' · ')} — 눌러서 에이전트 현황 보기`
  }
}

/**
 * 하단 줄 버튼의 id — 패널이 "바깥 누르기"에서 이 버튼을 안쪽으로 친다. 바깥으로 치면 누르는 순간 닫혔다가 click이 다시 열어
 * 닫히지 않는 패널이 된다(`ConversationHeader`의 `useDismissOnOutside`와 같은 이유). 버튼과 패널이 다른 컴포넌트라 ref 대신 id다.
 */
export const AGENT_ACTIVITY_TRIGGER_ID = 'agent-activity-trigger'
