import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './db/repositories/testing'
import { createWorkspaceRepository } from './db/repositories/workspace'
import { createRepoRepository } from './db/repositories/repo'
import { createIssueRepository } from './db/repositories/issue'
import { createMemoRepository } from './db/repositories/memo'
import { createAssetRepository } from './db/repositories/asset'
import {
  notifyingIssues, notifyingMemos, notifyingAssets, notifyingRepos, notifyingWorkspaces
} from './changes'
import type { ItemChange } from '@shared/models'
import type { Database } from './db/open'

describe('바뀜 알림 래퍼 (item-windows FR-17)', () => {
  let db: Database
  let workspaceId: string
  let repoId: string
  let seen: ItemChange[]
  const notify = (c: ItemChange) => { seen.push(c) }

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    seen = []
  })

  it('이슈: 만들기·고치기·잠긴 고치기·지우기가 각각 한 번 알리고, 열람 기록과 읽기는 알리지 않는다', () => {
    const issues = notifyingIssues(createIssueRepository(db), notify)
    const made = issues.create({ workspaceId, title: 'a' })
    const updated = issues.update({ id: made.id, title: 'b' })
    issues.updateIfUnchanged({ id: made.id, title: 'c', expectedUpdatedAt: updated.updatedAt })
    issues.markSeen(made.id)
    issues.list({ workspaceId })
    issues.get(made.id)
    issues.remove(made.id)
    expect(seen).toEqual(Array(4).fill({ workspaceId, kind: 'issue' }))
  })

  it('이슈: 충돌로 끝난 잠긴 고치기와 없는 id 지우기는 알리지 않는다', () => {
    const issues = notifyingIssues(createIssueRepository(db), notify)
    const made = issues.create({ workspaceId, title: 'a' })
    seen = []
    const result = issues.updateIfUnchanged({ id: made.id, title: 'x', expectedUpdatedAt: made.updatedAt - 1 })
    expect(result.ok).toBe(false)
    issues.remove('없는 id')
    expect(seen).toEqual([])
  })

  it('메모: 이슈와 같은 규칙이다', () => {
    const memos = notifyingMemos(createMemoRepository(db), notify)
    const made = memos.create({ workspaceId, title: 'a' })
    const updated = memos.update({ id: made.id, title: 'b' })
    memos.updateIfUnchanged({ id: made.id, title: 'c', expectedUpdatedAt: updated.updatedAt })
    expect(memos.updateIfUnchanged({ id: made.id, title: 'd', expectedUpdatedAt: 0 }).ok).toBe(false)
    memos.remove(made.id)
    memos.remove('없는 id')
    expect(seen).toEqual(Array(4).fill({ workspaceId, kind: 'memo' }))
  })

  it('asset: 앱에서 쓴 것만 알린다', () => {
    const assets = notifyingAssets(createAssetRepository(db), notify)
    const made = assets.createAuthored({ workspaceId, kind: 'skill', name: 'a' })
    assets.updateIfUnchanged({ id: made.id, content: 'x', expectedUpdatedAt: made.updatedAt })
    assets.remove(made.id)
    expect(seen).toEqual(Array(3).fill({ workspaceId, kind: 'asset' }))
  })

  it('repo: 만들기·이름·고치기·지우기', () => {
    const repos = notifyingRepos(createRepoRepository(db), notify)
    const made = repos.create({ workspaceId, name: 'web', path: '/tmp/web' })
    repos.rename(made.id, 'web2')
    repos.update(made.id, { description: 'd' })
    repos.remove(made.id)
    repos.remove(repoId + '없음')
    expect(seen).toEqual(Array(4).fill({ workspaceId, kind: 'repo' }))
  })

  it('workspace: 이름과 지우기', () => {
    const workspaces = notifyingWorkspaces(createWorkspaceRepository(db), notify)
    workspaces.rename(workspaceId, 'ws2')
    workspaces.remove(workspaceId)
    expect(seen).toEqual(Array(2).fill({ workspaceId, kind: 'workspace' }))
  })
})
