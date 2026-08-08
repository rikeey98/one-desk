import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RunEventProvider } from '../store/RunEventContext'
import { createRunEventStore } from '../store/runEvents'
import { Dock } from './Dock'
import type { OneDeskClient } from '@shared/client'
import type { Run } from '@shared/models'
import type { RunEvent } from '@shared/events'

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

function makeClient(over: Partial<OneDeskClient['runs']> = {}): OneDeskClient {
  return {
    runs: {
      list: vi.fn().mockResolvedValue([]),
      start: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      readLog: vi.fn().mockResolvedValue([]),
      ...over
    },
    events: { onRunEvent: vi.fn(() => () => {}), onRunUpdate: vi.fn(() => () => {}) }
  } as unknown as OneDeskClient
}

function renderDock(runs: Run[], client: OneDeskClient, store = createRunEventStore()) {
  return {
    store,
    ...render(
      <ClientProvider client={client}>
        <RunEventProvider store={store}>
          <Dock runs={runs} error={null} />
        </RunEventProvider>
      </ClientProvider>
    )
  }
}

describe('Dock', () => {
  it('run마다 탭을 만들고 가장 최근 run을 먼저 보여준다', async () => {
    const store = createRunEventStore()
    const newest = makeRun({ id: 'run-2', userPrompt: '새 실행' })
    const older = makeRun({ id: 'run-1', userPrompt: '옛 실행', status: 'succeeded' })
    store.hydrate('run-2', [{ type: 'text', runId: 'run-2', seq: 0, at: 0, text: '새 로그' } as RunEvent])
    store.hydrate('run-1', [{ type: 'text', runId: 'run-1', seq: 0, at: 0, text: '옛 로그' } as RunEvent])

    renderDock([newest, older], makeClient(), store)

    expect(screen.getByText('새 실행')).toBeInTheDocument()
    expect(screen.getByText('옛 실행')).toBeInTheDocument()
    expect(await screen.findByText('새 로그')).toBeInTheDocument()
  })

  it('탭을 누르면 그 run의 로그로 바뀐다', async () => {
    const store = createRunEventStore()
    store.hydrate('run-2', [{ type: 'text', runId: 'run-2', seq: 0, at: 0, text: '새 로그' } as RunEvent])
    store.hydrate('run-1', [{ type: 'text', runId: 'run-1', seq: 0, at: 0, text: '옛 로그' } as RunEvent])
    renderDock(
      [makeRun({ id: 'run-2', userPrompt: '새 실행' }), makeRun({ id: 'run-1', userPrompt: '옛 실행' })],
      makeClient(),
      store
    )

    await userEvent.click(screen.getByText('옛 실행'))
    expect(await screen.findByText('옛 로그')).toBeInTheDocument()
    expect(screen.queryByText('새 로그')).toBeNull()
  })

  it('스토어가 비어 있으면 로그 파일에서 되살린다', async () => {
    // 앱을 껐다 켜면 메모리 스토어는 비어 있다. 파일이 유일한 출처다.
    const readLog = vi.fn().mockResolvedValue([
      { type: 'text', runId: 'run-1', seq: 0, at: 0, text: '파일에서 온 줄' }
    ])
    renderDock([makeRun({ status: 'succeeded' })], makeClient({ readLog }))

    expect(await screen.findByText('파일에서 온 줄')).toBeInTheDocument()
    expect(readLog).toHaveBeenCalledWith('run-1')
  })

  it('실행 중인 run에만 취소 버튼을 보여주고 눌리면 취소한다', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([makeRun({ status: 'running' })], makeClient({ cancel }))

    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  it('끝난 run에는 취소 버튼이 없다', () => {
    renderDock([makeRun({ status: 'succeeded' })], makeClient())
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull()
  })

  it('run의 오류 메시지를 표시한다', async () => {
    renderDock(
      [makeRun({ status: 'failed', errorMessage: 'claude를 찾을 수 없습니다' })],
      makeClient()
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('claude를 찾을 수 없습니다')
  })

  it('도크를 접으면 로그가 사라진다', async () => {
    const store = createRunEventStore()
    store.hydrate('run-1', [{ type: 'text', runId: 'run-1', seq: 0, at: 0, text: '로그 줄' } as RunEvent])
    renderDock([makeRun()], makeClient(), store)

    expect(await screen.findByText('로그 줄')).toBeInTheDocument()
    await userEvent.click(screen.getByText('▾ 실행'))
    expect(screen.queryByText('로그 줄')).toBeNull()
  })
})
