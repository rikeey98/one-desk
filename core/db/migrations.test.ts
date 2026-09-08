import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './open'

/** drizzle 디렉토리를 idx <= untilIdx 까지만 담은 임시 복사본으로 만든다. */
function migrationsUpTo(untilIdx: number, dir: string) {
  const journal = JSON.parse(readFileSync(join('drizzle', 'meta', '_journal.json'), 'utf8'))
  const kept = journal.entries.filter((e: { idx: number }) => e.idx <= untilIdx)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  for (const entry of kept) {
    copyFileSync(join('drizzle', `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
    copyFileSync(
      join('drizzle', 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`),
      join(dir, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`)
    )
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: kept })
  )
  return dir
}

describe('0003 마이그레이션', () => {
  it('기존 이슈를 triaged_at = created_at 으로 백필한다', () => {
    const work = mkdtempSync(join(tmpdir(), 'one-desk-mig-'))
    try {
      const file = join(work, 'test.db')
      const old = migrationsUpTo(2, join(work, 'old-migrations'))

      // 0002 시점의 앱이 만든 것처럼 이슈를 하나 넣는다.
      const before = openDb({ file, migrationsDir: old })
      before.$client.exec(`
        INSERT INTO workspace (id, name, created_at, updated_at)
        VALUES ('ws', 'ws', 1000, 1000);
        INSERT INTO issue (id, workspace_id, title, created_at, updated_at)
        VALUES ('i1', 'ws', '옛 이슈', 1234, 1234);
      `)
      before.$client.close()

      // 이제 진짜 마이그레이션 디렉토리로 연다 — 0003이 여기서 돈다.
      const after = openDb({ file, migrationsDir: 'drizzle' })
      const row = after.$client
        .prepare('SELECT triaged_at as triagedAt FROM issue WHERE id = ?')
        .get('i1') as { triagedAt: number | null }
      after.$client.close()

      expect(row.triagedAt).toBe(1234)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
})

describe('0004 마이그레이션', () => {
  it('asset 테이블과 동일성 인덱스를 만든다', () => {
    const work = mkdtempSync(join(tmpdir(), 'one-desk-mig-'))
    try {
      const db = openDb({ file: join(work, 'test.db'), migrationsDir: 'drizzle' })
      const cols = db.$client.prepare('PRAGMA table_info(asset)').all() as { name: string }[]
      expect(cols.map((c) => c.name).sort()).toEqual([
        'content', 'created_at', 'description', 'file_path', 'id', 'kind',
        'last_seen_at', 'name', 'repo_id', 'source', 'updated_at', 'workspace_id'
      ])

      const idx = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='asset'")
        .all() as { name: string }[]
      expect(idx.map((i) => i.name)).toContain('asset_discovered_idx')

      // Windows는 열린 핸들이 있는 파일을 지우지 못한다.
      db.$client.close()
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it('같은 (workspace, repo, file_path)를 두 번 넣으면 거부된다', () => {
    // 이 제약이 없으면 스캔이 돌 때마다 같은 파일이 새 행으로 쌓인다.
    const work = mkdtempSync(join(tmpdir(), 'one-desk-mig-'))
    try {
      const db = openDb({ file: join(work, 'test.db'), migrationsDir: 'drizzle' })
      db.$client.exec(`
        INSERT INTO workspace (id, name, created_at, updated_at) VALUES ('ws', 'ws', 1, 1);
        INSERT INTO repo (id, workspace_id, name, path, created_at)
        VALUES ('r1', 'ws', 'api', '/tmp/api', 1);
      `)
      const insert = (id: string): void => {
        db.$client.prepare(
          `INSERT INTO asset (id, workspace_id, kind, source, name, repo_id, file_path,
           created_at, updated_at)
           VALUES (?, 'ws', 'skill', 'discovered', 'x', 'r1', '/a/SKILL.md', 1, 1)`
        ).run(id)
      }

      insert('a1')
      expect(() => insert('a2')).toThrow(/UNIQUE/)

      db.$client.close()
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it('authored 행은 여러 개 만들 수 있다', () => {
    // repo_id와 file_path가 둘 다 NULL이다. SQLite가 유니크 인덱스에서 NULL을
    // 서로 다르게 취급하지 않으면 두 번째에서 터진다.
    const work = mkdtempSync(join(tmpdir(), 'one-desk-mig-'))
    try {
      const db = openDb({ file: join(work, 'test.db'), migrationsDir: 'drizzle' })
      db.$client.exec(`
        INSERT INTO workspace (id, name, created_at, updated_at) VALUES ('ws', 'ws', 1, 1);
      `)
      const insert = (id: string): void => {
        db.$client.prepare(
          `INSERT INTO asset (id, workspace_id, kind, source, name, created_at, updated_at)
           VALUES (?, 'ws', 'skill', 'authored', 'x', 1, 1)`
        ).run(id)
      }

      insert('a1')
      expect(() => insert('a2')).not.toThrow()

      db.$client.close()
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
})
