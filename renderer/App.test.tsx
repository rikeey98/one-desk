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
})
