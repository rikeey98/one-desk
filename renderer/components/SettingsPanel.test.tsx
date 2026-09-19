import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { SettingsPanel } from './SettingsPanel'
import type { OneDeskClient } from '@shared/client'
import type {
  AgentStatuses, GlobalRoots,
  UpdateWorkspaceDefaultsInput, UpdateWorkspacePathsInput, Workspace
} from '@shared/models'

const AGENTS_OK: AgentStatuses = {
  'claude-code': { ok: true, executable: '/usr/local/bin/claude' },
  opencode: { ok: true, executable: '/usr/local/bin/opencode' }
}

const DEFAULTS: GlobalRoots = {
  claude: ['/home/me/.claude/skills', '/home/me/.claude/agents'],
  opencode: ['/home/me/.config/opencode/agent']
}

function makeWorkspace(over: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1', name: 'ws1', description: null, defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit',
    claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0, ...over
  }
}

function makeClient(
  over: Record<string, unknown> = {},
  workspacesOver: Record<string, unknown> = {}
): OneDeskClient {
  return {
    settings: {
      globalRoots: vi.fn().mockResolvedValue(DEFAULTS),
      setGlobalRoots: vi.fn().mockResolvedValue(DEFAULTS),
      ...over
    },
    workspaces: {
      list: vi.fn().mockResolvedValue([]),
      // 실제 저장소처럼 빈 칸을 null로 돌려준다 — 그래야 "돌려받은 값으로 다시
      // 채운다"가 고정된다.
      updateDefaults: vi.fn(async (input: UpdateWorkspaceDefaultsInput) => makeWorkspace({
        defaultAgentKind: input.defaultAgentKind,
        defaultModelClaude: (input.defaultModelClaude ?? '').trim() || null,
        defaultModelOpencode: (input.defaultModelOpencode ?? '').trim() || null,
        defaultPermission: input.defaultPermission
      })),
      updatePaths: vi.fn(async (input: UpdateWorkspacePathsInput) => makeWorkspace({
        claudePath: (input.claudePath ?? '').trim() || null,
        opencodePath: (input.opencodePath ?? '').trim() || null
      })),
      checkAgents: vi.fn(async () => AGENTS_OK),
      ...workspacesOver
    }
  } as unknown as OneDeskClient
}

function renderPanel(
  client: OneDeskClient,
  opts: { workspaces?: Workspace[]; workspaceId?: string | null; onWorkspaceSaved?: () => void } = {}
) {
  render(
    <ClientProvider client={client}>
      <SettingsPanel
        workspaces={opts.workspaces ?? [makeWorkspace()]}
        workspaceId={opts.workspaceId === undefined ? 'w1' : opts.workspaceId}
        onWorkspaceSaved={opts.onWorkspaceSaved ?? vi.fn()}
      />
    </ClientProvider>
  )
  return client
}

describe('SettingsPanel', () => {
  it('저장된 경로를 줄바꿈으로 보여준다', async () => {
    renderPanel(makeClient())
    // 글로벌 경로는 앱 탭에 있다 — 실행 탭이 기본으로 열린다.
    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Claude Code 글로벌 경로'))
        .toHaveValue('/home/me/.claude/skills\n/home/me/.claude/agents')
    })
    expect(screen.getByLabelText('OpenCode 글로벌 경로'))
      .toHaveValue('/home/me/.config/opencode/agent')
  })

  it('고쳐서 저장하면 줄 단위로 나눠 보낸다', async () => {
    const setGlobalRoots = vi.fn().mockResolvedValue(DEFAULTS)
    renderPanel(makeClient({ setGlobalRoots }))
    // 글로벌 경로는 앱 탭에 있다 — 실행 탭이 기본으로 열린다.
    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    const box = await screen.findByLabelText('Claude Code 글로벌 경로')

    await userEvent.clear(box)
    await userEvent.type(box, '/a{Enter}/b')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(setGlobalRoots).toHaveBeenCalledWith({
      claude: ['/a', '/b'],
      opencode: ['/home/me/.config/opencode/agent']
    })
  })

  it('저장에 실패하면 알리고 입력을 지우지 않는다', async () => {
    // 자동 저장이 아니라 사용자가 결과를 보는 자리다. 조용히 넘기지 않는다.
    const setGlobalRoots = vi.fn().mockRejectedValue(new Error('디스크가 가득 찼습니다'))
    renderPanel(makeClient({ setGlobalRoots }))
    // 글로벌 경로는 앱 탭에 있다 — 실행 탭이 기본으로 열린다.
    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    const box = await screen.findByLabelText('Claude Code 글로벌 경로')

    await userEvent.clear(box)
    await userEvent.type(box, '/a')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('디스크가 가득 찼습니다')
    expect(box).toHaveValue('/a')
  })

  it('저장하면 돌아온 값으로 다시 채운다', async () => {
    // core가 빈 목록을 기본값으로 되돌리므로, 화면이 그 결과를 반영해야 한다.
    const setGlobalRoots = vi.fn().mockResolvedValue({ claude: ['/정리됨'], opencode: [] })
    renderPanel(makeClient({ setGlobalRoots }))
    // 글로벌 경로는 앱 탭에 있다 — 실행 탭이 기본으로 열린다.
    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    const box = await screen.findByLabelText('Claude Code 글로벌 경로')

    await userEvent.clear(box)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(box).toHaveValue('/정리됨'))
  })

  it('조회에 실패하면 알린다', async () => {
    renderPanel(makeClient({ globalRoots: vi.fn().mockRejectedValue(new Error('못 읽음')) }))
    // 글로벌 경로는 앱 탭에 있다 — 실행 탭이 기본으로 열린다.
    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('못 읽음')
  })
})

describe('SettingsPanel — 실행 기본값', () => {
  it('고른 workspace의 기본값을 보여준다', async () => {
    renderPanel(makeClient(), {
      workspaces: [makeWorkspace({
        defaultAgentKind: 'opencode',
        defaultModelClaude: 'sonnet',
        defaultModelOpencode: 'openai/gpt-5'
      })]
    })

    expect(await screen.findByLabelText('기본 agent')).toHaveValue('opencode')
    expect(screen.getByLabelText('Claude Code 기본 모델')).toHaveValue('sonnet')
    expect(screen.getByLabelText('OpenCode 기본 모델')).toHaveValue('openai/gpt-5')
  })

  it('null 기본 모델은 빈 칸으로 보여준다', async () => {
    // 빈 칸이 "CLI 자신의 기본값에 맡긴다"이다. 저장할 때 다시 null이 된다.
    renderPanel(makeClient())
    expect(await screen.findByLabelText('Claude Code 기본 모델')).toHaveValue('')
  })

  it('고쳐서 저장하면 셋을 한 번에 보낸다', async () => {
    // 부분 갱신이 아니다 — 무엇이 덮이는지 흐려지지 않게 세 값을 전부 보낸다.
    const updateDefaults = vi.fn(async () => makeWorkspace())
    renderPanel(makeClient({}, { updateDefaults }))

    await userEvent.selectOptions(await screen.findByLabelText('기본 agent'), 'opencode')
    await userEvent.type(screen.getByLabelText('Claude Code 기본 모델'), 'sonnet')
    await userEvent.type(screen.getByLabelText('OpenCode 기본 모델'), 'openai/gpt-5')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    expect(updateDefaults).toHaveBeenCalledWith({
      id: 'w1',
      defaultAgentKind: 'opencode',
      defaultModelClaude: 'sonnet',
      defaultModelOpencode: 'openai/gpt-5',
      defaultPermission: 'edit'
    })
  })

  it('저장하면 돌아온 값으로 다시 채운다', async () => {
    // core가 공백을 다듬고 빈 칸을 null로 돌리므로 결과가 입력과 다를 수 있다.
    renderPanel(makeClient())
    const box = await screen.findByLabelText('Claude Code 기본 모델')

    await userEvent.type(box, '  sonnet  ')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    await waitFor(() => expect(box).toHaveValue('sonnet'))
  })

  it('저장이 끝나면 목록을 다시 읽으라고 알린다', async () => {
    // 이 호출이 빠지면 저장은 됐는데 실행 패널은 앱을 다시 켤 때까지 옛 값을 쓴다.
    const onWorkspaceSaved = vi.fn()
    renderPanel(makeClient(), { onWorkspaceSaved })

    await userEvent.type(await screen.findByLabelText('Claude Code 기본 모델'), 'opus')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    await waitFor(() => expect(onWorkspaceSaved).toHaveBeenCalled())
  })

  it('저장에 실패하면 알리고 입력을 지우지 않는다', async () => {
    const updateDefaults = vi.fn().mockRejectedValue(new Error('workspace를 찾을 수 없습니다'))
    renderPanel(makeClient({}, { updateDefaults }))
    const box = await screen.findByLabelText('Claude Code 기본 모델')

    await userEvent.type(box, 'opus')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('workspace를 찾을 수 없습니다')
    expect(box).toHaveValue('opus')
  })

  it('실패해도 onWorkspaceSaved를 부르지 않는다', async () => {
    const updateDefaults = vi.fn().mockRejectedValue(new Error('못 씀'))
    const onWorkspaceSaved = vi.fn()
    renderPanel(makeClient({}, { updateDefaults }), { onWorkspaceSaved })

    await userEvent.type(await screen.findByLabelText('Claude Code 기본 모델'), 'opus')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    await screen.findByRole('alert')
    expect(onWorkspaceSaved).not.toHaveBeenCalled()
  })

  it('workspace를 고르지 않았으면 안내만 남기고 칸을 열지 않는다', async () => {
    renderPanel(makeClient(), { workspaceId: null })

    expect(await screen.findByText(/왼쪽에서 workspace를 고르면/)).toBeInTheDocument()
    expect(screen.queryByLabelText('기본 agent')).toBeNull()
    expect(screen.queryByRole('button', { name: '기본값 저장' })).toBeNull()
  })

  it('고른 workspace가 바뀌면 칸을 그 workspace의 값으로 다시 채운다', async () => {
    // 앞 workspace의 값이 남아 있으면 저장 버튼 한 번에 엉뚱한 workspace로 넘어간다.
    const client = makeClient()
    const workspaces = [
      makeWorkspace({ id: 'w1', defaultModelClaude: 'sonnet' }),
      makeWorkspace({ id: 'w2', defaultModelClaude: 'opus', defaultAgentKind: 'opencode' })
    ]
    const { rerender } = render(
      <ClientProvider client={client}>
        <SettingsPanel workspaces={workspaces} workspaceId="w1" onWorkspaceSaved={vi.fn()} />
      </ClientProvider>
    )
    await waitFor(() => expect(screen.getByLabelText('Claude Code 기본 모델')).toHaveValue('sonnet'))

    rerender(
      <ClientProvider client={client}>
        <SettingsPanel workspaces={workspaces} workspaceId="w2" onWorkspaceSaved={vi.fn()} />
      </ClientProvider>
    )

    await waitFor(() => expect(screen.getByLabelText('Claude Code 기본 모델')).toHaveValue('opus'))
    expect(screen.getByLabelText('기본 agent')).toHaveValue('opencode')
  })

  it('실행 기본값을 저장해도 글로벌 경로는 건드리지 않는다', async () => {
    // 한 화면의 두 절은 범위가 다르다 — 위는 앱 전역, 아래는 workspace 하나다.
    const setGlobalRoots = vi.fn().mockResolvedValue(DEFAULTS)
    renderPanel(makeClient({ setGlobalRoots }))

    await userEvent.type(await screen.findByLabelText('Claude Code 기본 모델'), 'opus')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    await waitFor(() => expect(screen.getByLabelText('Claude Code 기본 모델')).toHaveValue('opus'))
    expect(setGlobalRoots).not.toHaveBeenCalled()
  })
})

describe('SettingsPanel — 기본 권한', () => {
  it('고른 workspace의 기본 권한을 보여준다', async () => {
    renderPanel(makeClient(), { workspaces: [makeWorkspace({ defaultPermission: 'read_only' })] })
    expect(await screen.findByLabelText('기본 권한')).toHaveValue('read_only')
  })

  it('낮추거나 같은 단계로 옮기는 것은 바로 저장한다', async () => {
    // 확인 절차는 전체 허용으로 **올릴 때**만이다 (설계 §403).
    const updateDefaults = vi.fn(async () => makeWorkspace())
    renderPanel(makeClient({}, { updateDefaults }), {
      workspaces: [makeWorkspace({ defaultPermission: 'edit' })]
    })

    await userEvent.selectOptions(await screen.findByLabelText('기본 권한'), 'read_only')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    await waitFor(() => expect(updateDefaults).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPermission: 'read_only' })))
  })

  it('전체 허용으로 올리면 경고하고 한 번 더 눌러야 저장한다', async () => {
    // 전체 설계 §403: workspace 기본값을 전체 허용으로 바꾸려면 별도 확인 절차를 거친다.
    const updateDefaults = vi.fn(async () => makeWorkspace({ defaultPermission: 'full' }))
    renderPanel(makeClient({}, { updateDefaults }), {
      workspaces: [makeWorkspace({ defaultPermission: 'edit' })]
    })

    await userEvent.selectOptions(await screen.findByLabelText('기본 권한'), 'full')
    expect(screen.getByText(/앞으로의 모든 새 실행/)).toBeInTheDocument()

    // 한 번 누르면 아직 저장되지 않는다.
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))
    expect(updateDefaults).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /한 번 더/ }))
    await waitFor(() => expect(updateDefaults).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPermission: 'full' })))
  })

  it('이미 전체 허용이면 다시 묻지 않는다', async () => {
    // §403이 말하는 것은 "바꾸는" 순간이다. 무관한 저장마다 확인을 요구하면
    // 사람이 확인 자체를 읽지 않게 된다.
    const updateDefaults = vi.fn(async () => makeWorkspace({ defaultPermission: 'full' }))
    renderPanel(makeClient({}, { updateDefaults }), {
      workspaces: [makeWorkspace({ defaultPermission: 'full' })]
    })

    await waitFor(() => expect(screen.getByLabelText('기본 권한')).toHaveValue('full'))
    expect(screen.queryByText(/앞으로의 모든 새 실행/)).toBeNull()

    await userEvent.type(screen.getByLabelText('Claude Code 기본 모델'), 'opus')
    await userEvent.click(screen.getByRole('button', { name: '기본값 저장' }))

    await waitFor(() => expect(updateDefaults).toHaveBeenCalled())
  })

  it('전체 허용을 골랐다가 되돌리면 경고가 사라진다', async () => {
    renderPanel(makeClient(), { workspaces: [makeWorkspace({ defaultPermission: 'edit' })] })
    const box = await screen.findByLabelText('기본 권한')

    await userEvent.selectOptions(box, 'full')
    expect(screen.getByText(/앞으로의 모든 새 실행/)).toBeInTheDocument()

    await userEvent.selectOptions(box, 'edit')
    expect(screen.queryByText(/앞으로의 모든 새 실행/)).toBeNull()
  })
})

describe('SettingsPanel — CLI 경로', () => {
  it('저장된 경로를 보여주고, 없으면 빈 칸이다', async () => {
    renderPanel(makeClient(), {
      workspaces: [makeWorkspace({ claudePath: '/opt/bin/claude', opencodePath: null })]
    })

    expect(await screen.findByLabelText('Claude Code 실행 파일')).toHaveValue('/opt/bin/claude')
    expect(screen.getByLabelText('OpenCode 실행 파일')).toHaveValue('')
  })

  it('고쳐서 저장하면 두 경로를 한 번에 보낸다', async () => {
    const updatePaths = vi.fn(async () => makeWorkspace())
    renderPanel(makeClient({}, { updatePaths }))

    await userEvent.type(await screen.findByLabelText('Claude Code 실행 파일'), '/opt/bin/claude')
    await userEvent.type(screen.getByLabelText('OpenCode 실행 파일'), '/opt/bin/opencode')
    await userEvent.click(screen.getByRole('button', { name: 'CLI 경로 저장' }))

    expect(updatePaths).toHaveBeenCalledWith({
      id: 'w1', claudePath: '/opt/bin/claude', opencodePath: '/opt/bin/opencode'
    })
  })

  it('경로를 저장해도 실행 기본값은 보내지 않는다', async () => {
    // 경로를 고치러 온 사람이 모델 기본값까지 덮으면 안 된다.
    const updateDefaults = vi.fn(async () => makeWorkspace())
    renderPanel(makeClient({}, { updateDefaults }))

    await userEvent.type(await screen.findByLabelText('Claude Code 실행 파일'), '/a')
    await userEvent.click(screen.getByRole('button', { name: 'CLI 경로 저장' }))

    await waitFor(() => expect(screen.getByLabelText('Claude Code 실행 파일')).toHaveValue('/a'))
    expect(updateDefaults).not.toHaveBeenCalled()
  })

  it('지금 무엇이 잡히는지 열자마자 보여준다', async () => {
    // 이 절에 오는 사람은 대개 실행이 "찾을 수 없습니다"로 막혀서 온 사람이다.
    renderPanel(makeClient())
    const status = await screen.findByLabelText('CLI 상태')
    expect(status).toHaveTextContent('/usr/local/bin/claude')
    expect(status).toHaveTextContent('/usr/local/bin/opencode')
  })

  it('찾지 못하면 그 이유를 그대로 보여준다', async () => {
    const checkAgents = vi.fn(async (): Promise<AgentStatuses> => ({
      'claude-code': { ok: false, reason: 'PATH에서 claude 실행 파일을 찾을 수 없습니다.' },
      opencode: { ok: true, executable: '/usr/local/bin/opencode' }
    }))
    renderPanel(makeClient({}, { checkAgents }))

    expect(await screen.findByLabelText('CLI 상태'))
      .toHaveTextContent('PATH에서 claude 실행 파일을 찾을 수 없습니다.')
  })

  it('저장하면 상태를 다시 읽는다', async () => {
    // 다시 읽지 않으면 방금 고친 경로가 맞는지 알 수 없어, 실행을 해봐야만 안다.
    const checkAgents = vi.fn(async () => AGENTS_OK)
    renderPanel(makeClient({}, { checkAgents }))
    await screen.findByLabelText('CLI 상태')
    expect(checkAgents).toHaveBeenCalledTimes(1)

    await userEvent.type(screen.getByLabelText('Claude Code 실행 파일'), '/a')
    await userEvent.click(screen.getByRole('button', { name: 'CLI 경로 저장' }))

    await waitFor(() => expect(checkAgents).toHaveBeenCalledTimes(2))
  })

  it('저장이 끝나면 목록을 다시 읽으라고 알린다', async () => {
    const onWorkspaceSaved = vi.fn()
    renderPanel(makeClient(), { onWorkspaceSaved })

    await userEvent.type(await screen.findByLabelText('Claude Code 실행 파일'), '/a')
    await userEvent.click(screen.getByRole('button', { name: 'CLI 경로 저장' }))

    await waitFor(() => expect(onWorkspaceSaved).toHaveBeenCalled())
  })

  it('저장에 실패하면 알리고 입력을 지우지 않는다', async () => {
    const updatePaths = vi.fn().mockRejectedValue(new Error('workspace를 찾을 수 없습니다'))
    renderPanel(makeClient({}, { updatePaths }))
    const box = await screen.findByLabelText('Claude Code 실행 파일')

    await userEvent.type(box, '/a')
    await userEvent.click(screen.getByRole('button', { name: 'CLI 경로 저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('workspace를 찾을 수 없습니다')
    expect(box).toHaveValue('/a')
  })

  it('상태 조회가 실패해도 화면이 남는다', async () => {
    const checkAgents = vi.fn().mockRejectedValue(new Error('못 읽음'))
    renderPanel(makeClient({}, { checkAgents }))

    expect(await screen.findByRole('alert')).toHaveTextContent('못 읽음')
    expect(screen.getByLabelText('Claude Code 실행 파일')).toBeInTheDocument()
  })

  it('workspace를 바꾸면 그 workspace의 경로와 상태를 다시 읽는다', async () => {
    const client = makeClient()
    const workspaces = [
      makeWorkspace({ id: 'w1', claudePath: '/a/claude' }),
      makeWorkspace({ id: 'w2', claudePath: '/b/claude' })
    ]
    const { rerender } = render(
      <ClientProvider client={client}>
        <SettingsPanel workspaces={workspaces} workspaceId="w1" onWorkspaceSaved={vi.fn()} />
      </ClientProvider>
    )
    await waitFor(() => expect(screen.getByLabelText('Claude Code 실행 파일')).toHaveValue('/a/claude'))

    rerender(
      <ClientProvider client={client}>
        <SettingsPanel workspaces={workspaces} workspaceId="w2" onWorkspaceSaved={vi.fn()} />
      </ClientProvider>
    )

    await waitFor(() => expect(screen.getByLabelText('Claude Code 실행 파일')).toHaveValue('/b/claude'))
    expect(client.workspaces.checkAgents).toHaveBeenCalledWith('w2')
  })

  it('workspace를 고르지 않았으면 CLI 경로 칸도 열지 않는다', async () => {
    renderPanel(makeClient(), { workspaceId: null })

    await screen.findByText(/왼쪽에서 workspace를 고르면/)
    expect(screen.queryByLabelText('Claude Code 실행 파일')).toBeNull()
    expect(screen.queryByRole('button', { name: 'CLI 경로 저장' })).toBeNull()
  })
})

describe('SettingsPanel — 탭', () => {
  it('탭 넷이 있고 실행 탭이 먼저 열린다', async () => {
    renderPanel(makeClient())
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['실행', '앱', 'repo', '정보'])
    expect(screen.getByRole('tab', { name: '실행' })).toHaveAttribute('aria-selected', 'true')
    // 실행 탭의 내용은 보이고 앱 탭의 내용은 보이지 않는다.
    expect(await screen.findByLabelText('기본 agent')).toBeInTheDocument()
    expect(screen.queryByLabelText('Claude Code 글로벌 경로')).toBeNull()
  })

  it('탭을 누르면 그 탭의 내용으로 바뀐다', async () => {
    renderPanel(makeClient())
    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    expect(screen.getByRole('tab', { name: '앱' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByLabelText('Claude Code 글로벌 경로')).toBeInTheDocument()
    expect(screen.queryByLabelText('기본 agent')).toBeNull()
  })

  it('각 탭이 자기 범위를 밝힌다', async () => {
    // FR-2: 실행·repo는 workspace 하나, 앱은 장비 전체. 이 문장이 "어디서 바꾸는지
    // 모르겠다"(intent)에 대한 답이다.
    renderPanel(makeClient())
    expect(await screen.findByText(/이 workspace에만/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    expect(await screen.findByText(/이 장비 전체에/)).toBeInTheDocument()
  })

  it('탭을 옮겼다 돌아와도 고치던 입력이 그대로다', async () => {
    // FR-11이 지키는 약속은 "저장 버튼이 없다"가 아니라 이것이다 — 초안 state가
    // 탭이 아니라 SettingsPanel에 있어야 성립한다. state를 탭 컴포넌트로 내리면
    // 언마운트와 함께 사라져 이 테스트가 실패한다.
    renderPanel(makeClient())
    const model = await screen.findByLabelText('Claude Code 기본 모델')
    await userEvent.type(model, 'opus')
    expect(model).toHaveValue('opus')

    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    const box = await screen.findByLabelText('Claude Code 글로벌 경로')
    await userEvent.clear(box)
    await userEvent.type(box, '/임시')

    await userEvent.click(screen.getByRole('tab', { name: '실행' }))
    expect(await screen.findByLabelText('Claude Code 기본 모델')).toHaveValue('opus')

    await userEvent.click(screen.getByRole('tab', { name: '앱' }))
    expect(await screen.findByLabelText('Claude Code 글로벌 경로')).toHaveValue('/임시')
  })
})
