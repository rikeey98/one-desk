import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, proposal } from '../schema'
import { NotFoundError, type ErrorSink } from '../../errors'
import { parseIssuePayload } from '../../proposals/payload'
import type { ConversationIssuePayload, IssueProposal, Proposal } from '@shared/models'

type Row = typeof proposal.$inferSelect

export interface CreateIssueProposalInput {
  workspaceId: string
  rootRunId: string
  runId: string
  payload: ConversationIssuePayload
}

/** 그 대화의 이슈화 제안이 기다리는가·거절됐는가 — 안내(`shouldProposeIssue`)와 도구가 본다. payload를 읽지 않는다 */
export function proposalStateOf(db: Database, rootRunId: string): { pending: boolean; declined: boolean } {
  const rows = db.select({ status: proposal.status }).from(proposal)
    .where(and(eq(proposal.rootRunId, rootRunId), eq(proposal.kind, 'conversation-issue'))).all()
  return {
    pending: rows.some((r) => r.status === 'pending'),
    declined: rows.some((r) => r.status === 'declined')
  }
}

/**
 * 제안 저장소 (`docs/sdlc/agent-proposals/` spec FR-1~4). 깨진 payload는 일어나면 결함이라 `onError`가 필수다 — 목록에서는 그 행을
 * 빼고 알린다(FR-2).
 */
export function createProposalRepository(db: Database, onError: ErrorSink) {
  /** 기존 이슈를 `inArray` 한 번으로 붙인다(N+1 없음, NFR-7). 같은 workspace의 살아 있는 이슈만 */
  function hydrate(rows: Row[]): Proposal[] {
    const parsed = rows.flatMap((r) => {
      const payload = parseIssuePayload(r.payload)
      if (!payload) {
        onError('제안 payload를 읽지 못했습니다', new Error(`proposal ${r.id}`))
        return []
      }
      return [{ row: r, payload }]
    })
    const ids = [...new Set(parsed.flatMap((p) => (p.payload.existingIssueId ? [p.payload.existingIssueId] : [])))]
    const found = ids.length === 0 ? [] : db
      .select({ id: issue.id, title: issue.title, status: issue.status, workspaceId: issue.workspaceId })
      .from(issue).where(inArray(issue.id, ids)).all()
    const byId = new Map(found.map((i) => [i.id, i]))
    return parsed.map(({ row, payload }): IssueProposal => {
      const hit = payload.existingIssueId ? byId.get(payload.existingIssueId) : undefined
      return {
        id: row.id, workspaceId: row.workspaceId, rootRunId: row.rootRunId, runId: row.runId,
        status: row.status, createdAt: row.createdAt, decidedAt: row.decidedAt,
        kind: 'conversation-issue',
        payload,
        existingIssue: hit && hit.workspaceId === row.workspaceId ? { id: hit.id, title: hit.title, status: hit.status } : null
      }
    })
  }

  function get(id: string): Proposal {
    const row = db.select().from(proposal).where(eq(proposal.id, id)).get()
    if (!row) throw new NotFoundError(`제안을 찾을 수 없습니다: ${id}`)
    const [one] = hydrate([row])
    if (!one) throw new Error(`제안 payload를 읽지 못했습니다: ${id}`)
    return one
  }

  return {
    /**
     * 같은 대화의 기다리는 이슈화 제안을 `superseded`로 내리고 새 행을 넣는다 — 한 트랜잭션 (FR-4). 제자리 갱신이 아니라 새 행인 것은
     * 배너의 제목 칸이 제안 id를 key로 잡기 때문이다.
     */
    createIssueProposal(input: CreateIssueProposalInput): Proposal {
      const id = randomUUID()
      const now = Date.now()
      db.transaction((tx) => {
        tx.update(proposal).set({ status: 'superseded', decidedAt: now })
          .where(and(
            eq(proposal.rootRunId, input.rootRunId),
            eq(proposal.kind, 'conversation-issue'),
            eq(proposal.status, 'pending')
          )).run()
        tx.insert(proposal).values({
          id, workspaceId: input.workspaceId, rootRunId: input.rootRunId, runId: input.runId,
          kind: 'conversation-issue', payload: JSON.stringify(input.payload), status: 'pending', createdAt: now
        }).run()
      })
      return get(id)
    },

    get,

    /** 그 workspace의 기다리는 제안, 오래된 순 (FR-20) */
    pendingIn(workspaceId: string): Proposal[] {
      return hydrate(db.select().from(proposal)
        .where(and(eq(proposal.workspaceId, workspaceId), eq(proposal.status, 'pending')))
        .orderBy(asc(proposal.createdAt)).all())
    },

    stateOf: (rootRunId: string) => proposalStateOf(db, rootRunId),

    /** 받거나 거절한다. `pending`이 아니면 던진다 — 두 번 눌러 둘째가 이슈를 하나 더 만들지 않게 (FR-17·19) */
    decide(id: string, status: 'accepted' | 'declined'): Proposal {
      const current = get(id)
      if (current.status !== 'pending') throw new Error('이미 처리된 제안입니다')
      db.update(proposal).set({ status, decidedAt: Date.now() }).where(eq(proposal.id, id)).run()
      return get(id)
    }
  }
}

export type ProposalRepository = ReturnType<typeof createProposalRepository>
