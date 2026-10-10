import { describe, it, expect, vi } from 'vitest'
import { createCloseGuard } from './closeGuard'
import { createCodeBufferStore } from './codeBuffers'
import { createPendingSaves, type PendingSave } from './pendingSaves'
import type { FileSaveInput, FileSaveResult } from '@shared/models'

function unloadEvent() {
  return { preventDefault: vi.fn(), returnValue: undefined as unknown } as unknown as BeforeUnloadEvent & {
    preventDefault: ReturnType<typeof vi.fn>
  }
}

const A = { workspaceId: 'w1', repoId: 'r1', path: 'a.ts' }
const B = { workspaceId: 'w1', repoId: 'r2', path: 'b.ts' }
const OPENED = { text: 'x\n', hash: 'h1', eol: 'lf' as const, bom: false }

function setup(save: (input: FileSaveInput) => Promise<FileSaveResult> = async () => ({ ok: true, hash: 'new' })) {
  const saves = createPendingSaves()
  const buffers = createCodeBufferStore()
  const close = vi.fn()
  const saveFile = vi.fn(save)
  const guard = createCloseGuard({ saves, buffers, close, save: saveFile })
  return { saves, buffers, close, saveFile, guard }
}

describe('closeGuard (docs/sdlc/code-editor/ FR-21, spec §4의 6)', () => {
  it('대기 저장도 고친 버퍼도 없으면 막지 않는다', () => {
    const { guard, buffers } = setup()
    const e = unloadEvent()
    guard.onBeforeUnload(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(buffers.closeRequest()).toBeNull()
  })

  it('고친 버퍼가 있으면 닫기를 멈추고 앱 안 확인을 요청한다', () => {
    const { guard, buffers, close } = setup()
    buffers.load(A, OPENED)
    buffers.edit(A, 'y\n')
    const e = unloadEvent()
    guard.onBeforeUnload(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(buffers.closeRequest()).toEqual({ failures: [] })
    expect(close).not.toHaveBeenCalled()
  })

  it('대기 저장이 먼저다 — 흘려보내고 닫기를 다시 부르며, 그때 고친 버퍼를 본다', async () => {
    const { guard, saves, buffers, close } = setup()
    let busy = true
    const entry: PendingSave = { busy: () => busy, flush: async () => { busy = false; return true } }
    saves.register(entry)
    buffers.load(A, OPENED)
    buffers.edit(A, 'y\n')

    guard.onBeforeUnload(unloadEvent())
    // 아직 확인을 묻지 않았다 — 대기 저장을 흘려보내는 중이다
    expect(buffers.closeRequest()).toBeNull()
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))

    // close()가 다시 부른 beforeunload — 이번엔 고친 버퍼 때문에 멈춘다
    const second = unloadEvent()
    guard.onBeforeUnload(second)
    expect(second.preventDefault).toHaveBeenCalled()
    expect(buffers.closeRequest()).toEqual({ failures: [] })
  })

  it('취소하면 요청을 내리고 닫지 않는다', async () => {
    const { guard, buffers, close } = setup()
    buffers.load(A, OPENED)
    buffers.edit(A, 'y\n')
    guard.onBeforeUnload(unloadEvent())
    await guard.answer('cancel')
    expect(buffers.closeRequest()).toBeNull()
    expect(close).not.toHaveBeenCalled()
  })

  it('저장하지 않고 닫기는 다음 beforeunload를 막지 않는다', async () => {
    const { guard, buffers, close } = setup()
    buffers.load(A, OPENED)
    buffers.edit(A, 'y\n')
    guard.onBeforeUnload(unloadEvent())
    await guard.answer('discard')
    expect(close).toHaveBeenCalledTimes(1)
    const again = unloadEvent()
    guard.onBeforeUnload(again)
    expect(again.preventDefault).not.toHaveBeenCalled()
  })

  it('모두 저장하고 닫기는 고친 버퍼를 기대 해시와 함께 저장하고 닫는다', async () => {
    const { guard, buffers, close, saveFile } = setup()
    buffers.load(A, OPENED)
    buffers.edit(A, 'y\n')
    buffers.load(B, { ...OPENED, hash: 'hb' })
    buffers.edit(B, 'z\n')
    guard.onBeforeUnload(unloadEvent())

    await guard.answer('save')

    expect(saveFile).toHaveBeenCalledWith({ ...A, content: 'y\n', expectedHash: 'h1' })
    expect(saveFile).toHaveBeenCalledWith({ ...B, content: 'z\n', expectedHash: 'hb' })
    expect(buffers.dirty()).toEqual([])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('하나라도 충돌·실패·예외면 닫지 않고, 무엇이 왜 남았는지 확인 창에 남긴다', async () => {
    const { guard, buffers, close } = setup(async (input) => {
      if (input.path === 'a.ts') return { ok: false, conflict: { hash: 'h9', deleted: false } }
      throw new Error('IPC 끊김')
    })
    buffers.load(A, OPENED)
    buffers.edit(A, 'y\n')
    buffers.load(B, OPENED)
    buffers.edit(B, 'z\n')
    guard.onBeforeUnload(unloadEvent())

    await guard.answer('save')

    expect(close).not.toHaveBeenCalled()
    expect(buffers.closeRequest()?.failures).toEqual([
      { path: 'a.ts', reason: '디스크에서 바뀌어 저장하지 않았습니다' },
      { path: 'b.ts', reason: 'IPC 끊김' }
    ])
    expect(buffers.dirty()).toHaveLength(2)
  })
})
