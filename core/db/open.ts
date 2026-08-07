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

  // WAL 모드에서는 체크포인트되지 않은 데이터가 -wal 파일에만 있을 수 있다
  // (자동 체크포인트 임계값은 기본 1000페이지). 크래시 등으로 정상 종료되지
  // 않았다면 .db 파일만 복사해서는 테이블조차 없는 백업이 만들어진다.
  // 복사 전에 짧게 열어 WAL 내용을 메인 파일로 합친다.
  const walDb = new BetterSqlite3(file)
  try {
    walDb.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    walDb.close()
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(file, `${file}.${stamp}.bak`)
}
