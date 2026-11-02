import { describe, it, expect, vi } from 'vitest'
import { createDrawingSync, parseSceneElements, sceneKey, sceneText, type SceneElement, type SyncDeps } from './sync'
import type { Drawing, SaveSceneInput, SaveSceneResult } from '@shared/models'

const el = (id: string, version = 1, extra: Partial<SceneElement> = {}): SceneElement =>
  ({ id, version, versionNonce: version * 7, ...extra })

function drawing(elements: SceneElement[], updatedAt: number): Drawing {
  return { id: 'd1', workspaceId: 'w', repoId: 'r', title: '그림 1', createdAt: 1, updatedAt, scene: sceneText(elements) }
}

/** 가짜 합치기 — 같은 id면 버전이 큰 쪽(Excalidraw의 규칙을 흉내낸다), 한쪽에만 있으면 남긴다 */
function fakeReconcile(local: readonly SceneElement[], remote: readonly SceneElement[]): SceneElement[] {
  const byId = new Map<string, SceneElement>()
  for (const r of remote) byId.set(r.id, r)
  for (const l of local) {
    const r = byId.get(l.id)
    if (!r || l.version > r.version) byId.set(l.id, l)
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** 캔버스 대역 — 요소를 들고 있고 apply가 바꾼다 */
function harness(initial: Drawing, overrides: Partial<SyncDeps> = {}) {
  let canvas: SceneElement[] = parseSceneElements(initial.scene)
  const saves: SaveSceneInput[] = []
  const applied: SceneElement[][] = []
  const deps: SyncDeps = {
    drawingId: initial.id,
    load: vi.fn(async () => null),
    save: vi.fn(async (input: SaveSceneInput): Promise<SaveSceneResult> => {
      saves.push(input)
      return { ok: true, drawing: { ...initial, updatedAt: input.expectedUpdatedAt + 1 } }
    }),
    reconcile: fakeReconcile,
    getElements: () => canvas,
    apply: (els) => { canvas = els; applied.push(els) },
    onDeleted: vi.fn(),
    ...overrides
  }
  const sync = createDrawingSync(deps, initial)
  return {
    sync, deps, saves, applied,
    draw: (els: SceneElement[]) => { canvas = els },
    canvas: () => canvas
  }
}

describe('장면 직렬화 (docs/sdlc/drawings/ spec §2)', () => {
  it('지운 요소를 남겨 저장한다 — 묘비가 없으면 다른 창이 그것을 되살린다', () => {
    const text = sceneText([el('a'), el('b', 2, { isDeleted: true })])
    expect(JSON.parse(text)).toEqual({
      type: 'excalidraw', version: 2, source: 'one-desk',
      elements: [el('a'), el('b', 2, { isDeleted: true })]
    })
    expect(parseSceneElements(text).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('읽을 수 없는 장면은 빈 배열이다', () => {
    expect(parseSceneElements('{')).toEqual([])
    expect(parseSceneElements('{"elements":3}')).toEqual([])
  })

  it('열쇠는 요소의 버전이 바뀌면 바뀌고 같으면 같다', () => {
    expect(sceneKey([el('a', 1)])).toBe(sceneKey([el('a', 1)]))
    expect(sceneKey([el('a', 2)])).not.toBe(sceneKey([el('a', 1)]))
    expect(sceneKey([el('a', 1), el('b', 1)])).not.toBe(sceneKey([el('a', 1)]))
    expect(sceneKey([el('a', 1, { versionNonce: 5 })])).not.toBe(sceneKey([el('a', 1, { versionNonce: 6 })]))
  })
})

describe('그림 동기화 (docs/sdlc/drawings/ spec FR-21)', () => {
  it('요소 버전이 그대로면(선택·스크롤만 바뀜) 저장하지 않는다', async () => {
    const h = harness(drawing([el('a')], 10))
    expect(h.sync.needsSave(h.canvas())).toBe(false)
    expect(await h.sync.save()).toBe(true)
    expect(h.saves).toEqual([])
  })

  it('바뀌면 저장하고 기대값을 응답의 것으로 올린다', async () => {
    const h = harness(drawing([el('a')], 10))
    h.draw([el('a', 2)])
    expect(h.sync.needsSave(h.canvas())).toBe(true)
    expect(await h.sync.save()).toBe(true)
    expect(h.saves).toHaveLength(1)
    expect(h.saves[0]!.expectedUpdatedAt).toBe(10)
    expect(parseSceneElements(h.saves[0]!.scene)).toEqual([el('a', 2)])
    // 같은 것을 다시 저장하지 않는다
    expect(h.sync.needsSave(h.canvas())).toBe(false)
    h.draw([el('a', 3)])
    await h.sync.save()
    expect(h.saves[1]!.expectedUpdatedAt).toBe(11)
  })

  it('충돌하면 합쳐서 캔버스에 넣고 그 위에서 다시 저장한다', async () => {
    const theirs = drawing([el('a', 5), el('b', 1)], 20)
    let first = true
    const h = harness(drawing([el('a')], 10), {
      save: vi.fn(async (input: SaveSceneInput): Promise<SaveSceneResult> => {
        if (first) { first = false; return { ok: false, current: theirs } }
        return { ok: true, drawing: { ...theirs, updatedAt: input.expectedUpdatedAt + 1 } }
      })
    })
    h.draw([el('a', 1), el('c', 1)])
    expect(await h.sync.save()).toBe(true)
    // 합친 것: 남의 a(5)·b, 내 c
    expect(h.canvas().map((e) => `${e.id}${e.version}`)).toEqual(['a5', 'b1', 'c1'])
    const second = (h.deps.save as ReturnType<typeof vi.fn>).mock.calls[1]![0] as SaveSceneInput
    expect(second.expectedUpdatedAt).toBe(20)
    expect(parseSceneElements(second.scene).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('합친 것이 남의 것과 같으면 다시 저장하지 않는다', async () => {
    const theirs = drawing([el('a', 5)], 20)
    const save = vi.fn(async (): Promise<SaveSceneResult> => ({ ok: false, current: theirs }))
    const h = harness(drawing([el('a')], 10), { save })
    h.draw([el('a', 2)])
    expect(await h.sync.save()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(h.canvas()).toEqual([el('a', 5)])
  })

  it('세 번 연달아 충돌하면 실패다', async () => {
    let n = 0
    const save = vi.fn(async (): Promise<SaveSceneResult> => {
      n += 1
      return { ok: false, current: drawing([el(`x${n}`)], 20 + n) }
    })
    const h = harness(drawing([el('a')], 10), { save })
    h.draw([el('a', 2)])
    expect(await h.sync.save()).toBe(false)
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('남이 저장했으면 다시 읽어 합친다 — 내게 저장 안 한 고친 것이 있으면 그것이 다음 저장거리다', async () => {
    const theirs = drawing([el('a', 1), el('b', 1)], 30)
    const load = vi.fn(async () => theirs)
    const h = harness(drawing([el('a')], 10), { load })
    h.draw([el('a', 2)])
    await h.sync.remoteChanged()
    expect(h.canvas().map((e) => `${e.id}${e.version}`)).toEqual(['a2', 'b1'])
    expect(h.sync.needsSave(h.canvas())).toBe(true)
    await h.sync.save()
    expect(h.saves[0]!.expectedUpdatedAt).toBe(30)
  })

  it('남의 바뀜이 내 것과 겹치지 않으면 합친 뒤 저장할 것이 없다', async () => {
    const theirs = drawing([el('a', 1), el('b', 1)], 30)
    const h = harness(drawing([el('a')], 10), { load: vi.fn(async () => theirs) })
    await h.sync.remoteChanged()
    expect(h.canvas().map((e) => e.id)).toEqual(['a', 'b'])
    expect(h.sync.needsSave(h.canvas())).toBe(false)
  })

  it('이미 아는 판(updatedAt ≤ 기대값)이면 캔버스를 건드리지 않는다', async () => {
    const h = harness(drawing([el('a')], 10), { load: vi.fn(async () => drawing([el('zzz')], 10)) })
    await h.sync.remoteChanged()
    expect(h.applied).toEqual([])
  })

  it('내 저장의 메아리는 캔버스를 건드리지 않는다 — 응답보다 알림이 먼저 와도', async () => {
    let release: (r: SaveSceneResult) => void = () => {}
    const saved: SceneElement[] = [el('a', 2)]
    const h = harness(drawing([el('a')], 10), {
      save: vi.fn((): Promise<SaveSceneResult> => new Promise((r) => { release = r })),
      load: vi.fn(async () => drawing(saved, 11))
    })
    h.draw(saved)
    const pending = h.sync.save()
    // 저장이 날아가는 사이 사용자가 또 그렸다 — 메아리가 이것을 덮으면 안 된다
    h.draw([el('a', 3)])
    await h.sync.remoteChanged()
    expect(h.applied).toEqual([])
    release({ ok: true, drawing: { ...drawing(saved, 11) } })
    expect(await pending).toBe(true)
    expect(h.sync.needsSave(h.canvas())).toBe(true)
    const next = h.sync.save()
    release({ ok: true, drawing: { ...drawing([el('a', 3)], 12) } })
    await next
    const calls = (h.deps.save as ReturnType<typeof vi.fn>).mock.calls as [SaveSceneInput][]
    expect(calls.at(-1)![0].expectedUpdatedAt).toBe(11)
  })

  it('다시 읽었더니 지워졌으면 알리고, 그 뒤로는 저장하지 않는다', async () => {
    const h = harness(drawing([el('a')], 10), { load: vi.fn(async () => null) })
    await h.sync.remoteChanged()
    expect(h.deps.onDeleted).toHaveBeenCalledTimes(1)
    h.draw([el('a', 2)])
    expect(h.sync.needsSave(h.canvas())).toBe(false)
    expect(await h.sync.save()).toBe(true)
    expect(h.deps.save).not.toHaveBeenCalled()
  })

  it('저장이 던졌는데 그림이 지워졌으면 실패가 아니다 — 창 닫기를 막지 않는다', async () => {
    const h = harness(drawing([el('a')], 10), {
      save: vi.fn(async () => { throw new Error('그림을 찾을 수 없습니다: d1') }),
      load: vi.fn(async () => null)
    })
    h.draw([el('a', 2)])
    expect(await h.sync.save()).toBe(true)
    expect(h.deps.onDeleted).toHaveBeenCalledTimes(1)
  })

  it('저장이 던졌고 그림이 있으면 실패다 — 오류를 던지지 않고 false로 알린다', async () => {
    const onError = vi.fn()
    const h = harness(drawing([el('a')], 10), {
      save: vi.fn(async () => { throw new Error('그림이 너무 큽니다 (8 MiB 초과)') }),
      load: vi.fn(async () => drawing([el('a')], 10)),
      onError
    })
    h.draw([el('a', 2)])
    expect(await h.sync.save()).toBe(false)
    expect(onError).toHaveBeenCalledWith('그림이 너무 큽니다 (8 MiB 초과)')
  })
})
