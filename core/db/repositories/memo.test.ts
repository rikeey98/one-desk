import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  let webRepoId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    apiRepoId = repos.create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    webRepoId = repos.create({ workspaceId, name: 'web', path: '/tmp/web' }).id
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

  it('repoIds를 갱신하면 기존 태그를 대체한다', () => {
    const created = memos.create({ workspaceId, title: 'x', repoIds: [apiRepoId] })
    const updated = memos.update({ id: created.id, repoIds: [webRepoId] })
    expect(updated.repoIds).toEqual([webRepoId])
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

  it('다른 workspace의 repo는 태그로 붙일 수 없다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    const otherRepo = createRepoRepository(db)
      .create({ workspaceId: other.id, name: '남의repo', path: '/tmp/other' })

    expect(() =>
      memos.create({ workspaceId, title: '경계 침범', repoIds: [otherRepo.id] })
    ).toThrow(/workspace/)

    expect(memos.list({ workspaceId })).toHaveLength(0)
  })

  it('update가 경계 위반으로 거부되면 제목 변경도 롤백된다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    const otherRepo = createRepoRepository(db)
      .create({ workspaceId: other.id, name: '남의repo', path: '/tmp/other' })
    const created = memos.create({ workspaceId, title: '원래제목', repoIds: [apiRepoId] })

    expect(() =>
      memos.update({ id: created.id, title: '바뀐제목', repoIds: [otherRepo.id] })
    ).toThrow(/workspace/)

    const after = memos.list({ workspaceId })[0]!
    expect(after.title).toBe('원래제목')
    expect(after.repoIds).toEqual([apiRepoId])
  })

  it('같은 repo를 중복해서 넘겨도 거부하지 않는다', () => {
    const created = memos.create({
      workspaceId, title: '중복 태그', repoIds: [apiRepoId, apiRepoId]
    })
    expect(created.repoIds).toEqual([apiRepoId])
  })
})

describe('updateIfUnchanged', () => {
  it('기대값이 맞으면 갱신하고 새 updatedAt을 돌려준다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const memos = createMemoRepository(db)
    const created = memos.create({ workspaceId, title: '제목', body: '원본' })

    const result = memos.updateIfUnchanged({
      id: created.id, body: '고침', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.memo.body).toBe('고침')
    expect(result.memo.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  it('그 사이 바뀌었으면 거부하고 최신 행을 돌려준다', () => {
    // agent가 MCP로 본문을 바꾼 상황. 화면의 낡은 버퍼가 덮어쓰면 안 된다.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const memos = createMemoRepository(db)
    const created = memos.create({ workspaceId, title: '제목', body: '원본' })
    memos.update({ id: created.id, body: 'agent가 쓴 것' })

    const result = memos.updateIfUnchanged({
      id: created.id, title: '사람이 바꾼 제목', body: '사람이 쓴 것', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.current.body).toBe('agent가 쓴 것')
    // title은 사람도 agent도 손대지 않은 값 — 버전 검사가 title/body 둘 다 막았는지 함께 본다.
    expect(result.current.title).toBe('제목')
  })

  it('없는 id면 NotFoundError를 던진다', () => {
    const db = makeTestDb()
    expect(() => createMemoRepository(db).updateIfUnchanged({
      id: '없는-id', body: 'x', expectedUpdatedAt: 1
    })).toThrow(/찾을 수 없습니다/)
  })

  it('같은 밀리초에 두 번 써도 updatedAt이 달라진다', () => {
    // updatedAt이 잠금의 버전 노릇을 한다. 값이 같아지면 "그 사이 바뀌었다"를
    // 놓쳐서, 이 기능이 막으려던 덮어쓰기가 그대로 일어난다.
    //
    // **시계를 고정해야 진짜 시험이 된다.** 그냥 두 번 쓰고 second > first만 보면
    // 두 쓰기가 밀리초 경계를 넘는 순간 단조 보정(buildPatch의 Math.max)을 지워도
    // 초록이 된다 — 실제 시각이 알아서 1 늘어나기 때문이다. 시각을 못박아 같은
    // 밀리초를 강제하면 남는 것은 보정뿐이라, 값까지 정확히 못박을 수 있다.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      const db = makeTestDb()
      const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
      const memos = createMemoRepository(db)
      const created = memos.create({ workspaceId, title: '제목', body: 'a' })

      const first = memos.update({ id: created.id, body: 'b' })
      const second = memos.update({ id: created.id, body: 'c' })

      expect(created.updatedAt).toBe(1_700_000_000_000)
      expect(first.updatedAt).toBe(1_700_000_000_001)
      expect(second.updatedAt).toBe(1_700_000_000_002)
    } finally {
      vi.useRealTimers()
    }
  })

  it('repoIds도 함께 갱신하고, 다른 workspace의 repo는 거부한다', () => {
    const db = makeTestDb()
    const workspaces = createWorkspaceRepository(db)
    const wsA = workspaces.create({ name: 'A' }).id
    const wsB = workspaces.create({ name: 'B' }).id
    const repos = createRepoRepository(db)
    const repoA = repos.create({ workspaceId: wsA, name: 'api', path: '/tmp/a' }).id
    const repoB = repos.create({ workspaceId: wsB, name: 'web', path: '/tmp/b' }).id
    const memos = createMemoRepository(db)
    const created = memos.create({ workspaceId: wsA, title: '제목', body: '원본' })

    const ok = memos.updateIfUnchanged({
      id: created.id, repoIds: [repoA], expectedUpdatedAt: created.updatedAt
    })
    expect(ok.ok).toBe(true)
    expect(memos.get(created.id).repoIds).toEqual([repoA])

    const beforeReject = memos.get(created.id)
    // assertReposInWorkspace는 tx.update(memo)가 이미 실행된 뒤에 던진다 — 그러니 여기서
    // title/body가 그대로인지 보는 것은 "쓰기가 없었다"가 아니라 "쓴 뒤 트랜잭션이
    // 롤백됐다"를 검증하는 진짜 시험이다 (설계 §6).
    expect(() => memos.updateIfUnchanged({
      id: created.id, title: '바뀐제목', body: '바뀐본문', repoIds: [repoB],
      expectedUpdatedAt: beforeReject.updatedAt
    })).toThrow(/속하지 않는 repo/)

    const after = memos.get(created.id)
    expect(after.title).toBe('제목')
    expect(after.body).toBe('원본')
    expect(after.repoIds).toEqual([repoA])
  })
})
