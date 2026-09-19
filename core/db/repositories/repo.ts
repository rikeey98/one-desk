import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { repo } from '../schema'
import { NotFoundError } from '../../errors'
import { moveAssetPathPrefix } from './asset'
import type { Repo, CreateRepoInput, UpdateRepoInput } from '@shared/models'

export function createRepoRepository(db: Database) {
  return {
    list(workspaceId: string): Repo[] {
      return db.select().from(repo)
        .where(eq(repo.workspaceId, workspaceId))
        .orderBy(asc(repo.sortOrder), asc(repo.name))
        .all()
    },

    /** 메인 프로세스가 id만 들고 경로를 찾을 때 쓴다 (VS Code로 열기). */
    get(id: string): Repo {
      const row = db.select().from(repo).where(eq(repo.id, id)).get()
      if (!row) throw new NotFoundError(`repo를 찾을 수 없습니다: ${id}`)
      return row
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

    /**
     * 넘어온 필드만 고친다. `rename`이 "path는 건드리지 않는다"고 못 박은 자리를
     * 설정 화면의 repo 탭이 여는 것이다 (settings-screen spec FR-8).
     *
     * 경로가 바뀌면 그 아래 asset의 `file_path`를 **같은 트랜잭션에서** 옮긴다(FR-9).
     * 따로 커밋되면 절반만 반영돼 목록이 두 벌이 된다. 경로가 실제로 존재하는지는
     * 여기서 보지 않는다 — 파일시스템은 core 표면의 몫이다.
     */
    update(id: string, patch: Omit<UpdateRepoInput, 'id'>): Repo {
      const set: Partial<Pick<Repo, 'name' | 'path' | 'description'>> = {}
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim()
        if (trimmed === '') throw new Error('이름은 비울 수 없습니다.')
        set.name = trimmed
      }
      if (patch.path !== undefined) {
        const trimmed = patch.path.trim()
        if (trimmed === '') throw new Error('경로는 비울 수 없습니다.')
        set.path = trimmed
      }
      if (patch.description !== undefined) set.description = patch.description

      return db.transaction((tx) => {
        const current = tx.select().from(repo).where(eq(repo.id, id)).get()
        if (!current) throw new NotFoundError(`repo를 찾을 수 없습니다: ${id}`)

        if (set.path !== undefined && set.path !== current.path) {
          moveAssetPathPrefix(tx, {
            workspaceId: current.workspaceId, repoId: id, from: current.path, to: set.path
          })
        }
        if (Object.keys(set).length === 0) return current

        const [row] = tx.update(repo).set(set).where(eq(repo.id, id)).returning().all()
        if (!row) throw new NotFoundError(`repo를 찾을 수 없습니다: ${id}`)
        return row
      })
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
