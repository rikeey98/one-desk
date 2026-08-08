import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { workspace } from '../schema'
import type { Workspace, CreateWorkspaceInput } from '@shared/models'

export function createWorkspaceRepository(db: Database) {
  return {
    list(): Workspace[] {
      return db.select().from(workspace).orderBy(asc(workspace.name)).all()
    },

    create(input: CreateWorkspaceInput): Workspace {
      const now = Date.now()
      const [row] = db
        .insert(workspace)
        .values({
          id: randomUUID(),
          name: input.name,
          description: input.description ?? null,
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .all()
      if (!row) throw new Error('workspace 생성에 실패했습니다')
      return row
    },

    remove(id: string): void {
      db.delete(workspace).where(eq(workspace.id, id)).run()
    }
  }
}
