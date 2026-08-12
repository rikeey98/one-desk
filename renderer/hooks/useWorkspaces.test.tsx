import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { useWorkspaces } from './useWorkspaces'
import type { OneDeskClient } from '@shared/client'
import type { ReactNode } from 'react'

// 이 훅은 이제 App이 한 번만 부른다(App.tsx의 주석 참고 — 여러 컴포넌트가 각자
// 인스턴스를 가지면 서로의 상태를 몰라 인박스가 "(사라진 workspace)"를 그리는 실제
// 결함이었다). 그래서 더 이상 Sidebar를 통해 간접적으로 테스트하지 않고, 다른 훅
// 테스트들(useInbox.test.tsx 등)과 같은 패턴으로 훅 자체를 renderHook으로 검증한다.
function wrap(client: OneDeskClient) {
  return ({ children }: { children: ReactNode }) => (
    <ClientProvider client={client}>{children}</ClientProvider>
  )
}

function makeFailingClient(): OneDeskClient {
  return {
    workspaces: {
      list: vi.fn().mockRejectedValue(new Error('DB를 열 수 없습니다')),
      create: vi.fn(),
      remove: vi.fn()
    }
  } as unknown as OneDeskClient
}

describe('useWorkspaces 오류 처리', () => {
  it('목록 조회가 실패하면 오류를 보여주고 로딩 상태에서 벗어난다', async () => {
    const { result } = renderHook(() => useWorkspaces(), { wrapper: wrap(makeFailingClient()) })

    await waitFor(() => expect(result.current.error).toBe('DB를 열 수 없습니다'))
    // setLoading(false)가 finally에 있어야 한다. try 안에 두면 실패 시 영원히 로딩 상태다.
    expect(result.current.loading).toBe(false)
  })
})
