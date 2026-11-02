import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { drawing, repo } from '../schema'
import { NotFoundError } from '../../errors'
import { assertScene, EMPTY_SCENE } from '../../drawings/scene'
import { nextDrawingTitle } from '../../drawings/title'
import type {
  CreateDrawingInput, Drawing, DrawingListQuery, DrawingSummary, SaveSceneInput, SaveSceneResult
} from '@shared/models'

/** 충돌을 트랜잭션 밖으로 알리는 신호. 오류가 아니라 예상된 결과다(메모의 것과 같다). */
const CONFLICT = Symbol('conflict')

/** 목록이 싣는 열 — 장면은 하나를 열 때만 나른다 */
const SUMMARY = {
  id: drawing.id,
  workspaceId: drawing.workspaceId,
  repoId: drawing.repoId,
  title: drawing.title,
  createdAt: drawing.createdAt,
  updatedAt: drawing.updatedAt
}

function cleanTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed === '') throw new Error('그림 이름이 비었습니다')
  return trimmed
}

/**
 * repo의 그림 (docs/sdlc/drawings/ spec FR-1~FR-7). 장면 저장은 메모의 `updateIfUnchanged`와 같은 낙관적 잠금이다 — 같은 그림이
 * 코드 칸과 별도 창에 같이 열려 있을 수 있고, 충돌하면 화면이 요소 단위로 합쳐 다시 저장한다(FR-21).
 */
export function createDrawingRepository(db: Database) {
  function getById(id: string): Drawing {
    const row = db.select().from(drawing).where(eq(drawing.id, id)).get()
    if (!row) throw new NotFoundError(`그림을 찾을 수 없습니다: ${id}`)
    return row
  }

  function summaryOf(id: string): DrawingSummary {
    const row = db.select(SUMMARY).from(drawing).where(eq(drawing.id, id)).get()
    if (!row) throw new NotFoundError(`그림을 찾을 수 없습니다: ${id}`)
    return row
  }

  /** updatedAt은 낙관적 잠금의 버전이다 — 같은 밀리초에 두 번 써도 반드시 이전 값보다 크게 (FR-2) */
  const nextUpdatedAt = (previous: number) => Math.max(Date.now(), previous + 1)

  return {
    get: getById,

    list(query: DrawingListQuery): DrawingSummary[] {
      const where = query.repoId
        ? and(eq(drawing.workspaceId, query.workspaceId), eq(drawing.repoId, query.repoId))
        : eq(drawing.workspaceId, query.workspaceId)
      return db.select(SUMMARY).from(drawing).where(where)
        .orderBy(asc(drawing.createdAt), asc(drawing.id)).all()
    },

    create(input: CreateDrawingInput): Drawing {
      const id = randomUUID()
      const now = Date.now()
      db.transaction((tx) => {
        // 외래키는 repo의 존재만 보장하고 소속은 보지 않는다 — 이슈·메모의 태그 검증과 같은 경계다
        const owner = tx.select({ workspaceId: repo.workspaceId }).from(repo).where(eq(repo.id, input.repoId)).get()
        if (!owner || owner.workspaceId !== input.workspaceId) {
          throw new Error(`이 workspace에 속하지 않는 repo입니다: ${input.repoId}`)
        }
        const title = input.title !== undefined
          ? cleanTitle(input.title)
          : nextDrawingTitle(tx.select({ title: drawing.title }).from(drawing)
            .where(eq(drawing.repoId, input.repoId)).all().map((r) => r.title))
        tx.insert(drawing).values({
          id, workspaceId: input.workspaceId, repoId: input.repoId, title, scene: EMPTY_SCENE, createdAt: now, updatedAt: now
        }).run()
      })
      return getById(id)
    },

    rename(id: string, title: string): DrawingSummary {
      const clean = cleanTitle(title)
      const row = db.select({ updatedAt: drawing.updatedAt }).from(drawing).where(eq(drawing.id, id)).get()
      if (!row) throw new NotFoundError(`그림을 찾을 수 없습니다: ${id}`)
      db.update(drawing).set({ title: clean, updatedAt: nextUpdatedAt(row.updatedAt) }).where(eq(drawing.id, id)).run()
      return summaryOf(id)
    },

    /**
     * 내가 읽은 뒤로 바뀌지 않았을 때만 쓴다. better-sqlite3는 동기이고 커넥션이 하나라 트랜잭션 안에서 읽고 쓰는 사이에 다른 JS가
     * 끼어들 수 없다(메모의 `updateIfUnchanged`와 같은 근거).
     */
    saveScene(input: SaveSceneInput): SaveSceneResult {
      assertScene(input.scene)
      try {
        db.transaction((tx) => {
          const row = tx.select({ updatedAt: drawing.updatedAt }).from(drawing).where(eq(drawing.id, input.id)).get()
          if (!row) throw new NotFoundError(`그림을 찾을 수 없습니다: ${input.id}`)
          if (row.updatedAt !== input.expectedUpdatedAt) throw CONFLICT
          tx.update(drawing).set({ scene: input.scene, updatedAt: nextUpdatedAt(row.updatedAt) })
            .where(eq(drawing.id, input.id)).run()
        })
      } catch (err) {
        if (err === CONFLICT) return { ok: false, current: getById(input.id) }
        throw err
      }
      return { ok: true, drawing: summaryOf(input.id) }
    },

    remove(id: string): void {
      db.delete(drawing).where(eq(drawing.id, id)).run()
    }
  }
}

export type DrawingRepository = ReturnType<typeof createDrawingRepository>
