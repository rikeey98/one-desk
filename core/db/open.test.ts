import { describe, it, expect } from 'vitest'
import {
  mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync, copyFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import BetterSqlite3 from 'better-sqlite3'
import { openDb } from './open'
import { workspace } from './schema'

const HERE = dirname(fileURLToPath(import.meta.url))

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

describe('openDb 마이그레이션', () => {
  it('0002 마이그레이션이 기존 체인의 뿌리를 백필한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-backfill-'))
    const file = join(dir, 'test.db')
    const full = resolve(HERE, '../../drizzle')

    // 0002 이전 상태를 만든다 — 마이그레이션 파일을 0001까지만 복사한다.
    const partial = join(dir, 'migrations')
    mkdirSync(join(partial, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(join(full, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[]
    }
    const keep = journal.entries.filter((e) => !e.tag.startsWith('0002'))
    writeFileSync(
      join(partial, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: keep })
    )
    for (const entry of keep) copyFileSync(join(full, `${entry.tag}.sql`), join(partial, `${entry.tag}.sql`))

    // 0001까지만 적용된 DB를 만든다.
    openDb({ file, migrationsDir: partial })

    // 심는 것은 raw 핸들로 한다 — root_run_id 컬럼이 없어 drizzle 스키마를 쓸 수
    // 없고, openDb는 핸들을 돌려주지 않는다. WAL이라 연결이 여럿이어도 된다.
    const seed = new BetterSqlite3(file)
    seed.exec(`
      INSERT INTO workspace (id, name, created_at, updated_at)
        VALUES ('ws', 'ws', 1, 1);
      INSERT INTO run (id, workspace_id, agent_kind, cwd, permission, user_prompt,
                       assembled_prompt, log_path, parent_run_id, created_at)
        VALUES
          ('a','ws','claude-code','/tmp','edit','1','1','/tmp/a.log', NULL, 1),
          ('b','ws','claude-code','/tmp','edit','2','2','/tmp/b.log', 'a',  2),
          ('c','ws','claude-code','/tmp','edit','3','3','/tmp/c.log', 'b',  3),
          ('z','ws','claude-code','/tmp','edit','4','4','/tmp/z.log', 'ghost', 4);
    `)
    seed.close()

    // 전체 마이그레이션으로 다시 연다 — 0002가 백필한다.
    openDb({ file, migrationsDir: full })

    const check = new BetterSqlite3(file)
    const rows = check
      .prepare('SELECT id, root_run_id FROM run ORDER BY created_at')
      .all() as { id: string; root_run_id: string }[]
    expect(rows).toEqual([
      { id: 'a', root_run_id: 'a' },
      { id: 'b', root_run_id: 'a' },
      { id: 'c', root_run_id: 'a' },
      // 부모가 사라진 행은 자기 자신이 뿌리다.
      { id: 'z', root_run_id: 'z' }
    ])
    check.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
