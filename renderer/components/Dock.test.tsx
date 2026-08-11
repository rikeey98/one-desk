import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RunEventProvider } from '../store/RunEventContext'
import { createRunEventStore, type RunEventStore } from '../store/runEvents'
import { Dock } from './Dock'
import type { OneDeskClient } from '@shared/client'
import type { Repo, Run } from '@shared/models'
import type { RunEvent } from '@shared/events'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
]

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 'run-1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp/api', permission: 'edit', userPrompt: '토큰 버그 고쳐줘',
    assembledPrompt: '<task/>', status: 'running', externalSessionId: null,
    parentRunId: null, resultText: null, needsAnswer: false, timeoutMs: null,
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
      ...over
    },
    events: {
      onRunEvent: vi.fn(() => () => {}),
      onRunUpdate: vi.fn(() => () => {}),
      onQueueUpdate: vi.fn(() => () => {})
    }
  } as unknown as OneDeskClient
}

function renderDock(runs: Run[], client: OneDeskClient, store: RunEventStore = createRunEventStore()) {
  render(
    <ClientProvider client={client}>
      <RunEventProvider store={store}>
        <Dock
          runs={runs}
          error={null}
          workspaceId="w1"
          repos={repos}
          reposError={null}
          queue={null}
          onChangeLimit={vi.fn()}
          chips={[]}
          onRemoveChip={vi.fn()}
          onRunStarted={vi.fn()}
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
