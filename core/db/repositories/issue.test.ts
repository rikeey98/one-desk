import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createIssueRepository } from './issue'
import type { Database } from '../open'

describe('IssueRepository', () => {
  let db: Database
  let issues: ReturnType<typeof createIssueRepository>
  let workspaceId: string
  let apiRepoId: string
  let webRepoId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    apiRepoId = repos.create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    webRepoId = repos.create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    issues = createIssueRepository(db)
  })

  it('생성 시 repoIds를 함께 저장하고 다시 읽어온다', () => {
    const created = issues.create({
      workspaceId, title: '토큰 버그', repoIds: [apiRepoId, webRepoId]
    })
    expect(created.repoIds.sort()).toEqual([apiRepoId, webRepoId].sort())

    const [fetched] = issues.list({ workspaceId })
    expect(fetched?.repoIds.sort()).toEqual([apiRepoId, webRepoId].sort())
  })

  it('repo 필터는 그 repo의 항목과 태그 없는 공통 항목을 함께 반환한다', () => {
    issues.create({ workspaceId, title: 'api 전용', repoIds: [apiRepoId] })
    issues.create({ workspaceId, title: 'web 전용', repoIds: [webRepoId] })
    issues.create({ workspaceId, title: '공통', repoIds: [] })

    const titles = issues.list({ workspaceId, repoId: apiRepoId })
      .map((i) => i.title).sort()
    expect(titles).toEqual(['api 전용', '공통'])
  })

  it('status를 done으로 바꾸면 closedAt이 채워진다', () => {
    const created = issues.create({ workspaceId, title: '끝낼것' })
    expect(created.closedAt).toBeNull()

    const updated = issues.update({ id: created.id, status: 'done' })
    expect(updated.status).toBe('done')
    expect(updated.closedAt).toBeTypeOf('number')
  })

  it('done에서 open으로 되돌리면 closedAt이 지워진다', () => {
    const created = issues.create({ workspaceId, title: '되돌릴것' })
    issues.update({ id: created.id, status: 'done' })
    const reopened = issues.update({ id: created.id, status: 'open' })
    expect(reopened.closedAt).toBeNull()
  })

  it('repoIds를 갱신하면 기존 태그를 대체한다', () => {
    const created = issues.create({ workspaceId, title: 'x', repoIds: [apiRepoId] })
    const updated = issues.update({ id: created.id, repoIds: [webRepoId] })
    expect(updated.repoIds).toEqual([webRepoId])
  })

  it('연달아 생성한 이슈가 최신순으로 정렬된다', async () => {
    issues.create({ workspaceId, title: 'A' })
    await new Promise((r) => setTimeout(r, 5))
    issues.create({ workspaceId, title: 'B' })
    await new Promise((r) => setTimeout(r, 5))
    issues.create({ workspaceId, title: 'C' })

    const titles = issues.list({ workspaceId }).map((i) => i.title)
    expect(titles).toEqual(['C', 'B', 'A'])
  })
})
