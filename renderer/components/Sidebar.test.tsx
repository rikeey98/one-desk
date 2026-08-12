import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { Sidebar } from './Sidebar'
import type { OneDeskClient } from '@shared/client'
import type { InboxCounts, Workspace } from '@shared/models'

function makeWorkspace(name: string, id: string): Workspace {
  return {
    id, name, description: null,
    defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null,
    defaultPermission: 'edit',
    claudePath: null, opencodePath: null,
    createdAt: 0, updatedAt: 0
  }
}

function makeClient(workspaces: Workspace[]): OneDeskClient {
  return {
    workspaces: { list: vi.fn().mockResolvedValue(workspaces), create: vi.fn(), remove: vi.fn() },
    repos: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    issues: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    memos: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }
  } as unknown as OneDeskClient
}

/**
 * Sidebar.test.tsx에는 원래 렌더 헬퍼가 없어 테스트마다 render()를 인라인으로
 * 불렀다. 인박스 배지 테스트가 늘면서 새 props(view, onSelectInbox, counts)를
 * 매번 다 채우면 장황해지므로 여기서 기본값을 채우고 필요한 것만 덮어쓴다.
 */
function renderSidebar(over: {
  workspaces?: Workspace[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  view?: 'workspace' | 'inbox'
  onSelectInbox?: () => void
  counts?: InboxCounts
} = {}) {
  const client = makeClient(over.workspaces ?? [makeWorkspace('ws-1', 'w1')])
  render(
    <ClientProvider client={client}>
      <Sidebar
        selectedId={over.selectedId ?? null}
        onSelect={over.onSelect ?? vi.fn()}
        view={over.view ?? 'workspace'}
        onSelectInbox={over.onSelectInbox ?? vi.fn()}
        counts={over.counts ?? { total: 0, byWorkspace: {} }}
      />
    </ClientProvider>
  )
}

describe('Sidebar', () => {
  it('workspace 목록을 보여준다', async () => {
    renderSidebar({ workspaces: [makeWorkspace('사내 플랫폼', 'w1'), makeWorkspace('one-desk', 'w2')] })
    expect(await screen.findByText('사내 플랫폼')).toBeTruthy()
    expect(screen.getByText('one-desk')).toBeTruthy()
  })

  it('workspace를 클릭하면 onSelect가 그 id로 불린다', async () => {
    const onSelect = vi.fn()
    renderSidebar({ workspaces: [makeWorkspace('사내 플랫폼', 'w1')], onSelect })
    await userEvent.click(await screen.findByText('사내 플랫폼'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('w1'))
  })

  it('인박스 항목에 전체 건수를 단다', () => {
    renderSidebar({ counts: { total: 3, byWorkspace: { w1: 2 } } })
    expect(screen.getByRole('button', { name: /인박스/ })).toHaveTextContent('3')
  })

  it('workspace마다 그 workspace의 건수를 단다', async () => {
    // 전체만 맞고 workspace별이 0이면 어디에 쌓였는지 알 수 없다.
    // useWorkspaces가 비동기로 목록을 읽으므로(list()가 Promise) getByRole이 아니라
    // findByRole로 로딩이 끝나기를 기다려야 한다 — 그렇지 않으면 "불러오는 중…" 상태에서
    // 단언이 실행되어 항상 실패한다.
    renderSidebar({ counts: { total: 3, byWorkspace: { w1: 2 } } })
    expect(await screen.findByRole('button', { name: /ws-1/ })).toHaveTextContent('2')
  })

  it('건수가 0인 곳에는 배지를 그리지 않는다', () => {
    // 0이 상시 붙어 있으면 눈이 걸러내는 법을 배우고, 숫자가 생겨도 안 보인다.
    renderSidebar({ counts: { total: 0, byWorkspace: {} } })
    expect(screen.getByRole('button', { name: /인박스/ })).not.toHaveTextContent('0')
  })
})
