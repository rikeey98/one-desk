import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { useQueue } from './useQueue'
import type { OneDeskClient } from '@shared/client'
import type { QueueSnapshot } from '@shared/models'

/** onQueueUpdate로 push를 직접 쏠 수 있는 클라이언트. */
function makeClient(queueSnapshot: () => Promise<QueueSnapshot>) {
  let push: ((snapshot: QueueSnapshot) => void) | null = null
  const client = {
    runs: { queueSnapshot: vi.fn(queueSnapshot) },
    events: {
      onQueueUpdate: vi.fn((cb: (s: QueueSnapshot) => void) => {
        push = cb
        return () => { push = null }
      })
    }
  } as unknown as OneDeskClient
  return { client, push: (s: QueueSnapshot) => act(() => push?.(s)) }
}

function renderUseQueue(client: OneDeskClient) {
  return renderHook(() => useQueue(), {
    wrapper: ({ children }) => <ClientProvider client={client}>{children}</ClientProvider>
  })
}

describe('useQueue', () => {
  it('초기 조회가 실패하면 오류를 낸다', async () => {
    const { client } = makeClient(() => Promise.reject(new Error('큐 상태를 불러오지 못했습니다')))
    const { result } = renderUseQueue(client)
    await waitFor(() => expect(result.current.error).toBe('큐 상태를 불러오지 못했습니다'))
    expect(result.current.snapshot).toBeNull()
  })

  it('push가 도착하면 이전 조회 실패를 지운다', async () => {
    // Dock은 queueError를 logError보다 앞에 둔다. 부팅 때의 일시적 실패가 그대로
    // 남으면 이후 모든 run 로그 오류가 그 낡은 문구에 영구히 가려진다.
    const { client, push } = makeClient(() => Promise.reject(new Error('큐 상태를 불러오지 못했습니다')))
    const { result } = renderUseQueue(client)
    await waitFor(() => expect(result.current.error).not.toBeNull())

    push({ running: 1, limit: 3, waiting: 0 })

    expect(result.current.snapshot).toEqual({ running: 1, limit: 3, waiting: 0 })
    expect(result.current.error).toBeNull()
  })
})
