import { existsSync, copyFileSync } from 'node:fs'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export interface OpenDbOptions {
  /** DB 파일 경로. ':memory:'면 인메모리. */
  file: string
  /** 생성된 마이그레이션 디렉토리 */
  migrationsDir: string
}

export type Database = ReturnType<typeof openDb>

export function openDb(opts: OpenDbOptions) {
  backupIfNeeded(opts.file)

  const sqlite = new BetterSqlite3(opts.file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: opts.migrationsDir })
  return db
}

/**
 * 마이그레이션 적용 전에 DB를 복제해둔다 (설계 §11).
 * 로컬 SQLite 하나에 모든 기록이 들어 있으므로 여기는 타협하지 않는다.
 */
function backupIfNeeded(file: string) {
  if (file === ':memory:' || !existsSync(file)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(file, `${file}.${stamp}.bak`)
}
