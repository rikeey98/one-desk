import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, issueRepo, repo } from '../schema'
import type { Issue, CreateIssueInput, UpdateIssueInput, ListQuery } from '@shared/models'

/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]

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

  /**
   * 태그로 붙이려는 repo가 전부 같은 workspace 소속인지 확인한다.
   * 외래키는 repo의 존재만 보장하고 소속은 보지 않으므로, 이 검증이 없으면
   * 다른 workspace의 repo id를 그대로 붙일 수 있다 (설계 §8의 보안 경계).
   */
  function assertReposInWorkspace(runner: Runner, workspaceId: string, repoIds: string[]) {
    if (repoIds.length === 0) return
    const found = runner
      .select({ id: repo.id })
      .from(repo)
      .where(and(eq(repo.workspaceId, workspaceId), inArray(repo.id, repoIds)))
      .all()
    const known = new Set(found.map((r) => r.id))
    const outside = repoIds.filter((id) => !known.has(id))
    if (outside.length > 0) {
      throw new Error(`이 workspace에 속하지 않는 repo입니다: ${outside.join(', ')}`)
    }
  }

  function replaceTags(runner: Runner, issueId: string, repoIds: string[]) {
    const unique = [...new Set(repoIds)]
    runner.delete(issueRepo).where(eq(issueRepo.issueId, issueId)).run()
    if (unique.length > 0) {
      runner.insert(issueRepo).values(unique.map((repoId) => ({ issueId, repoId }))).run()
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
      db.transaction((tx) => {
        assertReposInWorkspace(tx, input.workspaceId, input.repoIds ?? [])
        tx.insert(issue).values({
          id,
          workspaceId: input.workspaceId,
          title: input.title,
          body: input.body ?? '',
          createdAt: now,
          updatedAt: now
        }).run()
        replaceTags(tx, id, input.repoIds ?? [])
      })
      return getById(id)
    },

    update(input: UpdateIssueInput): Issue {
      const owner = db
        .select({ workspaceId: issue.workspaceId })
        .from(issue)
        .where(eq(issue.id, input.id))
        .get()
      if (!owner) throw new Error(`이슈를 찾을 수 없습니다: ${input.id}`)

      const patch: Record<string, unknown> = { updatedAt: Date.now() }
      if (input.title !== undefined) patch['title'] = input.title
      if (input.body !== undefined) patch['body'] = input.body
      if (input.status !== undefined) {
        patch['status'] = input.status
        // closedAt은 status에서 파생된다. 호출자가 따로 관리하면 둘이 어긋난다.
        patch['closedAt'] = input.status === 'done' ? Date.now() : null
      }

      db.transaction((tx) => {
        tx.update(issue).set(patch).where(eq(issue.id, input.id)).run()
        if (input.repoIds !== undefined) {
          assertReposInWorkspace(tx, owner.workspaceId, input.repoIds)
          replaceTags(tx, input.id, input.repoIds)
        }
      })
      return getById(input.id)
    },

    remove(id: string): void {
      db.delete(issue).where(eq(issue.id, id)).run()
    }
  }
}

export type IssueRepository = ReturnType<typeof createIssueRepository>
