import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
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
    id: 'run-1', workspaceId: 'w1', agentKind: 'claude-code', model: null, effort: null,
    cwd: '/tmp/api', permission: 'edit', userPrompt: '토큰 버그 고쳐줘',
    assembledPrompt: '<task/>', status: 'running', externalSessionId: null,
    parentRunId: null, rootRunId: over.id ?? 'run-1', resultText: null, needsAnswer: false, timeoutMs: null,
    exitCode: null, errorMessage: null, logPath: '/tmp/logs/run-1/stream.jsonl',
    reviewedAt: null, reviewedKind: null, startedAt: 1, endedAt: null,
    // 대화의 이름과 끝. 뿌리 행에서만 의미가 있고 기본은 둘 다 null이다.
    title: null, closedAt: null,
    createdAt: 1, contextItems: [], usage: null,
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
    commands: {
      list: vi.fn().mockResolvedValue({ commands: [], error: null }),
      refresh: vi.fn().mockResolvedValue({ commands: [], error: null })
    },
    runs: {
      list: vi.fn().mockResolvedValue([]),
      start: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      readLog: vi.fn().mockResolvedValue([]),
      queueSnapshot: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      setConcurrencyLimit: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      inbox: vi.fn().mockResolvedValue([]),
      inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
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
  return render(
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
    // **제목으로 세지 않는다.** 줄 끝 액션의 접근성 이름이 `<제목> 이름 바꾸기`·
    // `<제목> 대화 끝내기`라(FR-21) /첫 지시/는 줄 하나당 세 번 걸린다.
    expect(screen.getAllByText('첫 지시', { selector: '.dock-conv-title' })).toHaveLength(1)
    // groupConversations 없이 run마다 줄을 만드는 변이라면 3줄이 된다.
    // "＋ 새 대화"는 .dock-new라 여기 세지 않는다.
    expect(document.querySelectorAll('.dock-conv')).toHaveLength(1)
  })

  it('탭 배지와 입력부 권한 기본값은 대화의 마지막 턴에서 온다', async () => {
    // 첫 턴은 running·edit, 마지막 턴은 succeeded·read_only — 둘을 다르게 둬야
    // "마지막 턴에서 온다"는 것을 첫 턴(conv.runs[0])과 구분해서 확인할 수 있다.
    renderDock([
      makeRun({
        id: 'b2', rootRunId: 'b1', createdAt: 20, status: 'succeeded',
        permission: 'read_only', userPrompt: '두 번째 말'
      }),
      makeRun({
        id: 'b1', rootRunId: 'b1', createdAt: 10, status: 'running',
        permission: 'edit', userPrompt: '첫 말'
      })
    ])

    // 줄의 상태 점은 마지막 턴(b2, succeeded)에서 온다 — 첫 턴(running)이 아니다.
    // 글자가 아니라 점이므로 접근성 이름으로 잡는다(2026-09-23: 좁은 레일에서
    // 영어 상태 단어가 제목을 밀어내 글자를 뺐다).
    expect(screen.getByRole('img', { name: 'succeeded' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'running' })).toBeNull()

    await userEvent.click(screen.getByText('첫 말'))
    // 입력부의 권한 기본값도 마지막 턴(read_only)에서 온다 — 첫 턴(edit)이 아니다.
    await waitFor(() => expect(screen.getByLabelText('권한')).toHaveValue('read_only'))
  })

  it('처음에는 실행 패널을 보여주고 탭을 누르면 그 대화의 로그로 바뀐다', async () => {
    const store = createRunEventStore()
    store.hydrate('run-1', [textEvent('run-1', '옛 로그')])
    renderDock([makeRun({ id: 'run-1', userPrompt: '옛 실행' })], null, makeClient(), store)

    // 실행 패널이 먼저 열린다 (모달이 아니라 도크 확장 — 설계 §9)
    expect(screen.getByRole('button', { name: '실행' })).toBeInTheDocument()
    expect(screen.queryByText('옛 로그')).toBeNull()

    await userEvent.click(screen.getByText('옛 실행'))
    // 턴은 진행 중이어도 접힌 채로 뜬다 — 로그는 눌러야 보인다.
    await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    expect(await screen.findByText('옛 로그')).toBeInTheDocument()
  })

  it('focusConversationId가 그 대화를 연다', () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '첫 지시' })], 'a1')
    // 탭 라벨과 대화록의 첫 턴이 같은 문구('첫 지시')를 보이므로, 대화록 쪽(turn-user)으로
    // 좁혀 확인한다 — 대화가 실제로 열렸는지(탭만이 아니라 본문까지)를 본다.
    expect(screen.getByText('첫 지시', { selector: '.turn-user' })).toBeInTheDocument()
  })

  it('명시적으로 고른 대화가 목록에 없으면 다른 대화로 폴백하지 않는다', () => {
    // selected는 이제 로그 뷰의 대상만이 아니라 입력부의 전송 대상이기도 하다
    // (ConversationPanel→RunPanel이 conversation.id로 resume을 부른다). 폴백은
    // "고른 적이 없을 때"만 적용해야 한다 — pickedId가 있는데 그 대화가
    // conversations에 없다고 조용히 다른 대화로 떨어지면, 화면과 입력부가 서로
    // 다른 대화를 가리키는 채로 턴이 엉뚱한 대화로 나갈 수 있다(Important 2).
    //
    // 이 상태(비동기 runs 따라잡기 경쟁이 만들어내는 상태)는 경쟁을 기다리지
    // 않아도 목록에 없는 id를 그대로 넘기는 것만으로 그대로 구성할 수 있다.
    renderDock(
      [makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '실재하는 대화' })],
      '목록에-없는-id'
    )
    // 옛 코드(?? conversations[0])라면 실재하는 다른 대화('실재하는 대화')가 그려진다.
    expect(screen.queryByText('실재하는 대화', { selector: '.turn-user' })).toBeNull()
    // 새 코드는 selected가 null이라 ConversationPanel의 빈 상태 문구를 그린다.
    expect(screen.getByText('지시를 입력하면 대화가 시작됩니다')).toBeInTheDocument()
  })

  it('focusConversationId가 주어지면 그 대화의 로그를 연다', async () => {
    // 인박스의 "대화 열기"는 화면을 바꾸며 이 컴포넌트를 다시 마운트시킨다.
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
    const header = document.querySelector<HTMLElement>('.dock-header')!
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
    await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    expect(await screen.findByText('로그 줄')).toBeInTheDocument()
    await userEvent.click(screen.getByText('▾ 실행'))
    expect(screen.queryByText('로그 줄')).toBeNull()
  })

  it('탭을 옮기면 입력 중이던 프롬프트가 다른 대화로 따라가지 않는다', async () => {
    // key가 없으면 탭만 옮겨도 RunPanel 인스턴스가 그대로 남아, 입력 중이던
    // 프롬프트가 다른 대화의 입력부에 그대로 나타난다 — 예전에는 로그 뷰로
    // 가면 RunPanel 자체가 사라져 저절로 초기화됐지만 지금은 그 안전장치가 없다.
    renderDock([
      makeRun({ id: 'c1', rootRunId: 'c1', createdAt: 10, userPrompt: '대화 하나' }),
      makeRun({ id: 'c2', rootRunId: 'c2', createdAt: 20, userPrompt: '대화 둘' })
    ])

    await userEvent.click(screen.getByText('대화 둘'))
    await userEvent.type(screen.getByLabelText('지시'), '아직 안 보낸 말')
    expect(screen.getByLabelText('지시')).toHaveValue('아직 안 보낸 말')

    await userEvent.click(screen.getByText('대화 하나'))
    expect(screen.getByLabelText('지시')).toHaveValue('')
  })

  it('탭을 옮기면 담긴 것 줄도 그 대화의 것으로 바뀐다', async () => {
    // conversation prop이 한 줄 새면 줄은 그려지지만 늘 같은 대화 것을 보여준다.
    const { container } = renderDock([
      makeRun({ id: 'c1', rootRunId: 'c1', createdAt: 10, userPrompt: '대화 하나',
        contextItems: [{ type: 'issue', id: 'i1', label: '버그' }] }),
      makeRun({ id: 'c2', rootRunId: 'c2', createdAt: 20, userPrompt: '대화 둘',
        contextItems: [{ type: 'memo', id: 'm1', label: '릴리스 절차' }] })
    ])
    const applied = () =>
      [...container.querySelectorAll('.applied-chip')].map((e) => e.textContent)

    // 담긴 것이 있으면 제목이 거기서 온다(FR-11) — 지시가 아니라 이슈·메모 이름으로
    // 줄을 찾는다. 이 테스트가 `userPrompt`로 클릭하던 시절과 달라진 자리다.
    await userEvent.click(screen.getByText('버그', { selector: '.dock-conv-title' }))
    expect(applied()).toEqual(['이슈 · 버그'])

    await userEvent.click(screen.getByText('릴리스 절차', { selector: '.dock-conv-title' }))
    expect(applied()).toEqual(['메모 · 릴리스 절차'])
  })
})

/**
 * 대화 수명 주기 (`docs/sdlc/conversation-lifecycle/` FR-20~FR-23).
 *
 * run 목록은 `useRuns`가 주는 그대로다 — 끝낸 대화도 IPC로 오고, 목록에서
 * 내리는 것은 **여기서** 한다(spec 우려 1: 나중에 따로 조회로 바꿀 자리).
 */
describe('Dock 대화 수명 주기', () => {
  function titles(): string[] {
    return [...document.querySelectorAll('.dock-conv-title')].map((e) => e.textContent ?? '')
  }

  it('끝낸 대화는 기본 목록에서 내려간다', () => {
    renderDock([
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 20, userPrompt: '살아 있는 대화' }),
      makeRun({ id: 'b1', rootRunId: 'b1', createdAt: 10, userPrompt: '끝낸 대화', closedAt: 5 })
    ])
    expect(titles()).toEqual(['살아 있는 대화'])
  })

  it('끝낸 것이 없으면 토글을 아예 그리지 않는다', () => {
    // 늘 0이 붙어 있으면 눈이 걸러내고, 무엇을 여는 것인지도 알 수 없다 (FR-20).
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '하나' })])
    expect(screen.queryByRole('button', { name: /끝낸 대화/ })).toBeNull()
  })

  it('토글을 펼치면 끝낸 대화가 보이고 열 수 있다', async () => {
    renderDock([
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 20, userPrompt: '살아 있는 대화' }),
      makeRun({ id: 'b1', rootRunId: 'b1', createdAt: 10, userPrompt: '끝낸 대화', closedAt: 5 })
    ])
    await userEvent.click(screen.getByRole('button', { name: /끝낸 대화/ }))

    expect(titles()).toEqual(['살아 있는 대화', '끝낸 대화'])
    await userEvent.click(screen.getByText('끝낸 대화', { selector: '.dock-conv-title' }))
    expect(screen.getByText('끝낸 대화', { selector: '.turn-user' })).toBeInTheDocument()
  })

  it('끝낸 대화 줄에는 끝내기가 없고 이름 바꾸기는 있다', async () => {
    renderDock([makeRun({ id: 'b1', rootRunId: 'b1', userPrompt: '끝낸 대화', closedAt: 5 })])
    await userEvent.click(screen.getByRole('button', { name: /끝낸 대화/ }))

    expect(screen.queryByRole('button', { name: '끝낸 대화 대화 끝내기' })).toBeNull()
    expect(screen.getByRole('button', { name: '끝낸 대화 이름 바꾸기' })).toBeInTheDocument()
  })

  it('끝내기를 누르면 뿌리 id로 close를 부른다', async () => {
    const client = makeClient()
    renderDock([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20 }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '두 턴 대화' })
    ], null, client)

    await userEvent.click(screen.getByRole('button', { name: '두 턴 대화 대화 끝내기' }))

    // **뿌리 id다.** 턴 id를 넘기면 저장소가 던지고 아무 일도 일어나지 않는다.
    expect(client.runs.close).toHaveBeenCalledWith('a1')
  })

  it('보고 있던 대화를 끝내면 새 대화로 돌아간다', async () => {
    // 사라진 대화를 가리킨 채로 남으면 입력부가 어디로 보낼지 모르는 상태가 된다 (FR-23).
    const client = makeClient()
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '보던 대화' })], 'a1', client)
    expect(screen.getByText('보던 대화', { selector: '.turn-user' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '보던 대화 대화 끝내기' }))

    await waitFor(() => {
      expect(screen.queryByText('보던 대화', { selector: '.turn-user' })).toBeNull()
    })
    expect(screen.getByText('지시를 입력하면 대화가 시작됩니다')).toBeInTheDocument()
  })

  it('이름을 바꾸면 뿌리 id로 rename을 부른다', async () => {
    const client = makeClient()
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '옛 이름' })], null, client)

    await userEvent.click(screen.getByRole('button', { name: '옛 이름 이름 바꾸기' }))
    await userEvent.type(screen.getByRole('textbox', { name: '옛 이름 새 이름' }), '인증 정리')
    await userEvent.keyboard('{Enter}')

    expect(client.runs.rename).toHaveBeenCalledWith('a1', '인증 정리')
  })

  it('close가 실패하면 배너로 보여주고 대화는 그대로 열려 있다', async () => {
    const client = makeClient({ close: vi.fn().mockRejectedValue(new Error('못 끝냄')) })
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '보던 대화' })], 'a1', client)

    await userEvent.click(screen.getByRole('button', { name: '보던 대화 대화 끝내기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('못 끝냄')
    expect(screen.getByText('보던 대화', { selector: '.turn-user' })).toBeInTheDocument()
  })
})

/**
 * 본 대화는 저절로 확인된다 (`docs/sdlc/conversation-lifecycle/` FR-5~FR-8).
 *
 * 인박스에 가서 "확인함"을 눌러야만 배지가 줄던 것이 이 기능이 고치려던 증상이다.
 * 판정은 core의 배지 집계와 **같은 표**(`shared/inbox.ts`의 ACTIONABLE)에서 온다.
 */
describe('Dock 자동 확인', () => {
  const done = () => makeRun({
    id: 'a1', rootRunId: 'a1', status: 'succeeded', endedAt: 2, userPrompt: '끝난 대화'
  })

  it('완료·미확인 대화를 누르면 뿌리 id로 확인 표시를 찍는다', async () => {
    const client = makeClient()
    renderDock([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'succeeded', endedAt: 2 }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', endedAt: 1, userPrompt: '끝난 대화' })
    ], null, client)

    await userEvent.click(screen.getByText('끝난 대화', { selector: '.dock-conv-title' }))

    // **뿌리 id다.** 턴 id에 찍으면 대화는 인박스에 그대로 남는다.
    expect(client.runs.markReviewed).toHaveBeenCalledWith('a1', 'confirmed')
  })

  /**
   * **마운트만으로는 찍히지 않는다** (FR-6).
   *
   * Dock은 `pickedId`가 null이면 `conversations[0]`을 selected로 고른다. 자동 확인을
   * 그 경로에 걸면 **도크를 열기만 해도** 최근 대화가 조용히 내려간다 — 사용자는
   * 그 대화를 본 적이 없다.
   */
  it('마운트만으로는 찍지 않는다', () => {
    const client = makeClient()
    renderDock([done()], null, client)
    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('focusConversationId로 열려도 찍지 않는다', () => {
    // 인박스의 "대화 열기"가 쓰는 경로다. 거기서는 사용자가 이미 인박스를 보고 있고
    // 확인함/보관 버튼이 따로 있다 — 자동으로 내리면 그 선택을 가로챈다.
    const client = makeClient()
    renderDock([done()], 'a1', client)
    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('답변 필요는 눌러도 찍지 않는다', async () => {
    const client = makeClient()
    renderDock([makeRun({
      id: 'a1', rootRunId: 'a1', status: 'succeeded', endedAt: 2,
      needsAnswer: true, userPrompt: '질문한 대화'
    })], null, client)

    await userEvent.click(screen.getByText('질문한 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('실패도 눌러도 찍지 않는다', async () => {
    const client = makeClient()
    renderDock([makeRun({
      id: 'a1', rootRunId: 'a1', status: 'failed', endedAt: 2, userPrompt: '깨진 대화'
    })], null, client)

    await userEvent.click(screen.getByText('깨진 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('아직 도는 중인 대화는 찍지 않는다', async () => {
    // 끝나지도 않은 것을 "봤다"고 내릴 수는 없다 — 인박스 소속 자체가 아니다.
    const client = makeClient()
    renderDock([makeRun({
      id: 'a1', rootRunId: 'a1', status: 'running', userPrompt: '도는 대화'
    })], null, client)

    await userEvent.click(screen.getByText('도는 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('이미 확인한 대화는 다시 찍지 않는다', async () => {
    const client = makeClient()
    renderDock([makeRun({
      id: 'a1', rootRunId: 'a1', status: 'succeeded', endedAt: 2,
      reviewedAt: 100, reviewedKind: 'confirmed', userPrompt: '이미 본 대화'
    })], null, client)

    await userEvent.click(screen.getByText('이미 본 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('확인 표시 찍기가 실패해도 대화는 열린다', async () => {
    // 인박스 정리가 안 됐다고 대화를 못 보게 할 이유가 없다 (FR-8).
    const client = makeClient({ markReviewed: vi.fn().mockRejectedValue(new Error('못 찍음')) })
    renderDock([done()], null, client)

    await userEvent.click(screen.getByText('끝난 대화', { selector: '.dock-conv-title' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('못 찍음')
    expect(screen.getByText('끝난 대화', { selector: '.turn-user' })).toBeInTheDocument()
  })
})

describe('Dock 크기 조절', () => {
  // jsdom은 레이아웃을 계산하지 않는다 — 여기서 답할 수 있는 것은 "핸들이
  // 있는가"와 "드래그가 높이 값을 바꾸는가"뿐이고, "실제로 커 보이는가"는
  // 앱을 열어야 안다. 그 경계를 흐리지 않으려고 스타일 값만 단언한다.
  function dock() {
    return document.querySelector('.dock') as HTMLElement
  }

  // pointerdown은 React 핸들러가 받아야 하므로 fireEvent로 보낸다(raw dispatch는
  // 합성 이벤트 계층에 닿지 않는다). move/up은 Dock이 window에 직접 걸어둔
  // 네이티브 리스너라 window로 보낸다 — 포인터가 도크 밖으로 나가도 따라오게
  // 하려고 그렇게 돼 있다.
  function drag(handle: HTMLElement, fromY: number, toY: number) {
    // fireEvent.pointerDown은 이 jsdom에서 clientY를 싣지 않아 startY가
    // undefined가 된다. MouseEvent는 좌표를 제대로 나르고, bubbles:true면
    // React 루트 리스너까지 올라가 onPointerDown이 받는다.
    handle.dispatchEvent(new MouseEvent('pointerdown', { clientY: fromY, bubbles: true }))
    // window로 직접 보내는 이벤트는 React의 합성 계층을 거치지 않으므로
    // 상태 갱신이 자동으로 flush되지 않는다 — act로 감싸야 DOM에 반영된다.
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientY: toY }))
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
  }

  beforeEach(() => { localStorage.clear() })

  it('열려 있으면 크기 조절 핸들이 있다', () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1' })])
    expect(screen.getByRole('separator', { name: '대화창 크기 조절' })).toBeInTheDocument()
  })

  it('접혀 있으면 핸들이 없다 — 접힌 도크는 헤더뿐이라 조절할 것이 없다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1' })])
    // 도크 토글이다. 실행 버튼과 이름이 겹치므로 정확히 지정한다.
    await userEvent.click(screen.getByRole('button', { name: '▾ 실행' }))
    expect(screen.queryByRole('separator', { name: '대화창 크기 조절' })).not.toBeInTheDocument()
  })

  it('위로 끌면 대화창이 커진다', () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1' })])
    const before = dock().style.height
    drag(screen.getByRole('separator', { name: '대화창 크기 조절' }), 500, 300)
    const after = dock().style.height
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before))
  })

  it('끈 높이가 다음 마운트에 되살아난다', () => {
    const { unmount } = renderDock([makeRun({ id: 'a1', rootRunId: 'a1' })])
    drag(screen.getByRole('separator', { name: '대화창 크기 조절' }), 500, 300)
    const dragged = dock().style.height
    unmount()

    renderDock([makeRun({ id: 'a1', rootRunId: 'a1' })])
    expect(dock().style.height).toBe(dragged)
  })

  it('핸들을 더블클릭하면 기본 높이로 돌아간다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1' })])
    const handle = screen.getByRole('separator', { name: '대화창 크기 조절' })
    const original = dock().style.height
    drag(handle, 500, 300)
    expect(dock().style.height).not.toBe(original)

    await userEvent.dblClick(handle)
    expect(dock().style.height).toBe(original)
  })
})
