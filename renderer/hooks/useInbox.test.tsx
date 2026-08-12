import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { useInbox } from './useInbox'
import type { OneDeskClient } from '@shared/client'
import type { InboxCounts } from '@shared/models'
import type { ReactNode } from 'react'

function wrap(client: OneDeskClient) {
  return ({ children }: { children: ReactNode }) => (
    <ClientProvider client={client}>{children}</ClientProvider>
  )
}

describe('useInbox', () => {
  it('인박스가 열려 있으면 목록과 건수를 읽는다', async () => {
    const client = {
      runs: {
        inbox: vi.fn().mockResolvedValue([{ id: 'r1' }]),
        inboxCounts: vi.fn().mockResolvedValue({ total: 1, byWorkspace: { w1: 1 } })
      },
      events: { onInboxUpdate: vi.fn(() => () => {}) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(true), { wrapper: wrap(client) })
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
      expect(result.current.counts.total).toBe(1)
    })
  })

  it('인박스가 닫혀 있으면 push된 건수만 쓰고 목록은 읽지 않는다', async () => {
    // run 행이 바뀔 때마다 전체 미확인 run 조회와 맥락 hydrate가 도는 것은
    // 인박스를 한 번도 열지 않은 사용자에게는 순수한 비용이다 (설계 §8의 무인덱스 한계).
    const state: { fire: ((counts: InboxCounts) => void) | null } = { fire: null }
    const client = {
      runs: {
        inbox: vi.fn().mockResolvedValue([{ id: 'r1' }]),
        inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} })
      },
      events: {
        onInboxUpdate: vi.fn((cb: (counts: InboxCounts) => void) => { state.fire = cb; return () => {} })
      }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(false), { wrapper: wrap(client) })
    await waitFor(() => expect(client.runs.inboxCounts).toHaveBeenCalled())

    act(() => state.fire?.({ total: 4, byWorkspace: { w1: 4 } }))

    await waitFor(() => expect(result.current.counts.total).toBe(4))
    expect(client.runs.inbox).not.toHaveBeenCalled()
  })

  it('push가 오면 다시 읽는다', async () => {
    // let으로 캡처한 콜백을 그 스코프 밖에서 바로 호출하면(fire?.()) tsc가
    // "Type 'never' has no call signatures"로 컴파일을 거부한다(실측, 내부
    // 메커니즘은 미확인). 객체 프로퍼티에 담으면 이 오류 없이 컴파일된다.
    const state: { fire: ((counts: InboxCounts) => void) | null } = { fire: null }
    const client = {
      runs: {
        inbox: vi.fn().mockResolvedValue([]),
        inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} })
      },
      events: { onInboxUpdate: vi.fn((cb: (counts: InboxCounts) => void) => { state.fire = cb; return () => {} }) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(true), { wrapper: wrap(client) })
    await waitFor(() => expect(client.runs.inbox).toHaveBeenCalledTimes(1))

    state.fire?.({ total: 0, byWorkspace: {} })

    await waitFor(() => expect(client.runs.inbox).toHaveBeenCalledTimes(2))
    expect(result.current.error).toBeNull()
  })

  it('조회에 실패하면 오류를 드러내고, 이후 성공하면 지운다', async () => {
    // 조용히 감추면 "처리할 것이 없다"와 "못 읽었다"가 구별되지 않는다.
    const state: { fire: ((counts: InboxCounts) => void) | null } = { fire: null }
    const inbox = vi.fn()
      .mockRejectedValueOnce(new Error('읽기 실패'))
      .mockResolvedValue([])
    const client = {
      runs: { inbox, inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} }) },
      events: { onInboxUpdate: vi.fn((cb: (counts: InboxCounts) => void) => { state.fire = cb; return () => {} }) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.error).toBe('읽기 실패'))

    state.fire?.({ total: 0, byWorkspace: {} })

    await waitFor(() => expect(result.current.error).toBeNull())
  })
})
