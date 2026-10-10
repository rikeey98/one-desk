import { describe, it, expect, vi } from 'vitest'
import { createCodeBufferStore } from './codeBuffers'

const REF = { workspaceId: 'w1', repoId: 'r1', path: 'src/a.ts' }
const OPENED = { text: 'a\n', hash: 'h1', eol: 'lf' as const, bom: false }

describe('codeBuffers (docs/sdlc/code-editor/ FR-20)', () => {
  it('연 버퍼는 고치기 전에는 깨끗하고, 고치면 고친 것 목록에 든다', () => {
    const store = createCodeBufferStore()
    store.load(REF, OPENED)
    expect(store.get(REF)).toMatchObject({ text: 'a\n', baseText: 'a\n', baseHash: 'h1', dirty: false, readOnly: false })
    expect(store.dirty()).toEqual([])

    store.edit(REF, 'b\n')
    expect(store.get(REF)).toMatchObject({ text: 'b\n', dirty: true })
    expect(store.dirty()).toEqual([{ ...REF }])

    // 원래대로 되돌리면 다시 깨끗하다
    store.edit(REF, 'a\n')
    expect(store.dirty()).toEqual([])
  })

  it('저장하면 기대 해시가 새 해시가 된다 — 두 번째 저장이 자기 자신과 충돌하지 않는다', () => {
    const store = createCodeBufferStore()
    store.load(REF, OPENED)
    store.edit(REF, 'b\n')
    store.markSaved(REF, 'b\n', 'h2')
    expect(store.get(REF)).toMatchObject({ baseText: 'b\n', baseHash: 'h2', diskHash: 'h2', dirty: false })
  })

  it('저장하는 사이 더 친 글자는 고친 것으로 남는다', () => {
    const store = createCodeBufferStore()
    store.load(REF, OPENED)
    store.edit(REF, 'b\n')
    // 'b\n'을 보내 놓고 응답을 기다리는 사이 더 쳤다
    store.edit(REF, 'bc\n')
    store.markSaved(REF, 'b\n', 'h2')
    expect(store.get(REF)).toMatchObject({ text: 'bc\n', baseText: 'b\n', baseHash: 'h2', dirty: true })
  })

  it('섞인 줄바꿈은 읽기 전용이고 고칠 수 없다 (FR-16)', () => {
    const store = createCodeBufferStore()
    store.load(REF, { ...OPENED, eol: 'mixed' })
    store.edit(REF, 'x')
    expect(store.get(REF)).toMatchObject({ readOnly: true, text: 'a\n', dirty: false })
  })

  it('디스크 바뀜을 기억한다 — 지워짐은 null이다 (FR-22)', () => {
    const store = createCodeBufferStore()
    store.load(REF, OPENED)
    expect(store.get(REF)?.diskHash).toBe('h1')
    store.setDisk(REF, 'h9')
    expect(store.get(REF)?.diskHash).toBe('h9')
    store.setDisk(REF, null)
    expect(store.get(REF)?.diskHash).toBeNull()
  })

  it('버리면 고친 것이 없어진다', () => {
    const store = createCodeBufferStore()
    store.load(REF, OPENED)
    store.edit(REF, 'b\n')
    store.discard(REF)
    expect(store.get(REF)).toMatchObject({ text: 'a\n', dirty: false })
  })

  it('다시 불러오면(디스크 내용 불러오기) 고친 것을 버리고 새 기준이 된다', () => {
    const store = createCodeBufferStore()
    store.load(REF, OPENED)
    store.edit(REF, 'mine\n')
    store.load(REF, { ...OPENED, text: 'agent\n', hash: 'h3' })
    expect(store.get(REF)).toMatchObject({ text: 'agent\n', baseHash: 'h3', dirty: false })
  })

  it('repo마다 연 파일과 펼친 폴더를 기억한다 (FR-7)', () => {
    const store = createCodeBufferStore()
    expect(store.openPath('r1')).toBeNull()
    store.setOpenPath('r1', 'src/a.ts')
    store.setOpenPath('r2', 'b.ts')
    store.toggleExpanded('r1', 'src')
    store.expand('r1', ['lib', 'lib/x'])
    expect(store.openPath('r1')).toBe('src/a.ts')
    expect(store.openPath('r2')).toBe('b.ts')
    expect([...store.expanded('r1')].sort()).toEqual(['lib', 'lib/x', 'src'])
    store.toggleExpanded('r1', 'src')
    expect(store.expanded('r1').has('src')).toBe(false)
    expect(store.expanded('r2').size).toBe(0)
  })

  it('바뀔 때마다 알리고 판(version)이 오른다 — 같은 값으로 고치면 알리지 않는다', () => {
    const store = createCodeBufferStore()
    const listener = vi.fn()
    const off = store.subscribe(listener)
    const v0 = store.version()
    store.load(REF, OPENED)
    store.edit(REF, 'a\n')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.version()).toBeGreaterThan(v0)
    off()
    store.edit(REF, 'z')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('닫기 확인 요청을 세우고 내린다', () => {
    const store = createCodeBufferStore()
    expect(store.closeRequest()).toBeNull()
    store.requestClose()
    expect(store.closeRequest()).toEqual({ failures: [] })
    store.requestClose([{ path: 'a.ts', reason: '디스크에서 바뀌어 저장하지 않았습니다' }])
    expect(store.closeRequest()?.failures).toHaveLength(1)
    store.clearCloseRequest()
    expect(store.closeRequest()).toBeNull()
  })
})
