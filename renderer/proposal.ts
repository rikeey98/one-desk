import type { IssueProposal, Proposal } from '@shared/models'
import type { Conversation } from './conversation'

/**
 * 대화 칸의 배너 (`docs/sdlc/agent-proposals/` spec FR-21·22). 기존 이슈를 권하는 갈래는 그 이슈가 살아 있을 때만이다 — 지워졌으면
 * payload의 제목으로 새 이슈를 권한다.
 */
export type IssueBanner =
  | { mode: 'new'; proposal: IssueProposal }
  | { mode: 'existing'; proposal: IssueProposal; existing: NonNullable<IssueProposal['existingIssue']> }

/**
 * 이 대화의 기다리는 이슈화 제안 → 배너. 새 대화 칸(conversation null)·할당된 대화에는 없다 — 할당되면 제안 행은 `pending`인 채
 * 숨기만 하고, 할당을 떼면 다시 선다(§6 우려 3).
 */
export function bannerOf(proposals: Proposal[], conversation: Conversation | null): IssueBanner | null {
  if (!conversation || conversation.issue !== null) return null
  const proposal = proposals.find((p) =>
    p.kind === 'conversation-issue' && p.status === 'pending' && p.rootRunId === conversation.id
  )
  if (!proposal) return null
  return proposal.existingIssue
    ? { mode: 'existing', proposal, existing: proposal.existingIssue }
    : { mode: 'new', proposal }
}
