import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { HOME_LIVE_REFRESH_MS, useHome, useHomeCount } from './useHome'
import type { OneDeskClient } from '@shared/client'
import type { HomeSummary, ItemChange } from '@shared/models'
import type { ReactNode } from 'react'

function wrap(client: OneDeskClient) {
  return ({ children }: { children: ReactNode }) => (
    <ClientProvider client={client}>{children}</ClientProvider>
  )
}

function summaryOf(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    running: [], queued: 0, slots: { used: 0, limit: 2 }, todos: [], timeline: [], workspaces: [], doneToday: [],
    setup: { workspace: true, repo: true, firstRun: true }, ...over
  }
}

type Fire = {
  run: (() => void) | null
  inbox: (() => void) | null
  queue: (() => void) | null
  item: ((change: ItemChange) => void) | null
}

function makeClient(summary: HomeSummary = summaryOf(), count = 3) {
  const fire: Fire = { run: null, inbox: null, queue: null, item: null }
  const client = {
    home: {
      summary: vi.fn().mockResolvedValue(summary),
      count: vi.fn().mockResolvedValue(count),
      lastTarget: vi.fn().mockResolvedValue({ workspaceId: 'w', repoId: 'r' })
    },
    events: {
      onRunUpdate: vi.fn((cb: () => void) => { fire.run = cb; return () => { fire.run = null } }),
      onInboxUpdate: vi.fn((cb: () => void) => { fire.inbox = cb; return () => { fire.inbox = null } }),
      onQueueUpdate: vi.fn((cb: () => void) => { fire.queue = cb; return () => { fire.queue = null } }),
      onItemChanged: vi.fn((cb: (change: ItemChange) => void) => { fire.item = cb; return () => { fire.item = null } })
    }
  } as unknown as OneDeskClient
  return { client, fire }
}

afterEach(() => { vi.useRealTimers() })

describe('useHome', () => {
  it('홈이 보이면 오늘(로컬 자정)을 넘겨 요약을 읽는다', async () => {
    const { client } = makeClient(summaryOf({ queued: 2 }))
    const { result } = renderHook(() => useHome(true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.summary?.queued).toBe(2))
    expect(result.current.lastTarget).toEqual({ workspaceId: 'w', repoId: 'r' })
    const input = (client.home.summary as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { now: number; dayStart: number }
    const expected = new Date(input.now)
    expected.setHours(0, 0, 0, 0)
    expect(input.dayStart).toBe(expected.getTime())
  })

  it('홈이 보이지 않으면 읽지도 구독하지도 않는다 — workspace 화면에서 모든 workspace를 긁지 않는다', () => {
    const { client } = makeClient()
    renderHook(() => useHome(false), { wrapper: wrap(client) })
    expect(client.home.summary).not.toHaveBeenCalled()
    expect(client.events.onRunUpdate).not.toHaveBeenCalled()
  })

  it('run 변화 · 인박스 · 슬롯 · 이슈 변경(어느 workspace든)에 다시 읽는다', async () => {
    const { client, fire } = makeClient()
    renderHook(() => useHome(true), { wrapper: wrap(client) })
    await waitFor(() => expect(client.home.summary).toHaveBeenCalledTimes(1))
    act(() => fire.run?.())
    act(() => fire.inbox?.())
    act(() => fire.queue?.())
    act(() => fire.item?.({ kind: 'issue', workspaceId: 'other', id: 'i' } as ItemChange))
    await waitFor(() => expect(client.home.summary).toHaveBeenCalledTimes(5))
    // 메모 변경은 홈과 무관하다
    act(() => fire.item?.({ kind: 'memo', workspaceId: 'other', id: 'm' } as ItemChange))
    expect(client.home.summary).toHaveBeenCalledTimes(5)
  })

  it('도는 턴이 있는 동안 2초마다 다시 읽고, 없으면 타이머가 없다 (plan 개정 7)', async () => {
    // 실제 시간도 흐르게 두어야 waitFor가 돈다 — 타이머만 앞당긴다
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const running = summaryOf({
      running: [{
        workspaceId: 'w', workspaceName: 'w', repoId: null, repoName: null, conversationId: 'c', runId: 'r', title: 't',
        turns: 1, startedAt: 1, currentTool: null, lastText: null
      }]
    })
    const { client } = makeClient(running)
    const { result } = renderHook(() => useHome(true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.summary?.running).toHaveLength(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(HOME_LIVE_REFRESH_MS * 2 + 10) })
    expect((client.home.summary as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3)

    const idle = makeClient(summaryOf())
    const r2 = renderHook(() => useHome(true), { wrapper: wrap(idle.client) })
    await waitFor(() => expect(r2.result.current.summary).not.toBeNull())
    await act(async () => { await vi.advanceTimersByTimeAsync(HOME_LIVE_REFRESH_MS * 3) })
    expect(idle.client.home.summary).toHaveBeenCalledTimes(1)
  })

  it('실패하면 오류를 말하고, 다음 성공이 그것을 지운다', async () => {
    const { client, fire } = makeClient()
    ;(client.home.summary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB 잠김'))
    const { result } = renderHook(() => useHome(true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.error).toBe('DB 잠김'))
    act(() => fire.inbox?.())
    await waitFor(() => expect(result.current.error).toBeNull())
  })
})

describe('useHomeCount', () => {
  it('늘 count를 읽고 인박스 변화·이슈 변경에 다시 읽는다 — 요약 전체는 읽지 않는다', async () => {
    const { client, fire } = makeClient(summaryOf(), 4)
    const { result } = renderHook(() => useHomeCount(), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current).toBe(4))
    ;(client.home.count as ReturnType<typeof vi.fn>).mockResolvedValue(5)
    act(() => fire.inbox?.())
    await waitFor(() => expect(result.current).toBe(5))
    ;(client.home.count as ReturnType<typeof vi.fn>).mockResolvedValue(6)
    act(() => fire.item?.({ kind: 'issue', workspaceId: 'any', id: 'i' } as ItemChange))
    await waitFor(() => expect(result.current).toBe(6))
    expect(client.home.summary).not.toHaveBeenCalled()
  })
})
