import { join } from 'node:path'
import { openDb } from './db/open'
import { createWorkspaceRepository } from './db/repositories/workspace'

export interface CoreOptions {
  /** DB와 로그를 둘 디렉토리. Electron의 userData 경로를 main이 넘긴다. */
  dataDir: string
  /** 마이그레이션 디렉토리 (패키징 시 위치가 달라진다) */
  migrationsDir: string
}

export function createCore(opts: CoreOptions) {
  const db = openDb({
    file: join(opts.dataDir, 'one-desk.db'),
    migrationsDir: opts.migrationsDir
  })

  return {
    workspaces: createWorkspaceRepository(db)
  }
}

export type Core = ReturnType<typeof createCore>
