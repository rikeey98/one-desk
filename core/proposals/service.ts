import type { Database } from '../db/open'
import type { RunRepository } from '../db/repositories/run'
import type { IssueRepository } from '../db/repositories/issue'
import type { RepoRepository } from '../db/repositories/repo'
import type { ProposalRepository } from '../db/repositories/proposal'
import type { AcceptIssueProposal, Issue, Proposal, Run } from '@shared/models'

export interface ProposalServiceDeps {
  db: Database
  /**
   * **전부 감싸지 않은 저장소다** (`docs/sdlc/agent-proposals/` FR-18) — 트랜잭션 안에서 감싼 저장소가 알리면 되돌린 쓰기를 화면이
   * 다시 읽는다. 알림은 core가 트랜잭션이 끝난 뒤 한 번 낸다.
   */
  runs: RunRepository
  issues: IssueRepository
  proposals: ProposalRepository
  /** 제안 뒤에 지워진 repo를 걸러 낸다 — 남겨 두면 이슈 만들기가 소속 검증에 걸려 받기가 통째로 실패한다 */
  repos: RepoRepository
}

export interface AcceptResult {
  issue: Issue
  conversation: Run
  /** 새 이슈를 만들었는가 — core가 `issue` 바뀜 알림을 낼지 정한다 */
  created: boolean
}

/** 사람이 고친 제목. 제안 payload와 같은 규칙이다(한 줄, 1~200자) */
function titleOf(raw: string): string {
  const title = raw.trim()
  if (title === '') throw new Error('제목이 비었습니다')
  if (title.includes('\n')) throw new Error('제목은 한 줄이어야 합니다')
  if (title.length > 200) throw new Error('제목은 200자를 넘을 수 없습니다')
  return title
}

export function createProposalService(deps: ProposalServiceDeps) {
  return {
    /**
     * 받는다 (FR-17) — **한 트랜잭션**에서 이슈를 만들거나 고르고 → 뿌리에 할당하고 → 제안을 `accepted`로. 저장소마다 제
     * `db.transaction`을 쓰지만 better-sqlite3가 안쪽을 savepoint로 바꿔 바깥 하나가 전부를 되돌린다(plan 0단계 실측).
     */
    accept(id: string, choice: AcceptIssueProposal): AcceptResult {
      return deps.db.transaction(() => {
        const proposal = deps.proposals.get(id)
        if (proposal.kind !== 'conversation-issue') throw new Error(`이 종류의 제안은 받을 수 없습니다: ${String(proposal.kind)}`)
        // 사람이 `⋯`로 먼저 붙였을 수 있다
        if (deps.runs.get(proposal.rootRunId).issue !== null) throw new Error('이 대화에는 이미 이슈가 할당돼 있습니다')

        let issue: Issue
        if (choice.mode === 'existing') {
          if (proposal.existingIssue === null) throw new Error('제안한 이슈가 지워졌습니다')
          issue = deps.issues.get(proposal.existingIssue.id)
        } else {
          const { payload } = proposal
          const living = new Set(deps.repos.list(proposal.workspaceId).map((r) => r.id))
          issue = deps.issues.create({
            workspaceId: proposal.workspaceId,
            title: titleOf(choice.title),
            body: payload.body,
            repoIds: payload.repoIds.filter((r) => living.has(r)),
            // 셋을 다 주면 triagedAt이 파생돼 훑기를 건너뛴다 — create_issue와 같은 규칙(spec §6 우려 8)
            ...(payload.source ? { source: payload.source } : {}),
            ...(payload.kind ? { kind: payload.kind } : {}),
            ...(payload.priority ? { priority: payload.priority } : {})
          })
        }
        const conversation = deps.runs.assignIssue(proposal.rootRunId, issue.id)
        // pending이 아니면 decide가 던진다 — 두 번 눌러도 이슈는 하나다(바깥 트랜잭션이 만든 것을 되돌린다)
        deps.proposals.decide(id, 'accepted')
        return { issue, conversation, created: choice.mode === 'new' }
      })
    },

    /** 거절한다 (FR-19). 되돌리는 길이 없다 — 그 대화에 영구히 남고 안내와 도구가 그것을 본다 */
    decline(id: string): Proposal {
      return deps.proposals.decide(id, 'declined')
    },

    pending: (workspaceId: string): Proposal[] => deps.proposals.pendingIn(workspaceId)
  }
}

export type ProposalService = ReturnType<typeof createProposalService>
