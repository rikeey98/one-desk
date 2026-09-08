import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { repo } from '../schema'
import { NotFoundError } from '../../errors'
import type { Repo, CreateRepoInput } from '@shared/models'

export function createRepoRepository(db: Database) {
  return {
    list(workspaceId: string): Repo[] {
      return db.select().from(repo)
        .where(eq(repo.workspaceId, workspaceId))
        .orderBy(asc(repo.sortOrder), asc(repo.name))
        .all()
    },

    create(input: CreateRepoInput): Repo {
      const [row] = db.insert(repo).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        path: input.path,
        description: input.description ?? null,
        createdAt: Date.now()
      }).returning().all()
      if (!row) throw new Error('repo 생성에 실패했습니다')
      return row
    },

    /**
     * 이름만 바꾼다. workspace 쪽 `rename`과 같은 약속이다 — `path`는 실행이
     * 돌아가는 실제 디렉토리라 이름과 함께 바뀌면 안 되고, 옮기는 것은 지우고
     * 다시 등록하는 일이다.
     */
    rename(id: string, name: string): Repo {
      const trimmed = name.trim()
      if (trimmed === '') throw new Error('이름은 비울 수 없습니다.')

      const [row] = db.update(repo)
        .set({ name: trimmed })
        .where(eq(repo.id, id))
        .returning()
        .all()
      if (!row) throw new NotFoundError(`repo를 찾을 수 없습니다: ${id}`)
      return row
    },

    remove(id: string): void {
      db.delete(repo).where(eq(repo.id, id)).run()
    },

    /**
     * repo가 하나라도 있는 workspace의 id들. 부팅 스캔이 쓴다.
     *
     * workspace 저장소를 끌어들이지 않는 이유: 필요한 것은 "훑을 것이 있는
     * workspace"뿐이고, repo가 없는 workspace는 스캔할 대상이 없다.
     */
    workspaceIds(): string[] {
      return db.selectDistinct({ id: repo.workspaceId }).from(repo).all().map((r) => r.id)
    }
  }
}

export type RepoRepository = ReturnType<typeof createRepoRepository>
