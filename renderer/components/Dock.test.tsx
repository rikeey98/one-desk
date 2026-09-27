import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RunEventProvider } from '../store/RunEventContext'
import { createRunEventStore, type RunEventStore } from '../store/runEvents'
import { DraftProvider } from '../store/DraftContext'
import { createDraftStore } from '../store/drafts'
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
        {/* 입력부의 초안은 스토어가 쥔다 (spec FR-31) — main.tsx와 같은 한 겹이다. */}
        <DraftProvider store={createDraftStore()}>
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
            onFocusConsumed={vi.fn()}
          />
        </DraftProvider>
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
    // "새 대화" 단추는 .dock-new라 여기 세지 않는다.
    expect(document.querySelectorAll('.dock-conv')).toHaveLength(1)
  })

  it('탭 배지와 입력부 권한 기본값은 대화의 마지막 턴에서 온다', async () => {
    // 첫 턴은 failed·edit, 마지막 턴은 succeeded·read_only — 둘을 다르게 둬야
    // "마지막 턴에서 온다"는 것을 첫 턴(conv.runs[0])과 구분해서 확인할 수 있다.
    // (첫 턴을 running으로 두면 점이 도는 턴을 먼저 그려 이 구분이 흐려진다 — 아래
    // "도는 턴이 있으면…" 테스트가 그 규칙을 따로 고정한다.)
    renderDock([
      makeRun({
        id: 'b2', rootRunId: 'b1', createdAt: 20, status: 'succeeded', endedAt: 3,
        permission: 'read_only', userPrompt: '두 번째 말'
      }),
      makeRun({
        id: 'b1', rootRunId: 'b1', createdAt: 10, status: 'failed', endedAt: 2,
        permission: 'edit', userPrompt: '첫 말'
      })
    ])

    // 줄의 상태 점은 대표 턴(여기서는 마지막 턴 b2, 완료)에서 온다 — 첫 턴(실패)이
    // 아니다. 글자가 아니라 점이므로 접근성 이름으로 잡는다(2026-09-23: 좁은 레일에서
    // 상태 단어가 제목을 밀어내 글자를 뺐다). 이름은 한국어 한 표다(timeline spec FR-45).
    expect(screen.getByRole('img', { name: '완료' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '실패' })).toBeNull()

    await userEvent.click(screen.getByText('첫 말'))
    // 입력부의 권한 기본값도 마지막 턴(read_only)에서 온다 — 첫 턴(edit)이 아니다.
    await waitFor(() => expect(screen.getByLabelText('권한')).toHaveValue('read_only'))
  })

  /**
   * **줄의 상태는 마지막 턴이 아니라 대표 턴이다** (`docs/sdlc/conversation-fixes/` spec FR-3).
   *
   * 답변 필요로 멈춘 1턴 뒤에 예약했다가 시작도 못 하고 취소된 2턴이 있다. 마지막 턴으로
   * 그리면 점이 canceled가 되고 "답변 필요"가 사라진다 — 배지(core)는 대표 턴을 세므로
   * 사이드바에는 1이 있는데 도크 목록에는 그 이유가 보이지 않는다.
   */
  it('줄의 상태 점과 답변 필요 표시는 대표 턴에서 온다', () => {
    renderDock([
      makeRun({
        id: 'c2', rootRunId: 'c1', createdAt: 20, status: 'canceled',
        startedAt: null, endedAt: 3
      }),
      makeRun({
        id: 'c1', rootRunId: 'c1', createdAt: 10, status: 'succeeded', endedAt: 2,
        needsAnswer: true, userPrompt: '질문한 대화'
      })
    ])

    const row = screen.getByText('질문한 대화', { selector: '.dock-conv-title' })
      .closest('.dock-conv') as HTMLElement
    const dot = within(row).getByRole('img', { name: '완료' })
    // 점의 **색**도 대표 턴에서 온다 — 이름만 보면 className이 마지막 턴으로 되돌아가도
    // (회색 canceled 점) 초록인 채로 지나간다.
    expect(dot).toHaveClass('status-succeeded')
    expect(dot).not.toHaveClass('status-canceled')
    expect(dot).toHaveAttribute('title', '완료')
    expect(within(row).queryByRole('img', { name: '취소됨' })).toBeNull()
    expect(within(row).getByText('답변 필요')).toBeInTheDocument()
  })

  /**
   * **점은 도는 턴을 먼저 그린다** (2026-09-27 결정 — `docs/sdlc/conversation-timeline/`
   * spec FR-45 다듬음, conversation-fixes spec §7-3). 대표 턴만 그리면 앞 턴이 도는 동안
   * 이어 보낸 예약이 점을 "대기 중"으로 만들어, 대화록·헤더는 실행 중이라는데 목록만
   * 기다린다고 한다.
   */
  it('도는 턴이 있으면 예약이 걸려 있어도 점은 실행 중이다', () => {
    renderDock([
      makeRun({ id: 'd2', rootRunId: 'd1', createdAt: 20, status: 'pending', startedAt: null }),
      makeRun({ id: 'd1', rootRunId: 'd1', createdAt: 10, status: 'running', userPrompt: '도는 대화' })
    ])
    const row = screen.getByText('도는 대화', { selector: '.dock-conv-title' })
      .closest('.dock-conv') as HTMLElement
    const dot = within(row).getByRole('img', { name: '실행 중' })
    expect(dot).toHaveClass('status-running')
    expect(within(row).queryByRole('img', { name: '대기 중' })).toBeNull()
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

  /**
   * **멈추는 자리** (`docs/sdlc/conversation-timeline/` spec FR-29). 도크 헤더의 `취소`는 없어졌다
   * — 도는 턴은 입력부의 `중지`(FR-28)와 대화록 상태 줄의 `실행 중인 턴 멈추기`(fixes FR-11)가,
   * 예약은 입력칸 위 칩의 `예약 취소`(FR-30)가, 슬롯을 기다리는 첫 지시는 상태 줄의
   * `대기 취소`가 맡는다. 셋 다 도크의 `cancel`(오류 배너까지)을 탄다.
   */
  it('도크 헤더에는 취소가 없다 — 토글과 슬롯 표시기뿐이다', async () => {
    renderDock([makeRun({ status: 'running' })])
    await userEvent.click(screen.getByText('토큰 버그 고쳐줘', { selector: '.dock-conv-title' }))
    const header = document.querySelector<HTMLElement>('.dock-header')!
    expect(within(header).queryByRole('button', { name: /멈추기|취소|중지/ })).toBeNull()
  })

  it('실행 중인 대화는 입력부의 중지로 멈춘다', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([makeRun({ status: 'running' })], null, makeClient({ cancel }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘', { selector: '.dock-conv-title' }))
    await userEvent.click(screen.getByRole('button', { name: '중지' }))
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  it('슬롯을 기다리는 첫 지시는 대화록의 대기 취소로 거둔다', async () => {
    // 프로세스가 없을 뿐 사용자에겐 똑같이 걸려 있다. core는 대기 중 취소를 이미
    // 지원하는데(execution.cancel이 큐에서 빼고 canceled로 끝낸다) 버튼이 없으면
    // 그 경로에 손이 닿지 않는다 — 상한이 낮을수록 오래 묶여 있는 쪽이다.
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([makeRun({ status: 'pending', startedAt: null })], null, makeClient({ cancel }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘', { selector: '.dock-conv-title' }))
    await userEvent.click(screen.getByRole('button', { name: '대기 취소' }))
    expect(cancel).toHaveBeenCalledWith('run-1')
  })

  /**
   * **멈추기는 도는 턴을, 예약 취소는 예약을 겨눈다** (`docs/sdlc/conversation-fixes/` spec FR-11).
   * 예전에는 `createdAt` 기준 마지막 턴을 겨눠, 예약이 있으면 예약을 취소했고 실행 중인 턴을
   * 멈출 버튼이 어디에도 없었다. 이름이 곧 겨누는 턴이다.
   */
  it('예약이 걸린 대화에서 중지·멈추기는 도는 턴을, 예약 취소는 예약을 겨눈다', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', startedAt: null }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', userPrompt: '도는 대화' })
    ], null, makeClient({ cancel }))

    await userEvent.click(screen.getByText('도는 대화', { selector: '.dock-conv-title' }))
    await userEvent.click(screen.getByRole('button', { name: '중지' }))
    await userEvent.click(screen.getByRole('button', { name: '실행 중인 턴 멈추기' }))
    expect(cancel.mock.calls).toEqual([['a1'], ['a1']])

    await userEvent.click(screen.getByRole('button', { name: '예약 취소' }))
    expect(cancel).toHaveBeenLastCalledWith('a2')
  })

  it('예약을 취소해 마지막 턴이 끝났어도 도는 턴이 있으면 중지가 남는다', async () => {
    // 마지막 턴(취소된 예약)으로 판정하면 버튼이 사라져 도는 턴을 멈출 방법이 없어진다.
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderDock([
      makeRun({
        id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'canceled', startedAt: null, endedAt: 3
      }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', userPrompt: '도는 대화' })
    ], null, makeClient({ cancel }))

    await userEvent.click(screen.getByText('도는 대화', { selector: '.dock-conv-title' }))
    await userEvent.click(screen.getByRole('button', { name: '중지' }))
    expect(cancel).toHaveBeenCalledWith('a1')
  })

  it('끝난 run에는 멈추거나 거둘 버튼이 없다', async () => {
    renderDock([makeRun({ status: 'succeeded' })])
    await userEvent.click(screen.getByText('토큰 버그 고쳐줘', { selector: '.dock-conv-title' }))
    for (const name of ['중지', '실행 중인 턴 멈추기', '예약 취소', '대기 취소']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('멈추기가 실패하면 도크의 배너로 보인다', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('멈추지 못했습니다'))
    renderDock([makeRun({ status: 'running' })], null, makeClient({ cancel }))

    await userEvent.click(screen.getByText('토큰 버그 고쳐줘', { selector: '.dock-conv-title' }))
    await userEvent.click(screen.getByRole('button', { name: '중지' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('멈추지 못했습니다')
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
    // 진행 중인 턴은 접힌 채로도 지금까지의 마지막 텍스트를 답 칸에 흘린다
    // (docs/sdlc/conversation-timeline/ spec FR-12) — 펼치지 않아도 보인다.
    expect(await screen.findByText('로그 줄', { selector: '.turn-answer p' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '대화창 숨기기' }))
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

    // 돌아오면 남아 있다 — 초안은 대화마다 스토어가 쥔다(spec FR-31). 입력부는 대화를
    // 바꿀 때마다 key로 다시 마운트되므로 그 안의 state였다면 여기서 사라진다.
    await userEvent.click(screen.getByText('대화 둘'))
    expect(screen.getByLabelText('지시')).toHaveValue('아직 안 보낸 말')
  })

  it('새 대화 칸에 쓰던 지시도 다른 대화에 다녀와도 남는다', async () => {
    renderDock([makeRun({ id: 'c1', rootRunId: 'c1', status: 'succeeded', userPrompt: '대화 하나' })])

    await userEvent.type(screen.getByLabelText('지시'), '새로 시킬 말')
    await userEvent.click(screen.getByText('대화 하나', { selector: '.dock-conv-title' }))
    expect(screen.getByLabelText('지시')).toHaveValue('')

    await userEvent.click(screen.getByRole('button', { name: /새 대화/ }))
    expect(screen.getByLabelText('지시')).toHaveValue('새로 시킬 말')
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

  it('새 대화와 끝낸 대화 토글은 글리프가 아니라 아이콘이다 — 이름에 글리프가 섞이지 않는다', async () => {
    // 전각 ＋·▸·▾는 글꼴마다 굵기가 달라 한 줄에서 어긋난다(spec FR-48). e2e는 새 대화를
    // `{ name: '새 대화', exact: true }`로 잡는다.
    renderDock([makeRun({ id: 'b1', rootRunId: 'b1', userPrompt: '끝낸 대화', closedAt: 5 })])
    expect(screen.getByRole('button', { name: '새 대화' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: '끝낸 대화 1' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
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

  it('붙인 이름을 비우고 저장하면 빈 제목으로 rename해 파생 제목으로 되돌린다', async () => {
    // `docs/sdlc/conversation-fixes/` spec FR-21. 비운 칸이 취소로 끝나면 한 번 붙인
    // 이름을 영영 못 떼어 낸다. 저장소가 빈 문자열을 null로 저장한다(lifecycle FR-14) —
    // IPC는 문자열만 받으므로 null이 아니라 ''를 넘긴다.
    const client = makeClient()
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', title: '붙인 이름', userPrompt: '첫 지시' })], null, client)

    await userEvent.click(screen.getByRole('button', { name: '붙인 이름 이름 바꾸기' }))
    await userEvent.clear(screen.getByRole('textbox', { name: '붙인 이름 새 이름' }))
    await userEvent.keyboard('{Enter}')

    expect(client.runs.rename).toHaveBeenCalledWith('a1', '')
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
 * workspace 전환과 일회성 포커스 (`docs/sdlc/conversation-fixes/` spec FR-22).
 *
 * Dock은 workspace를 바꿔도 다시 마운트되지 않는다(App이 key를 주지 않는다). 그래서
 * 고른 대화·보기·이름 편집이 그대로 남아, 새 workspace의 목록 위에 옛 workspace의
 * 선택이 걸린다 — useRuns는 workspace가 바뀌어도 목록을 곧바로 비우지 않으므로 그
 * 사이에는 옛 대화가 그대로 열려 있고 입력부도 그 대화를 겨눈다.
 */
describe('Dock workspace 전환', () => {
  function dockProps(over: Partial<Parameters<typeof Dock>[0]> = {}): Parameters<typeof Dock>[0] {
    return {
      runs: [], error: null, workspaceId: 'w1', workspaces, repos, reposError: null,
      queue: null, queueError: null, onChangeLimit: vi.fn(), chips: [], onRemoveChip: vi.fn(),
      onRunStarted: vi.fn(), draftPrompt: '', draftCwd: null,
      focusConversationId: null, onFocusConsumed: vi.fn(),
      ...over
    }
  }

  function renderWith(props: Parameters<typeof Dock>[0], client: OneDeskClient = makeClient()) {
    const drafts = createDraftStore()
    const wrap = (p: Parameters<typeof Dock>[0]) => (
      <ClientProvider client={client}>
        <RunEventProvider store={createRunEventStore()}>
          <DraftProvider store={drafts}>
            <Dock {...p} />
          </DraftProvider>
        </RunEventProvider>
      </ClientProvider>
    )
    const view = render(wrap(props))
    return { rerender: (p: Parameters<typeof Dock>[0]) => view.rerender(wrap(p)) }
  }

  const w1Runs = [makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', endedAt: 2, userPrompt: '옛 workspace 대화' })]

  it('workspace가 바뀌면 보던 대화를 놓고 새 대화로 돌아간다', async () => {
    const { rerender } = renderWith(dockProps({ runs: w1Runs }))
    await userEvent.click(screen.getByText('옛 workspace 대화', { selector: '.dock-conv-title' }))
    expect(screen.getByText('옛 workspace 대화', { selector: '.turn-user' })).toBeInTheDocument()

    // 목록(runs)은 아직 옛 workspace의 것이다 — useRuns가 새 목록을 받기 전의 찰나다.
    rerender(dockProps({ runs: w1Runs, workspaceId: 'w2' }))

    expect(screen.queryByText('옛 workspace 대화', { selector: '.turn-user' })).toBeNull()
    expect(screen.getByText('지시를 입력하면 대화가 시작됩니다')).toBeInTheDocument()
  })

  it('workspace가 바뀌면 고치던 대화 이름 칸이 닫힌다', async () => {
    const { rerender } = renderWith(dockProps({ runs: w1Runs }))
    await userEvent.click(screen.getByRole('button', { name: '옛 workspace 대화 이름 바꾸기' }))
    expect(screen.getByRole('textbox', { name: '옛 workspace 대화 새 이름' })).toBeInTheDocument()

    rerender(dockProps({ runs: w1Runs, workspaceId: 'w2' }))

    expect(screen.queryByRole('textbox', { name: '옛 workspace 대화 새 이름' })).toBeNull()
  })

  it('workspace가 바뀌면 옛 대화에서 난 오류 배너가 사라진다', async () => {
    // 옛 workspace 대화의 끝내기·이름 바꾸기·취소·자동 확인 실패가 새 workspace의 도크
    // 위에 남으면, 사용자는 지금 보는 곳에서 무엇이 실패했는지 찾게 된다.
    const client = makeClient({ close: vi.fn().mockRejectedValue(new Error('못 끝냄')) })
    const { rerender } = renderWith(dockProps({ runs: w1Runs }), client)
    await userEvent.click(screen.getByRole('button', { name: '옛 workspace 대화 대화 끝내기' }))
    expect(await screen.findByText('못 끝냄')).toBeInTheDocument()

    rerender(dockProps({ runs: w1Runs, workspaceId: 'w2' }))

    expect(screen.queryByText('못 끝냄')).toBeNull()
  })

  it('workspace가 그대로면 고른 대화를 놓지 않는다', async () => {
    // 초기화가 workspaceId 변화가 아니라 매 렌더에 걸리면 목록이 갱신될 때마다 튄다.
    const { rerender } = renderWith(dockProps({ runs: w1Runs }))
    await userEvent.click(screen.getByText('옛 workspace 대화', { selector: '.dock-conv-title' }))

    rerender(dockProps({ runs: [...w1Runs] }))

    expect(screen.getByText('옛 workspace 대화', { selector: '.turn-user' })).toBeInTheDocument()
  })

  it('workspace가 바뀌면 새 대화 칸도 새로 시작한다 — 옛 workspace의 전송 오류가 남지 않는다', async () => {
    // 새 대화 칸의 key는 `new:<workspaceId>`다 (spec FR-31). 늘 'new'면 workspace를 넘어도 같은
    // 입력부 인스턴스가 남아, 옛 workspace에서 거부된 이유가 새 workspace의 입력부 위에 걸린다.
    const client = makeClient({ start: vi.fn().mockRejectedValue(new Error('w1에서 거부됨')) })
    const { rerender } = renderWith(dockProps(), client)
    await userEvent.type(screen.getByLabelText('지시'), '시킬 말')
    await userEvent.click(screen.getByRole('button', { name: '실행' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('w1에서 거부됨')

    rerender(dockProps({ workspaceId: 'w2' }))
    expect(screen.queryByText('w1에서 거부됨')).toBeNull()
    // 초안은 workspace마다 따로다 — 돌아오면 w1에 쓰던 것이 남아 있다.
    expect(screen.getByLabelText('지시')).toHaveValue('')
    rerender(dockProps({ workspaceId: 'w1' }))
    expect(screen.getByLabelText('지시')).toHaveValue('시킬 말')
  })

  it('focusConversationId로 대화를 열고 나면 소비했다고 알린다', () => {
    // App이 그 값을 치워야 다음 마운트에 되살아나지 않는다.
    const onFocusConsumed = vi.fn()
    renderWith(dockProps({ runs: w1Runs, focusConversationId: 'a1', onFocusConsumed }))

    expect(screen.getByText('옛 workspace 대화', { selector: '.turn-user' })).toBeInTheDocument()
    expect(onFocusConsumed).toHaveBeenCalled()
  })

  it('소비한 포커스가 치워져도 연 대화는 그대로다', () => {
    const { rerender } = renderWith(dockProps({ runs: w1Runs, focusConversationId: 'a1' }))

    rerender(dockProps({ runs: w1Runs, focusConversationId: null }))

    expect(screen.getByText('옛 workspace 대화', { selector: '.turn-user' })).toBeInTheDocument()
  })

  it('포커스가 없으면 소비를 알리지 않는다', () => {
    const onFocusConsumed = vi.fn()
    renderWith(dockProps({ runs: w1Runs, onFocusConsumed }))
    expect(onFocusConsumed).not.toHaveBeenCalled()
  })
})

/**
 * 본 대화는 저절로 확인된다 (`docs/sdlc/conversation-lifecycle/` FR-5~FR-8).
 *
 * 인박스에 가서 "확인함"을 눌러야만 배지가 줄던 것이 이 기능이 고치려던 증상이다.
 * 판정은 core의 배지 집계와 **같은 표**(`shared/inbox.ts`의 INBOX_RULES)의 `clearsOnView`
 * 칸에서, 대화의 **대표 턴**(`representativeTurn`)으로 한다.
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

  /**
   * **실패·중단은 배지에 세되, 열면 확인된다** (`docs/sdlc/conversation-fixes/` spec FR-4·FR-6).
   *
   * 2026-09-23에는 "실패는 열어 봐도 남는다"였다. 사용자가 "실패한 세션은 클릭해도 1이 안
   * 없어진다"고 보고해 뒤집었다 — OpenCode의 오류 알림처럼 보면 사라진다.
   */
  it('실패는 누르면 확인 표시를 찍는다', async () => {
    const client = makeClient()
    renderDock([makeRun({
      id: 'a1', rootRunId: 'a1', status: 'failed', endedAt: 2, userPrompt: '깨진 대화'
    })], null, client)

    await userEvent.click(screen.getByText('깨진 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).toHaveBeenCalledWith('a1', 'confirmed')
  })

  it('중단됨도 누르면 확인 표시를 찍는다', async () => {
    const client = makeClient()
    renderDock([makeRun({
      id: 'a1', rootRunId: 'a1', status: 'interrupted', endedAt: 2, userPrompt: '끊긴 대화'
    })], null, client)

    await userEvent.click(screen.getByText('끊긴 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).toHaveBeenCalledWith('a1', 'confirmed')
  })

  /**
   * **판정은 마지막 턴이 아니라 대표 턴으로 한다** (spec FR-1·FR-3).
   *
   * 답변 필요로 멈춘 1턴 뒤에 예약했다가 취소한 2턴이 있다. 마지막 턴(canceled =
   * 대기 중 취소됨)으로 판정하면 "열면 확인된다"에 걸려 **답해야 할 질문이 인박스에서
   * 조용히 내려간다.** 배지(core)는 대표 턴을 보므로 둘이 어긋나기도 한다.
   */
  it('시작하지 못하고 취소된 예약은 건너뛰고 대표 턴으로 판정한다', async () => {
    const client = makeClient()
    renderDock([
      makeRun({
        id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'canceled',
        startedAt: null, endedAt: 3
      }),
      makeRun({
        id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', endedAt: 2,
        needsAnswer: true, userPrompt: '질문한 대화'
      })
    ], null, client)

    await userEvent.click(screen.getByText('질문한 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('도는 턴 뒤의 예약이 취소됐어도 대화는 아직 진행 중이라 찍지 않는다', async () => {
    // 마지막 턴(취소된 예약)은 끝났지만 대표 턴(2턴)은 아직 돈다. "끝났는가"도 대표
    // 턴으로 봐야 한다 — 마지막 턴으로 보면 도는 중인 대화를 "봤다"고 내린다.
    const client = makeClient()
    renderDock([
      makeRun({
        id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'canceled',
        startedAt: null, endedAt: 3
      }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', userPrompt: '도는 대화' })
    ], null, client)

    await userEvent.click(screen.getByText('도는 대화', { selector: '.dock-conv-title' }))

    expect(client.runs.markReviewed).not.toHaveBeenCalled()
  })

  it('예약이 아직 기다리는 중이면 찍지 않는다', async () => {
    // 앞 턴이 실패로 끝났어도 대화는 아직 진행 중이다 — 예약이 곧 뜬다.
    const client = makeClient()
    renderDock([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', startedAt: null }),
      makeRun({
        id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'failed', endedAt: 2,
        userPrompt: '이어지는 대화'
      })
    ], null, client)

    await userEvent.click(screen.getByText('이어지는 대화', { selector: '.dock-conv-title' }))

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
    await userEvent.click(screen.getByRole('button', { name: '대화창 숨기기' }))
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

/**
 * 도크 헤더 — 토글·최대화·Esc (`docs/sdlc/conversation-timeline/` spec FR-37~FR-39).
 *
 * jsdom은 레이아웃을 계산하지 않는다 — "세 패널이 정말 숨는가"는 CSS(`.main:has(> .dock-max)`)와
 * e2e(`composer.e2e.ts`)가 답한다. 여기서는 클래스·인라인 높이·이름·키 처리만 본다.
 */
describe('Dock 헤더 — 토글·최대화·Esc', () => {
  function dock() {
    return document.querySelector('.dock') as HTMLElement
  }

  beforeEach(() => { localStorage.clear() })

  it('토글의 이름은 대화창 숨기기/보이기다 — 글자에 "실행"이 없다', async () => {
    // 아이콘이 aria-hidden이면 이름이 정확히 "실행"이 되어 전송 버튼의
    // `{ name: '실행', exact: true }`와 부딪힌다(FR-37). "접기"/"펼치기"는 턴의 `접기`와 부딪힌다.
    renderDock([])
    const toggle = screen.getByRole('button', { name: '대화창 숨기기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).not.toHaveTextContent('실행')
    expect(toggle).toHaveTextContent('대화')

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: '대화창 보이기' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('지시')).toBeNull()
  })

  it('최대화하면 도크에 dock-max가 붙고 인라인 높이·크기 조절 핸들이 없다', async () => {
    renderDock([])
    expect(dock().style.height).not.toBe('')
    await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))

    expect(dock()).toHaveClass('dock-max')
    expect(dock().style.height).toBe('')
    expect(screen.queryByRole('separator', { name: '대화창 크기 조절' })).toBeNull()

    // 같은 단추가 되돌린다 — "축소"라 부르지 않는다: 패널의 `축소`와 부분 일치로 부딪힌다(FR-38).
    await userEvent.click(screen.getByRole('button', { name: '대화창 원래 크기로' }))
    expect(dock()).not.toHaveClass('dock-max')
    expect(dock().style.height).not.toBe('')
  })

  it('접힌 도크에서 최대화를 누르면 펼치면서 최대화한다', async () => {
    renderDock([])
    await userEvent.click(screen.getByRole('button', { name: '대화창 숨기기' }))
    await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))
    expect(dock()).toHaveClass('dock-max')
    expect(screen.getByLabelText('지시')).toBeInTheDocument()
  })

  it('최대화한 도크를 접으면 최대화도 풀린다 — 접힌 도크가 본문을 가리면 안 된다', async () => {
    renderDock([])
    await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))
    await userEvent.click(screen.getByRole('button', { name: '대화창 숨기기' }))
    expect(dock()).not.toHaveClass('dock-max')
    expect(screen.getByRole('button', { name: '대화창 최대화' })).toBeInTheDocument()
    // 접힌 도크는 최대화 여부와 상관없이 dock-max가 없다(`open && maximized`) — 위 두 단언은 접는 것만으로
    // 참이다. 풀렸는지는 **다시 펼쳐야** 드러난다(리뷰가 찾은 공허한 테스트).
    await userEvent.click(screen.getByRole('button', { name: '대화창 보이기' }))
    expect(dock()).not.toHaveClass('dock-max')
    expect(dock().style.height).not.toBe('')
  })

  it('슬롯 상한을 고치다 누른 Esc는 편집만 닫는다 — 최대화는 그대로다 (FR-39 안쪽부터)', async () => {
    const props: Parameters<typeof Dock>[0] = {
      runs: [], error: null, workspaceId: 'w1', workspaces, repos, reposError: null,
      queue: { running: 0, limit: 3, waiting: 0 }, queueError: null, onChangeLimit: vi.fn(),
      chips: [], onRemoveChip: vi.fn(), onRunStarted: vi.fn(), draftPrompt: '', draftCwd: null,
      focusConversationId: null, onFocusConsumed: vi.fn()
    }
    render(
      <ClientProvider client={makeClient()}>
        <RunEventProvider store={createRunEventStore()}>
          <DraftProvider store={createDraftStore()}>
            <Dock {...props} />
          </DraftProvider>
        </RunEventProvider>
      </ClientProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))
    await userEvent.click(screen.getByRole('button', { name: '실행 슬롯' }))
    expect(screen.getByLabelText('동시 실행 상한')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText('동시 실행 상한')).toBeNull()
    expect(dock()).toHaveClass('dock-max')
    expect(props.onChangeLimit).not.toHaveBeenCalled()
  })

  it('Esc가 최대화를 풀고, 그 Esc는 document까지 가지 않는다', async () => {
    // App은 document의 Esc로 열린 항목을 닫는다 — 최대화를 푸는 Esc에 그것까지 같이 돌면
    // 숨어 있던 패널이 돌아오면서 보던 상세가 닫혀 있다(FR-39).
    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    try {
      renderDock([])
      await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))
      await userEvent.keyboard('{Escape}')
      expect(dock()).not.toHaveClass('dock-max')
      expect(onDocument).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocument)
    }
  })

  it('최대화하지 않았으면 Esc를 삼키지 않는다 — 열린 항목 닫기가 그대로 돈다', async () => {
    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    try {
      renderDock([])
      await userEvent.click(screen.getByLabelText('지시'))
      await userEvent.keyboard('{Escape}')
      expect(onDocument).toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocument)
    }
  })

  it('안쪽의 Esc가 먼저다 — 메뉴를 닫는 Esc는 최대화를 풀지 않는다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', userPrompt: '보던 대화' })], 'a1')
    await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(dock()).toHaveClass('dock-max')

    // 두 번째 Esc는 안쪽에 풀 것이 없으니 최대화를 푼다.
    await userEvent.keyboard('{Escape}')
    expect(dock()).not.toHaveClass('dock-max')
  })

  it('이름 편집을 취소하는 Esc도 최대화를 풀지 않는다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', userPrompt: '보던 대화' })])
    await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))
    await userEvent.click(screen.getByRole('button', { name: '보던 대화 이름 바꾸기' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: '보던 대화 새 이름' })).toBeNull()
    expect(dock()).toHaveClass('dock-max')
  })

  it('workspace가 바뀌어도 최대화는 남는다 — 선택이 아니라 보기 방식이다', async () => {
    const props: Parameters<typeof Dock>[0] = {
      runs: [], error: null, workspaceId: 'w1', workspaces, repos, reposError: null,
      queue: null, queueError: null, onChangeLimit: vi.fn(), chips: [], onRemoveChip: vi.fn(),
      onRunStarted: vi.fn(), draftPrompt: '', draftCwd: null,
      focusConversationId: null, onFocusConsumed: vi.fn()
    }
    const drafts = createDraftStore()
    const wrap = (p: Parameters<typeof Dock>[0]) => (
      <ClientProvider client={makeClient()}>
        <RunEventProvider store={createRunEventStore()}>
          <DraftProvider store={drafts}>
            <Dock {...p} />
          </DraftProvider>
        </RunEventProvider>
      </ClientProvider>
    )
    const view = render(wrap(props))
    await userEvent.click(screen.getByRole('button', { name: '대화창 최대화' }))
    view.rerender(wrap({ ...props, workspaceId: 'w2' }))
    expect(dock()).toHaveClass('dock-max')
  })
})

/**
 * 대화 헤더 (`docs/sdlc/conversation-timeline/` spec FR-33~FR-35, FR-29). 헤더는 Dock이 그린다 —
 * 헤더에 필요한 것(대화·이름 바꾸기·끝내기·멈추기)이 전부 Dock에 있다(plan 다듬은 것 5).
 * 배선 한 줄이 새면 헤더는 그려지는데 엉뚱한 대화를 겨누거나 오류가 배너로 오지 않는다.
 */
describe('Dock 대화 헤더', () => {
  function header(): HTMLElement {
    return document.querySelector<HTMLElement>('.conv-header')!
  }

  it('보는 대화의 제목이 헤더에 서고, 새 대화면 "새 대화"다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', title: '인증 정리' })])
    expect(header().querySelector('.conv-title')).toHaveTextContent('새 대화')

    await userEvent.click(screen.getByText('인증 정리', { selector: '.dock-conv-title' }))
    expect(header().querySelector('.conv-title')).toHaveTextContent('인증 정리')
  })

  it('헤더의 이름 바꾸기는 뿌리 id로 rename을 부른다', async () => {
    const client = makeClient()
    renderDock([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'succeeded' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', userPrompt: '옛 이름' })
    ], 'a1', client)

    await userEvent.click(screen.getByText('옛 이름', { selector: '.conv-title' }))
    await userEvent.type(screen.getByRole('textbox', { name: '옛 이름 새 이름' }), '인증 정리{Enter}')
    expect(client.runs.rename).toHaveBeenCalledWith('a1', '인증 정리')
  })

  /**
   * **이름 편집은 한 state다** (FR-34) — 목록 줄과 헤더가 같은 대화를 동시에 고치는 상태가 생기지
   * 않는다. 헤더에서 고치는 중이면 목록 줄은 제목 그대로이고, 반대도 그렇다.
   */
  /**
   * 헤더 편집을 **닫는** 배선 (리뷰가 찾은 것). ConversationHeader.test는 콜백을 모의로 받아 이것을
   * 고정하지 못한다 — Dock이 헤더에 내리는 `onCancelRename` 한 줄이나 `renameConversation`의
   * `setRenaming(null)`이 빠지면 헤더 제목 자리가 입력칸으로 굳고, 그 뒤로는 Enter·blur도 먹지 않는다.
   */
  it('헤더 편집을 Esc로 취소하면 제목으로 돌아온다', async () => {
    const client = makeClient()
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', userPrompt: '옛 이름' })], 'a1', client)
    await userEvent.click(screen.getByText('옛 이름', { selector: '.conv-title' }))
    expect(screen.getByRole('textbox', { name: '옛 이름 새 이름' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: '옛 이름 새 이름' })).toBeNull()
    expect(header().querySelector('.conv-title')).toHaveTextContent('옛 이름')
    expect(client.runs.rename).not.toHaveBeenCalled()
  })

  it('헤더 편집을 저장하면 입력칸이 닫힌다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', userPrompt: '옛 이름' })], 'a1')
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }))
    await userEvent.type(screen.getByRole('textbox', { name: '옛 이름 새 이름' }), '인증 정리{Enter}')
    expect(screen.queryByRole('textbox', { name: '옛 이름 새 이름' })).toBeNull()
    expect(header().querySelector('.rename-field')).toBeNull()
  })

  it('헤더에서 이름을 고치는 중이면 목록 줄은 입력칸이 아니다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', userPrompt: '보던 대화' })], 'a1')
    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }))

    const boxes = screen.getAllByRole('textbox', { name: '보던 대화 새 이름' })
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.closest('.conv-header')).not.toBeNull()
    expect(document.querySelector('.dock-side .rename-field')).toBeNull()
  })

  it('목록 줄에서 이름을 고치는 중이면 헤더는 입력칸이 아니다', async () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', userPrompt: '보던 대화' })], 'a1')
    await userEvent.click(screen.getByRole('button', { name: '보던 대화 이름 바꾸기' }))

    const boxes = screen.getAllByRole('textbox', { name: '보던 대화 새 이름' })
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.closest('.dock-side')).not.toBeNull()
    expect(header().querySelector('.rename-field')).toBeNull()
  })

  it('헤더 메뉴의 대화 끝내기는 뿌리 id로 close를 부르고 새 대화로 돌아간다', async () => {
    const client = makeClient()
    renderDock([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'succeeded' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', userPrompt: '보던 대화' })
    ], 'a1', client)

    await userEvent.click(screen.getByRole('button', { name: '대화 메뉴' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '대화 끝내기' }))

    expect(client.runs.close).toHaveBeenCalledWith('a1')
    await waitFor(() => {
      expect(screen.getByText('지시를 입력하면 대화가 시작됩니다')).toBeInTheDocument()
    })
  })

  it('헤더의 멈추기는 도는 턴을 멈추고, 실패하면 도크 배너로 보인다', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('멈추지 못했습니다'))
    renderDock([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', startedAt: null }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', userPrompt: '도는 대화' })
    ], 'a1', makeClient({ cancel }))

    // 헤더의 멈추기는 초안이 있을 때만 선다(spec §8의 3) — 초안을 쓴다.
    await userEvent.type(screen.getByRole('textbox', { name: '지시' }), '다음 지시')
    await userEvent.click(screen.getByRole('button', { name: '이 대화의 실행 멈추기' }))
    expect(cancel).toHaveBeenCalledWith('a1')
    expect(await screen.findByRole('alert')).toHaveTextContent('멈추지 못했습니다')
  })

  /**
   * 헤더의 멈추기는 입력칸에 초안이 있을 때만 선다 (spec §8의 3, 결정 2026-09-27) — 입력칸이 비면 같은
   * 자리의 전송 버튼이 이미 중지다. **배선을 본다**: 헤더는 입력부 밖이라 초안 스토어를 들어야 하고,
   * ConversationHeader.test는 `hasDraft`를 모의로 받아 이것을 고정하지 못한다. 멈추는 자리는 늘 둘이다 —
   * 상태 줄의 멈추기와, 헤더 또는 입력부 중지 중 하나.
   */
  it('헤더의 멈추기는 초안을 쓰면 서고 지우면 사라진다 — 입력부의 중지와 번갈아 선다', async () => {
    renderDock([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running', userPrompt: '도는 대화' })
    ], 'a1')
    const box = screen.getByRole('textbox', { name: '지시' })
    const headerStop = () => screen.queryByRole('button', { name: '이 대화의 실행 멈추기' })

    expect(headerStop()).toBeNull()
    expect(screen.getByRole('button', { name: '중지' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '실행 중인 턴 멈추기' })).toBeInTheDocument()

    // 공백만으로는 초안이 아니다 — 전송 버튼도 그대로 중지다.
    await userEvent.type(box, '   ')
    expect(headerStop()).toBeNull()
    expect(screen.getByRole('button', { name: '중지' })).toBeInTheDocument()

    await userEvent.type(box, '다음 지시')
    expect(headerStop()).not.toBeNull()
    expect(screen.queryByRole('button', { name: '중지' })).toBeNull()

    await userEvent.clear(box)
    expect(headerStop()).toBeNull()
    expect(screen.getByRole('button', { name: '중지' })).toBeInTheDocument()
  })

  it('다른 대화에 쓴 초안은 이 대화의 헤더 멈추기를 세우지 않는다', async () => {
    const drafts = createDraftStore()
    drafts.set('b1', '다른 대화에 쓰던 것')
    render(
      <ClientProvider client={makeClient()}>
        <RunEventProvider store={createRunEventStore()}>
          <DraftProvider store={drafts}>
            <Dock
              runs={[
                makeRun({ id: 'b1', rootRunId: 'b1', createdAt: 5, status: 'succeeded', userPrompt: '다른 대화' }),
                makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', userPrompt: '도는 대화' })
              ]}
              error={null} workspaceId="w1" workspaces={workspaces} repos={repos} reposError={null}
              queue={null} queueError={null} onChangeLimit={vi.fn()} chips={[]} onRemoveChip={vi.fn()}
              onRunStarted={vi.fn()} draftPrompt="" draftCwd={null}
              focusConversationId="a1" onFocusConsumed={vi.fn()}
            />
          </DraftProvider>
        </RunEventProvider>
      </ClientProvider>
    )
    expect(screen.getByRole('textbox', { name: '지시' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: '이 대화의 실행 멈추기' })).toBeNull()
  })

  it('헤더와 목록 줄의 부제는 등록된 repo의 이름이다 — 경로의 마지막 칸이 아니다', async () => {
    // 이 파일의 기본 픽스처는 이름('api')이 경로의 마지막 칸('/tmp/api')과 같아, Dock이 repos를
    // 내리지 않아도 부제가 같게 나온다(리뷰가 찾은 것) — 이름과 디렉토리가 다른 repo로 본다.
    const named: Repo[] = [
      { id: 'r9', workspaceId: 'w1', name: '결제 서버', path: '/tmp/pay-svc', description: null, sortOrder: 0, createdAt: 0 }
    ]
    const props: Parameters<typeof Dock>[0] = {
      runs: [makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', cwd: '/tmp/pay-svc', userPrompt: '결제 대화' })],
      error: null, workspaceId: 'w1', workspaces, repos: named, reposError: null,
      queue: null, queueError: null, onChangeLimit: vi.fn(), chips: [], onRemoveChip: vi.fn(),
      onRunStarted: vi.fn(), draftPrompt: '', draftCwd: null,
      focusConversationId: 'a1', onFocusConsumed: vi.fn()
    }
    render(
      <ClientProvider client={makeClient()}>
        <RunEventProvider store={createRunEventStore()}>
          <DraftProvider store={createDraftStore()}>
            <Dock {...props} />
          </DraftProvider>
        </RunEventProvider>
      </ClientProvider>
    )
    expect(header().querySelector('.conv-sub')).toHaveTextContent('결제 서버')
    expect(header().querySelector('.conv-sub')).not.toHaveTextContent('pay-svc')
    const row = document.querySelector<HTMLElement>('.dock-conv')!
    expect(row).toHaveTextContent('결제 서버')
    expect(row).not.toHaveTextContent('pay-svc')
  })

  it('헤더의 담긴 것 줄은 보는 대화의 것이다', async () => {
    renderDock([
      makeRun({ id: 'c1', rootRunId: 'c1', createdAt: 10, status: 'succeeded',
        contextItems: [{ type: 'issue', id: 'i1', label: '버그' }] }),
      makeRun({ id: 'c2', rootRunId: 'c2', createdAt: 20, status: 'succeeded',
        contextItems: [{ type: 'memo', id: 'm1', label: '릴리스 절차' }] })
    ])
    await userEvent.click(screen.getByText('버그', { selector: '.dock-conv-title' }))
    expect(header().querySelector('.applied-context')).toHaveTextContent('이슈 · 버그')
  })
})
