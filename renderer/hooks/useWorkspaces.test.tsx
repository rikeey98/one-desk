import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { Sidebar } from '../components/Sidebar'
import type { OneDeskClient } from '@shared/client'

function makeFailingClient(): OneDeskClient {
  return {
    workspaces: {
      list: vi.fn().mockRejectedValue(new Error('DB를 열 수 없습니다')),
      create: vi.fn(),
      remove: vi.fn()
    },
    repos: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    issues: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    memos: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }
  } as unknown as OneDeskClient
}

describe('useWorkspaces 오류 처리', () => {
  it('목록 조회가 실패하면 오류를 보여주고 로딩 상태에서 벗어난다', async () => {
    render(
      <ClientProvider client={makeFailingClient()}>
        <Sidebar selectedId={null} onSelect={vi.fn()} />
      </ClientProvider>
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('DB를 열 수 없습니다')
    // setLoading(false)가 finally에 있어야 한다. try 안에 두면 실패 시 영원히 로딩 상태다.
    expect(screen.queryByText('불러오는 중…')).toBeNull()
  })
})
