import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm'
import type { Database } from '../open'
import { memo, memoRepo, repo } from '../schema'
import type { Memo, CreateMemoInput, UpdateMemoInput, ListQuery } from '@shared/models'

/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]

export function createMemoRepository(db: Database) {
  function loadRepoIds(memoIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (memoIds.length === 0) return map
    const rows = db.select().from(memoRepo)
      .where(inArray(memoRepo.memoId, memoIds)).all()
    for (const row of rows) {
      const list = map.get(row.memoId) ?? []
      list.push(row.repoId)
      map.set(row.memoId, list)
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

  function replaceTags(runner: Runner, memoId: string, repoIds: string[]) {
    const unique = [...new Set(repoIds)]
    runner.delete(memoRepo).where(eq(memoRepo.memoId, memoId)).run()
    if (unique.length > 0) {
      runner.insert(memoRepo).values(unique.map((repoId) => ({ memoId, repoId }))).run()
    }
  }

  function getById(id: string): Memo {
    const row = db.select().from(memo).where(eq(memo.id, id)).get()
    if (!row) throw new Error(`메모를 찾을 수 없습니다: ${id}`)
    return { ...row, repoIds: loadRepoIds([id]).get(id) ?? [] }
  }

  return {
    list(query: ListQuery): Memo[] {
      const taggedWithRepo = db.select({ id: memoRepo.memoId }).from(memoRepo)
        .where(eq(memoRepo.repoId, query.repoId ?? ''))
      const taggedWithAny = db.select({ id: memoRepo.memoId }).from(memoRepo)

      const where = query.repoId
        ? and(
            eq(memo.workspaceId, query.workspaceId),
            or(inArray(memo.id, taggedWithRepo), notInArray(memo.id, taggedWithAny))
          )
        : eq(memo.workspaceId, query.workspaceId)

      const rows = db.select().from(memo).where(where)
        .orderBy(desc(memo.updatedAt), desc(memo.createdAt)).all()
      const tagMap = loadRepoIds(rows.map((r) => r.id))
      return rows.map((r) => ({ ...r, repoIds: tagMap.get(r.id) ?? [] }))
    },

    create(input: CreateMemoInput): Memo {
      const id = randomUUID()
      const now = Date.now()
      db.transaction((tx) => {
        assertReposInWorkspace(tx, input.workspaceId, input.repoIds ?? [])
        tx.insert(memo).values({
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

    update(input: UpdateMemoInput): Memo {
      const owner = db
        .select({ workspaceId: memo.workspaceId })
        .from(memo)
        .where(eq(memo.id, input.id))
        .get()
      if (!owner) throw new Error(`메모를 찾을 수 없습니다: ${input.id}`)

      const patch: Record<string, unknown> = { updatedAt: Date.now() }
      if (input.title !== undefined) patch['title'] = input.title
      if (input.body !== undefined) patch['body'] = input.body

      db.transaction((tx) => {
        tx.update(memo).set(patch).where(eq(memo.id, input.id)).run()
        if (input.repoIds !== undefined) {
          assertReposInWorkspace(tx, owner.workspaceId, input.repoIds)
          replaceTags(tx, input.id, input.repoIds)
        }
      })
      return getById(input.id)
    },

    remove(id: string): void {
      db.delete(memo).where(eq(memo.id, id)).run()
    }
  }
}
