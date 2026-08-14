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

  it('크래시로 정상 종료되지 않아 WAL이 체크포인트되지 않았어도 백업에 전체 데이터가 담긴다', () => {
    const dir = makeTempDir()
    // db1은 백업이 만들어지는 동안 열려 있어야 한다. 단언이 다 끝난 뒤에야
    // 닫는다 — Windows는 열린 핸들이 있는 파일을 지우지 못해(EBUSY) 정리가
    // 실패하고, 그러면 플랫폼 무관한 이 단언까지 같이 빨개진다.
    let db1: ReturnType<typeof openDb> | null = null
    try {
      const file = join(dir, 'test.db')

      db1 = openDb({ file, migrationsDir: 'drizzle' })
      db1.insert(workspace).values({ id: 'ws-1', name: '크래시 테스트' }).run()
      // 의도적으로 close()를 호출하지 않는다. better-sqlite3는 마지막 연결을
      // close()할 때 자동으로 체크포인트하므로, 정상 종료 시나리오만으로는
      // 이 결함(WAL 미체크포인트 상태의 백업)을 재현할 수 없다.
      // SIGKILL로 프로세스가 죽으면 close()가 호출되지 않아 데이터가
      // -wal 파일에만 남는데, 그 상황을 그대로 흉내낸다.

      const db2 = openDb({ file, migrationsDir: 'drizzle' })
      db2.$client.close()

      const [bakName] = listBakFiles(dir)
      if (!bakName) throw new Error('백업 파일이 생성되지 않았다')
      const backupPath = join(dir, bakName)

      const backupDb = new BetterSqlite3(backupPath, { readonly: true })
      try {
        const rows = backupDb.prepare('SELECT id, name FROM workspace').all()
        expect(rows).toEqual([{ id: 'ws-1', name: '크래시 테스트' }])
      } finally {
        backupDb.close()
      }
    } finally {
      db1?.$client.close()
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
