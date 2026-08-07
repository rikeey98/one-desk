import { describe, it, expect } from 'vitest'
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
