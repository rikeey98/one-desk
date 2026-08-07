import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { repo } from '../schema'
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
        description: input.description ?? null
      }).returning().all()
      if (!row) throw new Error('repo 생성에 실패했습니다')
      return row
    },

    remove(id: string): void {
      db.delete(repo).where(eq(repo.id, id)).run()
    }
  }
}
