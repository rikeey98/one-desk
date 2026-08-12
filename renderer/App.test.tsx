import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from './client/ClientProvider'
import { RunEventProvider } from './store/RunEventContext'
import { createRunEventStore, type RunEventStore } from './store/runEvents'
import App from './App'
import type { OneDeskClient } from '@shared/client'
import type {
  CreateRepoInput, CreateWorkspaceInput, InboxCounts, Repo, Run, Workspace
} from '@shared/models'

const workspace: Workspace = {
  id: 'w1', name: 'ws1', description: null, defaultAgentKind: 'claude-code',
  defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit',
  claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
}

function makeRepo(id: string, name: string, path: string, workspaceId = 'w1'): Repo {
  return { id, workspaceId, name, path, description: null, sortOrder: 0, createdAt: 0 }
}

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 'run-1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp/api', permission: 'edit', userPrompt: '토큰 버그 고쳐줘', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: 'sess-1', parentRunId: null,
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 1, contextItems: [],
    ...over
  }
}

/** 가짜 백엔드의 초기 상태. 인박스 배선 테스트는 상태가 있어야 의미가 생긴다. */
interface Seed {
  /** 미확인 run들. 같은 목록이 runs.list에도 보인다. */
  inbox?: Run[]
  repos?: Repo[]
  workspaces?: Workspace[]
}

/**
 * repos.list()가 실제 백엔드처럼 "그 순간의 최신 목록"을 돌려주게 만든다.
 * 버그는 백엔드가 아니라 화면 쪽 상태 동기화에 있었으므로, mock은 항상 진실을
 * 돌려주되 각 컴포넌트가 그 진실을 다시 조회하는지를 테스트가 가려낸다.
 *
 * workspaces·인박스도 같은 이유로 상태를 들고 있다. markReviewed가 이후 inbox()·
 * inboxCounts()에 반영되고 core의 emitInbox처럼 push까지 흉내내야, 화면이 그
 * 진실을 다시 읽는지(=배선이 살아 있는지) 테스트가 가려낼 수 있다.
 */
function makeClient(runsOver: Record<string, unknown> = {}, seed: Seed = {}): OneDeskClient {
  let workspaces: Workspace[] = seed.workspaces ?? [workspace]
  let repos: Repo[] = seed.repos ?? []
  let inbox: Run[] = seed.inbox ?? []
  const started: Run[] = [...(seed.inbox ?? [])]
  const listeners: Array<(counts: InboxCounts) => void> = []

  function counts(): InboxCounts {
    const byWorkspace: Record<string, number> = {}
    for (const run of inbox) byWorkspace[run.workspaceId] = (byWorkspace[run.workspaceId] ?? 0) + 1
    return { total: inbox.length, byWorkspace }
  }

  function emitInbox(): void {
    for (const cb of listeners) cb(counts())
  }

  return {
    workspaces: {
      list: vi.fn(async () => workspaces),
      create: vi.fn(async (input: CreateWorkspaceInput) => {
        const created: Workspace = { ...workspace, id: `w${workspaces.length + 1}`, name: input.name }
        workspaces = [...workspaces, created]
        return created
      }),
      remove: vi.fn()
    },
    repos: {
      list: vi.fn(async () => repos),
      create: vi.fn(async (input: CreateRepoInput) => {
        const created = makeRepo(`r${repos.length + 1}`, input.name, input.path, input.workspaceId)
        repos = [...repos, created]
        return created
      }),
      remove: vi.fn()
    },
    issues: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(async () => ({ id: 'i-new' })),
      update: vi.fn(async () => ({ id: 'i-updated' })),
      remove: vi.fn()
    },
    memos: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    runs: {
      list: vi.fn(async (workspaceId: string) => started.filter((r) => r.workspaceId === workspaceId)),
      start: vi.fn(async () => makeRun({ id: 'started' })),
      cancel: vi.fn(),
      readLog: vi.fn().mockResolvedValue([]),
      queueSnapshot: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      setConcurrencyLimit: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      inbox: vi.fn(async () => inbox),
      inboxCounts: vi.fn(async () => counts()),
      markReviewed: vi.fn(async (runId: string) => {
        inbox = inbox.filter((r) => r.id !== runId)
        emitInbox()
      }),
      resume: vi.fn(async () => makeRun({ id: 'resumed' })),
      ...runsOver
    },
    events: {
      onRunEvent: vi.fn(() => () => {}),
      onRunUpdate: vi.fn(() => () => {}),
      onQueueUpdate: vi.fn(() => () => {}),
      onInboxUpdate: vi.fn((cb: (next: InboxCounts) => void) => {
        listeners.push(cb)
        return () => {}
      })
    }
  } as unknown as OneDeskClient
}

function renderApp(client: OneDeskClient, store: RunEventStore = createRunEventStore()) {
  render(
    <ClientProvider client={client}>
      <RunEventProvider store={store}>
        <App />
      </RunEventProvider>
    </ClientProvider>
  )
}

/** 사이드바의 인박스 링크. Dock 탭에도 같은 글자가 들어갈 수 있어 <nav>로 스코프한다. */
function inboxLink(): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('button', { name: /인박스/ })
}

async function openInbox(): Promise<void> {
  await userEvent.click(inboxLink())
}

describe('App', () => {
  it('repo를 등록하면 실행 패널의 작업 디렉토리에도 바로 반영된다', async () => {
    // RepoStrip과 RunPanel이 각자 독립된 repo 목록 상태를 들고 있으면, RepoStrip에서
    // repo를 추가해도 RunPanel은 그 사실을 몰라 작업 디렉토리 select가 영원히 비고
    // ▶ 실행 버튼도 계속 비활성으로 남는다 — e2e에서 실제로 재현된 결함이다.
    render(
      <ClientProvider client={makeClient()}>
        <RunEventProvider store={createRunEventStore()}>
          <App />
        </RunEventProvider>
      </ClientProvider>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'ws1' }))

    await userEvent.type(await screen.findByPlaceholderText('repo 이름'), 'api')
    await userEvent.type(screen.getByPlaceholderText('/절대/경로'), '/tmp/api')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await screen.findByRole('button', { name: 'api 맥락에 담기' })

    // RunPanel의 작업 디렉토리 select가 새 repo를 알아야 한다.
    await waitFor(() => expect(screen.getByLabelText('작업 디렉토리')).toHaveValue('/tmp/api'))

    await userEvent.type(screen.getByPlaceholderText(/무엇을 시킬지/), '고쳐줘')
    expect(screen.getByRole('button', { name: '▶ 실행' })).toBeEnabled()
  })

  it('상한 변경이 거부되면 오류를 화면에 보여준다', async () => {
    // void로 던져두면 표시기가 그냥 안 움직이고 사용자는 아무것도 못 본다 —
    // 렌더러에는 unhandled rejection만 남는다. 새 UI 없이 기존 배너로 흘려야 한다.
    const client = makeClient({
      setConcurrencyLimit: vi.fn().mockRejectedValue(new Error('상한을 저장하지 못했습니다'))
    })
    render(
      <ClientProvider client={client}>
        <RunEventProvider store={createRunEventStore()}>
          <App />
        </RunEventProvider>
      </ClientProvider>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'ws1' }))
    await userEvent.click(await screen.findByRole('button', { name: '실행 슬롯' }))
    const input = screen.getByLabelText('동시 실행 상한')
    await userEvent.clear(input)
    await userEvent.type(input, '5{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('상한을 저장하지 못했습니다')
  })

  it('사이드바 배지로 미처리 건수를 알리고, 인박스에서 "확인함"을 누르면 사라진다', async () => {
    const client = makeClient({}, {
      inbox: [
        makeRun({ id: 'r-1', userPrompt: '첫 결과' }),
        makeRun({ id: 'r-2', userPrompt: '둘째 결과' })
      ]
    })
    renderApp(client)

    await waitFor(() => expect(inboxLink()).toHaveTextContent('2'))
    await openInbox()
    expect(await screen.findByText('첫 결과')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: '확인함' })[0]!)

    await waitFor(() => expect(client.runs.markReviewed).toHaveBeenCalledWith('r-1', 'confirmed'))
    // 확인한 run은 목록에서도 배지에서도 빠진다 — 목록은 스냅샷이지 진실이 아니다.
    await waitFor(() => expect(screen.queryByText('첫 결과')).toBeNull())
    expect(screen.getByText('둘째 결과')).toBeInTheDocument()
    expect(inboxLink()).toHaveTextContent('1')
  })

  it('"답하고 이어서"는 그 run의 세션을 이어 실행한다', async () => {
    const client = makeClient({}, {
      repos: [makeRepo('r1', 'api', '/tmp/api')],
      inbox: [makeRun({
        id: 'r-ask', needsAnswer: true, userPrompt: '질문한 실행', externalSessionId: 'sess-1'
      })]
    })
    renderApp(client)

    await openInbox()
    await userEvent.click(await screen.findByRole('button', { name: '답하고 이어서' }))

    await userEvent.type(await screen.findByPlaceholderText(/무엇을 시킬지/), '이어서 해줘')
    await userEvent.click(screen.getByRole('button', { name: '▶ 실행' }))

    await waitFor(() => expect(client.runs.resume).toHaveBeenCalledWith(expect.objectContaining({
      parentRunId: 'r-ask',
      userPrompt: '이어서 해줘'
    })))
    expect(client.runs.start).not.toHaveBeenCalled()
  })

  it('"이슈로 만들기"는 이슈를 만들고 그 run을 보관한다', async () => {
    // 실패는 대개 나중에 다뤄야 할 일인데, 인박스에서 사라지면 그대로 잊힌다.
    const client = makeClient({}, {
      inbox: [makeRun({
        id: 'r-failed', status: 'failed', userPrompt: '실패한 실행\n둘째 줄', errorMessage: '권한 거부'
      })]
    })
    renderApp(client)

    await openInbox()
    await userEvent.click(await screen.findByRole('button', { name: '이슈로 만들기' }))

    await waitFor(() => expect(client.issues.create).toHaveBeenCalledWith({
      workspaceId: 'w1', title: '실패한 실행', body: '권한 거부'
    }))
    await waitFor(() => expect(client.runs.markReviewed).toHaveBeenCalledWith('r-failed', 'archived'))
    await waitFor(() => expect(screen.queryByText(/실패한 실행/)).toBeNull())
  })

  it('사이드바에서 만든 workspace를 인박스도 안다', async () => {
    // useWorkspaces 인스턴스가 둘이면 Sidebar에서 만든 workspace를 App 인스턴스가
    // 영영 모른다 — 인박스가 그 run을 "(사라진 workspace)"로 그린 실제 결함이다.
    // useRepos 회귀 테스트와 같은 구조로, 가짜 client가 생성 후 새 목록을 돌려준다.
    const client = makeClient({}, {
      inbox: [makeRun({ id: 'r-new-ws', workspaceId: 'w2', userPrompt: '새 workspace의 실행' })]
    })
    renderApp(client)

    await userEvent.type(await screen.findByPlaceholderText('새 workspace 이름…'), 'ws2{Enter}')
    await screen.findByRole('button', { name: /ws2/ })

    await openInbox()
    const item = await screen.findByText('새 workspace의 실행')
    const card = item.closest('.inbox-item')!
    expect(within(card as HTMLElement).getByText('ws2')).toBeInTheDocument()
    expect(within(card as HTMLElement).queryByText('(사라진 workspace)')).toBeNull()
  })

  it('인박스 조회에 실패하면 인박스를 열지 않아도 사이드바에서 드러난다', async () => {
    // 배지가 그냥 안 붙으면 "처리할 것이 없다"와 "못 읽었다"가 구별되지 않는다.
    // 3a의 useQueue가 정확히 그 실수를 했다 (설계 §9).
    const client = makeClient({
      inbox: vi.fn().mockRejectedValue(new Error('인박스를 불러오지 못했습니다')),
      inboxCounts: vi.fn().mockRejectedValue(new Error('인박스를 불러오지 못했습니다'))
    })
    renderApp(client)

    expect(await screen.findByTitle(/인박스를 불러오지 못했습니다/)).toBeInTheDocument()
    expect(inboxLink()).toHaveTextContent('!')
  })

  it('인박스 조회 실패는 인박스 화면에도 배너로 뜬다', async () => {
    const client = makeClient({
      inbox: vi.fn().mockRejectedValue(new Error('인박스를 불러오지 못했습니다')),
      inboxCounts: vi.fn().mockRejectedValue(new Error('인박스를 불러오지 못했습니다'))
    })
    renderApp(client)

    await openInbox()
    expect(await screen.findByRole('alert')).toHaveTextContent('인박스를 불러오지 못했습니다')
  })

  it('"관련 이슈 닫기"는 이슈만 닫고 run은 인박스에 남긴다', async () => {
    // 설계 §5의 reviewedKind 표에 이 행동이 없고, 같은 절이 "이슈가 여럿이면 각각
    // 보인다"고 적었다. run까지 확인 처리하면 첫 이슈를 닫는 순간 항목이 사라져
    // 나머지 이슈를 닫을 수 없다.
    const client = makeClient({}, {
      inbox: [makeRun({
        id: 'r-done', userPrompt: '두 이슈 붙은 실행',
        contextItems: [{ type: 'issue', id: 'i1' }, { type: 'issue', id: 'i2' }]
      })]
    })
    renderApp(client)

    await openInbox()
    const buttons = await screen.findAllByRole('button', { name: '관련 이슈 닫기' })
    await userEvent.click(buttons[0]!)

    await waitFor(() => expect(client.issues.update).toHaveBeenCalledWith({ id: 'i1', status: 'done' }))
    expect(client.runs.markReviewed).not.toHaveBeenCalled()
    // 두 번째 이슈를 닫으려면 항목이 그대로 있어야 한다.
    expect(screen.getByText('두 이슈 붙은 실행')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '관련 이슈 닫기' })).toHaveLength(2)
  })

  it('인박스의 "로그 보기"가 그 run의 로그를 연다', async () => {
    // 화면이 인박스에서 workspace로 바뀌면 Dock이 다시 마운트되며 내부 view가
    // 'new'로 돌아간다 — 지정하지 않으면 사용자는 실행 패널만 보게 된다.
    const failed = makeRun({
      id: 'r-failed', status: 'failed', userPrompt: '빌드 고쳐줘', errorMessage: '빌드 실패'
    })
    const store = createRunEventStore()
    store.hydrate('r-failed', [{ type: 'text', runId: 'r-failed', seq: 0, at: 0, text: '로그 한 줄' }])
    renderApp(makeClient({}, { repos: [makeRepo('r1', 'api', '/tmp/api')], inbox: [failed] }), store)

    await openInbox()
    await userEvent.click(await screen.findByRole('button', { name: '로그 보기' }))

    expect(await screen.findByText('로그 한 줄')).toBeInTheDocument()
  })

  it('"다시 실행"은 원본이 돌던 작업 디렉토리에서 실행한다', async () => {
    // 프롬프트만 옮기고 cwd를 두면 RunPanel의 cwd가 첫 repo로 초기화돼 있어
    // 두 번째 repo의 run이 첫 번째 repo에서 돈다. 권한 기본값이 edit이면
    // 엉뚱한 저장소가 편집된다.
    const start = vi.fn().mockResolvedValue(makeRun({ id: 'restarted' }))
    const client = makeClient({ start }, {
      repos: [makeRepo('r1', 'api', '/tmp/api'), makeRepo('r2', 'web', '/tmp/web')],
      inbox: [makeRun({
        id: 'r-failed', status: 'failed', cwd: '/tmp/web', userPrompt: '웹 빌드 고쳐줘',
        errorMessage: '빌드 실패', externalSessionId: null
      })]
    })
    renderApp(client)

    await openInbox()
    await userEvent.click(await screen.findByRole('button', { name: '다시 실행' }))

    // 프롬프트 이전은 별도 테스트가 본다 — 여기서는 cwd만 걸리게 지운 뒤 다시 적는다.
    const box = await screen.findByPlaceholderText(/무엇을 시킬지/)
    await userEvent.clear(box)
    await userEvent.type(box, '다시 해줘')
    await userEvent.click(screen.getByRole('button', { name: '▶ 실행' }))

    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0]![0].cwd).toBe('/tmp/web')
  })

  it('"다시 실행"이 원본 프롬프트를 실행 패널에 채운다', async () => {
    const client = makeClient({}, {
      repos: [makeRepo('r1', 'api', '/tmp/api')],
      inbox: [makeRun({ id: 'r-int', status: 'interrupted', userPrompt: '원래 지시' })]
    })
    renderApp(client)

    await openInbox()
    await userEvent.click(await screen.findByRole('button', { name: '다시 실행' }))

    expect(await screen.findByPlaceholderText(/무엇을 시킬지/)).toHaveValue('원래 지시')
  })

  it('"다시 실행" 뒤에 resume으로 넘어가면 프롬프트가 비어 있다', async () => {
    // 설계 §7 — resume 모드의 프롬프트와 맥락 칩은 비어 있다. 실행하지 않고 돌아오면
    // "다시 실행"이 세운 draft가 남아 이어서 보낼 지시에 섞인다.
    const client = makeClient({}, {
      repos: [makeRepo('r1', 'api', '/tmp/api')],
      inbox: [
        makeRun({ id: 'r-int', status: 'interrupted', userPrompt: '원래 지시' }),
        makeRun({ id: 'r-ask', needsAnswer: true, userPrompt: '질문한 실행', externalSessionId: 'sess-1' })
      ]
    })
    renderApp(client)

    await openInbox()
    await userEvent.click(await screen.findByRole('button', { name: '다시 실행' }))
    expect(await screen.findByPlaceholderText(/무엇을 시킬지/)).toHaveValue('원래 지시')

    await userEvent.click(inboxLink())
    await userEvent.click(await screen.findByRole('button', { name: '답하고 이어서' }))

    expect(await screen.findByPlaceholderText(/무엇을 시킬지/)).toHaveValue('')
  })
})
