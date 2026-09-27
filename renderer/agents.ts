import type { AgentKind } from '@shared/models'

/**
 * agent의 화면 이름 (`docs/sdlc/conversation-timeline/` spec FR-46).
 *
 * 대화 헤더의 부제·턴의 메타 줄·실행 패널의 옵션·설정 화면·`AgentStatusList`가 이 표
 * 하나를 쓴다 — 한 enum을 여러 곳에 옮겨 적으면 한 곳만 고쳐지는 날이 온다
 * (`permission.ts`와 같은 이유).
 */
export const AGENT_LABELS: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  opencode: 'OpenCode'
}

/**
 * 고르는 칸에 늘어놓는 순서 — 실행 패널·설정 화면의 드롭다운과 CLI 상태 목록이 같은 순서다.
 * 표(`AGENT_LABELS`)의 키 순서에 기대지 않고 따로 적는다: 객체 키 순서가 곧 화면 순서라는
 * 가정은 누가 표를 정렬하는 날 조용히 깨진다.
 */
export const AGENT_KINDS: readonly AgentKind[] = ['claude-code', 'opencode']
