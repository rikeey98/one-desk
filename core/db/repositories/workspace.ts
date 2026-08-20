import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { workspace } from '../schema'
import { NotFoundError } from '../../errors'
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

    /**
     * 이름만 바꾼다. `update`가 아니라 `rename`인 것은 의도된 것이다 —
     * description·기본 권한까지 열면 호출자마다 다른 부분 갱신을 보내게 되고,
     * 그때 무엇이 덮이는지가 흐려진다. 필요해지면 그때 넓힌다.
     */
    rename(id: string, name: string): Workspace {
      const trimmed = name.trim()
      // 빈 이름을 허용하면 사이드바에 아무것도 안 적힌 줄이 남아 고를 수는 있는데
      // 무엇인지 알 수 없는 workspace가 된다.
      if (trimmed === '') throw new Error('이름은 비울 수 없습니다.')

      const [row] = db.update(workspace)
        .set({ name: trimmed, updatedAt: Date.now() })
        .where(eq(workspace.id, id))
        .returning()
        .all()
      // 조용히 넘어가면 화면이 왜 그대로인지 사용자도 우리도 알 수 없다.
      if (!row) throw new NotFoundError(`workspace를 찾을 수 없습니다: ${id}`)
      return row
    },

    remove(id: string): void {
      db.delete(workspace).where(eq(workspace.id, id)).run()
    }
  }
}
