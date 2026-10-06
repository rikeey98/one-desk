import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RunEventProvider } from '../store/RunEventContext'
import { createRunEventStore, type RunEventStore } from '../store/runEvents'
import { DraftProvider } from '../store/DraftContext'
import { createDraftStore } from '../store/drafts'
import { ConversationPanel } from './ConversationPanel'
import { groupConversations } from '../conversation'
import type { OneDeskClient } from '@shared/client'
import type { Conversation } from '../conversation'
import type { Repo, Run, Workspace } from '@shared/models'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
]

const workspace: Workspace = {
  id: 'w1', name: 'ws', description: null, defaultAgentKind: 'claude-code',
  defaultModelClaude: null, defaultModelOpencode: null, defaultEffortClaude: null, defaultVariantOpencode: null, defaultPermission: 'edit',
  claudePath: null, opencodePath: null, createdAt: 0, updatedAt: 0
}

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'w1', agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp/api',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: 'sess-1', parentRunId: null, rootRunId: over.id, resultText: null,
    // 대화의 이름과 끝. 뿌리 행에서만 의미가 있고 기본은 둘 다 null이다.
    title: null, closedAt: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], issue: null, usage: null,
    ...over
  }
}

function makeClient(opts: { resume?: ReturnType<typeof vi.fn> } = {}): OneDeskClient {
  return {
    workspaces: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    repos: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    commands: {
      list: vi.fn().mockResolvedValue({ commands: [], error: null }),
      refresh: vi.fn().mockResolvedValue({ commands: [], error: null })
    },
    runs: {
      list: vi.fn().mockResolvedValue([]),
      start: vi.fn().mockResolvedValue({ id: 'run-1' } as Run),
      resume: opts.resume ?? vi.fn().mockResolvedValue({ id: 'run-2' } as Run),
      cancel: vi.fn(), readLog: vi.fn().mockResolvedValue([])
    },
    events: {
      onRunEvent: vi.fn(() => () => {}),
      onRunUpdate: vi.fn(() => () => {}),
      onQueueUpdate: vi.fn(() => () => {}),
      onInboxUpdate: vi.fn(() => () => {})
    }
  } as unknown as OneDeskClient
}

/** RunPanel.test.tsx의 방식을 그대로 따른다 — ClientProvider로 감싸 client.runs.resume을
 *  가짜로 준다. */
function renderPanel(
  conversation: Conversation | null,
  opts: {
    resume?: ReturnType<typeof vi.fn>
    onCancel?: (runId: string) => void
    store?: RunEventStore
  } = {}
) {
  const client = makeClient(opts)
  const onRemoveChip = vi.fn()
  const onStarted = vi.fn()
  const { container } = render(
    <ClientProvider client={client}>
      {/* 턴은 접힌 채로도 스토어 스냅샷을 구독한다(useRunEventSnapshot) — 그 훅이
          RunEventProvider 컨텍스트를 요구하므로 여기서도 감싸 준다. */}
      <RunEventProvider store={opts.store ?? createRunEventStore()}>
        {/* 입력부의 초안은 스토어가 쥔다 (spec FR-31) — main.tsx와 같은 한 겹이다. */}
        <DraftProvider store={createDraftStore()}>
          <ConversationPanel
            conversation={conversation}
            workspaceId="w1"
            workspaces={[workspace]}
            repos={repos}
            reposError={null}
            chips={[]}
            onRemoveChip={onRemoveChip}
            onStarted={onStarted}
            onCancel={opts.onCancel ?? vi.fn()}
            draftPrompt=""
            draftCwd={null}
            selectedRepoId={null}
          />
        </DraftProvider>
      </RunEventProvider>
    </ClientProvider>
  )
  return { client, container, onRemoveChip, onStarted }
}

describe('ConversationPanel', () => {
  it('conversation이 null이면 새 대화 안내와 입력부만 보여준다', () => {
    renderPanel(null)
    expect(screen.getByText('지시를 입력하면 대화가 시작됩니다')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '실행' })).toBeInTheDocument()
  })

  it('conversation이 있으면 대화록을 보여준다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', createdAt: 10, userPrompt: '질문', resultText: '답변' })
    ])[0]!
    renderPanel(conv)
    expect(screen.getByText('질문')).toBeInTheDocument()
    expect(screen.getByText('답변')).toBeInTheDocument()
    expect(screen.queryByText('지시를 입력하면 대화가 시작됩니다')).not.toBeInTheDocument()
  })

  it('예약이 이미 있으면 전송이 잠긴다', async () => {
    // 대화당 예약은 하나다 (설계 §3-2).
    const conv = groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running' })
    ])[0]!
    renderPanel(conv)
    await userEvent.type(screen.getByRole('textbox', { name: /지시/ }), '또 하나')
    expect(screen.getByRole('button', { name: '실행' })).toBeDisabled()
  })

  it('실행 중이어도 입력은 받는다 — 치기 전에는 전송 버튼이 중지다', async () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running' })
    ])[0]!
    renderPanel(conv)
    expect(screen.getByRole('button', { name: '중지' })).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: /지시/ })
    await userEvent.type(box, '다음 말')
    expect(box).toHaveValue('다음 말')
    expect(screen.getByRole('button', { name: '실행' })).toBeEnabled()
  })

  /**
   * 입력부가 보는 대화의 지금 (`docs/sdlc/conversation-timeline/` spec FR-28·FR-30). 규칙(도는 턴,
   * 뿌리가 아닌 pending = 예약, 뿌리 pending)은 여기서 계산해 내린다 — `reserved`와 같은 자리다.
   * 배선 한 줄이 새면 버튼은 그려지는데 엉뚱한 턴을 겨눈다.
   */
  describe('도는 턴과 예약', () => {
    const reserving = () => groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', userPrompt: '이어 보낸 말' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running', startedAt: 5 })
    ])[0]!

    it('입력부의 중지는 도는 턴을 겨눈다 — 예약이 아니다', async () => {
      const onCancel = vi.fn()
      renderPanel(reserving(), { onCancel })
      await userEvent.click(screen.getByRole('button', { name: '중지' }))
      expect(onCancel).toHaveBeenCalledWith('a1')
      expect(onCancel).not.toHaveBeenCalledWith('a2')
    })

    it('예약은 대화록이 아니라 입력칸 위 칩이고, 칩의 예약 취소는 예약을 겨눈다', async () => {
      const onCancel = vi.fn()
      const { container } = renderPanel(reserving(), { onCancel })
      expect(container.querySelector('.transcript')).not.toHaveTextContent('이어 보낸 말')
      const chip = screen.getByRole('status')
      expect(chip).toHaveTextContent('이어 보낸 말')
      expect(chip).toHaveTextContent('앞 턴이 끝나면 보냅니다')
      await userEvent.click(within(chip).getByRole('button', { name: '예약 취소' }))
      expect(onCancel).toHaveBeenCalledWith('a2')
    })

    it('앞 턴이 끝났으면 칩은 슬롯을 기다린다고 말한다', () => {
      renderPanel(groupConversations([
        makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded' })
      ])[0]!)
      expect(screen.getByRole('status')).toHaveTextContent('실행 슬롯이 비면 보냅니다')
      expect(screen.queryByRole('button', { name: '중지' })).toBeNull()
    })

    it('첫 지시가 슬롯을 기다리면 대화록에 남고 입력부는 그렇다고 말한다', async () => {
      const onCancel = vi.fn()
      const { container } = renderPanel(groupConversations([
        makeRun({ id: 'a1', rootRunId: 'a1', status: 'pending', userPrompt: '첫 지시' })
      ])[0]!, { onCancel })
      expect(within(container.querySelector<HTMLElement>('.transcript')!).getByText('첫 지시')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('첫 지시가 실행을 기다리는 중입니다')
      expect(screen.queryByRole('button', { name: '예약 취소' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: '대기 취소' }))
      expect(onCancel).toHaveBeenCalledWith('a1')
    })
  })

  it('답하기를 누르면 입력칸에 포커스가 간다 (FR-44)', async () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', needsAnswer: true, resultText: '어느 쪽으로 할까요?' })
    ])[0]!
    renderPanel(conv)
    const box = screen.getByRole('textbox', { name: /지시/ })
    expect(box).not.toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: '답하기' }))
    expect(box).toHaveFocus()
  })

  /**
   * 다시 보내기 (`docs/sdlc/conversation-timeline/` spec FR-43). 대화록의 버튼이 부르고,
   * **그 턴의 값 그대로** 같은 대화에 새 턴을 잇는다 — 인박스의 "다시 실행"이 새 대화를
   * 열며 조건을 잃는 것과 다르다.
   */
  describe('다시 보내기', () => {
    const failed = () => groupConversations([
      makeRun({
        id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'failed', startedAt: 15,
        userPrompt: '다시 할 말', model: 'opus', effort: 'high', permission: 'read_only',
        externalSessionId: null,
        contextItems: [{ type: 'issue', id: 'i1', label: '토큰 만료 버그' }]
      }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10 })
    ])[0]!

    it('그 턴의 지시·맥락·조건으로 이 대화를 잇고 시작된 턴을 넘긴다', async () => {
      const next = makeRun({ id: 'a3', rootRunId: 'a1', status: 'pending' })
      const resume = vi.fn().mockResolvedValue(next)
      const { onStarted } = renderPanel(failed(), { resume })

      await userEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
      expect(resume).toHaveBeenCalledWith({
        conversationId: 'a1',
        userPrompt: '다시 할 말',
        // 이름(label)은 보내지 않는다 — core가 읽는 시점에 다시 붙인다.
        context: [{ type: 'issue', id: 'i1' }],
        model: 'opus',
        effort: 'high',
        permission: 'read_only'
      })
      await vi.waitFor(() => expect(onStarted).toHaveBeenCalledWith(next))
    })

    it('@로 담은 파일은 맥락에서 빼고 보낸다 — 원문 지시문의 @가 다시 가져온다 (docs/sdlc/input-triggers/ FR-18)', async () => {
      const withFile = groupConversations([
        makeRun({
          id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'failed', startedAt: 15,
          userPrompt: '@notes/a.txt 다시', externalSessionId: null,
          contextItems: [
            { type: 'issue', id: 'i1', label: '토큰 만료 버그' },
            { type: 'file', id: 'r1:notes/a.txt', label: 'notes/a.txt' }
          ]
        }),
        makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10 })
      ])[0]!
      const resume = vi.fn().mockResolvedValue(makeRun({ id: 'a3', rootRunId: 'a1', status: 'pending' }))
      renderPanel(withFile, { resume })

      await userEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
      expect(resume).toHaveBeenCalledWith(expect.objectContaining({
        userPrompt: '@notes/a.txt 다시',
        context: [{ type: 'issue', id: 'i1' }]
      }))
    })

    it('실패하면 이유를 보이고 버튼을 다시 풀어 준다', async () => {
      const resume = vi.fn().mockRejectedValue(new Error('이어받을 세션이 없습니다'))
      const { onStarted } = renderPanel(failed(), { resume })

      const button = screen.getByRole('button', { name: '다시 보내기' })
      await userEvent.click(button)
      // 대화록의 오류 카드(턴의 errorMessage)와 갈리게 문구로 찾는다.
      expect(await screen.findByText('이어받을 세션이 없습니다')).toHaveAttribute('role', 'alert')
      await vi.waitFor(() => expect(button).toBeEnabled())
      expect(onStarted).not.toHaveBeenCalled()
    })
  })

  it('이 대화에 담긴 것 줄은 여기 없다 — 대화 헤더로 옮겨 갔다 (spec FR-33)', () => {
    // 두 곳에 그리면 같은 줄이 두 번 보인다. 줄 자체의 규칙은 ConversationHeader.test가 본다.
    const conv = groupConversations([
      makeRun({ id: 'a1', contextItems: [{ type: 'issue', id: 'i1', label: '토큰 만료 버그' }] })
    ])[0]!
    const { container } = renderPanel(conv)
    expect(container.querySelector('.applied-context')).toBeNull()
  })

  /**
   * 바닥 따라가기 (`docs/sdlc/conversation-timeline/` spec FR-42). jsdom은 레이아웃이 없다 —
   * 대화록(`.transcript`)의 스크롤 속성을 직접 세워 흉내 낸다. 진짜로 따라 내려가는가는
   * `composer.e2e.ts`가 본다.
   */
  describe('바닥 따라가기', () => {
    const geo = { scrollHeight: 1000, clientHeight: 300 }
    let observers: ResizeObserverCallback[] = []

    beforeEach(() => {
      geo.scrollHeight = 1000
      geo.clientHeight = 300
      observers = []
      // 스크롤러만 크기가 있다 — 나머지 요소는 jsdom 그대로 0이다.
      vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
        return this.classList.contains('transcript') ? geo.scrollHeight : 0
      })
      vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
        return this.classList.contains('transcript') ? geo.clientHeight : 0
      })
      // jsdom에는 ResizeObserver가 없다. 누가 높이 변화를 계기로 쓰면 아래에서 직접 불러
      // 그 변이가 드러나게 한다.
      vi.stubGlobal('ResizeObserver', class {
        constructor(cb: ResizeObserverCallback) { observers.push(cb) }
        observe() {}
        unobserve() {}
        disconnect() {}
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    const running = () => groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'running', startedAt: 5, userPrompt: '도는 턴' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', resultText: '지난 답' })
    ])[0]!

    function scroller(container: HTMLElement): HTMLElement {
      return container.querySelector<HTMLElement>('.transcript')!
    }

    function push(store: RunEventStore, seq: number) {
      store.push({ type: 'text', runId: 'a2', seq, at: 0, text: `흐르는 글 ${seq}` })
    }

    it('대화를 열면 바닥에서 시작한다', () => {
      const { container } = renderPanel(running())
      expect(scroller(container).scrollTop).toBe(1000)
    })

    it('바닥에 붙어 있으면 새 내용이 올 때 따라 내려간다', async () => {
      const store = createRunEventStore()
      const { container } = renderPanel(running(), { store })
      geo.scrollHeight = 1500
      push(store, 1)
      await vi.waitFor(() => expect(scroller(container).scrollTop).toBe(1500))
      expect(screen.queryByRole('button', { name: '최신으로 이동' })).toBeNull()
    })

    it('스토어 상한에 닿은 뒤에 오는 줄도 따라간다 — 수는 그대로여도 마지막 seq가 바뀐다', async () => {
      // 스토어는 run당 개수를 넘으면 앞을 자른다(기본 2,000). 내용 버전이 이벤트 수만 보면 상한에
      // 닿은 뒤로는 새 줄이 와도 버전이 같아 따라가지 않는다(spec FR-42 다듬음 (1)). 상한을 작게
      // 세워 그 자리를 싸게 만든다.
      const store = createRunEventStore({ maxPerRun: 3 })
      const { container } = renderPanel(running(), { store })
      for (const seq of [1, 2, 3]) push(store, seq)
      await screen.findByText('흐르는 글 3')
      expect(store.getSnapshot('a2')).toHaveLength(3)

      geo.scrollHeight = 1400
      push(store, 4)
      await screen.findByText('흐르는 글 4')
      expect(store.getSnapshot('a2')).toHaveLength(3)
      await vi.waitFor(() => expect(scroller(container).scrollTop).toBe(1400))
    })

    it('위로 올려 두면 따라가지 않고 최신으로 이동이 뜬다 — 누르면 바닥으로 가서 다시 붙는다', async () => {
      const store = createRunEventStore()
      const { container } = renderPanel(running(), { store })
      const box = scroller(container)
      box.scrollTop = 100
      fireEvent.scroll(box)
      const jump = await screen.findByRole('button', { name: '최신으로 이동' })
      // 버튼은 스크롤러 밖(형제)이다 — 스크롤되지도 잘리지도 않는다.
      expect(box.contains(jump)).toBe(false)

      geo.scrollHeight = 1500
      push(store, 1)
      await screen.findByText('흐르는 글 1')
      expect(box.scrollTop).toBe(100)

      await userEvent.click(jump)
      expect(box.scrollTop).toBe(1500)
      expect(screen.queryByRole('button', { name: '최신으로 이동' })).toBeNull()

      // 다시 붙었으니 다음 내용은 따라간다.
      geo.scrollHeight = 1800
      push(store, 2)
      await vi.waitFor(() => expect(box.scrollTop).toBe(1800))
    })

    it('펼쳐도 바닥으로 가지 않는다 — 높이 변화는 내용 버전이 아니다', async () => {
      const { container } = renderPanel(running())
      const box = scroller(container)
      expect(box.scrollTop).toBe(1000)

      // 지난 턴을 펼친다 — 내용이 늘어난다. 내용의 높이 변화를 계기로 쓰는 구현이면 여기서
      // 끌려간다. 관찰자를 전부 불러 본다 — 대화록 칸 자신의 높이(clientHeight)는 그대로다.
      //
      // **프레임은 테스트가 넘긴다.** 훅은 누른 뒤 한 프레임 뒤에 "붙어 있다"를 다시 잰다. 진짜
      // 프레임에 맡기면 userEvent.click이 안에서 setTimeout으로 양보하는 사이에 그 프레임이 먼저 돌
      // 수도, 나중에 돌 수도 있다 — 누른 뒤에 높이를 세우던 때는 먼저 돈 쪽이 옛 높이(1000)로 재어
      // `최신으로 이동`이 영영 뜨지 않았다(리뷰가 찾은 간헐 실패 — 기준선 실행에서도 한 번 났다).
      // 관찰자는 그 프레임보다 **먼저** 부른다: 다시 재기 전이라 "붙어 있다"가 아직 참인 그 틈에서
      // 높이 변화를 계기로 쓰는 구현이 끌려가는지를 늘 같은 순서로 본다.
      const frames: FrameRequestCallback[] = []
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
      vi.stubGlobal('cancelAnimationFrame', () => {})
      const first = container.querySelectorAll<HTMLElement>('.turn')[0]!
      geo.scrollHeight = 1600
      await userEvent.click(within(first).getByRole('button', { name: '자세히' }))
      act(() => { for (const cb of observers) cb([], {} as ResizeObserver) })
      expect(box.scrollTop).toBe(1000)

      // 펼친 뒤에는 바닥에서 떨어져 있다 — 그렇다고 알린다(한 프레임 뒤에 잰다).
      act(() => { for (const cb of frames.splice(0)) cb(0) })
      expect(await screen.findByRole('button', { name: '최신으로 이동' })).toBeInTheDocument()
      expect(box.scrollTop).toBe(1000)
    })

    it('칸이 줄며 스크롤 이벤트가 관찰자보다 먼저 와도 붙어 있던 것은 바닥을 지킨다', () => {
      // 도크를 끄는 동안 실측된 순서다 — 스크롤 이벤트는 프레임의 레이아웃 앞에서, ResizeObserver는
      // 뒤에서 돈다. 스크롤 이벤트가 줄어든 칸으로 재면 바닥에서 떨어진 것으로 보여 따라가기가 풀린다.
      const { container } = renderPanel(running())
      const box = scroller(container)
      box.scrollTop = 700
      fireEvent.scroll(box)
      geo.clientHeight = 150
      fireEvent.scroll(box)
      act(() => { for (const cb of observers) cb([], {} as ResizeObserver) })
      expect(box.scrollTop).toBe(1000)
      expect(screen.queryByRole('button', { name: '최신으로 이동' })).toBeNull()
    })

    it('대화록 칸이 줄어도 붙어 있으면 바닥을 지킨다 — 도크를 끌거나 입력부에 칩이 뜬 때', () => {
      // 상자가 줄면 scrollTop은 위를 기준으로 남아 바닥이 가려지고 스크롤 이벤트도 없다.
      const { container } = renderPanel(running())
      const box = scroller(container)
      // 진짜 브라우저처럼 바닥(1000 − 300)에 세운다 — 붙어 있다.
      box.scrollTop = 700
      fireEvent.scroll(box)
      geo.clientHeight = 150
      act(() => { for (const cb of observers) cb([], {} as ResizeObserver) })
      expect(box.scrollTop).toBe(1000)
      // 바닥에서 떨어진 채로 칸이 줄면 끌어내리지 않고 다시 잴 뿐이다.
      box.scrollTop = 100
      fireEvent.scroll(box)
      geo.clientHeight = 120
      act(() => { for (const cb of observers) cb([], {} as ResizeObserver) })
      expect(box.scrollTop).toBe(100)
      expect(screen.getByRole('button', { name: '최신으로 이동' })).toBeInTheDocument()
    })
  })
})
