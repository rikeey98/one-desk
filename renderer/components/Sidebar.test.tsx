import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { Sidebar } from './Sidebar'
import type { OneDeskClient } from '@shared/client'
import type { InboxCounts, McpStatus, PlanUsage, Workspace } from '@shared/models'

function makeWorkspace(name: string, id: string): Workspace {
  return {
    id, name, description: null,
    defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null,
  defaultEffortClaude: null, defaultVariantOpencode: null,
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
  view?: 'home' | 'workspace' | 'inbox' | 'report' | 'settings'
  onSelectHome?: () => void
  homeCount?: number
  focusWorkspaceAdd?: boolean
  onFocusWorkspaceAddConsumed?: () => void
  onSelectInbox?: () => void
  onSelectSettings?: () => void
  counts?: InboxCounts
  countsError?: string | null
  mcpStatus?: McpStatus
  planUsage?: PlanUsage | null
  onDeleted?: (id: string) => void
  onSelectReport?: () => void
  collapsed?: boolean
  client?: OneDeskClient
} = {}) {
  render(
    <ClientProvider client={over.client ?? makeClient()}>
      <Sidebar
        workspaces={over.workspaces ?? [makeWorkspace('ws-1', 'w1')]}
        loading={over.loading ?? false}
        error={over.error ?? null}
        refresh={over.refresh ?? vi.fn().mockResolvedValue(undefined)}
        selectedId={over.selectedId ?? null}
        onSelect={over.onSelect ?? vi.fn()}
        view={over.view ?? 'workspace'}
        onSelectInbox={over.onSelectInbox ?? vi.fn()}
        onSelectReport={over.onSelectReport ?? vi.fn()}
        onSelectSettings={over.onSelectSettings ?? vi.fn()}
        counts={over.counts ?? { total: 0, byWorkspace: {} }}
        countsError={over.countsError ?? null}
        mcpStatus={over.mcpStatus ?? { state: 'listening', port: 12345 }}
        planUsage={over.planUsage ?? null}
        onDeleted={over.onDeleted ?? vi.fn()}
        collapsed={over.collapsed ?? false}
        onSelectHome={over.onSelectHome ?? vi.fn()}
        homeCount={over.homeCount ?? 0}
        focusWorkspaceAdd={over.focusWorkspaceAdd ?? false}
        onFocusWorkspaceAddConsumed={over.onFocusWorkspaceAddConsumed ?? vi.fn()}
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
    // 이름 바꾸기·삭제 버튼도 이름에 'ws-1'을 담으므로 선택 버튼으로 좁힌다.
    expect(document.querySelector('.ws')).toHaveTextContent('2')
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
    const rows = document.querySelectorAll('.ws')
    expect(rows[0]).not.toHaveTextContent('0')
    expect(rows[1]).not.toHaveTextContent('0')
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
          onSelectReport={vi.fn()}
      onSelectSettings={vi.fn()}
          onDeleted={vi.fn()}
          counts={{ total: 0, byWorkspace: {} }}
          countsError={null}
          mcpStatus={status}
          planUsage={null}
          collapsed={false}
        onSelectHome={vi.fn()}
        homeCount={0}
        focusWorkspaceAdd={false}
        onFocusWorkspaceAddConsumed={vi.fn()}
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
    const row = screen.getByText(/MCP 연결 실패/).closest('.mcp-status')
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

describe('요금제 사용률 줄 (docs/sdlc/plan-usage/ FR-5)', () => {
  const now = Date.now()
  const usage: PlanUsage = {
    fiveHour: { utilization: 0.06, resetsAt: now + 3_600_000 },
    sevenDay: { utilization: 0.02, resetsAt: now + 100 * 3_600_000 },
    limited: false,
    observedAt: now
  }

  it('값이 있으면 두 창의 사용률을 보이고 자세한 것은 title에 담는다', () => {
    renderSidebar({ planUsage: usage })
    const row = screen.getByText('요금제 5h 6% · 7d 2%')
    expect(row.getAttribute('title')).toContain('마지막 확인 방금')
    expect(row).not.toHaveClass('plan-usage-warn')
  })

  it('값이 없으면 줄이 없다 — 0%로 채우지 않는다', () => {
    renderSidebar({ planUsage: null })
    expect(screen.queryByText(/요금제/)).toBeNull()
  })

  it('경고면 경고색 클래스다', () => {
    renderSidebar({ planUsage: { ...usage, limited: true } })
    expect(screen.getByText(/한도 도달/)).toHaveClass('plan-usage-warn')
  })
})

describe('Sidebar workspace 관리', () => {
  function clientWith(over: Record<string, unknown>): OneDeskClient {
    const base = makeClient()
    return { ...base, workspaces: { ...base.workspaces, ...over } } as unknown as OneDeskClient
  }

  it('이름 바꾸기를 누르면 그 자리가 입력창이 된다', async () => {
    renderSidebar({ workspaces: [makeWorkspace('옛 이름', 'w1')] })
    await userEvent.click(screen.getByRole('button', { name: '옛 이름 이름 바꾸기' }))
    expect(screen.getByRole('textbox', { name: '옛 이름 새 이름' })).toBeInTheDocument()
  })

  it('저장하면 rename을 부르고 목록을 다시 읽는다', async () => {
    const rename = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderSidebar({ workspaces: [makeWorkspace('옛 이름', 'w1')], client: clientWith({ rename }), refresh })

    await userEvent.click(screen.getByRole('button', { name: '옛 이름 이름 바꾸기' }))
    await userEvent.clear(screen.getByRole('textbox', { name: '옛 이름 새 이름' }))
    await userEvent.type(screen.getByRole('textbox', { name: '옛 이름 새 이름' }), '새 이름{Enter}')

    await waitFor(() => expect(rename).toHaveBeenCalledWith('w1', '새 이름'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('삭제는 이름을 정확히 타이핑해야 열린다 — 이슈·메모·실행 기록이 함께 사라진다', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    renderSidebar({ workspaces: [makeWorkspace('사내 플랫폼', 'w1')], client: clientWith({ remove }) })

    await userEvent.click(screen.getByRole('button', { name: '사내 플랫폼 삭제' }))
    const confirm = screen.getByRole('button', { name: '사내 플랫폼 삭제 확인' })
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByRole('textbox', { name: '삭제하려면 사내 플랫폼 을 입력' }), '사내 플랫')
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByRole('textbox', { name: '삭제하려면 사내 플랫폼 을 입력' }), '폼')
    expect(confirm).toBeEnabled()

    await userEvent.click(confirm)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('w1'))
  })

  it('삭제하면 App에 알린다 — 고른 workspace가 사라졌는데 화면이 남아 있으면 안 된다', async () => {
    const onDeleted = vi.fn()
    renderSidebar({
      workspaces: [makeWorkspace('ws', 'w1')],
      client: clientWith({ remove: vi.fn().mockResolvedValue(undefined) }),
      onDeleted
    })

    await userEvent.click(screen.getByRole('button', { name: 'ws 삭제' }))
    await userEvent.type(screen.getByRole('textbox', { name: '삭제하려면 ws 을 입력' }), 'ws')
    await userEvent.click(screen.getByRole('button', { name: 'ws 삭제 확인' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('w1'))
  })
})

describe('Sidebar — 설정 링크', () => {
  it('설정을 누르면 onSelectSettings를 부른다', async () => {
    const onSelectSettings = vi.fn()
    renderSidebar({ onSelectSettings })
    await userEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(onSelectSettings).toHaveBeenCalled()
  })

  it('설정 화면일 때 링크가 선택 표시된다', () => {
    renderSidebar({ view: 'settings' })
    expect(screen.getByRole('button', { name: '설정' }).className).toContain('selected')
  })
})

describe('리포트 진입점 (docs/sdlc/period-report/ FR-13)', () => {
  it('인박스 바로 아래 줄이고, 누르면 onSelectReport를 부른다', async () => {
    const onSelectReport = vi.fn()
    renderSidebar({ onSelectReport })
    const links = screen.getAllByRole('button').map((b) => b.textContent)
    expect(links.indexOf('리포트')).toBe(links.findIndex((t) => t?.startsWith('인박스')) + 1)
    await userEvent.click(screen.getByRole('button', { name: '리포트' }))
    expect(onSelectReport).toHaveBeenCalledOnce()
  })

  it('리포트 화면이면 선택된 모양이고 workspace 줄은 선택이 아니다', () => {
    renderSidebar({ view: 'report', selectedId: 'w1' })
    expect(screen.getByRole('button', { name: '리포트' })).toHaveClass('inbox-link-selected')
    expect(screen.getByRole('button', { name: '리포트' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'ws-1' })).not.toHaveClass('ws-selected')
  })

  it('접히면 workspace 목록과 요금제 줄 없이 아이콘 타일만 남는다 — 이름과 배지는 그대로다', () => {
    const resetsAt = Date.now() + 3_600_000
    renderSidebar({
      collapsed: true,
      counts: { total: 3, byWorkspace: { w1: 2 } },
      planUsage: { fiveHour: { utilization: 0.1, resetsAt }, sevenDay: { utilization: 0.1, resetsAt }, limited: false, observedAt: Date.now() }
    })
    expect(screen.queryByText('ws-1')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('새 workspace 이름…')).not.toBeInTheDocument()
    expect(screen.queryByText(/요금제/)).not.toBeInTheDocument()
    const inbox = screen.getByRole('button', { name: /인박스/ })
    expect(inbox).toHaveTextContent('3')
    expect(inbox).toHaveAttribute('title', '인박스')
    expect(screen.getByRole('button', { name: '설정' })).toHaveAttribute('title', '설정')
    // MCP는 점만 보이므로 상태를 풍선이 말한다
    expect(document.querySelector('.mcp-status')).toHaveAttribute('title', 'MCP :12345')
  })
})

// ── docs/sdlc/ux-polish/ ──

describe('접힌 사이드바의 workspace 타일 (docs/sdlc/ux-polish/ FR-7)', () => {
  it('workspace가 둘 이상이면 이니셜 타일이 서고, 고른 것은 표시가 붙으며, 누르면 그 id로 고른다', async () => {
    const onSelect = vi.fn()
    renderSidebar({
      collapsed: true, selectedId: 'w2', onSelect,
      workspaces: [makeWorkspace('개인', 'w1'), makeWorkspace('회사', 'w2')],
      counts: { total: 2, byWorkspace: { w1: 2 } }
    })
    const tiles = screen.getByRole('list', { name: '워크스페이스' })
    const personal = within(tiles).getByRole('button', { name: '개인' })
    const company = within(tiles).getByRole('button', { name: '회사' })
    expect(personal).toHaveTextContent('개')
    expect(personal).toHaveAttribute('title', '개인')
    expect(personal).toHaveTextContent('2')
    expect(company).toHaveClass('ws-tile-selected')
    expect(company).toHaveAttribute('aria-current', 'true')
    expect(personal).not.toHaveClass('ws-tile-selected')
    await userEvent.click(personal)
    expect(onSelect).toHaveBeenCalledWith('w1')
  })

  it('workspace가 하나뿐이면 타일이 없다 — 고를 것이 없다', () => {
    renderSidebar({ collapsed: true, selectedId: 'w1', workspaces: [makeWorkspace('개인', 'w1')] })
    expect(screen.queryByRole('list', { name: '워크스페이스' })).not.toBeInTheDocument()
  })

  it('펼쳐져 있으면 타일 대신 목록이다 — 같은 이름의 버튼이 둘 서지 않는다', () => {
    renderSidebar({ collapsed: false, workspaces: [makeWorkspace('개인', 'w1'), makeWorkspace('회사', 'w2')] })
    expect(screen.queryByRole('list', { name: '워크스페이스' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '개인' })).toHaveLength(1)
  })
})

describe('홈 진입점 (docs/sdlc/home/ FR-12·FR-16·FR-17)', () => {
  it('홈은 인박스 위에 서고 누르면 onSelectHome이다 — 배지는 오늘 할 일의 수', async () => {
    const onSelectHome = vi.fn()
    renderSidebar({ onSelectHome, homeCount: 4, view: 'home' })
    const nav = screen.getByRole('button', { name: /^홈/ }).parentElement!
    const labels = within(nav).getAllByRole('button').map((b) => b.textContent?.replace(/\d+$/, ''))
    expect(labels.slice(0, 2)).toEqual(['홈', '인박스'])
    const home = screen.getByRole('button', { name: /^홈/ })
    expect(home).toHaveAttribute('aria-current', 'page')
    expect(within(home).getByText('4')).toHaveClass('badge')
    await userEvent.click(home)
    expect(onSelectHome).toHaveBeenCalled()
  })

  it('할 일이 없으면 배지가 없다', () => {
    renderSidebar({ homeCount: 0 })
    expect(within(screen.getByRole('button', { name: '홈' })).queryByText('0')).not.toBeInTheDocument()
  })

  it('접혀도 홈 타일은 남는다', () => {
    renderSidebar({ collapsed: true, homeCount: 2 })
    expect(screen.getByRole('button', { name: /^홈/ })).toBeInTheDocument()
  })

  it('focusWorkspaceAdd가 서면 새 workspace 입력칸에 포커스하고 치운다 (준비 단계 ①)', async () => {
    const consumed = vi.fn()
    renderSidebar({ focusWorkspaceAdd: true, onFocusWorkspaceAddConsumed: consumed })
    await waitFor(() => expect(screen.getByPlaceholderText('새 workspace 이름…')).toHaveFocus())
    expect(consumed).toHaveBeenCalled()
  })
})
