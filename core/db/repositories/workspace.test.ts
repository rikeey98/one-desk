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

describe('WorkspaceRepository.rename', () => {
  it('이름을 바꾸고 바뀐 행을 돌려준다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '옛 이름' })

    const renamed = repo.rename(created.id, '새 이름')

    expect(renamed.name).toBe('새 이름')
    expect(repo.list().map((w) => w.name)).toEqual(['새 이름'])
  })

  it('앞뒤 공백을 떼어낸다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '이름' })

    expect(repo.rename(created.id, '  다듬은 이름  ').name).toBe('다듬은 이름')
  })

  it('빈 이름은 거부한다 — 목록에서 못 알아보는 workspace가 생긴다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '이름' })

    expect(() => repo.rename(created.id, '   ')).toThrow('이름은 비울 수 없습니다')
    expect(repo.list()[0]!.name).toBe('이름')
  })

  it('updatedAt을 올린다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '이름' })

    const renamed = repo.rename(created.id, '새 이름')

    expect(renamed.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('없는 id면 던진다 — 조용히 넘어가면 화면이 왜 안 바뀌는지 알 수 없다', () => {
    const db = makeTestDb()
    expect(() => createWorkspaceRepository(db).rename('없음', '이름')).toThrow('workspace를 찾을 수 없습니다')
  })
})
