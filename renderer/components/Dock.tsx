import { useEffect, useMemo, useState, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useClient } from '../client/ClientProvider'
import { clampDockHeight, readDockHeight, writeDockHeight, DEFAULT_DOCK_RATIO } from '../dockHeight'
import { ConversationPanel } from './ConversationPanel'
import { ConversationHeader } from './ConversationHeader'
import { ConversationList } from './ConversationList'
import { draftKeyOf } from '../store/drafts'
import { useDraftFilled } from '../store/DraftContext'
import { SlotIndicator } from './SlotIndicator'
import { IconChevronDown, IconCollapse, IconFolder, IconMaximize } from './icons'
import { FilePane, type OpenRequest } from './code/FilePane'
import { CodePaneContext, useCodePaneSlot, type CodePaneOpener } from './code/CodePaneContext'
import { paneTarget } from '../code/target'
import {
  clampPaneWidth, PANE_STEP_PX, readPaneKind, readPaneWidth, resetPaneWidth, writePaneKind, writePaneWidth,
  type PaneKind
} from '../code/layout'
import { conversationIdOf, filterByRepo, groupConversations, repoOfConversation, sectionByRepo, type Conversation } from '../conversation'
import { readCollapsedSections, writeCollapsedSections } from '../dockSections'
import { confirmSeen as confirmConversationSeen } from '../conversationSeen'
import type { ContextChip } from '../context'
import type { AssignedIssue, QueueSnapshot, Repo, Run, Workspace } from '@shared/models'

/** 코드 칸 폭 경계의 폭(px)과 칸 열의 오른쪽 여백 — CSS `.code-pane-resizer`·`.code-column`과 같다 */
const PANE_RESIZER_PX = 9
const PANE_COLUMN_GUTTER_PX = 12

/**
 * 본문 + 칸에 쓸 수 있는 폭 (code-editor FR-4, 안 B). 칸의 자리는 `.app`의 마지막 열이라 앱 창에서 사이드바·경계·
 * 열 여백을 뺀 것이다. 자리가 없으면 창 폭으로 어림한다.
 */
function availablePaneSpace(slot: HTMLElement | null): number {
  const app = slot?.parentElement ?? null
  const sidebar = app?.querySelector<HTMLElement>(':scope > .sidebar') ?? null
  return (app?.clientWidth ?? window.innerWidth) - (sidebar?.offsetWidth ?? 0) - PANE_RESIZER_PX - PANE_COLUMN_GUTTER_PX
}

export function Dock({
  runs, error, workspaceId, workspaces, repos, reposError, queue, queueError, onChangeLimit, chips, onRemoveChip,
  onRunStarted, draftPrompt, draftCwd, selectedRepoId, onClearRepoFilter, focusConversationId, onFocusConsumed,
  // 개발 버전: 선택 prop이다 — plan에서 필수로 올리고 App 배선 테스트를 붙인다 (conversation-issue spec §7).
  draftIssue = null, onClearDraftIssue = () => {}, focusNew = false, onOpenIssue = () => {}
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
  /** ConversationPanel까지 그대로 흘려 보낸다 — 사이드바에서 고른 repo, 새 대화의 작업 디렉토리다. */
  selectedRepoId: string | null
  /**
   * 목록의 거름 줄에서 사이드바의 repo 선택을 푼다 (`docs/sdlc/dock-repo-sections/` FR-8·11). 앱의 repo 거름은 하나라 이슈·메모
   * 패널의 거름도 같이 풀린다. **필수다** — 선택이면 App의 한 줄을 지워도 조용히 컴파일된다.
   */
  onClearRepoFilter: () => void
  /** 인박스의 "대화 열기"가 지정한 대화. null이면 기본대로 새 대화 탭이 열린다. */
  focusConversationId: string | null
  /**
   * `focusConversationId`로 대화를 열었다고 알린다 — App이 그 값을 치운다
   * (`docs/sdlc/conversation-fixes/` spec FR-22). 일회성 지시라, 남아 있으면 Dock이 다시
   * 마운트될 때마다(설정에 갔다 오기) 그 대화가 되살아난다. **필수다** — 선택 인자면
   * App의 배선 한 줄을 지워도 조용히 컴파일된다.
   */
  onFocusConsumed: () => void
  /** 새 대화 칸에 걸린 할당 예정 이슈 (`docs/sdlc/conversation-issue/` FR-20). 새 대화 칸에서만 쓴다 */
  draftIssue?: AssignedIssue | null
  /** 할당 예정을 뗀다(새 대화 칸의 `이슈 할당 해제`) */
  onClearDraftIssue?: () => void
  /** 이슈 상세의 `대화 시작`이 세운다 — 도크를 펼치고 새 대화 칸으로 옮긴다(FR-15). 쓰면 `onFocusConsumed`로 치운다 */
  focusNew?: boolean
  /** 대화 헤더의 `할당된 이슈 열기` — 그 이슈 상세를 연다(FR-21) */
  onOpenIssue?: (issueId: string) => void
}) {
  const client = useClient()
  const [open, setOpen] = useState(true)
  // 최대화 (`docs/sdlc/conversation-timeline/` spec FR-38) — 도크가 본문 전체 높이를 쓰고 세 패널은
  // CSS로 **숨는다**(언마운트하지 않는다 — 입력 중이던 이슈 본문이 지워지지 않는다). 보기 방식이라
  // 저장하지 않고, workspace를 바꿔도 남긴다(spec §3).
  const [maximized, setMaximized] = useState(false)
  // 도크 높이. 원래 CSS에 34%로 박혀 있어 대화창을 넓힐 방법이 없었다.
  // 창 크기는 마운트 시점에만 읽는다 — 리사이즈 추적은 이 변경의 범위가 아니고,
  // 값은 아래 드래그에서 매번 지금 창 크기로 다시 클램프된다.
  const [height, setHeight] = useState(() => readDockHeight(window.innerHeight))
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)
  // 코드 칸 (`docs/sdlc/code-editor/` FR-1~FR-7). 열린 종류와 폭은 이 장비에 남는다 — 인박스·설정에 다녀와
  // 도크가 다시 마운트돼도 열린 채다(FR-4). 칸 안의 연 파일·고친 글은 스토어가 쥔다(FR-20).
  const [paneKind, setPaneKind] = useState<PaneKind | null>(readPaneKind)
  const [paneWidth, setPaneWidth] = useState<number | null>(readPaneWidth)
  // 새 대화 칸의 작업 디렉토리 — 입력부가 알린다(FR-6). 이어 가는 대화는 뿌리 cwd를 쓴다
  const [newCwd, setNewCwd] = useState('')
  // 대화록의 `코드 칸에서 열기` (FR-23)
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null)
  const openNonce = useRef(0)
  const paneDrag = useRef<{ startX: number; startWidth: number } | null>(null)
  // 칸이 그려질 자리 — 앱 창 오른쪽 끝의 위아래 전체 열이다(안 B, 2026-10-10). 상태는 여기 두고 그 자리에 포털로 그린다
  const paneSlot = useCodePaneSlot()
  const slotRef = useRef(paneSlot)
  slotRef.current = paneSlot

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

  // 코드 칸의 폭 경계. 도크 높이 조절과 같은 모양 — 칸 밖으로 끌어도 따라오게 window에 건다.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = paneDrag.current
      if (!d) return
      // 왼쪽으로 끌면(clientX 감소) 칸이 넓어진다. 쓸 수 있는 폭은 본문 + 칸이다.
      setPaneWidth(clampPaneWidth(d.startWidth + (d.startX - e.clientX), availablePaneSpace(slotRef.current)))
    }
    function onUp() {
      if (!paneDrag.current) return
      paneDrag.current = null
      setPaneWidth((w) => { if (w !== null) writePaneWidth(w); return w })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  function setPane(kind: PaneKind | null) {
    setPaneKind(kind)
    writePaneKind(kind)
  }

  /** 폭 경계의 키보드 — ←는 칸을 넓히고 →는 좁힌다(경계를 그쪽으로 옮긴다) */
  function onResizerKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const pane = paneSlot?.querySelector<HTMLElement>('.code-box')
    if (!pane) return
    const next = clampPaneWidth(
      pane.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? PANE_STEP_PX : -PANE_STEP_PX),
      availablePaneSpace(paneSlot)
    )
    setPaneWidth(next)
    writePaneWidth(next)
  }

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
  // 펼친 이슈 줄 (conversation-issue FR-28). 끝낸 대화 펼침처럼 보기 취향이라 workspace를 바꿔도 두고 간다
  // (이슈 id는 workspace마다 다르니 섞이지 않는다).
  const [expandedIssues, setExpandedIssues] = useState<ReadonlySet<string>>(() => new Set())
  // 접은 repo 구획 (dock-repo-sections FR-7). 보기 취향이라 이 장비에 기억한다 — 기본은 전부 펼침
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(readCollapsedSections)
  // 이름 편집은 목록 줄과 대화 헤더가 **한 state**를 나눠 쓴다 (spec FR-34) — 두 자리에서 같은
  // 대화를 동시에 고치는 상태가 생기지 않는다. `where`가 어느 자리의 입력칸인지를 가른다.
  const [renaming, setRenaming] = useState<{ id: string; where: 'list' | 'header' } | null>(null)

  // workspace가 바뀌면 고른 대화·보기·이름 편집을 처음으로 돌린다 (spec FR-22). App은
  // Dock에 key를 주지 않아 workspace를 바꿔도 다시 마운트되지 않는다 — 남겨 두면 새
  // workspace의 목록 위에 옛 선택이 걸리고, useRuns가 새 목록을 받기 전의 찰나에는 옛
  // 대화가 그대로 열린 채 입력부가 그 대화를 겨눈다. 옛 대화에서 난 오류 배너도 함께
  // 치운다 — 새 workspace의 도크 위에 남으면 지금 보는 곳에서 무엇이 실패했는지 찾게 된다.
  //
  // **effect가 아니라 렌더 중에 맞춘다**(React의 "prop이 바뀌면 state 조정" 패턴). effect면
  // 옛 선택과 새 workspaceId가 함께 그려지는 한 프레임이 생긴다. 아래 포커스 effect는
  // 커밋 뒤에 도므로, 둘이 같이 바뀌어도 포커스가 이긴다. 끝낸 대화 펼침(`showClosed`)과
  // 최대화(`maximized`)는 선택이 아니라 보기 취향이라 두고 간다.
  const [shownWorkspaceId, setShownWorkspaceId] = useState(workspaceId)
  if (shownWorkspaceId !== workspaceId) {
    setShownWorkspaceId(workspaceId)
    setView('new')
    setPickedId(null)
    setRenaming(null)
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

  // 사이드바 거름과 repo 구획 (`docs/sdlc/dock-repo-sections/` FR-3~10). 거름은 **보기만** 바꾼다 — 고른 대화(`selected`)는
  // 거름 밖이어도 그대로다(FR-9). 지운 repo를 고른 채면 거름이 없는 것과 같다.
  const filterRepo = selectedRepoId ? repos.find((r) => r.id === selectedRepoId) ?? null : null
  const visibleOpen = useMemo(
    () => (filterRepo ? filterByRepo(openConversations, repos, filterRepo.id) : openConversations),
    [openConversations, repos, filterRepo]
  )
  const visibleClosed = useMemo(
    () => (filterRepo ? filterByRepo(closedConversations, repos, filterRepo.id) : closedConversations),
    [closedConversations, repos, filterRepo]
  )
  // 구획이 하나뿐이면 머리 없이 지금 목록 그대로다 (FR-5)
  const sections = useMemo(() => {
    if (filterRepo) return null
    const all = sectionByRepo(openConversations, repos)
    return all.length > 1 ? all : null
  }, [openConversations, repos, filterRepo])

  // 위 초기값은 "마운트 시점"만 잡는다 — Dock이 마운트된 채로 focusConversationId가
  // 나중에 바뀌는 경우(지금 배선에서는 일어나지 않지만)도 대비해 effect로도 맞춘다.
  //
  // 연 뒤에는 소비했다고 알린다 (FR-22) — App이 값을 치워 null이 되면 이 effect는
  // 아무것도 하지 않으므로 연 대화는 그대로다. onFocusConsumed는 의존성에 넣지 않는다:
  // App이 매 렌더 새 함수를 넘기므로, 넣으면 지시가 치워지기 전 렌더마다 다시 연다.
  useEffect(() => {
    if (!focusConversationId) return
    // 이슈 줄 안에 접혀 있으면 펼친다 — 이슈 상세의 `대화 열기`로 온 대화가 목록에서 보여야 한다 (FR-28).
    revealIssueOf(focusConversationId)
    setPickedId(focusConversationId)
    setView('conversation')
    setOpen(true)
    onFocusConsumed()
  }, [focusConversationId])

  // 이슈 상세의 `대화 시작` (conversation-issue FR-15) — 새 대화 칸으로 옮겨 펼친다. 위와 같은 일회성 지시다.
  useEffect(() => {
    if (!focusNew) return
    setPickedId(null)
    setView('new')
    setOpen(true)
    onFocusConsumed()
  }, [focusNew])

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
    : visibleOpen[0] ?? null
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

  /** 그 대화가 이슈 줄 안에 있으면 그 줄을 펼친다. 대화가 아직 목록에 없으면(방금 시작한 첫 턴) 아무것도 하지 않는다 */
  function revealIssueOf(conversationId: string) {
    const conv = conversations.find((c) => c.id === conversationId)
    // 접힌 repo 구획 안이면 그 구획도 편다 (dock-repo-sections FR-7) — 기억한 접힘에서도 뺀다
    if (conv) {
      const repo = repoOfConversation(conv, repos)
      const key = repo ? `repo:${repo.id}` : 'other'
      setCollapsedSections((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        writeCollapsedSections(next)
        return next
      })
    }
    const issueId = conv?.issue?.id
    if (!issueId) return
    setExpandedIssues((prev) => prev.has(issueId) ? prev : new Set(prev).add(issueId))
  }

  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeCollapsedSections(next)
      return next
    })
  }

  function toggleIssue(issueId: string) {
    setExpandedIssues((prev) => {
      const next = new Set(prev)
      if (next.has(issueId)) next.delete(issueId)
      else next.add(issueId)
      return next
    })
  }

  // 방금 시작한 대화는 아직 목록에 없다 — 들어오면 그때 이슈 줄을 펼친다 (FR-28). 같은 이슈로 두 번째 대화를
  // 시작하는 순간 목록이 이슈 줄로 접히는데, 펼치지 않으면 지금 보고 있는 대화가 목록에서 사라진다.
  const [revealPending, setRevealPending] = useState<string | null>(null)
  useEffect(() => {
    if (!revealPending || !conversations.some((c) => c.id === revealPending)) return
    revealIssueOf(revealPending)
    setRevealPending(null)
  }, [revealPending, conversations])

  function started(run: Run) {
    setRevealPending(conversationIdOf(run))
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
   * 본 대화를 인박스에서 내린다 (FR-5). 판정은 `renderer/conversationSeen.ts` 한 함수다 — 이슈 상세의
   * `대화 열기`도 같은 것을 쓴다(`docs/sdlc/conversation-issue/` FR-17).
   */
  async function confirmSeen(conv: Conversation) {
    try {
      await confirmConversationSeen(client, conv)
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
    setRenaming(null)
    setActionError(null)
    try {
      await client.runs.rename(conv.id, title)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 대화의 할당 이슈를 바꾸거나 뗀다 (conversation-issue FR-21). 뿌리 id에 찍는다 */
  async function assignIssue(conv: Conversation, issueId: string | null) {
    setActionError(null)
    try {
      await client.runs.assignIssue(conv.id, issueId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  function toggleOpen() {
    // 접으면 최대화도 푼다 — 접힌 도크가 최대화로 남으면 세 패널이 숨은 채 도크 헤더만 남는다.
    if (open) setMaximized(false)
    setOpen(!open)
  }

  function toggleMaximized() {
    if (open && maximized) {
      setMaximized(false)
      return
    }
    // 접힌 도크에서 누르면 펼치면서 최대화한다 (FR-38).
    setOpen(true)
    setMaximized(true)
  }

  /**
   * Esc로 최대화를 푼다 (spec FR-39). **안쪽부터 푼다** — 피커·이름 편집·메뉴가 먼저 Esc를
   * 삼키므로(`stopPropagation`이면 여기까지 오지 않고, `preventDefault`만 했으면 아래에서
   * 거른다) 그쪽이 열려 있으면 최대화는 그대로다. 푼 Esc는 여기서 멈춘다 — React의
   * `stopPropagation`은 document까지 닿지 않으므로 App의 "열린 항목 닫기"가 같은 Esc에 같이
   * 돌지 않는다(RenameField가 기대는 것과 같은 성질). 최대화가 아니면 아무것도 삼키지 않는다.
   */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || !(open && maximized)) return
    e.preventDefault()
    e.stopPropagation()
    setMaximized(false)
  }

  const isMax = open && maximized
  const shownConversation = view === 'new' ? null : selected
  // 보는 대화의 입력칸에 보낼 것이 있는가 — 대화 헤더의 `멈추기`는 그때만 선다(spec §8의 3, 결정
  // 2026-09-27). 입력칸이 비면 같은 자리의 전송 버튼이 이미 중지다. 키는 입력부의 초안 키와 같다.
  const hasDraft = useDraftFilled(draftKeyOf(shownConversation?.id ?? null, workspaceId))

  // 코드 칸의 대상 repo (FR-6) — 보는 대화의 뿌리 cwd, 새 대화면 입력부의 작업 디렉토리
  const target = paneTarget(shownConversation, newCwd, repos)
  const targetRepo = target.repo
  const opener = useMemo<CodePaneOpener | null>(() => (targetRepo
    ? {
      repoPath: targetRepo.path,
      open: (path, line) => {
        setPane('files')
        setOpenRequest({ path, line, nonce: ++openNonce.current })
      }
    }
    : null), [targetRepo])
  // 코드 칸 버튼 줄 (FR-1) — 대화 헤더 오른쪽 끝의 슬롯이다. 대상이 없으면 비활성이고 `title`이 이유를 말한다.
  // `disabled`가 아니라 `aria-disabled`다 — 비활성 버튼에는 title 풍선이 뜨지 않아 이유가 보이지 않는다.
  const paneButtons = (
    <button
      type="button"
      className={['pane-toggle', paneKind === 'files' && 'pane-toggle-on'].filter(Boolean).join(' ')}
      aria-pressed={paneKind === 'files'}
      aria-disabled={targetRepo ? undefined : true}
      title={targetRepo ? `${targetRepo.name}의 파일` : target.reason}
      onClick={() => { if (targetRepo) setPane(paneKind === 'files' ? null : 'files') }}
    >
      <IconFolder width="13" height="13" />
      파일
    </button>
  )

  return (
    <section
      className={['dock', open && 'dock-open', isMax && 'dock-max'].filter(Boolean).join(' ')}
      // 최대화하면 인라인 높이를 쓰지 않는다 — 본문 전체를 CSS(`.dock-max`)가 준다.
      {...(open && !isMax ? { style: { height } } : {})}
      onKeyDown={onKeyDown}
    >
      {/* 접힌 도크는 헤더뿐이라, 최대화한 도크는 본문 전체라 조절할 것이 없다. */}
      {open && !isMax && (
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
      {/* 헤더는 토글 · 슬롯 표시기 · 최대화다 (`docs/sdlc/conversation-timeline/` spec FR-37).
          대화 목록이 세로로 내려가면서 "대화가 늘면 슬롯 표시기가 화면 밖으로 밀려난다"는
          문제(3b 스펙 §7이 탭 스트립 밖에 표시기를 둔 이유)가 구조적으로 사라졌다.

          **취소는 여기 없다** (FR-29). 도는 턴은 대화 헤더의 `멈추기`, 입력부의 `중지`, 대화록 상태
          줄의 `실행 중인 턴 멈추기`가, 예약은 입력칸 위 칩의 `예약 취소`가, 슬롯을 기다리는 첫
          지시는 상태 줄의 `대기 취소`가 멈춘다 — 전부 아래 `cancel`을 탄다. lifecycle FR-24가 여기
          취소를 남긴 이유("대화록의 턴별 취소는 pending에만 있다")는 fixes FR-11로 사라졌다. */}
      <header className="dock-header">
        {/* 토글의 이름에 "실행"·"접기"를 넣지 않는다 (FR-37). 아이콘이 aria-hidden이라 글자가
            "실행"이면 이름이 정확히 "실행"이 되어 전송 버튼의 `{ name: '실행', exact: true }`와
            부딪히고, "접기"는 턴의 `접기`와 부분 일치로 부딪힌다. */}
        <button
          type="button"
          className="dock-toggle"
          aria-label={open ? '대화창 숨기기' : '대화창 보이기'}
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <IconChevronDown className="dock-toggle-icon" width="12" height="12" />
          대화
        </button>
        <SlotIndicator snapshot={queue} onChangeLimit={onChangeLimit} />
        {/* 한 단추가 번갈아 선다 — 누른 뒤에도 포커스가 같은 자리에 남아 Esc가 도크에 닿는다.
            되돌리는 이름을 "축소"라 하지 않는다: 패널의 `축소`(e2e가 exact로 잡는다)와 부분
            일치로 부딪힌다(FR-38). */}
        <button
          type="button"
          className="row-action dock-max-toggle"
          aria-label={isMax ? '대화창 원래 크기로' : '대화창 최대화'}
          title={isMax ? '대화창 원래 크기로 (Esc)' : '대화창 최대화'}
          onClick={toggleMaximized}
        >
          {isMax ? <IconCollapse /> : <IconMaximize />}
        </button>
      </header>

      {open && (
        <div className="dock-body">
          {shown && <div role="alert" className="form-error">{shown}</div>}
          <div className="dock-split">
            <ConversationList
              open={visibleOpen}
              closed={visibleClosed}
              sections={sections}
              collapsedSections={collapsedSections}
              onToggleSection={toggleSection}
              filterRepo={filterRepo}
              onClearFilter={onClearRepoFilter}
              selectedId={selected?.id ?? null}
              isNew={view === 'new'}
              repos={repos}
              showClosed={showClosed}
              renamingId={renaming?.where === 'list' ? renaming.id : null}
              expandedIssues={expandedIssues}
              onToggleIssue={toggleIssue}
              onPickNew={() => { setView('new'); setPickedId(null); setOpen(true) }}
              onPick={pick}
              onRename={(conv, title) => void renameConversation(conv, title)}
              onClose={(conv) => void closeConversation(conv)}
              onToggleClosed={() => setShowClosed(!showClosed)}
              onStartRename={(id) => setRenaming({ id, where: 'list' })}
              onCancelRename={() => setRenaming(null)}
            />
            {/* key로 대화가 바뀔 때마다 언마운트→재마운트시킨다. key가 없으면 목록에서
                다른 대화를 골라도 RunPanel 인스턴스가 그대로 남아 입력 중이던
                프롬프트·모델이 다른 대화로 따라간다 — 예전에는 로그 뷰로 가면 RunPanel
                자체가 안 그려져 저절로 초기화됐지만, 지금은 대화마다 같은 RunPanel이
                계속 떠 있어 그 안전장치가 사라졌다.

                **key는 초안의 키와 같다** — 대화 id, 새 대화면 `new:<workspaceId>`
                (`docs/sdlc/conversation-timeline/` spec FR-31). 늘 'new'면 새 대화 칸이
                workspace를 넘어 같은 인스턴스로 남아 옛 workspace의 오류·고른 값을 들고 간다.
                쓰던 지시는 인스턴스가 아니라 초안 스토어가 쥐므로 다시 마운트돼도 남는다.

                **대화 칸은 헤더 · 대화록 · 입력부이고 스크롤은 대화록만 한다** (FR-41) —
                `.dock-main`은 넘치지 않는다. 헤더는 여기서 그린다(plan 다듬은 것 5): 필요한 것
                (대화·이름 바꾸기·끝내기·멈추기)이 전부 여기 있어 prop을 한 겹 덜 내린다. */}
            <CodePaneContext.Provider value={opener}>
              <div className="dock-main">
                <ConversationHeader
                  conversation={shownConversation}
                  repos={repos}
                  renaming={shownConversation !== null
                    && renaming?.where === 'header' && renaming.id === shownConversation.id}
                  onStartRename={() => {
                    if (shownConversation) setRenaming({ id: shownConversation.id, where: 'header' })
                  }}
                  onRename={(title) => {
                    if (shownConversation) void renameConversation(shownConversation, title)
                  }}
                  onCancelRename={() => setRenaming(null)}
                  onClose={() => { if (shownConversation) void closeConversation(shownConversation) }}
                  onCancel={cancel}
                  hasDraft={hasDraft}
                  workspaceId={workspaceId}
                  pendingIssue={view === 'new' ? draftIssue : null}
                  onClearPendingIssue={onClearDraftIssue}
                  onOpenIssue={onOpenIssue}
                  onAssignIssue={(issueId) => {
                    if (shownConversation) void assignIssue(shownConversation, issueId)
                  }}
                  paneButtons={paneButtons}
                />
                <ConversationPanel
                  key={draftKeyOf(shownConversation?.id ?? null, workspaceId)}
                  conversation={shownConversation}
                  pendingIssue={view === 'new' ? draftIssue : null}
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
                  selectedRepoId={selectedRepoId}
                  onCwdChange={setNewCwd}
                />
              </div>
            </CodePaneContext.Provider>
          </div>
        </div>
      )}
      {/* 코드 칸 — 앱 창 오른쪽 끝의 위아래 전체 열에 그린다 (code-editor FR-2, 안 B). 도크 본문 밖이라 도크를 접어도
          남는다(FR-5). 대상은 그대로 도크가 보는 대화다. 자리가 없으면(도크를 혼자 그린 테스트) 서지 않는다. */}
      {paneKind === 'files' && paneSlot && createPortal(
        <>
          <div
            role="separator"
            aria-label="코드 칸 폭 조절"
            aria-orientation="vertical"
            tabIndex={0}
            className="code-pane-resizer"
            onPointerDown={(e) => {
              const pane = paneSlot.querySelector<HTMLElement>('.code-box')
              paneDrag.current = { startX: e.clientX, startWidth: pane?.getBoundingClientRect().width ?? 0 }
            }}
            onDoubleClick={() => { setPaneWidth(null); resetPaneWidth() }}
            onKeyDown={onResizerKey}
          />
          <div className="code-box" style={paneWidth !== null ? { width: paneWidth } : undefined}>
            {targetRepo
              ? (
                <FilePane
                  workspaceId={workspaceId}
                  repo={targetRepo}
                  openRequest={openRequest}
                  onClose={() => setPane(null)}
                />
              )
              : (
                <section className="code-pane code-pane-empty" aria-label="코드 칸">
                  <p className="code-pane-hint">{target.reason}</p>
                  <button type="button" onClick={() => setPane(null)}>코드 칸 닫기</button>
                </section>
              )}
          </div>
        </>,
        paneSlot
      )}
    </section>
  )
}
