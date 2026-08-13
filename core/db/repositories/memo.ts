import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm'
import type { Database } from '../open'
import { memo, memoRepo, repo } from '../schema'
import { NotFoundError } from '../../errors'
import type {
  Memo, CreateMemoInput, UpdateMemoInput, ListQuery,
  GuardedUpdateMemoInput, MemoUpdateResult
} from '@shared/models'

/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]

/** 충돌을 트랜잭션 밖으로 알리는 신호. 오류가 아니라 예상된 결과다. */
const CONFLICT = Symbol('conflict')

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
    if (!row) throw new NotFoundError(`메모를 찾을 수 없습니다: ${id}`)
    return { ...row, repoIds: loadRepoIds([id]).get(id) ?? [] }
  }

  /**
   * UpdateMemoInput을 SET 절로 바꾼다. update와 updateIfUnchanged가 함께 쓴다.
   *
   * updatedAt은 낙관적 잠금의 버전 노릇도 한다 (설계 §6). 같은 밀리초에 두 번 쓰면
   * 값이 같아져 "그 사이 바뀌었다"를 놓치므로 반드시 이전 값보다 크게 만든다.
   */
  function buildPatch(input: UpdateMemoInput, previousUpdatedAt: number): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      updatedAt: Math.max(Date.now(), previousUpdatedAt + 1)
    }
    if (input.title !== undefined) patch['title'] = input.title
    if (input.body !== undefined) patch['body'] = input.body
    return patch
  }

  return {
    /** id로 하나를 집어온다. workspace 소속은 보지 않는다 — 부르는 쪽의 책임이다. */
    get: getById,

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
        .select({ workspaceId: memo.workspaceId, updatedAt: memo.updatedAt })
        .from(memo)
        .where(eq(memo.id, input.id))
        .get()
      if (!owner) throw new NotFoundError(`메모를 찾을 수 없습니다: ${input.id}`)

      const patch = buildPatch(input, owner.updatedAt)

      db.transaction((tx) => {
        tx.update(memo).set(patch).where(eq(memo.id, input.id)).run()
        if (input.repoIds !== undefined) {
          assertReposInWorkspace(tx, owner.workspaceId, input.repoIds)
          replaceTags(tx, input.id, input.repoIds)
        }
      })
      return getById(input.id)
    },

    /**
     * 내가 읽은 뒤로 바뀌지 않았을 때만 갱신한다 (설계 §6).
     *
     * 읽고 나서 쓰는데도 경합이 없다 — better-sqlite3는 동기이고 커넥션이 하나뿐이라
     * db.transaction 안에서는 다른 JS가 끼어들 수 없다. 조건부 UPDATE의 영향 행 수를
     * 세는 방법도 되지만, 읽는 쪽이 분명하고 충돌 시 돌려줄 최신 행이 이미 손에 있다.
     */
    updateIfUnchanged(input: GuardedUpdateMemoInput): MemoUpdateResult {
      try {
        db.transaction((tx) => {
          const row = tx
            .select({ workspaceId: memo.workspaceId, updatedAt: memo.updatedAt })
            .from(memo)
            .where(eq(memo.id, input.id))
            .get()
          if (!row) throw new NotFoundError(`메모를 찾을 수 없습니다: ${input.id}`)
          // 던져야 트랜잭션이 롤백된다. 여기서 return하면 앞선 쓰기가 남는다.
          if (row.updatedAt !== input.expectedUpdatedAt) throw CONFLICT

          tx.update(memo).set(buildPatch(input, row.updatedAt))
            .where(eq(memo.id, input.id)).run()
          if (input.repoIds !== undefined) {
            assertReposInWorkspace(tx, row.workspaceId, input.repoIds)
            replaceTags(tx, input.id, input.repoIds)
          }
        })
      } catch (err) {
        if (err === CONFLICT) return { ok: false, current: getById(input.id) }
        throw err
      }
      return { ok: true, memo: getById(input.id) }
    },

    remove(id: string): void {
      db.delete(memo).where(eq(memo.id, id)).run()
    }
  }
}

export type MemoRepository = ReturnType<typeof createMemoRepository>
