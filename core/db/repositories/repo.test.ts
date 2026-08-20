import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import type { Database } from '../open'

describe('RepoRepository', () => {
  let db: Database
  let repos: ReturnType<typeof createRepoRepository>
  let workspaceId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    repos = createRepoRepository(db)
  })

  it('workspace에 속한 repo만 반환한다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    repos.create({ workspaceId, name: 'api-server', path: '/tmp/api' })
    repos.create({ workspaceId: other.id, name: '남의것', path: '/tmp/x' })

    const list = repos.list(workspaceId)
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('api-server')
  })

  it('sortOrder, name 순으로 정렬한다', () => {
    repos.create({ workspaceId, name: 'zulu', path: '/tmp/z' })
    repos.create({ workspaceId, name: 'alpha', path: '/tmp/a' })
    expect(repos.list(workspaceId).map((r) => r.name)).toEqual(['alpha', 'zulu'])
  })

  it('workspace를 지우면 repo도 함께 사라진다', () => {
    repos.create({ workspaceId, name: 'api-server', path: '/tmp/api' })
    createWorkspaceRepository(db).remove(workspaceId)
    expect(repos.list(workspaceId)).toHaveLength(0)
  })
})

describe('RepoRepository.rename', () => {
  // workspace 쪽 짝과 같은 약속이다 — 한쪽만 고치면 두 화면이 다르게 동작한다.
  it('이름을 바꾸고 바뀐 행을 돌려준다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    const created = repos.create({ workspaceId, name: '옛 이름', path: '/tmp/a' })

    expect(repos.rename(created.id, '새 이름').name).toBe('새 이름')
    expect(repos.list(workspaceId).map((r) => r.name)).toEqual(['새 이름'])
  })

  it('앞뒤 공백을 떼어낸다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    const created = repos.create({ workspaceId, name: '이름', path: '/tmp/a' })

    expect(repos.rename(created.id, '  다듬은 이름  ').name).toBe('다듬은 이름')
  })

  it('빈 이름은 거부한다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    const created = repos.create({ workspaceId, name: '이름', path: '/tmp/a' })

    expect(() => repos.rename(created.id, '  ')).toThrow('이름은 비울 수 없습니다')
    expect(repos.list(workspaceId)[0]!.name).toBe('이름')
  })

  it('없는 id면 던진다', () => {
    const db = makeTestDb()
    expect(() => createRepoRepository(db).rename('없음', '이름')).toThrow('repo를 찾을 수 없습니다')
  })

  it('경로는 건드리지 않는다 — 이름만 바꾸는 것이 이 메서드의 약속이다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    const created = repos.create({ workspaceId, name: '이름', path: '/tmp/a' })

    expect(repos.rename(created.id, '새 이름').path).toBe(created.path)
  })
})
