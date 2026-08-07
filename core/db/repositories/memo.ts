import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm'
import type { Database } from '../open'
import { memo, memoRepo } from '../schema'
import type { Memo, CreateMemoInput, UpdateMemoInput, ListQuery } from '@shared/models'

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

  function replaceTags(memoId: string, repoIds: string[]) {
    db.delete(memoRepo).where(eq(memoRepo.memoId, memoId)).run()
    if (repoIds.length > 0) {
      db.insert(memoRepo).values(repoIds.map((repoId) => ({ memoId, repoId }))).run()
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
        .orderBy(desc(memo.updatedAt)).all()
      const tagMap = loadRepoIds(rows.map((r) => r.id))
      return rows.map((r) => ({ ...r, repoIds: tagMap.get(r.id) ?? [] }))
    },

    create(input: CreateMemoInput): Memo {
      const id = randomUUID()
      db.insert(memo).values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body ?? ''
      }).run()
      replaceTags(id, input.repoIds ?? [])
      return getById(id)
    },

    update(input: UpdateMemoInput): Memo {
      const patch: Record<string, unknown> = { updatedAt: Date.now() }
      if (input.title !== undefined) patch['title'] = input.title
      if (input.body !== undefined) patch['body'] = input.body
      db.update(memo).set(patch).where(eq(memo.id, input.id)).run()
      if (input.repoIds !== undefined) replaceTags(input.id, input.repoIds)
      return getById(input.id)
    },

    remove(id: string): void {
      db.delete(memo).where(eq(memo.id, id)).run()
    }
  }
}
