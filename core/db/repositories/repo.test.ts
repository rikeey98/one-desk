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
