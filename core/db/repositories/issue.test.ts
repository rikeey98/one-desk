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

  it('태그 삽입이 실패하면 이슈 본문도 저장되지 않는다', () => {
    expect(() =>
      issues.create({ workspaceId, title: '고아 이슈', repoIds: ['존재하지-않는-repo'] })
    ).toThrow()

    expect(issues.list({ workspaceId })).toHaveLength(0)
  })

  it('다른 workspace의 repo는 태그로 붙일 수 없다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    const otherRepo = createRepoRepository(db)
      .create({ workspaceId: other.id, name: '남의repo', path: '/tmp/other' })

    expect(() =>
      issues.create({ workspaceId, title: '경계 침범', repoIds: [otherRepo.id] })
    ).toThrow(/workspace/)

    expect(issues.list({ workspaceId })).toHaveLength(0)
  })

  it('update가 경계 위반으로 거부되면 제목·상태 변경도 롤백된다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    const otherRepo = createRepoRepository(db)
      .create({ workspaceId: other.id, name: '남의repo', path: '/tmp/other' })
    const created = issues.create({ workspaceId, title: '원래제목', repoIds: [apiRepoId] })

    expect(() =>
      issues.update({ id: created.id, title: '바뀐제목', status: 'done', repoIds: [otherRepo.id] })
    ).toThrow(/workspace/)

    const after = issues.list({ workspaceId })[0]!
    expect(after.title).toBe('원래제목')
    expect(after.status).toBe('open')
    expect(after.repoIds).toEqual([apiRepoId])
  })

  it('같은 repo를 중복해서 넘겨도 거부하지 않는다', () => {
    const created = issues.create({
      workspaceId, title: '중복 태그', repoIds: [apiRepoId, apiRepoId]
    })
    expect(created.repoIds).toEqual([apiRepoId])
  })
})

describe('updateIfUnchanged', () => {
  it('기대값이 맞으면 갱신하고 새 updatedAt을 돌려준다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })

    const result = issues.updateIfUnchanged({
      id: created.id, body: '고침', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issue.body).toBe('고침')
    expect(result.issue.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  it('그 사이 바뀌었으면 거부하고 최신 행을 돌려준다', () => {
    // agent가 MCP로 본문을 바꾼 상황. 화면의 낡은 버퍼가 덮어쓰면 안 된다.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })
    issues.update({ id: created.id, body: 'agent가 쓴 것' })

    const result = issues.updateIfUnchanged({
      id: created.id, body: '사람이 쓴 것', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.current.body).toBe('agent가 쓴 것')
  })

  it('거부된 저장은 DB를 바꾸지 않는다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })
    issues.update({ id: created.id, body: 'agent가 쓴 것' })

    issues.updateIfUnchanged({
      id: created.id, title: '사람이 바꾼 제목', expectedUpdatedAt: created.updatedAt
    })

    // 제목도 함께 롤백돼야 한다. 트랜잭션 밖에서 검사하면 여기서 새어나간다.
    expect(issues.get(created.id).title).toBe('제목')
  })

  it('없는 id면 NotFoundError를 던진다', () => {
    const db = makeTestDb()
    expect(() => createIssueRepository(db).updateIfUnchanged({
      id: '없는-id', body: 'x', expectedUpdatedAt: 1
    })).toThrow(/찾을 수 없습니다/)
  })

  it('같은 밀리초에 두 번 써도 updatedAt이 달라진다', () => {
    // updatedAt이 잠금의 버전 노릇을 한다. 값이 같아지면 "그 사이 바뀌었다"를
    // 놓쳐서, 이 기능이 막으려던 덮어쓰기가 그대로 일어난다.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: 'a' })

    const first = issues.update({ id: created.id, body: 'b' })
    const second = issues.update({ id: created.id, body: 'c' })

    expect(first.updatedAt).toBeGreaterThan(created.updatedAt)
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
  })

  it('repoIds도 함께 갱신하고, 다른 workspace의 repo는 거부한다', () => {
    const db = makeTestDb()
    const workspaces = createWorkspaceRepository(db)
    const wsA = workspaces.create({ name: 'A' }).id
    const wsB = workspaces.create({ name: 'B' }).id
    const repos = createRepoRepository(db)
    const repoA = repos.create({ workspaceId: wsA, name: 'api', path: '/tmp/a' }).id
    const repoB = repos.create({ workspaceId: wsB, name: 'web', path: '/tmp/b' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId: wsA, title: '제목' })

    const ok = issues.updateIfUnchanged({
      id: created.id, repoIds: [repoA], expectedUpdatedAt: created.updatedAt
    })
    expect(ok.ok).toBe(true)
    expect(issues.get(created.id).repoIds).toEqual([repoA])

    expect(() => issues.updateIfUnchanged({
      id: created.id, repoIds: [repoB], expectedUpdatedAt: issues.get(created.id).updatedAt
    })).toThrow(/속하지 않는 repo/)
  })
})
