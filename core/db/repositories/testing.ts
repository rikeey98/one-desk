import { openDb, type Database } from '../open'

export function makeTestDb(): Database {
  return openDb({ file: ':memory:', migrationsDir: 'drizzle' })
}
