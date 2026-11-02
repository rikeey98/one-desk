import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createDrawingRepository } from './drawing'
import { EMPTY_SCENE } from '../../drawings/scene'
import type { Database } from '../open'

const scene = (ids: string[]) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'one-desk', elements: ids.map((id) => ({ id })) })

describe('DrawingRepository (docs/sdlc/drawings/ spec FR-1~FR-7)', () => {
  let db: Database
  let drawings: ReturnType<typeof createDrawingRepository>
  let workspaceId: string
  let otherWorkspaceId: string
  let apiRepoId: string
  let webRepoId: string
  let foreignRepoId: string

  beforeEach(() => {
    db = makeTestDb()
    const workspaces = createWorkspaceRepository(db)
    workspaceId = workspaces.create({ name: 'ws' }).id
    otherWorkspaceId = workspaces.create({ name: 'other' }).id
    const repos = createRepoRepository(db)
    apiRepoId = repos.create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    webRepoId = repos.create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    foreignRepoId = repos.create({ workspaceId: otherWorkspaceId, name: 'x', path: '/tmp/x' }).id
    drawings = createDrawingRepository(db)
  })

  afterEach(() => { vi.useRealTimers(); db.$client.close() })

  it('만들면 빈 장면과 그림 N 이름으로 시작한다', () => {
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    expect(a).toMatchObject({ workspaceId, repoId: apiRepoId, title: '그림 1', scene: EMPTY_SCENE })
    expect(a.createdAt).toBe(a.updatedAt)
    expect(drawings.create({ workspaceId, repoId: apiRepoId }).title).toBe('그림 2')
    // 번호는 repo마다다
    expect(drawings.create({ workspaceId, repoId: webRepoId }).title).toBe('그림 1')
    expect(drawings.create({ workspaceId, repoId: webRepoId, title: '  구조도  ' }).title).toBe('구조도')
  })

  it('다른 workspace의 repo에는 만들 수 없다', () => {
    expect(() => drawings.create({ workspaceId, repoId: foreignRepoId })).toThrow(/이 workspace에 속하지 않는 repo/)
    expect(drawings.list({ workspaceId: otherWorkspaceId })).toEqual([])
  })

  it('목록은 장면 없이 만든 순서다 — repo를 주면 그 repo만, 안 주면 workspace 전부', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    vi.setSystemTime(2000)
    const b = drawings.create({ workspaceId, repoId: webRepoId })
    vi.setSystemTime(3000)
    const c = drawings.create({ workspaceId, repoId: apiRepoId })
    // 나중에 고친 것도 순서를 바꾸지 않는다
    drawings.saveScene({ id: a.id, scene: scene(['x']), expectedUpdatedAt: a.updatedAt })

    const api = drawings.list({ workspaceId, repoId: apiRepoId })
    expect(api.map((d) => d.id)).toEqual([a.id, c.id])
    expect(api[0]).not.toHaveProperty('scene')
    expect(drawings.list({ workspaceId }).map((d) => d.id)).toEqual([a.id, b.id, c.id])
  })

  it('없는 그림을 읽으면 NotFoundError다', () => {
    expect(() => drawings.get('nope')).toThrow(/그림을 찾을 수 없습니다/)
  })

  it('장면을 저장하면 updatedAt이 오르고 읽으면 그 장면이다', () => {
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    const result = drawings.saveScene({ id: a.id, scene: scene(['r1']), expectedUpdatedAt: a.updatedAt })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.drawing.updatedAt).toBeGreaterThan(a.updatedAt)
    expect(result.drawing).not.toHaveProperty('scene')
    expect(drawings.get(a.id).scene).toBe(scene(['r1']))
  })

  it('읽은 뒤에 바뀌었으면 쓰지 않고 지금 것을 돌려준다', () => {
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    drawings.saveScene({ id: a.id, scene: scene(['mine']), expectedUpdatedAt: a.updatedAt })
    const stale = drawings.saveScene({ id: a.id, scene: scene(['theirs']), expectedUpdatedAt: a.updatedAt })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.current.scene).toBe(scene(['mine']))
    expect(drawings.get(a.id).scene).toBe(scene(['mine']))
  })

  it('같은 밀리초의 두 저장도 충돌을 잡는다 — updatedAt은 단조 증가한다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    const first = drawings.saveScene({ id: a.id, scene: scene(['1']), expectedUpdatedAt: a.updatedAt })
    expect(first.ok && first.drawing.updatedAt).toBe(5001)
    // 같은 밀리초에 옛 기대값으로 쓰면 충돌이다
    expect(drawings.saveScene({ id: a.id, scene: scene(['2']), expectedUpdatedAt: a.updatedAt }).ok).toBe(false)
  })

  it('모양이 틀린 장면은 쓰지 않고 던진다', () => {
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    expect(() => drawings.saveScene({ id: a.id, scene: '{"elements":1}', expectedUpdatedAt: a.updatedAt })).toThrow(/elements/)
    expect(drawings.get(a.id).scene).toBe(EMPTY_SCENE)
  })

  it('없는 그림에 저장하면 NotFoundError다', () => {
    expect(() => drawings.saveScene({ id: 'nope', scene: EMPTY_SCENE, expectedUpdatedAt: 0 })).toThrow(/그림을 찾을 수 없습니다/)
  })

  it('이름을 바꾸면 앞뒤 공백을 걷고 updatedAt을 올린다 — 비면 던진다', () => {
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    const renamed = drawings.rename(a.id, '  구조도 ')
    expect(renamed.title).toBe('구조도')
    expect(renamed.updatedAt).toBeGreaterThan(a.updatedAt)
    expect(() => drawings.rename(a.id, '   ')).toThrow(/이름/)
    expect(() => drawings.rename('nope', 'x')).toThrow(/그림을 찾을 수 없습니다/)
  })

  it('지우면 목록에서 빠진다 — 없는 id는 조용하다', () => {
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    drawings.remove(a.id)
    expect(drawings.list({ workspaceId })).toEqual([])
    expect(() => drawings.remove(a.id)).not.toThrow()
  })

  it('repo를 지우면 그 repo의 그림이 지워지고 다른 repo의 것은 남는다 (FR-7)', () => {
    drawings.create({ workspaceId, repoId: apiRepoId })
    const web = drawings.create({ workspaceId, repoId: webRepoId })
    createRepoRepository(db).remove(apiRepoId)
    expect(drawings.list({ workspaceId }).map((d) => d.id)).toEqual([web.id])
  })

  it('workspace를 지우면 그 그림이 다 지워진다 (FR-7)', () => {
    const a = drawings.create({ workspaceId, repoId: apiRepoId })
    createWorkspaceRepository(db).remove(workspaceId)
    expect(() => drawings.get(a.id)).toThrow(/그림을 찾을 수 없습니다/)
  })
})
