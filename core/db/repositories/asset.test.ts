import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createAssetRepository, type AssetRepository } from './asset'
import type { Database } from '../open'

let db: Database
let assets: AssetRepository
let workspaceId: string
let repoId: string

beforeEach(() => {
  db = makeTestDb()
  assets = createAssetRepository(db)
  workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: '/tmp/api' }).id
})

const found = {
  kind: 'skill' as const, name: '알파', description: '설명', filePath: '/tmp/api/a/SKILL.md'
}

describe('upsertDiscovered', () => {
  it('처음 보면 만든다', () => {
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    const list = assets.list({ workspaceId })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      kind: 'skill', source: 'discovered', name: '알파', repoId, lastSeenAt: 100
    })
  })

  it('두 번 봐도 행이 늘지 않는다', () => {
    // 동일성 키가 없으면 스캔마다 같은 파일이 새 행으로 쌓인다 (설계 §3-3).
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 200, found: [found] })
    expect(assets.list({ workspaceId })).toHaveLength(1)
  })

  it('다시 보면 이름·설명·lastSeenAt을 갱신한다', () => {
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    assets.upsertDiscovered({
      workspaceId, repoId, seenAt: 200,
      found: [{ ...found, name: '알파(개명)', description: '새 설명' }]
    })
    expect(assets.list({ workspaceId })[0]).toMatchObject({
      name: '알파(개명)', description: '새 설명', lastSeenAt: 200
    })
  })

  it('사라진 파일의 행은 남고 lastSeenAt이 그대로다', () => {
    // 지우면 그 asset을 첨부했던 과거 run의 기록이 끊긴다 (설계 §3-4).
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 200, found: [] })
    const list = assets.list({ workspaceId })
    expect(list).toHaveLength(1)
    expect(list[0]!.lastSeenAt).toBe(100)
  })

  it('authored 행은 건드리지 않는다', () => {
    // 안 그러면 앱에서 쓴 asset이 첫 스캔에 전부 "없음"이 된다 (설계 §3-4).
    const mine = assets.createAuthored({ workspaceId, kind: 'agent', name: '내가 쓴 것' })
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 200, found: [] })
    const still = assets.get(mine.id)
    expect(still.source).toBe('authored')
    expect(still.lastSeenAt).toBeNull()
  })

  it('repo가 달라도 같은 파일이면 한 행이다', () => {
    // 파일 경로가 곧 동일성이다. 한 repo가 다른 repo 안에 있으면 같은 파일이 양쪽에서
    // 발견되는데, 그때 행이 둘로 갈리면 목록에 같은 skill이 두 번 뜬다.
    // (docs/sdlc/asset-scope/spec.md — 2026-09-07 설계 §3-3을 대체함)
    const other = createRepoRepository(db).create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    assets.upsertDiscovered({ workspaceId, repoId: other, seenAt: 200, found: [found] })

    const list = assets.list({ workspaceId })
    expect(list).toHaveLength(1)
    // 나중에 발견한 repo로 갱신된다.
    expect(list[0]).toMatchObject({ repoId: other, lastSeenAt: 200 })
  })

  it('경로가 다르면 별개 행이다', () => {
    const other = createRepoRepository(db).create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    assets.upsertDiscovered({
      workspaceId, repoId: other, seenAt: 100,
      found: [{ ...found, filePath: '/tmp/web/a/SKILL.md' }]
    })
    expect(assets.list({ workspaceId })).toHaveLength(2)
  })
})

describe('authored', () => {
  it('만들면 본문을 갖고 lastSeenAt은 null이다', () => {
    const made = assets.createAuthored({
      workspaceId, kind: 'skill', name: '내 스킬', description: '설명', content: '# 본문'
    })
    expect(made).toMatchObject({
      source: 'authored', content: '# 본문', lastSeenAt: null, repoId: null, filePath: null
    })
  })

  it('authored를 여러 개 만들 수 있다', () => {
    // 유니크 인덱스가 (workspace, repo_id, file_path)인데 둘 다 NULL이다.
    assets.createAuthored({ workspaceId, kind: 'skill', name: '하나' })
    assets.createAuthored({ workspaceId, kind: 'skill', name: '둘' })
    expect(assets.list({ workspaceId })).toHaveLength(2)
  })

  it('updateIfUnchanged가 기대값이 맞을 때 고친다', () => {
    const made = assets.createAuthored({ workspaceId, kind: 'skill', name: '내 스킬' })
    const result = assets.updateIfUnchanged({
      id: made.id, expectedUpdatedAt: made.updatedAt, content: '고친 본문'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.asset.content).toBe('고친 본문')
  })

  it('그 사이 바뀌었으면 거부하고 현재 값을 준다', () => {
    const made = assets.createAuthored({ workspaceId, kind: 'skill', name: '내 스킬' })
    assets.updateIfUnchanged({ id: made.id, expectedUpdatedAt: made.updatedAt, content: '먼저' })
    const late = assets.updateIfUnchanged({
      id: made.id, expectedUpdatedAt: made.updatedAt, content: '나중'
    })
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.current.content).toBe('먼저')
  })

  it('같은 밀리초에 두 번 써도 updatedAt이 증가한다', () => {
    // Date.now()만 쓰면 값이 같아져 "그 사이 바뀌었다"를 놓친다.
    const made = assets.createAuthored({ workspaceId, kind: 'skill', name: '내 스킬' })
    let cur = made.updatedAt
    for (let i = 0; i < 3; i++) {
      const r = assets.updateIfUnchanged({ id: made.id, expectedUpdatedAt: cur, content: `v${i}` })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.asset.updatedAt).toBeGreaterThan(cur)
        cur = r.asset.updatedAt
      }
    }
  })

  it('discovered는 updateIfUnchanged로 고칠 수 없다', () => {
    // 본문은 파일이 원본이다. 앱이 고치면 어느 쪽이 진짜인지 알 수 없게 된다 (설계 §6-2).
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    const row = assets.list({ workspaceId })[0]!
    expect(() => assets.updateIfUnchanged({
      id: row.id, expectedUpdatedAt: row.updatedAt, content: '덮어쓰기'
    })).toThrow(/discovered/)
  })
})
