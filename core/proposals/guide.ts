/**
 * 이슈 없는 대화의 턴에 붙이는 안내 (`docs/sdlc/agent-proposals/` spec FR-16). 문턱은 문구로만 지킨다(§6 우려 2) — 바꿀 때는 plan
 * 10단계처럼 일 대화·질문 대화로 다시 잰다.
 */
export const PROPOSE_ISSUE_GUIDE = `
이 대화에는 아직 이슈가 없다. 이 대화의 일이 나중에 다시 챙겨야 할 "처리할 일"(고칠 버그, 만들 기능, 이어서 할 작업)이면,
작업을 마친 뒤 propose_issue 도구로 사람에게 이슈로 만들자고 한 번 제안할 것.
- 질문에 답하기, 설명, 잡담, 한 번 확인하고 끝나는 일에는 제안하지 말 것. 애매하면 제안하지 말 것.
- 제안하기 전에 list_issues로 이 workspace의 열린 이슈를 볼 것. 같은 일을 하는 이슈가 있으면 existingIssueId로 그 이슈를 줄 것.
- 제목은 한 줄로, 무엇을 해야 하는지가 드러나게. 본문은 한두 줄.
- 제안했다는 사실을 답에 쓰지 말 것. 사람이 화면에서 따로 본다.
`.trim()

export interface ProposeIssueInput {
  /** MCP가 배선돼 있는가 — 없으면 부를 도구가 없다 */
  mcp: boolean
  /** 이 턴이 끝난 뒤 대화에 할당될 이슈. 새 대화면 자동 할당까지 거친 값이다 */
  assignedIssueId: string | null
  /** 그 대화의 이슈화 제안 — 새 대화는 늘 둘 다 거짓이다 */
  state: { pending: boolean; declined: boolean }
}

/**
 * 이 턴에 안내를 붙이는가 (FR-15). 기다리는 제안이 있는 동안 빼는 것은 사람이 답하기 전에 같은 질문을 다시 묻지 않으려는 것이다.
 * agent·권한을 보지 않는다 — OpenCode도 읽기 전용·편집 허용에서 one-desk MCP 도구가 열려 있다(`opencodePermissionConfig`, spec §8의
 * 6 — 2026-10-27 사용자 결정).
 */
export function shouldProposeIssue(input: ProposeIssueInput): boolean {
  if (!input.mcp) return false
  if (input.assignedIssueId !== null) return false
  return !input.state.pending && !input.state.declined
}
