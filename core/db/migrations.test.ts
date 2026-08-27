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
