import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, issueRepo } from '../schema'
import type { Issue, CreateIssueInput, UpdateIssueInput, ListQuery } from '@shared/models'

export function createIssueRepository(db: Database) {
  /** 여러 이슈의 repoIds를 한 번의 쿼리로 모아온다 (N+1 방지). */
  function loadRepoIds(issueIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (issueIds.length === 0) return map
    const rows = db.select().from(issueRepo)
      .where(inArray(issueRepo.issueId, issueIds)).all()
    for (const row of rows) {
      const list = map.get(row.issueId) ?? []
      list.push(row.repoId)
      map.set(row.issueId, list)
    }
    return map
  }

  function replaceTags(issueId: string, repoIds: string[]) {
    db.delete(issueRepo).where(eq(issueRepo.issueId, issueId)).run()
    if (repoIds.length > 0) {
      db.insert(issueRepo).values(repoIds.map((repoId) => ({ issueId, repoId }))).run()
    }
  }

  function getById(id: string): Issue {
    const row = db.select().from(issue).where(eq(issue.id, id)).get()
    if (!row) throw new Error(`이슈를 찾을 수 없습니다: ${id}`)
    return { ...row, repoIds: loadRepoIds([id]).get(id) ?? [] }
  }

  return {
    list(query: ListQuery): Issue[] {
      // repo 필터: 그 repo에 태그된 것 + 어디에도 태그되지 않은 공통 항목 (설계 §9)
      const taggedWithRepo = db.select({ id: issueRepo.issueId }).from(issueRepo)
        .where(eq(issueRepo.repoId, query.repoId ?? ''))
      const taggedWithAny = db.select({ id: issueRepo.issueId }).from(issueRepo)

      const where = query.repoId
        ? and(
            eq(issue.workspaceId, query.workspaceId),
            or(inArray(issue.id, taggedWithRepo), notInArray(issue.id, taggedWithAny))
          )
        : eq(issue.workspaceId, query.workspaceId)

      const rows = db.select().from(issue).where(where)
        .orderBy(desc(issue.updatedAt), desc(issue.createdAt)).all()

      const tagMap = loadRepoIds(rows.map((r) => r.id))
      return rows.map((r) => ({ ...r, repoIds: tagMap.get(r.id) ?? [] }))
    },

    create(input: CreateIssueInput): Issue {
      const id = randomUUID()
      const now = Date.now()
      db.insert(issue).values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body ?? '',
        createdAt: now,
        updatedAt: now
      }).run()
      replaceTags(id, input.repoIds ?? [])
      return getById(id)
    },

    update(input: UpdateIssueInput): Issue {
      const patch: Record<string, unknown> = { updatedAt: Date.now() }
      if (input.title !== undefined) patch['title'] = input.title
      if (input.body !== undefined) patch['body'] = input.body
      if (input.status !== undefined) {
        patch['status'] = input.status
        // closedAt은 status에서 파생된다. 호출자가 따로 관리하면 둘이 어긋난다.
        patch['closedAt'] = input.status === 'done' ? Date.now() : null
      }

      db.update(issue).set(patch).where(eq(issue.id, input.id)).run()
      if (input.repoIds !== undefined) replaceTags(input.id, input.repoIds)
      return getById(input.id)
    },

    remove(id: string): void {
      db.delete(issue).where(eq(issue.id, id)).run()
    }
  }
}
