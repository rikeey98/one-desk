import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { AgentActivityPanel } from './AgentActivityPanel'
import { AGENT_ACTIVITY_TRIGGER_ID } from '../agentActivity'
import type { OneDeskClient } from '@shared/client'
import type { AgentProbes, AgentStatuses, ConfigFile, HomeSummary, Repo, Workspace } from '@shared/models'

function ws(id: string, name: string, over: Partial<Workspace> = {}): Workspace {
  return {
    id, name, description: null, defaultAgentKind: 'claude-code', defaultModelClaude: null, defaultModelOpencode: null,
    defaultEffortClaude: null, defaultVariantOpencode: null, defaultPermission: 'edit', claudePath: null, opencodePath: null, kind: 'normal',
    createdAt: 1, updatedAt: 1, ...over
  }
}

const api: Repo = { id: 'r1', workspaceId: 'w1', name: 'api', path: '/w/api', description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0 }

const FILES: ConfigFile[] = [
  { key: 'claude-settings', repoId: null, path: '/home/me/.claude/settings.json', exists: true },
  { key: 'claude-state', repoId: null, path: '/home/me/.claude.json', exists: true },
  { key: 'opencode-config', repoId: null, path: '/home/me/.config/opencode/opencode.json', exists: false },
  { key: 'repo-mcp', repoId: 'r1', path: '/w/api/.mcp.json', exists: true },
  { key: 'repo-opencode', repoId: 'r1', path: '/w/api/opencode.json', exists: false }
]

function summary(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    running: [], queued: 0, slots: { used: 0, limit: 3 }, todos: [], timeline: [], workspaces: [], doneToday: [],
    setup: { workspace: true, repo: true, firstRun: true }, ...over
  }
}

function makeClient(over: { summary?: HomeSummary; files?: ConfigFile[]; openConfigFile?: () => Promise<void> } = {}) {
  const statuses: AgentStatuses = {
    'claude-code': { ok: true, executable: '/usr/local/bin/claude' },
    opencode: { ok: false, reason: 'opencode를 찾을 수 없습니다' }
  }
  const probes: AgentProbes = {
    'claude-code': { auth: { state: 'ok', method: null, plan: null }, model: { state: 'resolved', model: 'claude-sonnet-5' }, version: '2.1.300', models: [] },
    opencode: { auth: { state: 'unknown', reason: '실행 파일 없음' }, model: { state: 'skipped', reason: '실행 파일 없음' }, version: null, models: [] }
  }
  const client = {
    home: {
      summary: vi.fn(async () => over.summary ?? summary())
    },
    workspaces: {
      checkAgents: vi.fn(async () => statuses),
      probeAgents: vi.fn(async () => probes)
    },
    repos: { list: vi.fn(async () => [api]) },
    app: {
      info: vi.fn(async () => ({ version: '9.9.9', dataDir: '/d', dbFile: '/d/one-desk.db', logDir: '/d/logs' })),
      configFiles: vi.fn(async () => over.files ?? FILES),
      openConfigFile: vi.fn(over.openConfigFile ?? (async () => {})),
      reveal: vi.fn(async () => {})
    },
    events: {
      onRunUpdate: vi.fn(() => () => {}),
      onInboxUpdate: vi.fn(() => () => {}),
      onQueueUpdate: vi.fn(() => () => {}),
      onItemChanged: vi.fn(() => () => {})
    }
  }
  return client as unknown as OneDeskClient & typeof client
}

function renderPanel(client = makeClient(), over: Partial<Parameters<typeof AgentActivityPanel>[0]> = {}) {
  const props = {
    workspaces: [ws('w1', '회사', { defaultModelClaude: 'opus', defaultEffortClaude: 'high', defaultPermission: 'full' }), ws('w2', '개인')],
    workspaceId: 'w1',
    mcpStatus: { state: 'listening', port: 53021 } as const,
    queue: { running: 1, limit: 3, waiting: 2 },
    planUsage: null,
    onOpenConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    ...over
  }
  render(
    <ClientProvider client={client}>
      <AgentActivityPanel {...props} />
    </ClientProvider>
  )
  return { client, props }
}

describe('AgentActivityPanel — 지금 동작 (docs/sdlc/agent-status/ FR-4)', () => {
  it('MCP·슬롯·대기를 말하고, 도는 대화의 `열기`는 패널을 닫고 그 대화로 간다', async () => {
    const client = makeClient({
      summary: summary({
        running: [{
          workspaceId: 'w2', workspaceName: '개인', repoId: 'r9', repoName: 'blog', conversationId: 'c1', runId: 't2',
          title: '빌드 고치기', turns: 2, startedAt: Date.now() - 5_000, currentTool: 'Bash', lastText: null
        }]
      })
    })
    const { props } = renderPanel(client)
    expect(screen.getByText('포트 53021에서 받는 중')).toBeInTheDocument()
    expect(screen.getByText(/1\/3 사용/)).toHaveTextContent('기다리는 턴 2')
    const row = (await screen.findByText('빌드 고치기')).closest('li')!
    expect(row).toHaveTextContent('개인 · blog')
    expect(row).toHaveTextContent('Bash')
    await userEvent.click(within(row).getByRole('button', { name: '빌드 고치기 대화로 가기' }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onOpenConversation).toHaveBeenCalledWith('w2', 'c1')
  })

  it('도는 대화가 없으면 그렇다고 말한다', async () => {
    renderPanel()
    expect(await screen.findByText('돌고 있는 대화 없음')).toBeInTheDocument()
  })

  it('MCP가 실패했으면 이유를 보인다', () => {
    renderPanel(makeClient(), { mcpStatus: { state: 'failed', message: 'EADDRINUSE' } })
    expect(screen.getByText('연결 실패 — EADDRINUSE')).toBeInTheDocument()
  })
})

describe('AgentActivityPanel — 에이전트 설치 (FR-5)', () => {
  it('설정 실행 탭과 같은 판정을 고른 workspace로 묻고 같은 줄로 그린다', async () => {
    const { client } = renderPanel()
    const list = await screen.findByRole('list', { name: '에이전트 설치 판정' })
    await waitFor(() => expect(list).toHaveTextContent('claude-sonnet-5'))
    expect(list).toHaveTextContent('/usr/local/bin/claude · v2.1.300')
    expect(list).toHaveTextContent('opencode를 찾을 수 없습니다')
    expect(client.workspaces.checkAgents).toHaveBeenCalledWith('w1')
  })

  it('고른 workspace가 없으면 첫 workspace로 묻는다', async () => {
    const { client } = renderPanel(makeClient(), { workspaceId: null })
    await waitFor(() => expect(client.workspaces.checkAgents).toHaveBeenCalledWith('w1'))
    expect(client.app.configFiles).toHaveBeenCalledWith('w1')
  })

  it('workspace가 하나도 없으면 묻지 않고 안내한다 — 설정 파일은 이 장비의 것만', async () => {
    const { client } = renderPanel(makeClient(), { workspaces: [], workspaceId: null })
    expect(screen.getByText('workspace를 만들면 확인합니다')).toBeInTheDocument()
    await waitFor(() => expect(client.app.configFiles).toHaveBeenCalledWith(null))
    expect(client.workspaces.checkAgents).not.toHaveBeenCalled()
  })

  it('다시 확인은 캐시를 버리고 다시 묻는다', async () => {
    const { client } = renderPanel()
    const again = screen.getByRole('button', { name: '에이전트 설치 다시 확인' })
    await waitFor(() => expect(again).toBeEnabled())
    await userEvent.click(again)
    await waitFor(() => expect(client.workspaces.probeAgents).toHaveBeenLastCalledWith('w1', true))
  })
})

describe('AgentActivityPanel — 실행 환경 (FR-5)', () => {
  it('고른 workspace의 기본값을 같은 이름표로 보이고, `설정 열기`는 닫고 설정으로 간다', async () => {
    const { props } = renderPanel()
    const env = screen.getByRole('region', { name: '실행 환경' })
    expect(env).toHaveTextContent('회사')
    expect(env).toHaveTextContent('Claude Code')
    expect(env).toHaveTextContent('opus')
    expect(env).toHaveTextContent('high')
    expect(env).toHaveTextContent('전체 허용')
    expect(env).toHaveTextContent('최대 3개')
    await waitFor(() => expect(env).toHaveTextContent('v9.9.9'))
    await userEvent.click(within(env).getByRole('button', { name: '설정 열기' }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onOpenSettings).toHaveBeenCalled()
  })

  it('비운 기본값은 CLI 기본값이라고 말한다 — OpenCode면 variant다', () => {
    renderPanel(makeClient(), { workspaces: [ws('w1', '회사', { defaultAgentKind: 'opencode' })] })
    const env = screen.getByRole('region', { name: '실행 환경' })
    expect(env).toHaveTextContent('OpenCode')
    expect(env).toHaveTextContent('variant')
    expect(env).toHaveTextContent('CLI 기본값')
  })
})

describe('AgentActivityPanel — 설정 파일 (FR-6·FR-7)', () => {
  it('있는 파일은 (종류, repo id)로 열고, 없는 이 장비의 파일은 자리만 보인다', async () => {
    const { client } = renderPanel()
    const files = screen.getByRole('region', { name: '설정 파일' })
    await userEvent.click(await within(files).findByRole('button', { name: 'Claude Code 사용자 설정 파일 열기' }))
    expect(client.app.openConfigFile).toHaveBeenLastCalledWith({ key: 'claude-settings', repoId: null })
    await userEvent.click(within(files).getByRole('button', { name: 'api · 프로젝트 MCP 서버 파일 열기' }))
    expect(client.app.openConfigFile).toHaveBeenLastCalledWith({ key: 'repo-mcp', repoId: 'r1' })
    const missing = within(files).getByText('OpenCode 전역 설정').closest('li')!
    expect(missing).toHaveTextContent('없음')
    expect(within(missing).queryByRole('button')).toBeNull()
    // repo의 없는 파일은 줄을 세우지 않는다
    expect(within(files).queryByText('OpenCode 프로젝트 설정')).toBeNull()
  })

  it('열기에 실패하면 이유를 패널에 보인다', async () => {
    renderPanel(makeClient({ openConfigFile: async () => { throw new Error('파일이 없습니다: /x') } }))
    await userEvent.click(await screen.findByRole('button', { name: 'Claude Code 사용자 설정 파일 열기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('파일이 없습니다: /x')
  })

  it('one-desk의 데이터·로그 폴더를 이름으로 연다', async () => {
    const { client } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '앱 데이터 폴더' }))
    expect(client.app.reveal).toHaveBeenLastCalledWith('data')
    await userEvent.click(screen.getByRole('button', { name: '실행 로그 폴더' }))
    expect(client.app.reveal).toHaveBeenLastCalledWith('logs')
  })
})

describe('AgentActivityPanel — 닫기 (FR-3)', () => {
  it('Esc는 패널만 닫고 바깥(App의 열린 항목 닫기)으로 새지 않는다', async () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    try {
      const { props } = renderPanel()
      const dialog = screen.getByRole('dialog', { name: '에이전트 현황' })
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(props.onClose).toHaveBeenCalledTimes(1)
      expect(outer).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', outer)
    }
  })

  it('바깥을 누르면 닫히고, 패널 안과 하단 줄 버튼은 바깥이 아니다', () => {
    const trigger = document.createElement('button')
    trigger.id = AGENT_ACTIVITY_TRIGGER_ID
    document.body.appendChild(trigger)
    try {
      const { props } = renderPanel()
      fireEvent.pointerDown(screen.getByRole('dialog', { name: '에이전트 현황' }))
      fireEvent.pointerDown(trigger)
      expect(props.onClose).not.toHaveBeenCalled()
      fireEvent.pointerDown(document.body)
      expect(props.onClose).toHaveBeenCalledTimes(1)
    } finally {
      trigger.remove()
    }
  })

  it('닫기 단추', async () => {
    const { props } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '에이전트 현황 닫기' }))
    expect(props.onClose).toHaveBeenCalled()
  })
})
