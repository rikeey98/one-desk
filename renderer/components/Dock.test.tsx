import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

// id만 넘기고 rootRunId를 따로 넘기지 않으면 그 id가 뿌리다 — 부모 없는 run의
// 기본 모양이다. 여러 run을 한 대화로 묶는 테스트는 rootRunId를 명시적으로 넘긴다.
//
// 예전에는 rootRunId가 'run-1'로 하드코딩돼 있었다 — id와 무관하게 항상 같은
// 값이라 서로 다른 두 run을 넘겨도 조용히 한 대화로 접혔다. Dock이 rootRunId를
// 읽지 않던 동안은 무해했지만, groupConversations를 쓰기 시작하면 바로 드러난다.
function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 'run-1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp/api', permission: 'edit', userPrompt: '토큰 버그 고쳐줘',
    assembledPrompt: '<task/>', status: 'running', externalSessionId: null,
    parentRunId: null, rootRunId: over.id ?? 'run-1', resultText: null, needsAnswer: false, timeoutMs: null,
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
  focusConversationId: string | null = null,
  client: OneDeskClient = makeClient(),
  store: RunEventStore = createRunEventStore(),
  queueError: string | null = null
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
          draftPrompt=""
          draftCwd={null}
          focusConversationId={focusConversationId}
        />
      </RunEventProvider>
    </ClientProvider>
  )
  return store
}

describe('Dock', () => {
  it('대화마다 탭을 만든다', () => {
    renderDock([makeRun({ id: 'run-2', userPrompt: '새 실행' }), makeRun({ id: 'run-1', userPrompt: '옛 실행' })])
    expect(screen.getByText('새 실행')).toBeInTheDocument()
    expect(screen.getByText('옛 실행')).toBeInTheDocument()
  })

  it('3턴 대화가 탭 하나로 뜬다', () => {
    // 세 run이 모두 같은 대화(rootRunId: 'a1')에 속하면 탭도 하나여야 한다.
    renderDock([
      makeRun({ id: 'a3', rootRunId: 'a1', createdAt: 30 }),
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20 }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '첫 지시' })
    ])
    expect(screen.getAllByRole('button', { name: /첫 지시/ })).toHaveLength(1)
  })

  it('처음에는 실행 패널을 보여주고 탭을 누르면 그 대화의 로그로 바뀐다', async () => {
    const store = createRunEventStore()
    store.hydrate('run-1', [textEvent('run-1', '옛 로그')])
    renderDock([makeRun({ id: 'run-1', userPrompt: '옛 실행' })], null, makeClient(), store)

    // 실행 패널이 먼저 열린다 (모달이 아니라 도크 확장 — 설계 §9)
    expect(screen.getByRole('button', { name: '실행' })).toBeInTheDocument()
    expect(screen.queryByText('옛 로그')).toBeNull()

    await userEvent.click(screen.getByText('옛 실행'))
    // run 상태가 running이라 마지막 턴의 로그가 처음부터 펼쳐져 있다 (Task 7).
    expect(await screen.findByText('옛 로그')).toBeInTheDocument()
  })

  it('focusConversationId가 그 대화를 연다', () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '첫 지시' })], 'a1')
    // 탭 라벨과 대화록의 첫 턴이 같은 문구('첫 지시')를 보이므로, 대화록 쪽(turn-user)으로
    // 좁혀 확인한다 — 대화가 실제로 열렸는지(탭만이 아니라 본문까지)를 본다.
    expect(screen.getByText('첫 지시', { selector: '.turn-user' })).toBeInTheDocument()
  })

  it('focusConversationId가 주어지면 그 대화의 로그를 연다', async () => {
    // 인박스의 "로그 보기"는 화면을 바꾸며 이 컴포넌트를 다시 마운트시킨다.
    // 내부 view는 'new'로 돌아가므로 App이 지정하지 않으면 실행 패널만 열린다.
    const store = createRunEventStore()
    store.hydrate('run-2', [textEvent('run-2', '두 번째 로그')])
    const target = makeRun({ id: 'run-2', userPrompt: '두 번째 실행', status: 'failed' })
    renderDock(
      [makeRun({ id: 'run-1', userPrompt: '첫 실행' }), target],
      'run-2',
      makeClient(),
      store
    )

    // 대화가 바로 열려 새 대화 안내 대신 그 대화의 지시가 보인다. 탭 라벨도 같은
    // 문구를 보이므로 대화록 쪽(turn-user)으로 좁혀 확인한다. 입력부(실행 버튼)는
    // 대화 중에도 다음 턴을 보내기 위해 항상 함께 떠 있으므로 여기서는 보지 않는다.
    expect(screen.getByText('두 번째 실행', { selector: '.turn-user' })).toBeInTheDocument()
    expect(screen.queryByText('지시를 입력하면 대화가 시작됩니다')).toBeNull()
    // failed 상태라 마지막 턴은 접혀 있다 — 펼쳐야 로그가 보인다 (Task 7의 설계).
    await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    expect(await screen.findByText('두 번째 로그')).toBeInTheDocument()
  })

  it('스토어가 비어 있으면 로그 파일에서 되살린다', async () => {
    // 앱을 껐다 켜면 메모리 스토어는 비어 있다. 파일이 유일한 출처다.
    const readLog = vi.fn().mockResolvedValue([textEvent('run-1', '파일에서 온 줄')])
    renderDock([makeRun({ status: 'succeeded' })], null, makeClient({ readLog }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    // succeeded는 진행 중이 아니라 마지막 턴이 접혀 있다 — 펼쳐야 훅이 걸리고 읽는다.
    await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    expect(await screen.findByText('파일에서 온 줄')).toBeInTheDocument()
    expect(readLog).toHaveBeenCalledWith('run-1')
  })

  it('실행 중인 run에만 취소 버튼을 보여주고 눌리면 취소한다', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([makeRun({ status: 'running' })], null, makeClient({ cancel }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  it('대기 중인 run에도 취소 버튼을 보여준다', async () => {
    // 프로세스가 없을 뿐 사용자에겐 똑같이 걸려 있다. core는 대기 중 취소를 이미
    // 지원하는데(execution.cancel이 큐에서 빼고 canceled로 끝낸다) 버튼이 없으면
    // 그 경로에 손이 닿지 않는다 — 상한이 낮을수록 오래 묶여 있는 쪽이다.
    //
    // 대기 중인 턴은 Transcript 자신의 "취소" 버튼도 함께 보여준다(설계상 두 경로
    // 다 client.runs.cancel로 간다 — 노트 #5) — 그래서 도크 헤더의 취소 버튼만
    // 콕 집어 확인한다.
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([makeRun({ status: 'pending', startedAt: null })], null, makeClient({ cancel }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    const header = document.querySelector('.dock-header')!
    await userEvent.click(within(header).getByRole('button', { name: '취소' }))
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  it('끝난 run에는 취소 버튼이 없다', async () => {
    renderDock([makeRun({ status: 'succeeded' })])
    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull()
  })

  it('답변을 기다리는 대화는 탭에 표시한다', () => {
    // succeeded로 끝나지만 agent가 질문하고 멈춘 상태다. 배지가 없으면 구분이 안 된다.
    renderDock([makeRun({ status: 'succeeded', needsAnswer: true })])
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })

  it('평범하게 끝난 대화에는 답변 필요 배지가 없다', () => {
    renderDock([makeRun({ status: 'succeeded', needsAnswer: false })])
    expect(screen.queryByText('답변 필요')).toBeNull()
  })

  it('run의 오류 메시지를 표시한다', async () => {
    renderDock([makeRun({ status: 'failed', errorMessage: 'claude를 찾을 수 없습니다' })])
    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    // 오류는 턴 안에 항상 보인다 — 로그와 달리 펼치지 않아도 된다 (Transcript의 Turn).
    expect(await screen.findByRole('alert')).toHaveTextContent('claude를 찾을 수 없습니다')
  })

  it('큐 조회 오류도 기존 배너로 보여준다', () => {
    // 실패하면 표시기가 그냥 안 보이는데, 이 기능이 메우려던 "왜 안 보이지" 공백이
    // 오류 상황에서 되살아난다. 새 배너를 만들지 않고 기존 alert 경로로 흘려야 한다.
    renderDock([], null, makeClient(), createRunEventStore(), '큐 상태를 불러오지 못했습니다')
    expect(screen.getByRole('alert')).toHaveTextContent('큐 상태를 불러오지 못했습니다')
  })

  it('도크를 접으면 본문이 사라진다', async () => {
    const store = createRunEventStore()
    store.hydrate('run-1', [textEvent('run-1', '로그 줄')])
    renderDock([makeRun()], null, makeClient(), store)

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘'))
    expect(await screen.findByText('로그 줄')).toBeInTheDocument()
    await userEvent.click(screen.getByText('▾ 실행'))
    expect(screen.queryByText('로그 줄')).toBeNull()
  })
})
