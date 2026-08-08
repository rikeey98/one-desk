import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { openDb, type Database } from '../open'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(HERE, '../../../drizzle')

export function makeTestDb(): Database {
  return openDb({ file: ':memory:', migrationsDir: MIGRATIONS_DIR })
}
