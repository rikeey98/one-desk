import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

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
