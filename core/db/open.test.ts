import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { openDb } from './open'
import { workspace } from './schema'

describe('openDb', () => {
  it('인메모리 DB에 마이그레이션을 적용하고 테이블을 만든다', () => {
    const db = openDb({ file: ':memory:', migrationsDir: 'drizzle' })
    const rows = db.select().from(workspace).all()
    expect(rows).toEqual([])
  })

  it('외래키 제약을 켠다', () => {
    const db = openDb({ file: ':memory:', migrationsDir: 'drizzle' })
    const [row] = db.$client.pragma('foreign_keys') as Array<{ foreign_keys: number }>
    expect(row?.foreign_keys).toBe(1)
  })
})

describe('openDb 백업', () => {
  function makeTempDir() {
    return mkdtempSync(join(tmpdir(), 'one-desk-open-test-'))
  }

  function listBakFiles(dir: string) {
    return readdirSync(dir).filter((name) => name.endsWith('.bak'))
  }

  it('기존 DB 파일이 있을 때 백업이 만들어진다', () => {
    const dir = makeTempDir()
    try {
      const file = join(dir, 'test.db')

      const db1 = openDb({ file, migrationsDir: 'drizzle' })
      db1.$client.close()
      expect(listBakFiles(dir)).toEqual([])

      const db2 = openDb({ file, migrationsDir: 'drizzle' })
      db2.$client.close()

      expect(listBakFiles(dir).length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('백업 내용이 원본과 같다', () => {
    const dir = makeTempDir()
    try {
      const file = join(dir, 'test.db')

      const db1 = openDb({ file, migrationsDir: 'drizzle' })
      db1.insert(workspace).values({ id: 'ws-1', name: '백업 테스트' }).run()
      // WAL 내용을 메인 db 파일로 완전히 반영해야 백업 파일이 데이터를 담는다.
      db1.$client.pragma('wal_checkpoint(TRUNCATE)')
      db1.$client.close()
      const originalBytes = readFileSync(file)

      const db2 = openDb({ file, migrationsDir: 'drizzle' })
      db2.$client.close()

      const [bakName] = listBakFiles(dir)
      if (!bakName) throw new Error('백업 파일이 생성되지 않았다')
      const backupPath = join(dir, bakName)
      const backupBytes = readFileSync(backupPath)

      expect(backupBytes.equals(originalBytes)).toBe(true)

      const backupDb = new BetterSqlite3(backupPath)
      try {
        const rows = backupDb.prepare('SELECT id, name FROM workspace').all()
        expect(rows).toEqual([{ id: 'ws-1', name: '백업 테스트' }])
      } finally {
        backupDb.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('신규 파일을 열 때는 백업을 만들지 않는다', () => {
    const dir = makeTempDir()
    try {
      const file = join(dir, 'brand-new.db')

      const db = openDb({ file, migrationsDir: 'drizzle' })
      db.$client.close()

      expect(listBakFiles(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
