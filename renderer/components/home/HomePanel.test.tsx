import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HomeSummary, HomeWorkspace } from '@shared/models'
import { HomeBody, HomePanel, type HomeActions } from './HomePanel'
import { setupStateOf } from '../../home/setup'

const NOW = new Date(2026, 9, 21, 10, 0, 0).getTime()

function row(id: string, repos: string[], over: Partial<HomeWorkspace> = {}): HomeWorkspace {
  return {
    workspaceId: id, name: id, open: 1, doing: 0, doneToday: 0, untriaged: 0,
    repos: repos.map((r) => ({ repoId: r, name: r, path: `/w/${id}/${r}`, agentEnv: 'host', open: 0, conversations: 0, state: 'none' })),
    ...over
  }
}
function summaryOf(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    running: [], queued: 0, slots: { used: 0, limit: 2 }, todos: [], timeline: [], workspaces: [row('a', ['api']), row('b', ['web'])],
    doneToday: [], setup: { workspace: true, repo: true, firstRun: true }, ...over
  }
}
function actions(over: Partial<HomeActions> = {}): HomeActions {
  return {
    onOpenConversation: vi.fn(), onReply: vi.fn(), onResend: vi.fn(), onStop: vi.fn(), onTriage: vi.fn(), onOpenIssues: vi.fn(),
    onOpenWorkspace: vi.fn(), onFocusWorkspaceAdd: vi.fn(), onOpenRepoForm: vi.fn(),
    onRefreshCli: vi.fn(), onOpenSettings: vi.fn(), onStartFirstConversation: vi.fn(), ...over
  }
}
const cli = { statuses: null, probes: null, probing: false }

function renderBody(summary: HomeSummary, acts = actions(), width = 1440) {
  render(<HomeBody summary={summary} now={NOW} width={width} actions={acts} />)
  return acts
}

describe('HomeBody — 오늘 할 일 (FR-9)', () => {
  const todos: HomeSummary['todos'] = [
    { kind: 'needs-answer', workspaceId: 'a', workspaceName: 'a', repoId: 'api', repoName: 'api', conversationId: 'c1', runId: 'r1', title: '로그인', detail: '어느 브랜치?', at: NOW - 1000 },
    { kind: 'failed', workspaceId: 'b', workspaceName: 'b', repoId: null, repoName: null, conversationId: 'c2', runId: 'r2', title: '내보내기', detail: 'exit 1', at: NOW - 2000 },
    { kind: 'untriaged', workspaceId: 'a', workspaceName: 'a', count: 2, titles: ['x', 'y'] },
    { kind: 'stale', workspaceId: 'b', workspaceName: 'b', count: 1, titles: ['z'] }
  ]

  it('줄마다 버튼 하나(실패·중단만 둘)이고 콜백이 workspace와 id를 받는다', async () => {
    const acts = renderBody(summaryOf({ todos }))
    const list = within(screen.getByRole('list', { name: '오늘 할 일' }))
    const rows = list.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(within(rows[0]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['답하기'])
    expect(within(rows[1]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['다시 보내기', '대화 열기'])
    expect(within(rows[2]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['훑기'])
    expect(within(rows[3]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['방치 이슈 보기'])

    await userEvent.click(within(rows[0]!).getByRole('button', { name: '답하기' }))
    expect(acts.onReply).toHaveBeenCalledWith('a', 'c1')
    await userEvent.click(within(rows[1]!).getByRole('button', { name: '다시 보내기' }))
    expect(acts.onResend).toHaveBeenCalledWith('b', 'r2')
    await userEvent.click(within(rows[1]!).getByRole('button', { name: '대화 열기' }))
    expect(acts.onOpenConversation).toHaveBeenCalledWith('b', 'c2')
    await userEvent.click(within(rows[2]!).getByRole('button', { name: '훑기' }))
    expect(acts.onTriage).toHaveBeenCalledWith('a')
    await userEvent.click(within(rows[3]!).getByRole('button', { name: '방치 이슈 보기' }))
    expect(acts.onOpenIssues).toHaveBeenCalledWith('b')
  })

  it('비어 있으면 빈 상태 한 줄이고 개수 알약은 0이다', () => {
    renderBody(summaryOf())
    expect(screen.getByText(/할 일 없음/)).toBeInTheDocument()
  })
})

describe('HomeBody — 돌고 있는 것 (FR-10)', () => {
  it('대화 열기와 <제목> 실행 멈추기, 스냅샷이 없으면 "진행 중"', async () => {
    const acts = renderBody(summaryOf({
      running: [{ workspaceId: 'a', workspaceName: 'a', repoId: 'api', repoName: 'api', conversationId: 'c1', runId: 'r1', title: '로그인', turns: 2, startedAt: NOW - 65_000, currentTool: null, lastText: null }],
      queued: 1, slots: { used: 1, limit: 2 }
    }))
    const running = within(screen.getByRole('region', { name: '지금 돌고 있는 것' }))
    expect(running.getByText('진행 중')).toBeInTheDocument()
    expect(running.getByText('1분 5초')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '로그인 실행 멈추기' }))
    expect(acts.onStop).toHaveBeenCalledWith('r1')
    await userEvent.click(screen.getByRole('button', { name: '대화 열기' }))
    expect(acts.onOpenConversation).toHaveBeenCalledWith('a', 'c1')
  })
})

describe('HomeBody — 작은 창 (FR-13)', () => {
  it('창 폭 1280px(.home 1040px) 아래에서는 타임라인을 그리지 않는다', () => {
    const summary = summaryOf({ timeline: [{ workspaceId: 'a', name: 'a', bars: [] }] })
    const { unmount } = render(<HomeBody summary={summary} now={NOW} width={1039} actions={actions()} />)
    expect(screen.queryByRole('heading', { name: '오늘 타임라인' })).not.toBeInTheDocument()
    unmount()
    render(<HomeBody summary={summary} now={NOW} width={1040} actions={actions()} />)
    expect(screen.getByRole('heading', { name: '오늘 타임라인' })).toBeInTheDocument()
  })
})

describe('HomeBody — workspace 카드 (FR-6)', () => {
  it('카드 버튼의 이름은 <이름> 워크스페이스 열기다 — 사이드바의 workspace 버튼과 부딪히지 않는다', async () => {
    const acts = renderBody(summaryOf())
    expect(screen.queryByRole('button', { name: 'a' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'a 워크스페이스 열기' }))
    expect(acts.onOpenWorkspace).toHaveBeenCalledWith('a')
  })
})

// 홈에서 보내는 대화는 홈 도크 하나다 — 그 workspace로 보내는 카드를 걷었다 (docs/sdlc/home-conversation/ FR-13 개정, 2026-11-03)
describe('HomeBody — 보내는 칸이 없다', () => {
  it('본문에 지시 입력칸도 실행 버튼도 없다', () => {
    renderBody(summaryOf())
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '실행' })).not.toBeInTheDocument()
  })
})

describe('HomePanel — 준비 단계 (FR-14·16)', () => {
  it('done이 아니면 본문 대신 준비 단계이고, 끝난 단계는 한 줄로 접힌다', async () => {
    const acts = actions()
    const summary = summaryOf({ workspaces: [row('회사', ['api'])], setup: { workspace: true, repo: true, firstRun: false } })
    render(<HomePanel summary={summary} error={null} setup={setupStateOf(summary.setup, 'none')} cli={cli} now={NOW} platform="Win32" actions={acts} />)
    expect(screen.queryByRole('heading', { name: '오늘 할 일' })).not.toBeInTheDocument()
    const steps = screen.getAllByRole('listitem').filter((li) => li.classList.contains('home-step'))
    expect(steps.map((s) => s.classList.contains('home-step-done'))).toEqual([true, true, false, false])
    expect(steps[0]).toHaveTextContent('회사')
    expect(steps[1]).toHaveTextContent('repo 1개')
    expect(screen.queryByRole('button', { name: '워크스페이스 만들기' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(acts.onRefreshCli).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '설정에서 경로 지정' }))
    expect(acts.onOpenSettings).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /첫 대화 보내기/ }))
    expect(acts.onStartFirstConversation).toHaveBeenCalled()
  })

  it('아무것도 없으면 ①만 열려 있고 버튼이 사이드바 폼으로 보낸다 — ②·④는 잠긴다', async () => {
    const acts = actions()
    const summary = summaryOf({ workspaces: [], setup: { workspace: false, repo: false, firstRun: false } })
    render(<HomePanel summary={summary} error={null} setup={setupStateOf(summary.setup, 'pending')} cli={cli} now={NOW} platform="Win32" actions={acts} />)
    await userEvent.click(screen.getByRole('button', { name: '워크스페이스 만들기' }))
    expect(acts.onFocusWorkspaceAdd).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '폴더 연결하기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /첫 대화 보내기/ })).toBeDisabled()
  })

  it('넷 다 끝나면 본문이다', () => {
    const summary = summaryOf()
    render(<HomePanel summary={summary} error={null} setup={setupStateOf(summary.setup, 'ready')} cli={cli} now={NOW} platform="Win32" actions={actions()} />)
    expect(screen.getByRole('heading', { name: '오늘 할 일' })).toBeInTheDocument()
  })
})
