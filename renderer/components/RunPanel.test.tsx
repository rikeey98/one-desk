import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RunPanel } from './RunPanel'
import type { OneDeskClient } from '@shared/client'
import type { Permission, Repo, Run, Workspace } from '@shared/models'
import type { ContextChip } from '../context'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
]

function makeWorkspace(defaultPermission: Permission): Workspace {
  return {
    id: 'w1', name: 'ws', description: null, defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null, defaultPermission,
    claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
  }
}

function makeClient(opts: {
  defaultPermission?: Permission
  start?: ReturnType<typeof vi.fn>
} = {}): OneDeskClient {
  return {
    workspaces: {
      list: vi.fn().mockResolvedValue([makeWorkspace(opts.defaultPermission ?? 'edit')]),
      create: vi.fn(), remove: vi.fn()
    },
    // repos는 이제 App이 useRepos로 조회해 prop으로 내려준다 (RepoStrip과 상태를
    // 공유하기 위해서다). RunPanel은 더 이상 client.repos를 직접 부르지 않는다.
    repos: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    runs: {
      list: vi.fn().mockResolvedValue([]),
      start: opts.start ?? vi.fn().mockResolvedValue({ id: 'run-1' } as Run),
      cancel: vi.fn(), readLog: vi.fn()
    },
    events: { onRunEvent: vi.fn(() => () => {}), onRunUpdate: vi.fn(() => () => {}) }
  } as unknown as OneDeskClient
}

function renderPanel(
  client: OneDeskClient,
  panelRepos: Repo[] = repos,
  chips: ContextChip[] = [],
  onStarted = vi.fn()
) {
  render(
    <ClientProvider client={client}>
      <RunPanel
        workspaceId="w1"
        repos={panelRepos}
        reposError={null}
        chips={chips}
        onRemoveChip={vi.fn()}
        onStarted={onStarted}
      />
    </ClientProvider>
  )
  return onStarted
}

describe('RunPanel', () => {
  it('agent는 claude-code만 고를 수 있다', async () => {
    // OpenCode 어댑터는 5단계에 들어온다. 지금 고르면 Claude Code가 실행돼 혼란만 준다.
    renderPanel(makeClient())
    const select = await screen.findByLabelText('agent')
    expect(select).toBeDisabled()
    expect(select.querySelectorAll('option')).toHaveLength(1)
  })

  it('권한 기본값은 workspace의 defaultPermission이다', async () => {
    renderPanel(makeClient({ defaultPermission: 'read_only' }))
    await waitFor(() => expect(screen.getByLabelText('권한')).toHaveValue('read_only'))
  })

  it('맥락과 권한을 담아 실행을 요청한다', async () => {
    const start = vi.fn().mockResolvedValue({ id: 'run-1' } as Run)
    const onStarted = renderPanel(
      makeClient({ start, defaultPermission: 'read_only' }),
      repos,
      [{ type: 'issue', id: 'i1', label: '토큰 버그' }]
    )

    await waitFor(() => expect(screen.getByLabelText('권한')).toHaveValue('read_only'))
    await userEvent.type(screen.getByPlaceholderText(/무엇을 시킬지/), '고쳐줘')
    await userEvent.click(screen.getByRole('button', { name: '▶ 실행' }))

    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'w1',
      agentKind: 'claude-code',
      cwd: '/tmp/api',
      permission: 'read_only',
      userPrompt: '고쳐줘',
      context: [{ type: 'issue', id: 'i1' }]
    })))
    expect(onStarted).toHaveBeenCalled()
  })

  it('⌘↵로도 실행된다', async () => {
    const start = vi.fn().mockResolvedValue({ id: 'run-1' } as Run)
    renderPanel(makeClient({ start }))

    const box = await screen.findByPlaceholderText(/무엇을 시킬지/)
    await userEvent.type(box, '고쳐줘')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(start).toHaveBeenCalled())
  })

  it('지시가 비어 있으면 실행할 수 없다', async () => {
    renderPanel(makeClient())
    expect(await screen.findByRole('button', { name: '▶ 실행' })).toBeDisabled()
  })

  it('repo가 없으면 안내하고 실행을 막는다', async () => {
    renderPanel(makeClient(), [])
    expect(await screen.findByText(/repo를 먼저 등록/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '▶ 실행' })).toBeDisabled()
  })

  it('실행이 거부되면 오류를 보여준다', async () => {
    const start = vi.fn().mockRejectedValue(new Error('claude를 찾을 수 없습니다'))
    renderPanel(makeClient({ start }))

    await userEvent.type(await screen.findByPlaceholderText(/무엇을 시킬지/), 'x')
    await userEvent.click(screen.getByRole('button', { name: '▶ 실행' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('claude를 찾을 수 없습니다')
  })
})
