import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { Sidebar } from './Sidebar'
import type { OneDeskClient } from '@shared/client'
import type { InboxCounts, McpStatus, Workspace } from '@shared/models'

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

// workspace 목록은 이제 App이 useWorkspaces()로 한 번만 조회해 prop으로 내려준다
// (App.tsx의 주석 참고 — 인스턴스가 여러 개면 서로의 상태를 몰라 인박스가 방금 만든
// workspace를 "(사라진 workspace)"로 그리는 실제 결함이었다). Sidebar는 workspace
// "생성"만 client로 직접 하므로, list()는 더 이상 Sidebar를 통해 불리지 않는다 —
// 그래도 ClientProvider가 요구하는 모양을 맞추려면 client mock 자체는 필요하다.
function makeClient(): OneDeskClient {
  return {
    workspaces: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
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
  loading?: boolean
  error?: string | null
  refresh?: () => Promise<void>
  selectedId?: string | null
  onSelect?: (id: string) => void
  view?: 'workspace' | 'inbox'
  onSelectInbox?: () => void
  counts?: InboxCounts
  countsError?: string | null
  mcpStatus?: McpStatus
} = {}) {
  render(
    <ClientProvider client={makeClient()}>
      <Sidebar
        workspaces={over.workspaces ?? [makeWorkspace('ws-1', 'w1')]}
        loading={over.loading ?? false}
        error={over.error ?? null}
        refresh={over.refresh ?? vi.fn().mockResolvedValue(undefined)}
        selectedId={over.selectedId ?? null}
        onSelect={over.onSelect ?? vi.fn()}
        view={over.view ?? 'workspace'}
        onSelectInbox={over.onSelectInbox ?? vi.fn()}
        counts={over.counts ?? { total: 0, byWorkspace: {} }}
        countsError={over.countsError ?? null}
        mcpStatus={over.mcpStatus ?? { state: 'listening', port: 12345 }}
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

  it('workspace마다 그 workspace의 건수를 단다', () => {
    // 전체만 맞고 workspace별이 0이면 어디에 쌓였는지 알 수 없다.
    renderSidebar({ counts: { total: 3, byWorkspace: { w1: 2 } } })
    expect(screen.getByRole('button', { name: /ws-1/ })).toHaveTextContent('2')
  })

  it('건수가 0인 곳에는 배지를 그리지 않는다', () => {
    // 0이 상시 붙어 있으면 눈이 걸러내는 법을 배우고, 숫자가 생겨도 안 보인다.
    renderSidebar({ counts: { total: 0, byWorkspace: {} } })
    expect(screen.getByRole('button', { name: /인박스/ })).not.toHaveTextContent('0')
  })

  it('인박스 조회에 실패하면 배지 자리에 표식을 남긴다', () => {
    // 조용히 배지를 숨기면 "처리할 것이 없다"와 "못 읽었다"가 구별되지 않는다.
    // 인박스를 열지 않아도 그 사실이 보여야 한다 (설계 §9).
    renderSidebar({ countsError: '인박스를 읽지 못했습니다' })
    expect(screen.getByRole('button', { name: /인박스/ })).toHaveTextContent('!')
    expect(screen.getByTitle(/인박스를 읽지 못했습니다/)).toBeInTheDocument()
  })

  it('workspace 배지도 건수가 0이거나 없으면 그리지 않는다', async () => {
    // 위 테스트는 인박스 링크만 본다 — workspace 행에는 별도 가드
    // (counts.byWorkspace[w.id] ?? 0) > 0가 있고, 이 테스트가 없으면 그 가드를
    // 지워도 전체 스위트가 통과한다. byWorkspace에 명시적으로 0이 들어있는
    // workspace(w1)와 키 자체가 없는 workspace(w2) 둘 다 확인한다.
    renderSidebar({
      workspaces: [makeWorkspace('ws-1', 'w1'), makeWorkspace('ws-2', 'w2')],
      counts: { total: 0, byWorkspace: { w1: 0 } }
    })
    expect(await screen.findByRole('button', { name: /ws-1/ })).not.toHaveTextContent('0')
    expect(screen.getByRole('button', { name: /ws-2/ })).not.toHaveTextContent('0')
  })
})

/** 같은 인스턴스에 다른 상태를 다시 주기 위한 헬퍼. renderSidebar는 rerender를 돌려주지 않는다. */
function renderSidebarRaw(mcpStatus: McpStatus) {
  function tree(status: McpStatus) {
    return (
      <ClientProvider client={makeClient()}>
        <Sidebar
          workspaces={[makeWorkspace('ws-1', 'w1')]}
          loading={false}
          error={null}
          refresh={vi.fn().mockResolvedValue(undefined)}
          selectedId={null}
          onSelect={vi.fn()}
          view="workspace"
          onSelectInbox={vi.fn()}
          counts={{ total: 0, byWorkspace: {} }}
          countsError={null}
          mcpStatus={status}
        />
      </ClientProvider>
    )
  }
  const view = render(tree(mcpStatus))
  return { rerender: (next: McpStatus) => { view.rerender(tree(next)) } }
}

describe('MCP 상태 줄', () => {
  it('listening이면 포트를 보여준다', () => {
    // 포트를 그대로 보여주는 것이 요점이다 — "서버가 정말 떴는가"와 "몇 번인가"를
    // 눈으로 확인해야 하는 상황이 실제로 있었다.
    renderSidebar({ mcpStatus: { state: 'listening', port: 53021 } })
    expect(screen.getByText(/MCP :53021/)).toBeInTheDocument()
  })

  it('starting이면 시작 중으로 보여준다', () => {
    renderSidebar({ mcpStatus: { state: 'starting' } })
    expect(screen.getByText(/MCP 시작 중/)).toBeInTheDocument()
  })

  it('failed면 실패로 보여주고 사유를 title에 담는다', () => {
    renderSidebar({ mcpStatus: { state: 'failed', message: 'EADDRINUSE' } })
    const row = screen.getByText(/MCP 연결 실패/)
    expect(row).toBeInTheDocument()
    expect(row).toHaveAttribute('title', 'EADDRINUSE')
  })

  it('상태가 바뀌면 화면도 바뀐다 — prop을 실제로 읽는다', () => {
    // 하드코딩된 문자열을 그리는 구현으로도 위 셋이 통과할 수 있다.
    // 같은 컴포넌트에 다른 상태를 주어 prop을 읽는다는 것을 고정한다.
    const { rerender } = renderSidebarRaw({ state: 'starting' })
    expect(screen.getByText(/MCP 시작 중/)).toBeInTheDocument()
    rerender({ state: 'listening', port: 999 })
    expect(screen.queryByText(/MCP 시작 중/)).not.toBeInTheDocument()
    expect(screen.getByText(/MCP :999/)).toBeInTheDocument()
  })
})
