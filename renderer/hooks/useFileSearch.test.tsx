import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ClientProvider } from '../client/ClientProvider'
import { useFileSearch, FILE_SEARCH_DEBOUNCE_MS } from './useFileSearch'
import type { OneDeskClient } from '@shared/client'
import type { FileSearchResult } from '@shared/models'

afterEach(() => { vi.useRealTimers() })

function withClient(search: OneDeskClient['files']['search']) {
  const client = { files: { search } } as unknown as OneDeskClient
  return ({ children }: { children: ReactNode }) => <ClientProvider client={client}>{children}</ClientProvider>
}

function deferred() {
  let resolve!: (value: FileSearchResult) => void
  const promise = new Promise<FileSearchResult>((r) => { resolve = r })
  return { promise, resolve }
}

describe('useFileSearch (docs/sdlc/input-triggers/ §5-4)', () => {
  it('늦게 온 옛 질의의 응답이 새 결과를 덮지 않는다', async () => {
    vi.useFakeTimers()
    const old = deferred()
    const fresh = deferred()
    const search = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const { result, rerender } = renderHook(({ q }) => useFileSearch('w1', 'r1', q, true), {
      initialProps: { q: 'a' }, wrapper: withClient(search)
    })

    await act(async () => { vi.advanceTimersByTime(FILE_SEARCH_DEBOUNCE_MS) })
    rerender({ q: 'ab' })
    await act(async () => { vi.advanceTimersByTime(FILE_SEARCH_DEBOUNCE_MS) })
    await act(async () => { fresh.resolve({ ok: true, files: [{ path: 'ab.ts' }], truncated: false }) })
    await act(async () => { old.resolve({ ok: true, files: [{ path: 'a.ts' }], truncated: false }) })

    expect(result.current.files).toEqual([{ path: 'ab.ts' }])
    expect(search).toHaveBeenLastCalledWith({ workspaceId: 'w1', repoId: 'r1', query: 'ab' })
  })

  it('꺼져 있거나 repo가 없으면 부르지 않는다', async () => {
    vi.useFakeTimers()
    const search = vi.fn()
    renderHook(() => useFileSearch('w1', 'r1', 'a', false), { wrapper: withClient(search) })
    renderHook(() => useFileSearch('w1', null, 'a', true), { wrapper: withClient(search) })
    await act(async () => { vi.advanceTimersByTime(FILE_SEARCH_DEBOUNCE_MS * 2) })
    expect(search).not.toHaveBeenCalled()
  })

  it('디바운스 안의 연속 입력은 한 번만 부른다', async () => {
    vi.useFakeTimers()
    const search = vi.fn().mockResolvedValue({ ok: true, files: [], truncated: false })
    const { rerender } = renderHook(({ q }) => useFileSearch('w1', 'r1', q, true), {
      initialProps: { q: 'a' }, wrapper: withClient(search)
    })
    rerender({ q: 'ab' })
    rerender({ q: 'abc' })
    await act(async () => { vi.advanceTimersByTime(FILE_SEARCH_DEBOUNCE_MS) })

    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1', query: 'abc' })
  })
})
