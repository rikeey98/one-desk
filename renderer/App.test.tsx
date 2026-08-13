import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from './client/ClientProvider'
import { RunEventProvider } from './store/RunEventContext'
import { createRunEventStore, type RunEventStore } from './store/runEvents'
import App from './App'
import type { OneDeskClient } from '@shared/client'
import type {
  CreateIssueInput, CreateMemoInput, CreateRepoInput, CreateWorkspaceInput,
  GuardedUpdateIssueInput, GuardedUpdateMemoInput, InboxCounts, Issue, IssueUpdateResult,
  Memo, MemoUpdateResult, Repo, Run, UpdateIssueInput, UpdateMemoInput, Workspace
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

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'w1', title: '이슈', body: '', status: 'open',
    repoIds: [], createdAt: 0, updatedAt: 0, closedAt: null, ...over
  }
}

function makeMemo(over: Partial<Memo> = {}): Memo {
  return {
    id: 'm1', workspaceId: 'w1', title: '메모', body: '',
    repoIds: [], createdAt: 0, updatedAt: 0, ...over
  }
}

/** 가짜 백엔드의 초기 상태. 인박스 배선 테스트는 상태가 있어야 의미가 생긴다. */
interface Seed {
  /** 미확인 run들. 같은 목록이 runs.list에도 보인다. */
  inbox?: Run[]
  repos?: Repo[]
  workspaces?: Workspace[]
  issues?: Issue[]
  memos?: Memo[]
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
  let issues: Issue[] = seed.issues ?? []
  let memos: Memo[] = seed.memos ?? []
  // updatedAt은 단조 증가한다 (설계 §6). 저장소의 Math.max(Date.now(), 이전+1)에서
  // 잠금이 기대는 성질만 남긴 것이다.
  let clock = 1_000

  /**
   * 이슈·메모는 실제 저장소와 같은 규칙으로 흉내낸다 — **모든 쓰기가 updatedAt을
   * 올리고, 잠긴 쓰기는 기대값을 진짜로 비교한다.**
   *
   * 고정된 객체를 돌려주는 mock으로는 낙관적 잠금이 얽힌 결함이 영영 안 보인다:
   * 목록의 상태 버튼이 잠기지 않은 update로 updatedAt을 올려 열려 있는 상세의
   * 기대값만 낡게 만들고, 그다음 자동 저장이 사용자 자신의 클릭을 agent의 편집으로
   * 착각해 유령 충돌 배너를 띄우던 결함이 356개 테스트를 통과하고 있었다.
   */
  function writeIssue(input: UpdateIssueInput): Issue {
    const prev = issues.find((i) => i.id === input.id)
    if (!prev) throw new Error(`이슈를 찾을 수 없습니다: ${input.id}`)
    const updatedAt = ++clock
    const status = input.status ?? prev.status
    const next: Issue = {
      ...prev,
      title: input.title ?? prev.title,
      body: input.body ?? prev.body,
      status,
      // closedAt은 status에서 파생된다 — 화면이 따로 넘기지 않는다.
      closedAt: status === 'done' ? updatedAt : null,
      updatedAt
    }
    issues = issues.map((i) => (i.id === next.id ? next : i))
    return next
  }

  function writeMemo(input: UpdateMemoInput): Memo {
    const prev = memos.find((m) => m.id === input.id)
    if (!prev) throw new Error(`메모를 찾을 수 없습니다: ${input.id}`)
    const updatedAt = ++clock
    const next: Memo = {
      ...prev,
      title: input.title ?? prev.title,
      body: input.body ?? prev.body,
      updatedAt
    }
    memos = memos.map((m) => (m.id === next.id ? next : m))
    return next
  }

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
      list: vi.fn(async () => issues),
      create: vi.fn(async (input: CreateIssueInput) => {
        const created = makeIssue({
          id: `i${issues.length + 1}`, workspaceId: input.workspaceId, title: input.title,
          body: input.body ?? '', createdAt: ++clock, updatedAt: clock
        })
        issues = [...issues, created]
        return created
      }),
      // 잠기지 않은 쓰기. agent(MCP)와 인박스의 이슈 닫기가 쓴다 (설계 §6).
      update: vi.fn(async (input: UpdateIssueInput) => writeIssue(input)),
      // Step 5b — 항목 전환이 옛 항목에 저장되는지 보는 회귀 테스트가 기록을 읽는다.
      updateIfUnchanged: vi.fn(async (input: GuardedUpdateIssueInput): Promise<IssueUpdateResult> => {
        const prev = issues.find((i) => i.id === input.id)
        if (!prev) throw new Error(`이슈를 찾을 수 없습니다: ${input.id}`)
        // 기대값을 진짜로 비교한다 — 이 한 줄이 없으면 유령 충돌도 진짜 충돌도 안 보인다.
        if (prev.updatedAt !== input.expectedUpdatedAt) return { ok: false, current: prev }
        return { ok: true, issue: writeIssue(input) }
      }),
      remove: vi.fn(async (id: string) => { issues = issues.filter((i) => i.id !== id) })
    },
    memos: {
      list: vi.fn(async () => memos),
      create: vi.fn(async (input: CreateMemoInput) => {
        const created = makeMemo({
          id: `m${memos.length + 1}`, workspaceId: input.workspaceId, title: input.title,
          body: input.body ?? '', createdAt: ++clock, updatedAt: clock
        })
        memos = [...memos, created]
        return created
      }),
      update: vi.fn(async (input: UpdateMemoInput) => writeMemo(input)),
      updateIfUnchanged: vi.fn(async (input: GuardedUpdateMemoInput): Promise<MemoUpdateResult> => {
        const prev = memos.find((m) => m.id === input.id)
        if (!prev) throw new Error(`메모를 찾을 수 없습니다: ${input.id}`)
        if (prev.updatedAt !== input.expectedUpdatedAt) return { ok: false, current: prev }
        return { ok: true, memo: writeMemo(input) }
      }),
      remove: vi.fn(async (id: string) => { memos = memos.filter((m) => m.id !== id) })
    },
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

/** 사이드바에서 ws1을 골라 workspace 화면으로 들어간다. */
async function selectWorkspace(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'ws1' }))
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
      // 가짜 저장소가 실제처럼 상태를 들고 있으므로, 닫을 이슈가 실제로 있어야 한다.
      issues: [makeIssue({ id: 'i1' }), makeIssue({ id: 'i2' })],
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

describe('패널 확장', () => {
  it('이슈를 클릭하면 그 패널이 확장되고 상세가 뜬다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))

    expect(screen.getByRole('region', { name: 'Issues' })).toHaveClass('panel-expanded')
    expect(screen.getByRole('region', { name: 'Memos' })).not.toHaveClass('panel-expanded')
    // App이 openId를 IssuePanel에 내려보내는지도 확인한다 — expanded만 확인하면
    // App.tsx가 <IssuePanel openId={…}> 한 줄을 빠뜨려도 이 테스트가 여전히
    // 초록이다. 클릭한 항목이 열린 상태(item-open)로 보이는지까지 봐야 한다.
    expect(screen.getByRole('button', { name: '토큰 만료' })).toHaveClass('item-open')
  })

  it('메모를 열면 이슈 상세가 닫힌다', async () => {
    // 한 번에 한 패널만 확장된다. 상태를 각 패널이 따로 들면 둘 다 열린다.
    renderApp(makeClient({}, {
      issues: [makeIssue({ id: 'i1', title: '토큰 만료' })],
      memos: [makeMemo({ id: 'm1', title: '배포 메모' })]
    }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    await userEvent.click(await screen.findByRole('button', { name: '배포 메모' }))

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
    expect(screen.getByRole('region', { name: 'Memos' })).toHaveClass('panel-expanded')
    // MemoPanel도 마찬가지다 — App이 openId를 내려보내지 않으면 패널은 확장돼도
    // 어느 항목이 열렸는지는 표시되지 않는다.
    expect(screen.getByRole('button', { name: '배포 메모' })).toHaveClass('item-open')
  })

  it('같은 항목을 다시 클릭하면 접힌다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    const title = await screen.findByRole('button', { name: '토큰 만료' })
    await userEvent.click(title)
    await userEvent.click(title)

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
  })

  it('Esc로 접는다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    await userEvent.keyboard('{Escape}')

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
  })

  it('workspace를 바꾸면 열린 항목이 접힌다', async () => {
    // App.tsx의 selectWorkspace 안 setOpenItem(null) 한 줄이 지키는 계약이다.
    // 다른 workspace로 넘어가면서 이전 workspace의 항목을 열어둔 채로 두면 안 된다.
    const ws2: Workspace = { ...workspace, id: 'w2', name: 'ws2' }
    renderApp(makeClient({}, {
      workspaces: [workspace, ws2],
      issues: [makeIssue({ id: 'i1', title: '토큰 만료' })]
    }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    expect(screen.getByRole('region', { name: 'Issues' })).toHaveClass('panel-expanded')

    await userEvent.click(await screen.findByRole('button', { name: 'ws2' }))

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
  })

  it('항목 클릭은 맥락에 담지 않는다', async () => {
    // 본문이 생기면 "열어본다"가 주된 행동이 된다. 담기는 별도 토글로 옮겼다.
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))

    expect(screen.queryByRole('button', { name: /토큰 만료 ✕/ })).toBeNull()
  })

  it('담기 토글이 맥락 칩을 만든다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료 맥락에 담기' }))

    expect(screen.getByRole('button', { name: /토큰 만료 ✕/ })).toBeInTheDocument()
  })

  it('메모 항목 클릭은 맥락에 담지 않는다', async () => {
    // IssuePanel 쪽 짝과 같은 약속이다 (설계 §5). 메모 쪽은 배선이 통째로 무방비였다 —
    // App.tsx가 MemoPanel에 내려보내는 onToggleContext 한 줄을 지워도 356개가 초록이었다.
    renderApp(makeClient({}, { memos: [makeMemo({ id: 'm1', title: '배포 메모' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '배포 메모' }))

    expect(screen.queryByRole('button', { name: /배포 메모 ✕/ })).toBeNull()
  })

  it('메모의 담기 토글이 맥락 칩을 만든다', async () => {
    renderApp(makeClient({}, { memos: [makeMemo({ id: 'm1', title: '배포 메모' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '배포 메모 맥락에 담기' }))

    expect(screen.getByRole('button', { name: /배포 메모 ✕/ })).toBeInTheDocument()
  })

  it('담은 이슈에는 담김 표시가 남는다', async () => {
    // 변이표 10. 표시가 제목에서 ＋ 토글로 옮겨간 뒤로 아무 테스트도 보고 있지 않았다.
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    const pick = await screen.findByRole('button', { name: '토큰 만료 맥락에 담기' })
    expect(pick).not.toHaveClass('item-picked')
    expect(pick).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(pick)

    expect(pick).toHaveClass('item-picked')
    expect(pick).toHaveAttribute('aria-pressed', 'true')
  })

  it('담은 메모에는 담김 표시가 남는다', async () => {
    // 변이표 10의 메모 쪽 짝 (설계 §10의 24행 — memo 대칭).
    renderApp(makeClient({}, { memos: [makeMemo({ id: 'm1', title: '배포 메모' })] }))
    await selectWorkspace()

    const pick = await screen.findByRole('button', { name: '배포 메모 맥락에 담기' })
    expect(pick).not.toHaveClass('item-picked')
    expect(pick).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(pick)

    expect(pick).toHaveClass('item-picked')
    expect(pick).toHaveAttribute('aria-pressed', 'true')
  })

  it('목록의 상태는 읽기 전용 배지다', async () => {
    // 상태 편집은 상세로 옮겼다 (설계 §9). 목록에 쓰기 버튼이 다시 생기면 그 쓰기가
    // 잠기지 않은 update를 타고 열려 있는 상세의 기대값을 낡게 만든다 — 아래
    // "유령 충돌" 테스트가 막는 결함의 입구다.
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()
    await screen.findByRole('button', { name: '토큰 만료' })

    expect(screen.queryByRole('button', { name: 'open' })).toBeNull()
    expect(screen.getByText('open')).toHaveClass('status')
  })

  it('상세에서 상태를 바꾼 뒤 본문을 쳐도 유령 충돌이 나지 않는다', async () => {
    // 목록의 상태 버튼이 잠기지 않은 update로 쓰던 시절의 결함(이 브랜치의 Critical):
    // 상태 클릭이 updatedAt을 올려 열려 있는 상세의 기대값만 낡게 만들고, 600ms 뒤
    // 자동 저장이 사용자 자신의 클릭을 agent의 편집으로 착각해 "그 사이 바뀌었습니다"를
    // 띄웠다. 거기서 다시 불러오기를 누르면 그때까지 친 것이 통째로 사라진다.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = makeClient({}, {
      issues: [makeIssue({ id: 'i1', title: '토큰 만료', updatedAt: 100 })]
    })
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))

    await userEvent.selectOptions(screen.getByLabelText('상태'), 'doing')
    await userEvent.type(screen.getByLabelText('본문'), '재현 절차')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    // 배너든 오류든 알림이 하나라도 뜨면 실패다 — 무엇이 떴는지 메시지에 남게 본다.
    expect(screen.queryAllByRole('alert').map((el) => el.textContent)).toEqual([])
    // 두 쓰기가 모두 남아 있어야 한다. 상태만 쓰이고 본문이 거부됐으면 결함 그대로다.
    const [saved] = await client.issues.list({ workspaceId: 'w1' })
    expect(saved).toMatchObject({ status: 'doing', body: '재현 절차' })
    vi.useRealTimers()
  })

  it('Esc로 접다가 난 충돌은 배너로 남고 패널이 접히지 않는다', async () => {
    // 언마운트 flush에 맡기면 setConflict가 이미 사라진 상세에 떨어져 React가 조용히
    // 버린다 — 배너도 오류도 없이, flush가 이미 소비한 텍스트만 사라진다 (설계 §7).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = makeClient({}, {
      issues: [makeIssue({ id: 'i1', title: '토큰 만료', updatedAt: 100 })]
    })
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    await userEvent.type(screen.getByLabelText('본문'), '사람이 친 것')

    // agent가 MCP로 같은 이슈를 고친 상황. agent는 잠기지 않은 update를 쓴다 (설계 §6).
    await act(async () => { await client.issues.update({ id: 'i1', body: 'agent가 쓴 것' }) })
    fireEvent.keyDown(screen.getByLabelText('본문'), { key: 'Escape' })

    expect(await screen.findByText(/그 사이 바뀌었습니다/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Issues' })).toHaveClass('panel-expanded')
    vi.useRealTimers()
  })

  it('메모도 Esc로 접다가 난 충돌은 배너로 남고 패널이 접히지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = makeClient({}, {
      memos: [makeMemo({ id: 'm1', title: '배포 메모', updatedAt: 100 })]
    })
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '배포 메모' }))
    await userEvent.type(screen.getByLabelText('본문'), '사람이 친 것')

    await act(async () => { await client.memos.update({ id: 'm1', body: 'agent가 쓴 것' }) })
    fireEvent.keyDown(screen.getByLabelText('본문'), { key: 'Escape' })

    expect(await screen.findByText(/그 사이 바뀌었습니다/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Memos' })).toHaveClass('panel-expanded')
    vi.useRealTimers()
  })

  it('다른 이슈로 옮기면 대기 중이던 본문이 원래 이슈에 저장된다', async () => {
    // key가 없으면 React가 상세를 재사용하고, 정리 시점의 저장 콜백은 이미 새
    // 이슈를 붙잡고 있어 옛 내용이 엉뚱한 이슈에 저장된다.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = makeClient({}, {
      issues: [
        makeIssue({ id: 'i1', title: '첫째', updatedAt: 100 }),
        makeIssue({ id: 'i2', title: '둘째', updatedAt: 100 })
      ]
    })
    renderApp(client)
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '첫째' }))
    await userEvent.type(screen.getByLabelText('본문'), '첫째의 메모')
    // userEvent.click은 실제 브라우저처럼 이전 포커스(본문)에 자연스러운 blur를
    // 먼저 흘려보낸다 — IssueDetail의 onBlur가 그 blur만으로 디바운스를 흘려보내
    // key 유무와 무관하게 저장이 성공해 버려 이 테스트가 무력화된다(실측 확인:
    // key를 지워도 초록이었다). fireEvent.click은 포커스 이동/blur를 흉내내지
    // 않으므로, 오직 key가 만드는 재마운트-정리 경로만으로 저장이 일어나는지를 본다.
    fireEvent.click(screen.getByRole('button', { name: '둘째' }))

    // 버퍼가 새다면 화면에도 드러난다 — key가 없으면 컴포넌트가 재사용되어 '첫째'의
    // 본문 상태가 그대로 남는다. 이 확인은 타이머나 blur와 무관하게(전환 직후) 바로
    // 참이어야 한다.
    expect(screen.getByLabelText('본문')).toHaveValue('')

    await waitFor(() => expect(client.issues.updateIfUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', body: '첫째의 메모' })
    ))
    vi.useRealTimers()
  })

  it('본문 저장이 성공하면 목록을 다시 읽는다', async () => {
    // IssuePanel이 IssueDetail에 내려보내는 onChanged={() => { void refresh() }}
    // 한 줄이 지키는 배선이다 — 비우면(onChanged={() => {}}) 성공한 저장 뒤에도
    // 목록이 낡은 채로 남는다.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] })
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))

    const before = vi.mocked(client.issues.list).mock.calls.length
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    expect(vi.mocked(client.issues.list).mock.calls.length).toBeGreaterThan(before)
    vi.useRealTimers()
  })

  it('메모 본문 저장이 성공하면 목록을 다시 읽는다', async () => {
    // MemoPanel이 MemoDetail에 내려보내는 onChanged={() => { void refresh() }}
    // 한 줄이 지키는 배선이다 — 비우면(onChanged={() => {}}) 성공한 저장 뒤에도
    // 목록이 낡은 채로 남는다. IssuePanel의 대칭 테스트와 짝이다.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = makeClient({}, { memos: [makeMemo({ id: 'm1', title: '배포 메모' })] })
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '배포 메모' }))

    const before = vi.mocked(client.memos.list).mock.calls.length
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    expect(vi.mocked(client.memos.list).mock.calls.length).toBeGreaterThan(before)
    vi.useRealTimers()
  })

  it('삭제하면 상세가 접힌다', async () => {
    // IssuePanel의 onDeleted={() => { onOpen(open.id); void refresh() }}에서
    // onOpen(open.id) 한 줄이 지키는 배선이다 — 빠지면 지워진 항목의 상세가 그대로
    // 열린 채 남는다. 이 client의 issues.list는 고정 스냅샷이라(설계상 remove가
    // 목록을 바꾸지 않는다) 컬랩스 effect(설계 §8, 다음 테스트)가 우연히 대신
    // 닫아주지 않는다 — 오직 이 명시적 호출만으로 닫히는지를 본다.
    const client = makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] })
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    expect(screen.getByRole('region', { name: 'Issues' })).toHaveClass('panel-expanded')

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
  })

  it('메모를 삭제하면 상세가 접힌다', async () => {
    // MemoPanel의 onDeleted={() => { onOpen(open.id); void refresh() }}에서
    // onOpen(open.id) 한 줄이 지키는 배선이다 — 빠지면 지워진 항목의 상세가 그대로
    // 열린 채 남는다. IssuePanel의 대칭 테스트와 짝이다.
    const client = makeClient({}, { memos: [makeMemo({ id: 'm1', title: '배포 메모' })] })
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '배포 메모' }))
    expect(screen.getByRole('region', { name: 'Memos' })).toHaveClass('panel-expanded')

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))

    expect(screen.getByRole('region', { name: 'Memos' })).not.toHaveClass('panel-expanded')
  })

  it('필터를 바꿔 열린 이슈가 목록에서 빠지면 상세가 접힌다', async () => {
    // Task 3 리뷰가 이월한 자리(설계 §8) — IssuePanel의 컬랩스 effect
    // (`if (openId && !open) onOpen(openId)`)가 지운다. repo 필터가 바뀌어 열려
    //있던 이슈가 새로 읽은 목록에서 사라지면 상세를 접어야, 더 이상 존재하지 않는
    // (또는 걸러진) 항목을 계속 그리지 않는다.
    const client = makeClient({}, {
      repos: [makeRepo('r1', 'api', '/tmp/api')],
      issues: [makeIssue({ id: 'i1', title: '토큰 만료' })]
    })
    // 첫 조회(마운트)는 이슈를 보여주고, repo 필터로 바뀐 뒤의 조회는 걸러져 빈
    // 목록을 돌려준다 — 이 fake의 list()는 인자의 repoId를 실제로 걸러내지 않으므로
    // 여기서 순서로 흉내낸다.
    vi.mocked(client.issues.list)
      .mockResolvedValueOnce([makeIssue({ id: 'i1', title: '토큰 만료' })])
      .mockResolvedValue([])
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    expect(screen.getByRole('region', { name: 'Issues' })).toHaveClass('panel-expanded')

    // repo 카드 버튼에는 aria-label이 없어 접근성 이름이 이름+경로를 이어붙인 값이
    // 되고, 옆의 "api 맥락에 담기" 버튼과 접두어가 겹친다 — role 쿼리로 모호해지는
    // 것을 피해 DOM으로 직접 집는다.
    const repoCard = document.querySelector('.repo-card')
    if (!repoCard) throw new Error('repo-card 버튼을 찾지 못했습니다')
    fireEvent.click(repoCard)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
    })
  })

  it('필터를 바꿔 열린 메모가 목록에서 빠지면 상세가 접힌다', async () => {
    // Task 3 리뷰가 이월한 자리(설계 §8) — MemoPanel의 컬랩스 effect
    // (`if (openId && !open) onOpen(openId)`)가 지운다. repo 필터가 바뀌어 열려
    // 있던 메모가 새로 읽은 목록에서 사라지면 상세를 접어야, 더 이상 존재하지 않는
    // (또는 걸러진) 항목을 계속 그리지 않는다. IssuePanel의 대칭 테스트와 짝이다.
    const client = makeClient({}, {
      repos: [makeRepo('r1', 'api', '/tmp/api')],
      memos: [makeMemo({ id: 'm1', title: '배포 메모' })]
    })
    // 첫 조회(마운트)는 메모를 보여주고, repo 필터로 바뀐 뒤의 조회는 걸러져 빈
    // 목록을 돌려준다 — 이 fake의 list()는 인자의 repoId를 실제로 걸러내지 않으므로
    // 여기서 순서로 흉내낸다.
    vi.mocked(client.memos.list)
      .mockResolvedValueOnce([makeMemo({ id: 'm1', title: '배포 메모' })])
      .mockResolvedValue([])
    renderApp(client)
    await selectWorkspace()
    await userEvent.click(await screen.findByRole('button', { name: '배포 메모' }))
    expect(screen.getByRole('region', { name: 'Memos' })).toHaveClass('panel-expanded')

    // repo 카드 버튼에는 aria-label이 없어 접근성 이름이 이름+경로를 이어붙인 값이
    // 되고, 옆의 "api 맥락에 담기" 버튼과 접두어가 겹친다 — role 쿼리로 모호해지는
    // 것을 피해 DOM으로 직접 집는다.
    const repoCard = document.querySelector('.repo-card')
    if (!repoCard) throw new Error('repo-card 버튼을 찾지 못했습니다')
    fireEvent.click(repoCard)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Memos' })).not.toHaveClass('panel-expanded')
    })
  })
})
