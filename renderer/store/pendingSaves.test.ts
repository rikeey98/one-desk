import { describe, it, expect, vi } from 'vitest'
import { createPendingSaves, guardUnload, type PendingSave } from './pendingSaves'

function entry(busy: boolean, result: boolean | Error = true): PendingSave & { flushed: number } {
  const e = {
    flushed: 0,
    busy: () => busy,
    flush: async () => {
      e.flushed++
      if (result instanceof Error) throw result
      return result
    }
  }
  return e
}

function unloadEvent() {
  return { preventDefault: vi.fn(), returnValue: undefined as unknown } as unknown as BeforeUnloadEvent & {
    preventDefault: ReturnType<typeof vi.fn>
  }
}

describe('PendingSaves', () => {
  it('하나라도 바쁘면 바쁘고, 해제하면 빠진다', () => {
    const saves = createPendingSaves()
    expect(saves.busy()).toBe(false)
    saves.register(entry(false))
    const off = saves.register(entry(true))
    expect(saves.busy()).toBe(true)
    off()
    expect(saves.busy()).toBe(false)
  })

  it('flushAll은 전부 흘려보내고, 실패나 예외가 하나라도 있으면 false다', async () => {
    const saves = createPendingSaves()
    const a = entry(true)
    const b = entry(true, false)
    saves.register(a)
    saves.register(b)
    expect(await saves.flushAll()).toBe(false)
    expect(a.flushed + b.flushed).toBe(2)

    const ok = createPendingSaves()
    ok.register(entry(true))
    expect(await ok.flushAll()).toBe(true)

    const thrown = createPendingSaves()
    thrown.register(entry(true, new Error('x')))
    expect(await thrown.flushAll()).toBe(false)
  })
})

describe('guardUnload', () => {
  it('바쁘지 않으면 닫기를 막지 않는다', () => {
    const close = vi.fn()
    const event = unloadEvent()
    guardUnload(createPendingSaves(), close)(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('바쁘면 닫기를 미루고, 흘려보낸 뒤 스스로 닫는다', async () => {
    const saves = createPendingSaves()
    let busy = true
    saves.register({ busy: () => busy, flush: async () => { busy = false; return true } })
    const close = vi.fn()
    const event = unloadEvent()
    guardUnload(saves, close)(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.returnValue).toBe('')
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('저장이 실패하면 닫지 않는다', async () => {
    const saves = createPendingSaves()
    const failing = entry(true, false)
    saves.register(failing)
    const close = vi.fn()
    guardUnload(saves, close)(unloadEvent())
    await vi.waitFor(() => expect(failing.flushed).toBe(1))
    // flushAll이 끝나고 then이 돌 때까지 기다린다 — 마이크로태스크 한 번으로는 이르다.
    await new Promise((r) => setTimeout(r, 0))
    expect(close).not.toHaveBeenCalled()
  })

  it('흘려보내는 중에 다시 닫으려 해도 한 번만 흘려보낸다', async () => {
    const saves = createPendingSaves()
    let release!: () => void
    let calls = 0
    saves.register({ busy: () => true, flush: () => { calls++; return new Promise((r) => { release = () => r(true) }) } })
    const close = vi.fn()
    const guard = guardUnload(saves, close)
    guard(unloadEvent())
    guard(unloadEvent())
    expect(calls).toBe(1)
    release()
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })
})
