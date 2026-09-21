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

describe('글로벌 asset', () => {
  const global1 = {
    kind: 'skill' as const, name: '글로벌 알파', description: null,
    filePath: '/home/.claude/skills/알파/SKILL.md'
  }

  it('repoId가 null이면 글로벌로 저장된다', () => {
    assets.upsertDiscovered({ workspaceId, repoId: null, seenAt: 100, found: [global1] })
    const list = assets.list({ workspaceId })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ source: 'discovered', repoId: null, lastSeenAt: 100 })
  })

  it('두 번 훑어도 행이 늘지 않는다', () => {
    // repo_id를 조회 키에 넣으면 `repo_id = NULL`이 절대 참이 되지 않아 매번 INSERT를
    // 시도하고 유니크 인덱스에 걸린다. 이 테스트가 그것을 잡는다.
    assets.upsertDiscovered({ workspaceId, repoId: null, seenAt: 100, found: [global1] })
    assets.upsertDiscovered({ workspaceId, repoId: null, seenAt: 200, found: [global1] })
    const list = assets.list({ workspaceId })
    expect(list).toHaveLength(1)
    expect(list[0]!.lastSeenAt).toBe(200)
  })
})

describe('list의 repo 필터', () => {
  it('repo를 지정하면 글로벌·그 repo·authored만 나온다', () => {
    const other = createRepoRepository(db).create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    assets.upsertDiscovered({
      workspaceId, repoId, seenAt: 1,
      found: [{ kind: 'skill', name: 'api 것', description: null, filePath: '/tmp/api/a/SKILL.md' }]
    })
    assets.upsertDiscovered({
      workspaceId, repoId: other, seenAt: 1,
      found: [{ kind: 'skill', name: 'web 것', description: null, filePath: '/tmp/web/a/SKILL.md' }]
    })
    assets.upsertDiscovered({
      workspaceId, repoId: null, seenAt: 1,
      found: [{ kind: 'skill', name: '글로벌 것', description: null, filePath: '/home/g/SKILL.md' }]
    })
    assets.createAuthored({ workspaceId, kind: 'skill', name: '앱에서 쓴 것' })

    const names = assets.list({ workspaceId, repoId }).map((a) => a.name).sort()
    expect(names).toEqual(['api 것', '글로벌 것', '앱에서 쓴 것'].sort())
  })

  it('repo를 지정하지 않으면 전부 나온다', () => {
    const other = createRepoRepository(db).create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    assets.upsertDiscovered({
      workspaceId, repoId, seenAt: 1,
      found: [{ kind: 'skill', name: 'api 것', description: null, filePath: '/tmp/api/a/SKILL.md' }]
    })
    assets.upsertDiscovered({
      workspaceId, repoId: other, seenAt: 1,
      found: [{ kind: 'skill', name: 'web 것', description: null, filePath: '/tmp/web/a/SKILL.md' }]
    })
    expect(assets.list({ workspaceId })).toHaveLength(2)
  })
})

describe('movePathPrefix', () => {
  // spec FR-9: repo 경로가 바뀌면 그 아래 asset의 file_path를 새 경로로 옮긴다.
  // 행을 새로 만들지 않아야 과거 run이 첨부한 asset의 기록(id)이 이어진다(설계 §232).
  const globalFound = {
    kind: 'skill' as const, name: '글로벌', description: null, filePath: '/home/me/.claude/skills/g/SKILL.md'
  }

  it('그 repo의 asset만 새 접두사로 옮기고 id는 그대로다', () => {
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    const before = assets.list({ workspaceId })[0]!

    assets.movePathPrefix({ workspaceId, repoId, from: '/tmp/api', to: '/srv/api' })

    const after = assets.list({ workspaceId })
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, filePath: '/srv/api/a/SKILL.md' })
  })

  it('글로벌 asset(repo_id NULL)은 한 글자도 바뀌지 않는다', () => {
    // SQL에서 repo_id = NULL은 절대 참이 아니다 — 조건을 잘못 쓰면 글로벌이 조용히
    // 딸려 오거나(접두사가 우연히 같을 때) 아무것도 옮겨지지 않는다.
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    // 글로벌 경로가 repo 디렉토리 **안**에 있는 경우다 — repo가 홈 디렉토리면 실제로
    // 그렇다. 접두사는 같지만 repo_id가 NULL이라 옮기면 안 된다.
    assets.upsertDiscovered({
      workspaceId, repoId: null, seenAt: 100,
      found: [{ ...globalFound, filePath: '/tmp/api/.claude/skills/g/SKILL.md' }]
    })

    assets.movePathPrefix({ workspaceId, repoId, from: '/tmp/api', to: '/srv/api' })

    const paths = assets.list({ workspaceId }).map((a) => a.filePath).sort()
    expect(paths).toEqual(['/srv/api/a/SKILL.md', '/tmp/api/.claude/skills/g/SKILL.md'])
  })

  it('접두사는 경로 경계에서만 맞는다 — /tmp/api가 /tmp/api2를 끌고 가지 않는다', () => {
    const other = createRepoRepository(db).create({ workspaceId, name: 'api2', path: '/tmp/api2' })
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [found] })
    assets.upsertDiscovered({
      workspaceId, repoId: other.id, seenAt: 100,
      found: [{ ...found, name: '베타', filePath: '/tmp/api2/b/SKILL.md' }]
    })
    // 같은 repo 안에서도 접두사만 우연히 겹치는 파일은 있을 수 있다 — repo 조건과
    // 경계 조건이 둘 다 있어야 한다.
    assets.movePathPrefix({ workspaceId, repoId: other.id, from: '/tmp/api', to: '/srv/api' })
    expect(assets.list({ workspaceId }).map((a) => a.filePath).sort())
      .toEqual(['/tmp/api/a/SKILL.md', '/tmp/api2/b/SKILL.md'])
  })

  it('다른 workspace의 asset은 건드리지 않는다', () => {
    const otherWs = createWorkspaceRepository(db).create({ name: 'other' }).id
    const otherRepo = createRepoRepository(db).create({ workspaceId: otherWs, name: 'api', path: '/tmp/api' }).id
    assets.upsertDiscovered({ workspaceId: otherWs, repoId: otherRepo, seenAt: 100, found: [found] })

    assets.movePathPrefix({ workspaceId, repoId, from: '/tmp/api', to: '/srv/api' })
    expect(assets.list({ workspaceId: otherWs })[0]!.filePath).toBe('/tmp/api/a/SKILL.md')
  })

  it('새 경로에 같은 file_path가 이미 있으면 통째로 되돌린다', () => {
    // 유니크 인덱스 (workspace_id, file_path)에 걸리는 경우 — 같은 repo를 두 번 등록한
    // 상태다. 절반만 옮겨진 채 남으면 목록이 두 벌이 된다.
    const dup = createRepoRepository(db).create({ workspaceId, name: 'dup', path: '/srv/api' })
    assets.upsertDiscovered({ workspaceId, repoId, seenAt: 100, found: [
      found, { ...found, name: '감마', filePath: '/tmp/api/c/SKILL.md' }
    ] })
    assets.upsertDiscovered({ workspaceId, repoId: dup.id, seenAt: 100, found: [
      { ...found, name: '감마(복제)', filePath: '/srv/api/c/SKILL.md' }
    ] })

    expect(() => assets.movePathPrefix({ workspaceId, repoId, from: '/tmp/api', to: '/srv/api' }))
      .toThrow()
    const mine = assets.list({ workspaceId, repoId }).filter((a) => a.repoId === repoId)
    expect(mine.map((a) => a.filePath).sort()).toEqual(['/tmp/api/a/SKILL.md', '/tmp/api/c/SKILL.md'])
  })
})

describe('createAuthored — instructions', () => {
  it('지시 파일은 앱에서 작성할 수 없다 (docs/sdlc/repo-instructions/ FR-10)', () => {
    expect(() => assets.createAuthored({ workspaceId, kind: 'instructions', name: 'CLAUDE.md' }))
      .toThrow(/지시 파일/)
  })
})
