import { useEffect, useMemo, useState , useRef } from 'react'
import { useClient } from '../client/ClientProvider'
import { clampDockHeight, readDockHeight, writeDockHeight, DEFAULT_DOCK_RATIO } from '../dockHeight'
import { ConversationPanel } from './ConversationPanel'
import { STOP_RUNNING_TURN } from './Transcript'
import { ConversationList } from './ConversationList'
import { SlotIndicator } from './SlotIndicator'
import { conversationIdOf, groupConversations, type Conversation } from '../conversation'
import { INBOX_RULES, inboxCategory } from '@shared/inbox'
import type { ContextChip } from '../context'
import type { QueueSnapshot, Repo, Run, Workspace } from '@shared/models'

export function Dock({
  runs, error, workspaceId, workspaces, repos, reposError, queue, queueError, onChangeLimit, chips, onRemoveChip,
  onRunStarted, draftPrompt, draftCwd, focusConversationId, onFocusConsumed
}: {
  runs: Run[]
  error: string | null
  workspaceId: string
  /** ConversationPanel까지 그대로 흘려 보낸다 — App이 useWorkspaces()로 한 번만 조회한 것이다. */
  workspaces: Workspace[]
  repos: Repo[]
  reposError: string | null
  queue: QueueSnapshot | null
  queueError: string | null
  onChangeLimit: (n: number) => void
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onRunStarted: (run: Run) => void
  draftPrompt: string
  /** ConversationPanel까지 그대로 흘려 보낸다 — "다시 실행"이 요구하는 작업 디렉토리다. */
  draftCwd: string | null
  /** 인박스의 "대화 열기"가 지정한 대화. null이면 기본대로 새 대화 탭이 열린다. */
  focusConversationId: string | null
  /**
   * `focusConversationId`로 대화를 열었다고 알린다 — App이 그 값을 치운다
   * (`docs/sdlc/conversation-fixes/` spec FR-22). 일회성 지시라, 남아 있으면 Dock이 다시
   * 마운트될 때마다(설정에 갔다 오기) 그 대화가 되살아난다. **필수다** — 선택 인자면
   * App의 배선 한 줄을 지워도 조용히 컴파일된다.
   */
  onFocusConsumed: () => void
}) {
  const client = useClient()
  const [open, setOpen] = useState(true)
  // 도크 높이. 원래 CSS에 34%로 박혀 있어 대화창을 넓힐 방법이 없었다.
  // 창 크기는 마운트 시점에만 읽는다 — 리사이즈 추적은 이 변경의 범위가 아니고,
  // 값은 아래 드래그에서 매번 지금 창 크기로 다시 클램프된다.
  const [height, setHeight] = useState(() => readDockHeight(window.innerHeight))
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)

  // 포인터를 도크 밖으로 끌어도 따라와야 하므로 window에 건다. 드래그 중에만
  // 붙였다 떼는 이유는 그것 말고는 매 렌더 리스너가 살아 있을 이유가 없어서다.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current
      if (!d) return
      // 위로 끌면(clientY 감소) 대화창이 커진다.
      setHeight(clampDockHeight(d.startHeight + (d.startY - e.clientY), window.innerHeight))
    }
    function onUp() {
      if (!drag.current) return
      drag.current = null
      setHeight((h) => { writeDockHeight(h); return h })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  function resetHeight() {
    const next = clampDockHeight(window.innerHeight * DEFAULT_DOCK_RATIO, window.innerHeight)
    setHeight(next)
    writeDockHeight(next)
  }

  // 실행 패널은 모달이 아니라 도크가 확장된 형태다 —
  // 모달이 뜨면 뒤의 issue/memo를 클릭해 맥락을 담을 수 없다 (설계 §9).
  //
  // focusConversationId가 있으면 마운트 첫 렌더부터 그 대화를 연 상태로 시작한다.
  // 'new'로 시작했다가 아래 effect가 나중에 고치면, 그 사이의 첫 렌더에서
  // ConversationPanel이 conversation=null을 받는 순간이 생긴다 — RunPanel의
  // draftPrompt 가드(!conversation)가 그 찰나에 걸려 "다시 실행"이 남긴 draft를
  // 새 대화가 아니라 지금 이어받는 대화의 입력에 반영해 버린다("다시 실행" 뒤에
  // 인박스로 돌아가 다른 대화를 "대화 열기"로 열면 그 draft가 새는 결함으로 실측됨).
  const [view, setView] = useState<'conversation' | 'new'>(focusConversationId ? 'conversation' : 'new')
  const [pickedId, setPickedId] = useState<string | null>(focusConversationId)
  const [actionError, setActionError] = useState<string | null>(null)
  // 목록의 펼침·편집 state는 여기서 쥔다 — ConversationList에 내리면 도크를 접었다
  // 펴는 것만으로 편집하던 이름이 사라진다.
  const [showClosed, setShowClosed] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  // workspace가 바뀌면 고른 대화·보기·이름 편집을 처음으로 돌린다 (spec FR-22). App은
  // Dock에 key를 주지 않아 workspace를 바꿔도 다시 마운트되지 않는다 — 남겨 두면 새
  // workspace의 목록 위에 옛 선택이 걸리고, useRuns가 새 목록을 받기 전의 찰나에는 옛
  // 대화가 그대로 열린 채 입력부가 그 대화를 겨눈다. 옛 대화에서 난 오류 배너도 함께
  // 치운다 — 새 workspace의 도크 위에 남으면 지금 보는 곳에서 무엇이 실패했는지 찾게 된다.
  //
  // **effect가 아니라 렌더 중에 맞춘다**(React의 "prop이 바뀌면 state 조정" 패턴). effect면
  // 옛 선택과 새 workspaceId가 함께 그려지는 한 프레임이 생긴다. 아래 포커스 effect는
  // 커밋 뒤에 도므로, 둘이 같이 바뀌어도 포커스가 이긴다. 끝낸 대화 펼침(`showClosed`)은
  // 선택이 아니라 보기 취향이라 두고 간다.
  const [shownWorkspaceId, setShownWorkspaceId] = useState(workspaceId)
  if (shownWorkspaceId !== workspaceId) {
    setShownWorkspaceId(workspaceId)
    setView('new')
    setPickedId(null)
    setRenamingId(null)
    setActionError(null)
  }

  // useRuns는 최신순 평평한 목록을 준다. 목록은 run이 아니라 대화 단위다.
  const conversations = useMemo(() => groupConversations(runs), [runs])
  // 끝낸 대화는 기본 목록에서 내려간다 (spec FR-18·FR-20). 지우는 것이 아니라
  // 접는 것이라, 아래 토글로 언제든 다시 열 수 있다.
  const openConversations = useMemo(
    () => conversations.filter((c) => c.closedAt === null), [conversations]
  )
  const closedConversations = useMemo(
    () => conversations.filter((c) => c.closedAt !== null), [conversations]
  )

  // 위 초기값은 "마운트 시점"만 잡는다 — Dock이 마운트된 채로 focusConversationId가
  // 나중에 바뀌는 경우(지금 배선에서는 일어나지 않지만)도 대비해 effect로도 맞춘다.
  //
  // 연 뒤에는 소비했다고 알린다 (FR-22) — App이 값을 치워 null이 되면 이 effect는
  // 아무것도 하지 않으므로 연 대화는 그대로다. onFocusConsumed는 의존성에 넣지 않는다:
  // App이 매 렌더 새 함수를 넘기므로, 넣으면 지시가 치워지기 전 렌더마다 다시 연다.
  useEffect(() => {
    if (!focusConversationId) return
    setPickedId(focusConversationId)
    setView('conversation')
    setOpen(true)
    onFocusConsumed()
  }, [focusConversationId])

  // 폴백은 "고른 적이 없을 때"(pickedId===null)에만 적용한다. pickedId가 있는데
  // 그 대화가 지금 conversations에 없다고 조용히 다른 대화로 떨어지면 안 된다 —
  // selected는 이제 로그 뷰의 대상만이 아니라 입력부의 전송 대상이기도 하다
  // (ConversationPanel→RunPanel이 conversation.id로 resume을 부른다). focusConversationId로
  // 막 마운트됐는데 runs가 아직 그 workspace 것으로 안 갈렸거나(useRuns는 workspaceId가
  // 바뀔 때 목록을 즉시 비우지 않는다), 방금 시작한 run이 아직 목록에 없는(started()가
  // pickedId를 먼저 세운다) 그 찰나에 폴백이 다른 대화를 골라 버리면, 화면과 입력부가
  // 다른 대화를 가리키는 채로 Ctrl/⌘+Enter를 누르는 순간 턴이 엉뚱한 대화로 나간다.
  // 폴백은 끝나지 않은 대화 중에서 고른다 — 끝낸 대화가 기본으로 열리면 방금 내린
  // 것이 되돌아온 것처럼 보인다.
  const selected = pickedId
    ? conversations.find((c) => c.id === pickedId) ?? null
    : openConversations[0] ?? null
  // 큐 조회가 실패하면 표시기가 그냥 안 보인다 — 이 기능이 메우려던 "왜 안 보이지"라는
  // 공백이 오류 상황에서 되살아난다. 새 배너를 만들지 않고 기존 경로로 흘려 보인다.
  const shown = actionError ?? error ?? queueError

  async function cancel(runId: string) {
    setActionError(null)
    try {
      await client.runs.cancel(runId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  function started(run: Run) {
    setPickedId(conversationIdOf(run))
    setView('conversation')
    setOpen(true)
    onRunStarted(run)
  }

  /**
   * 목록에서 대화를 **명시적으로** 골랐다.
   *
   * **자동 확인은 이 경로에만 걸린다** (FR-5·FR-6). `selected`나 마운트 effect에
   * 걸면 `pickedId`가 null일 때의 폴백(`openConversations[0]`)까지 타서, 도크를
   * 열기만 해도 최근 대화가 조용히 인박스에서 내려간다 — 사용자는 그 대화를 본
   * 적이 없다.
   */
  function pick(conv: Conversation) {
    setPickedId(conv.id)
    setView('conversation')
    setOpen(true)
    void confirmSeen(conv)
  }

  /**
   * 본 대화를 인박스에서 내린다 (FR-5).
   *
   * 판정은 core의 배지 집계와 **같은 표**의 다른 칸에서 온다(`shared/inbox.ts`의
   * `INBOX_RULES` — 배지는 `badge`, 여기는 `clearsOnView`). 열어 봐도 남는 것은 답변
   * 필요뿐이고, 실패·중단은 배지에 세지만 열면 내려간다(`docs/sdlc/conversation-fixes/`
   * spec FR-4·FR-6). 표를 두 곳에 적으면 어느 쪽에도 안 걸리는 카테고리가 생긴다.
   *
   * **마지막 턴이 아니라 대표 턴(`conv.state`)으로 판정한다** (FR-3). 시작도 못 하고
   * 취소된 예약으로 판정하면 그 앞 턴의 답변 필요가 "대기 중 취소됨"에 가려 열자마자
   * 조용히 내려간다. 배지(core)도 같은 대표 턴을 센다.
   *
   * 되돌리는 자리는 core에 이미 있다: `create(parentRunId)`가 뿌리의 `reviewedAt`을
   * 지우므로, 새 턴이 오면 배지에 다시 오른다(FR-7).
   */
  async function confirmSeen(conv: Conversation) {
    if (!INBOX_RULES[inboxCategory(conv.state)].clearsOnView) return
    // 끝나지 않은 대화는 인박스 소속 자체가 아니다. 대표 턴이 아직 돌거나 기다리는
    // 중이면(예약이 남아 있으면) 대화는 진행 중이다.
    if (conv.state.endedAt === null) return
    // 뿌리가 이미 확인됐으면 부를 것이 없다. core도 같은 가드가 있지만, IPC 왕복을
    // 목록 클릭마다 하는 것이 아깝다.
    const root = conv.runs.find((r) => r.id === conv.id) ?? conv.runs[0]!
    if (root.reviewedAt !== null) return
    try {
      // **뿌리 id에 찍는다.** 턴 id에 찍으면 아무 일도 일어나지 않는다 — 대화는
      // 인박스에 그대로 남는다(execution.cancel이 이 자리에서 한 번 걸렸다, C-1-a).
      await client.runs.markReviewed(conv.id, 'confirmed')
    } catch (err) {
      // 인박스 정리가 안 됐다고 대화를 못 보게 할 이유가 없다 (FR-8).
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  async function closeConversation(conv: Conversation) {
    setActionError(null)
    try {
      await client.runs.close(conv.id)
      // 지금 보고 있던 대화를 끝냈으면 새 대화로 돌아간다 (FR-23) — 사라진 대화를
      // 가리킨 채로 남으면 입력부가 어디로 보낼지 모르는 상태가 된다.
      if (pickedId === conv.id) {
        setPickedId(null)
        setView('new')
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  async function renameConversation(conv: Conversation, title: string) {
    setRenamingId(null)
    setActionError(null)
    try {
      await client.runs.rename(conv.id, title)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section
      className={open ? 'dock dock-open' : 'dock'}
      {...(open ? { style: { height } } : {})}
    >
      {/* 접힌 도크는 헤더뿐이라 조절할 것이 없다. */}
      {open && (
        <div
          role="separator"
          aria-label="대화창 크기 조절"
          aria-orientation="horizontal"
          className="dock-resizer"
          onPointerDown={(e) => {
            // preventDefault를 부르지 않는다 — 부르면 뒤따르는 click/dblclick이
            // 억제돼 더블클릭 초기화가 죽는다. 드래그 중 텍스트가 선택되는 것은
            // .dock-resizer의 user-select: none이 막는다.
            drag.current = { startY: e.clientY, startHeight: height }
          }}
          onDoubleClick={resetHeight}
        />
      )}
      {/* 헤더에는 토글·슬롯 표시기·취소만 남는다. 대화 목록이 세로로 내려가면서
          "대화가 늘면 슬롯 표시기가 화면 밖으로 밀려난다"는 문제(3b 스펙 §7이 탭
          스트립 밖에 표시기를 둔 이유)가 구조적으로 사라졌다. */}
      <header className="dock-header">
        <button type="button" className="dock-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▴'} 실행
        </button>
        <SlotIndicator snapshot={queue} onChangeLimit={onChangeLimit} />
        {/* **대화의 활성 턴을 겨눈다 — 실행 중인 턴이 먼저다** (`docs/sdlc/conversation-fixes/`
            spec FR-11). 마지막 턴(`last`)을 겨누면 예약이 있을 때 예약을 취소하고 실행 중인
            턴은 멈출 수 없으며, 예약을 취소하고 나면 마지막 턴이 끝나 버튼 자체가 사라진다.
            대기 중인 턴도 겨눌 수 있다 — 프로세스가 없을 뿐 사용자에겐 똑같이 걸려 있다.
            **이름이 겨누는 턴을 말한다** — 대화록에서 같은 턴을 겨누는 버튼과 같은 이름이다.
            실행 중이면 "실행 중인 턴 멈추기", 예약이면 예약 버블과 같은 "취소". 늘 "취소"로
            두면 예약이 걸린 대화에서 헤더와 예약 버블이 같은 이름으로 다른 턴을 멈춘다. */}
        {view === 'conversation' && selected?.active && (
          <button
            type="button"
            className="dock-cancel"
            aria-label={selected.active.status === 'running' ? STOP_RUNNING_TURN : undefined}
            onClick={() => { if (selected.active) void cancel(selected.active.id) }}
          >
            {selected.active.status === 'running' ? '멈추기' : '취소'}
          </button>
        )}
      </header>

      {open && (
        <div className="dock-body">
          {shown && <div role="alert" className="form-error">{shown}</div>}
          <div className="dock-split">
            <ConversationList
              open={openConversations}
              closed={closedConversations}
              selectedId={selected?.id ?? null}
              isNew={view === 'new'}
              repos={repos}
              showClosed={showClosed}
              renamingId={renamingId}
              onPickNew={() => { setView('new'); setPickedId(null); setOpen(true) }}
              onPick={pick}
              onRename={(conv, title) => void renameConversation(conv, title)}
              onClose={(conv) => void closeConversation(conv)}
              onToggleClosed={() => setShowClosed(!showClosed)}
              onStartRename={setRenamingId}
              onCancelRename={() => setRenamingId(null)}
            />
            {/* key로 대화가 바뀔 때마다 언마운트→재마운트시킨다. key가 없으면 목록에서
                다른 대화를 골라도 RunPanel 인스턴스가 그대로 남아 입력 중이던
                프롬프트·모델이 다른 대화로 따라간다 — 예전에는 로그 뷰로 가면 RunPanel
                자체가 안 그려져 저절로 초기화됐지만, 지금은 대화마다 같은 RunPanel이
                계속 떠 있어 그 안전장치가 사라졌다. */}
            <div className="dock-main">
              <ConversationPanel
                key={view === 'new' ? 'new' : selected?.id ?? 'new'}
                conversation={view === 'new' ? null : selected}
                workspaceId={workspaceId}
                workspaces={workspaces}
                repos={repos}
                reposError={reposError}
                chips={chips}
                onRemoveChip={onRemoveChip}
                onStarted={started}
                onCancel={cancel}
                draftPrompt={draftPrompt}
                draftCwd={draftCwd}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
