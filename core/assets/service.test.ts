import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTestDb } from '../db/repositories/testing'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createRepoRepository } from '../db/repositories/repo'
import { createAssetRepository } from '../db/repositories/asset'
import { createAssetService } from './service'

let dir: string
let ctx: ReturnType<typeof setup>

let globalRoots: string[] = []

function setup() {
  const db = makeTestDb()
  const assets = createAssetRepository(db)
  const repos = createRepoRepository(db)
  const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  const service = createAssetService({
    assets, repos,
    globalRoots: () => globalRoots,
    workspaceIds: () => [workspaceId]
  })
  return { db, assets, repos, workspaceId, service }
}

function writeSkill(root: string, name: string): void {
  const d = join(root, '.claude', 'skills', name)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: 설명\n---\n`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'one-desk-svc-'))
  globalRoots = []
  ctx = setup()
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('createAssetService', () => {
  it('repo 하나를 훑어 저장한다', async () => {
    writeSkill(dir, '알파')
    const repoId = ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'api', path: dir }).id

    await ctx.service.scanRepo(ctx.workspaceId, repoId)

    expect(ctx.assets.list({ workspaceId: ctx.workspaceId }).map((a) => a.name)).toEqual(['알파'])
  })

  it('두 번 훑어도 행이 늘지 않는다', async () => {
    writeSkill(dir, '알파')
    const repoId = ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'api', path: dir }).id

    await ctx.service.scanRepo(ctx.workspaceId, repoId)
    await ctx.service.scanRepo(ctx.workspaceId, repoId)

    expect(ctx.assets.list({ workspaceId: ctx.workspaceId })).toHaveLength(1)
  })

  it('workspace의 모든 repo를 훑는다', async () => {
    const second = mkdtempSync(join(tmpdir(), 'one-desk-svc2-'))
    try {
      writeSkill(dir, '알파')
      writeSkill(second, '베타')
      ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'api', path: dir })
      ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'web', path: second })

      await ctx.service.scanWorkspace(ctx.workspaceId)

      expect(ctx.assets.list({ workspaceId: ctx.workspaceId }).map((a) => a.name).sort())
        .toEqual(['베타', '알파'])
    } finally {
      rmSync(second, { recursive: true, force: true })
    }
  })

  it('scanAll은 모든 workspace를 훑는다', async () => {
    writeSkill(dir, '알파')
    ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'api', path: dir })

    await ctx.service.scanAll()

    expect(ctx.assets.list({ workspaceId: ctx.workspaceId })).toHaveLength(1)
  })

  it('repo 경로가 사라져도 던지지 않고 행을 남긴다', async () => {
    // 부팅 스캔이 repo 하나 때문에 죽으면 앱이 열리지 않는다.
    writeSkill(dir, '알파')
    const repoId = ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'api', path: dir }).id
    await ctx.service.scanRepo(ctx.workspaceId, repoId)
    rmSync(dir, { recursive: true, force: true })

    await expect(ctx.service.scanRepo(ctx.workspaceId, repoId)).resolves.toBeUndefined()
    expect(ctx.assets.list({ workspaceId: ctx.workspaceId })).toHaveLength(1)
  })
})

describe('글로벌 스캔', () => {
  it('글로벌 루트의 skill을 repoId 없이 저장한다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'one-desk-home-'))
    try {
      writeSkill(home, '글로벌 알파')
      globalRoots = [join(home, '.claude', 'skills')]

      await ctx.service.scanWorkspace(ctx.workspaceId)

      const list = ctx.assets.list({ workspaceId: ctx.workspaceId })
      expect(list.map((a) => a.name)).toEqual(['글로벌 알파'])
      expect(list[0]!.repoId).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('두 번 훑어도 행이 늘지 않는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'one-desk-home-'))
    try {
      writeSkill(home, '글로벌 알파')
      globalRoots = [join(home, '.claude', 'skills')]

      await ctx.service.scanWorkspace(ctx.workspaceId)
      await ctx.service.scanWorkspace(ctx.workspaceId)

      expect(ctx.assets.list({ workspaceId: ctx.workspaceId })).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('repo가 하나도 없어도 글로벌은 훑는다', async () => {
    // scanWorkspace가 repo 목록만 돌면 repo를 등록하기 전에는 글로벌이 안 보인다.
    const home = mkdtempSync(join(tmpdir(), 'one-desk-home-'))
    try {
      writeSkill(home, '글로벌 알파')
      globalRoots = [join(home, '.claude', 'skills')]

      await ctx.service.scanWorkspace(ctx.workspaceId)

      expect(ctx.assets.list({ workspaceId: ctx.workspaceId })).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('없는 글로벌 경로는 건너뛴다', async () => {
    globalRoots = [join(dir, '없는곳')]
    await expect(ctx.service.scanWorkspace(ctx.workspaceId)).resolves.toBeUndefined()
    expect(ctx.assets.list({ workspaceId: ctx.workspaceId })).toEqual([])
  })

  it('scanAll은 repo가 없는 workspace도 훑는다', async () => {
    const home = mkdtempSync(join(tmpdir(), 'one-desk-home-'))
    try {
      writeSkill(home, '글로벌 알파')
      globalRoots = [join(home, '.claude', 'skills')]

      await ctx.service.scanAll()

      expect(ctx.assets.list({ workspaceId: ctx.workspaceId })).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('스캔 한 번의 시각', () => {
  /**
   * `Date.now()`를 부를 때마다 1ms씩 흐르게 한다. 실제 디렉토리 걷기는 1ms 안에 끝날 수도
   * 있어 "배치마다 시각이 다르다"는 결함이 테스트에서 재현되지 않는다 — 시계를 쥐어야
   * 서비스가 시각을 몇 번 찍는지가 결정적으로 드러난다.
   */
  function tickingClock(): void {
    let t = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => ++t)
  }

  it('repo와 글로벌 루트를 한 번에 훑으면 모든 배치의 lastSeenAt이 같다', async () => {
    // 화면의 "없음"은 workspace에서 가장 최근에 본 시각보다 오래된 것이다(설계 §3-4).
    // 한 번의 스캔이 배치마다 다른 시각을 찍으면, 먼저 훑은 repo의 asset이 나중에
    // 훑은 글로벌보다 몇 ms 오래돼 방금 본 파일에 "없음"이 붙는다.
    const homeA = mkdtempSync(join(tmpdir(), 'one-desk-home-a-'))
    const homeB = mkdtempSync(join(tmpdir(), 'one-desk-home-b-'))
    try {
      writeSkill(dir, '알파')
      writeSkill(homeA, '글로벌 알파')
      writeSkill(homeB, '글로벌 베타')
      ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'api', path: dir })
      globalRoots = [join(homeA, '.claude', 'skills'), join(homeB, '.claude', 'skills')]
      tickingClock()

      await ctx.service.scanWorkspace(ctx.workspaceId)

      const list = ctx.assets.list({ workspaceId: ctx.workspaceId })
      expect(list).toHaveLength(3)
      expect(new Set(list.map((a) => a.lastSeenAt)).size).toBe(1)
    } finally {
      rmSync(homeA, { recursive: true, force: true })
      rmSync(homeB, { recursive: true, force: true })
    }
  })

  it('두 번째 스캔은 첫 스캔보다 늦은 시각을 찍는다', async () => {
    // 시각 하나를 잡는 것이 "매번 같은 시각"으로 퇴화하면 사라진 파일을 영영 못 잡는다.
    writeSkill(dir, '알파')
    ctx.repos.create({ workspaceId: ctx.workspaceId, name: 'api', path: dir })
    tickingClock()

    await ctx.service.scanWorkspace(ctx.workspaceId)
    const first = ctx.assets.list({ workspaceId: ctx.workspaceId })[0]!.lastSeenAt!
    await ctx.service.scanWorkspace(ctx.workspaceId)
    const second = ctx.assets.list({ workspaceId: ctx.workspaceId })[0]!.lastSeenAt!

    expect(second).toBeGreaterThan(first)
  })
})
