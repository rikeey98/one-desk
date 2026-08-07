import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import type { Database } from '../open'

describe('WorkspaceRepository', () => {
  let db: Database
  let repo: ReturnType<typeof createWorkspaceRepository>

  beforeEach(() => {
    db = makeTestDb()
    repo = createWorkspaceRepository(db)
  })

  it('생성한 workspace를 목록에서 찾을 수 있다', () => {
    const created = repo.create({ name: '사내 플랫폼' })
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('사내 플랫폼')
    expect(created.defaultPermission).toBe('edit')

    const all = repo.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.id).toBe(created.id)
  })

  it('이름순으로 정렬해서 반환한다', () => {
    repo.create({ name: '하나' })
    repo.create({ name: '가나' })
    repo.create({ name: '나나' })
    expect(repo.list().map((w) => w.name)).toEqual(['가나', '나나', '하나'])
  })

  it('삭제하면 목록에서 사라진다', () => {
    const w = repo.create({ name: '지울것' })
    repo.remove(w.id)
    expect(repo.list()).toHaveLength(0)
  })
})
