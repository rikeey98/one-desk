import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RunEventProvider } from '../store/RunEventContext'
import { createRunEventStore, type RunEventStore } from '../store/runEvents'
import { Dock } from './Dock'
import type { OneDeskClient } from '@shared/client'
import type { Repo, Run, Workspace } from '@shared/models'
import type { RunEvent } from '@shared/events'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
]

// Dock 자신은 workspaces를 쓰지 않는다 — RunPanel까지 그대로 흘려 보낼 뿐이다
// (App.tsx의 주석 참고). 여기 테스트들은 permission 기본값을 다루지 않으므로
// 빈 배열로 충분하다.
const workspaces: Workspace[] = []

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 'run-1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp/api', permission: 'edit', userPrompt: '토큰 버그 고쳐줘',
    assembledPrompt: '<task/>', status: 'running', externalSessionId: null,
    parentRunId: null, rootRunId: 'run-1', resultText: null, needsAnswer: false, timeoutMs: null,
    exitCode: null, errorMessage: null, logPath: '/tmp/logs/run-1/stream.jsonl',
    reviewedAt: null, reviewedKind: null, startedAt: 1, endedAt: null,
    createdAt: 1, contextItems: [],
    ...over
  }
}

function textEvent(runId: string, text: string): RunEvent {
  return { type: 'text', runId, seq: 0, at: 0, text }
}

function makeClient(over: Partial<OneDeskClient['runs']> = {}): OneDeskClient {
  return {
    workspaces: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
    repos: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
    runs: {
      list: vi.fn().mockResolvedValue([]),
      start: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      readLog: vi.fn().mockResolvedValue([]),
      queueSnapshot: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      setConcurrencyLimit: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      inbox: vi.fn().mockResolvedValue([]),
      inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} }),
      markReviewed: vi.fn(),
      resume: vi.fn(),
      ...over
    },
    events: {
      onRunEvent: vi.fn(() => () => {}),
      onRunUpdate: vi.fn(() => () => {}),
      onQueueUpdate: vi.fn(() => () => {}),
      onInboxUpdate: vi.fn(() => () => {})
    }
  } as unknown as OneDeskClient
}

function renderDock(
  runs: Run[],
  client: OneDeskClient,
  store: RunEventStore = createRunEventStore(),
  queueError: string | null = null,
  focusRun: Run | null = null
) {
  render(
    <ClientProvider client={client}>
      <RunEventProvider store={store}>
        <Dock
          runs={runs}
          error={null}
          workspaceId="w1"
          workspaces={workspaces}
          repos={repos}
          reposError={null}
          queue={null}
          queueError={queueError}
          onChangeLimit={vi.fn()}
          chips={[]}
          onRemoveChip={vi.fn()}
          onRunStarted={vi.fn()}
          resumeFrom={null}
          draftPrompt=""
          draftCwd={null}
          focusRun={focusRun}
          onExitResume={vi.fn()}
        />
      </RunEventProvider>
    </ClientProvider>
  )
  return store
}

describe('Dock', () => {
  it('run마다 탭을 만든다', () => {
    renderDock(
      [makeRun({ id: 'run-2', userPrompt: '새 실행' }), makeRun({ id: 'run-1', userPrompt: '옛 실행' })],
      makeClient()
    )
    expect(screen.getByText('새 실행')).toBeInTheDocument()
    expect(screen.getByText('옛 실행')).toBeInTheDocument()
  })

  it('처음에는 실행 패널을 보여주고 탭을 누르면 그 run의 로그로 바뀐다', async () => {
    const store = createRunEventStore()
    store.hydrate('run-1', [textEvent('run-1', '옛 로그')])
    renderDock([makeRun({ id: 'run-1', userPrompt: '옛 실행' })], makeClient(), store)

    // 실행 패널이 먼저 열린다 (모달이 아니라 도크 확장 — 설계 §9)
    expect(screen.getByRole('button', { name: '▶ 실행' })).toBeInTheDocument()
    expect(screen.queryByText('옛 로그')).toBeNull()

    await userEvent.click(screen.getByText('옛 실행'))
    expect(await screen.findByText('옛 로그')).toBeInTheDocument()
  })

  it('focusRun이 주어지면 그 run의 로그를 연다', async () => {
    // 인박스의 "로그 보기"는 화면을 바꾸며 이 컴포넌트를 다시 마운트시킨다.
    // 내부 view는 'new'로 돌아가므로 App이 지정하지 않으면 실행 패널만 열린다.
    const store = createRunEventStore()
    store.hydrate('run-2', [textEvent('run-2', '두 번째 로그')])
    const target = makeRun({ id: 'run-2', userPrompt: '두 번째 실행', status: 'failed' })
    renderDock([makeRun({ id: 'run-1', userPrompt: '첫 실행' }), target], makeClient(), store, null, target)

    expect(await screen.findByText('두 번째 로그')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '▶ 실행' })).toBeNull()
  })

  it('스토어가 비어 있으면 로그 파일에서 되살린다', async () => {
    // 앱을 껐다 켜면 메모리 스토어는 비어 있다. 파일이 유일한 출처다.
    const readLog = vi.fn().mockResolvedValue([textEvent('run-1', '파일에서 온 줄')])
    renderDock([makeRun({ status: 'succeeded' })], makeClient({ readLog }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    expect(await screen.findByText('파일에서 온 줄')).toBeInTheDocument()
    expect(readLog).toHaveBeenCalledWith('run-1')
  })

  it('실행 중인 run에만 취소 버튼을 보여주고 눌리면 취소한다', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([makeRun({ status: 'running' })], makeClient({ cancel }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  it('대기 중인 run에도 취소 버튼을 보여준다', async () => {
    // 프로세스가 없을 뿐 사용자에겐 똑같이 걸려 있다. core는 대기 중 취소를 이미
    // 지원하는데(execution.cancel이 큐에서 빼고 canceled로 끝낸다) 버튼이 없으면
    // 그 경로에 손이 닿지 않는다 — 상한이 낮을수록 오래 묶여 있는 쪽이다.
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([makeRun({ status: 'pending', startedAt: null })], makeClient({ cancel }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  it('끝난 run에는 취소 버튼이 없다', async () => {
    renderDock([makeRun({ status: 'succeeded' })], makeClient())
    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull()
  })

  it('답변을 기다리는 run은 탭에 표시한다', () => {
    // succeeded로 끝나지만 agent가 질문하고 멈춘 상태다. 배지가 없으면 구분이 안 된다.
    renderDock([makeRun({ status: 'succeeded', needsAnswer: true })], makeClient())
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })

  it('평범하게 끝난 run에는 답변 필요 배지가 없다', () => {
    renderDock([makeRun({ status: 'succeeded', needsAnswer: false })], makeClient())
    expect(screen.queryByText('답변 필요')).toBeNull()
  })

  it('run의 오류 메시지를 표시한다', async () => {
    renderDock([makeRun({ status: 'failed', errorMessage: 'claude를 찾을 수 없습니다' })], makeClient())
    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    expect(await screen.findByRole('alert')).toHaveTextContent('claude를 찾을 수 없습니다')
  })

  it('큐 조회 오류도 기존 배너로 보여준다', () => {
    // 실패하면 표시기가 그냥 안 보이는데, 이 기능이 메우려던 "왜 안 보이지" 공백이
    // 오류 상황에서 되살아난다. 새 배너를 만들지 않고 기존 alert 경로로 흘려야 한다.
    renderDock([], makeClient(), createRunEventStore(), '큐 상태를 불러오지 못했습니다')
    expect(screen.getByRole('alert')).toHaveTextContent('큐 상태를 불러오지 못했습니다')
  })

  it('도크를 접으면 본문이 사라진다', async () => {
    const store = createRunEventStore()
    store.hydrate('run-1', [textEvent('run-1', '로그 줄')])
    renderDock([makeRun()], makeClient(), store)

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    expect(await screen.findByText('로그 줄')).toBeInTheDocument()
    await userEvent.click(screen.getByText('▾ 실행'))
    expect(screen.queryByText('로그 줄')).toBeNull()
  })
})
