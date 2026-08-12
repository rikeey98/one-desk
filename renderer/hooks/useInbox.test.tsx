import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { useInbox } from './useInbox'
import type { OneDeskClient } from '@shared/client'
import type { ReactNode } from 'react'

function wrap(client: OneDeskClient) {
  return ({ children }: { children: ReactNode }) => (
    <ClientProvider client={client}>{children}</ClientProvider>
  )
}

describe('useInbox', () => {
  it('처음에 목록과 건수를 읽는다', async () => {
    const client = {
      runs: {
        inbox: vi.fn().mockResolvedValue([{ id: 'r1' }]),
        inboxCounts: vi.fn().mockResolvedValue({ total: 1, byWorkspace: { w1: 1 } })
      },
      events: { onInboxUpdate: vi.fn(() => () => {}) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(), { wrapper: wrap(client) })
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
      expect(result.current.counts.total).toBe(1)
    })
  })

  it('push가 오면 다시 읽는다', async () => {
    // let으로 캡처한 콜백을 그 스코프 밖에서 바로 호출하면(fire?.()) tsc가
    // "Type 'never' has no call signatures"로 컴파일을 거부한다(실측, 내부
    // 메커니즘은 미확인). 객체 프로퍼티에 담으면 이 오류 없이 컴파일된다.
    const state: { fire: (() => void) | null } = { fire: null }
    const client = {
      runs: {
        inbox: vi.fn().mockResolvedValue([]),
        inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} })
      },
      events: { onInboxUpdate: vi.fn((cb: () => void) => { state.fire = cb; return () => {} }) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(), { wrapper: wrap(client) })
    await waitFor(() => expect(client.runs.inbox).toHaveBeenCalledTimes(1))

    state.fire?.()

    await waitFor(() => expect(client.runs.inbox).toHaveBeenCalledTimes(2))
    expect(result.current.error).toBeNull()
  })

  it('조회에 실패하면 오류를 드러내고, 이후 성공하면 지운다', async () => {
    // 조용히 감추면 "처리할 것이 없다"와 "못 읽었다"가 구별되지 않는다.
    const state: { fire: (() => void) | null } = { fire: null }
    const inbox = vi.fn()
      .mockRejectedValueOnce(new Error('읽기 실패'))
      .mockResolvedValue([])
    const client = {
      runs: { inbox, inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} }) },
      events: { onInboxUpdate: vi.fn((cb: () => void) => { state.fire = cb; return () => {} }) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.error).toBe('읽기 실패'))

    state.fire?.()

    await waitFor(() => expect(result.current.error).toBeNull())
  })
})
