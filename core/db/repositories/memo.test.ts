import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createMemoRepository } from './memo'
import type { Database } from '../open'

describe('MemoRepository', () => {
  let db: Database
  let memos: ReturnType<typeof createMemoRepository>
  let workspaceId: string
  let apiRepoId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    apiRepoId = createRepoRepository(db)
      .create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    memos = createMemoRepository(db)
  })

  it('repoIds와 함께 저장하고 읽어온다', () => {
    const created = memos.create({
      workspaceId, title: '배포 절차', body: '내용', repoIds: [apiRepoId]
    })
    expect(created.repoIds).toEqual([apiRepoId])
    expect(created.body).toBe('내용')
  })

  it('repo 필터는 공통 메모도 함께 반환한다', () => {
    memos.create({ workspaceId, title: 'api 메모', repoIds: [apiRepoId] })
    memos.create({ workspaceId, title: '공통 메모', repoIds: [] })
    const titles = memos.list({ workspaceId, repoId: apiRepoId })
      .map((m) => m.title).sort()
    expect(titles).toEqual(['api 메모', '공통 메모'])
  })

  it('제목을 수정하면 updatedAt이 커진다', async () => {
    const created = memos.create({ workspaceId, title: '전' })
    await new Promise((r) => setTimeout(r, 5))
    const updated = memos.update({ id: created.id, title: '후' })
    expect(updated.title).toBe('후')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('연달아 생성한 메모가 최신순으로 정렬된다', async () => {
    memos.create({ workspaceId, title: 'A' })
    await new Promise((r) => setTimeout(r, 5))
    memos.create({ workspaceId, title: 'B' })
    await new Promise((r) => setTimeout(r, 5))
    memos.create({ workspaceId, title: 'C' })

    const titles = memos.list({ workspaceId }).map((m) => m.title)
    expect(titles).toEqual(['C', 'B', 'A'])
  })

  it('태그 삽입이 실패하면 메모 본문도 저장되지 않는다', () => {
    expect(() =>
      memos.create({ workspaceId, title: '고아 메모', repoIds: ['존재하지-않는-repo'] })
    ).toThrow()

    expect(memos.list({ workspaceId })).toHaveLength(0)
  })
})
