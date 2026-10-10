import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { RenameField } from './RenameField'
import { repoLabel } from './ConversationList'
import { IssuePicker } from './IssuePicker'
import { IconClose, IconExternalLink, IconMore, IconStop } from './icons'
import { AGENT_LABELS } from '../agents'
import { contextOf, type Conversation } from '../conversation'
import { contextPercent, conversationUsage, formatContext, type ConversationUsage } from '../usage'
import type { AssignedIssue, ContextItemType, Repo } from '@shared/models'

/** 담긴 항목의 종류 이름. asset의 skill·agent 구분은 이번 범위 밖이다 (conversation-context spec). */
const TYPE_LABELS: Record<ContextItemType, string> = {
  repo: 'repo', issue: '이슈', memo: '메모', asset: 'asset', file: '파일'
}

/** 링이 경고 색으로 바뀌는 점유 (spec FR-36) */
const WARN_RATIO = 0.8

/**
 * 채움 호의 최소 길이(px, 둥근 끝을 빼고). 5%면 채움이 2px 점 하나라 링이 스피너와 구별되지 않았다
 * (spec §8의 2, 결정 2026-09-27). 끝이 둥글어 보이는 길이는 이것 + 선 굵기(2px)다 — 점이 아니라 짧은
 * 호로 읽히는 길이. 정확한 값은 곁의 퍼센트 글자가 말한다.
 */
const MIN_ARC = 3

/**
 * 열린 오버레이를 바깥 누르기로 닫는다. 오버레이와 그것을 여는 단추는 **안쪽**이다 — 단추를
 * 바깥으로 치면 누르는 순간 닫혔다가 click이 다시 열어 닫히지 않는 메뉴가 된다.
 */
function useDismissOnOutside(
  open: boolean, inside: readonly RefObject<HTMLElement | null>[], onDismiss: () => void
) {
  const latest = useRef(onDismiss)
  latest.current = onDismiss
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: Event) {
      const target = e.target as Node | null
      if (target && inside.some((ref) => ref.current?.contains(target))) return
      latest.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open, inside])
}

/**
 * `⋯` 메뉴 (spec FR-35) — 이름 바꾸기·대화 끝내기. popover(최상위 레이어)와 anchor
 * positioning으로 단추 아래에 뜬다(DESIGN.md 오버레이 규칙) — 도크 본문의 overflow에
 * 잘리지 않는다. jsdom에는 `togglePopover`가 없어 옵셔널로 부른다(CommandPicker와 같다).
 *
 * **Esc는 여기서 멈춘다**(`preventDefault` + `stopPropagation`). 안쪽부터 푼다 — 같은 Esc에
 * 도크 최대화(Dock의 onKeyDown, FR-39)나 열린 항목 닫기(App의 document 리스너)까지 풀리면
 * 안 된다. 메뉴가 닫혀 있으면 아무것도 삼키지 않는다.
 */
function ConversationMenu({ canClose, onRename, onClose, assigned, onPickIssue, onUnassign }: {
  canClose: boolean
  onRename: () => void
  onClose: () => void
  /** 할당된 이슈가 있는가 — `이슈 할당`이 `이슈 바꾸기`가 되고 `이슈 할당 해제`가 선다 (conversation-issue FR-21) */
  assigned: boolean
  onPickIssue: () => void
  onUnassign: () => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const inside = useRef([trigger, menu] as const).current
  const menuId = useId()

  useDismissOnOutside(open, inside, () => setOpen(false))

  // 열리면 최상위 레이어에 올리고 첫 항목으로 포커스를 옮긴다 — 키보드로 연 사람이 곧바로
  // ↑↓를 쓸 수 있어야 한다. 그리기 전에 올린다: 닫힌 popover는 UA가 숨기므로 effect면 한
  // 프레임 늦게 뜬다. 닫는 것은 언마운트가 맡는다.
  useLayoutEffect(() => {
    if (!open) return
    menu.current?.togglePopover?.(true)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  function items(): HTMLElement[] {
    return [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      // 포커스가 사라지는 메뉴와 함께 없어지지 않게 단추로 돌려놓는다.
      trigger.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const list = items()
      if (list.length === 0) return
      const at = list.indexOf(document.activeElement as HTMLElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      list[(at + step + list.length) % list.length]?.focus()
      return
    }
    // Tab으로 메뉴를 벗어나면 닫는다 — 열린 채로 남은 메뉴가 다음 요소를 가린다.
    if (e.key === 'Tab') setOpen(false)
  }

  function pick(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <span className="conv-menu-wrap" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="row-action conv-menu-button"
        aria-label="대화 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <IconMore />
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label="대화 메뉴" className="conv-menu" popover="manual">
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick(onRename)}>
            이름 바꾸기
          </button>
          {/* 할당 (conversation-issue FR-21). 확인 단계가 없다 — 지우는 것이 없고 되돌리기가 한 번이다. */}
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick(onPickIssue)}>
            {assigned ? '이슈 바꾸기' : '이슈 할당'}
          </button>
          {assigned && (
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick(onUnassign)}>
              이슈 할당 해제
            </button>
          )}
          {/* 끝낸 대화에는 끝내기가 없다 (lifecycle FR-22) — 이름은 여전히 고칠 수 있다. */}
          {canClose && (
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick(onClose)}>
              대화 끝내기
            </button>
          )}
        </div>
      )}
    </span>
  )
}

/**
 * 컨텍스트 링 (FR-36) — 점유를 아는 마지막 턴의 점유 ÷ 창. 아이콘이 아니라 **값을 그리는 계기**라
 * `icons.tsx`에 두지 않는다. 뜻은 감싸는 단추의 이름이 말하므로 aria-hidden이다.
 *
 * 채움은 12시에서 시작하는 호 하나다(`dasharray`의 첫 칸이 호 길이). 끝이 둥글고, 낮은 점유에도
 * `MIN_ARC`보다 짧아지지 않는다 — 점 하나는 스피너로 읽힌다(spec §8의 2).
 */
function ContextRing({ ratio }: { ratio: number }) {
  const r = 7
  const length = 2 * Math.PI * r
  const filled = Math.min(1, Math.max(0, ratio))
  const arc = Math.min(length, Math.max(MIN_ARC, length * filled))
  return (
    <svg
      className={ratio > WARN_RATIO ? 'conv-ring conv-ring-warn' : 'conv-ring'}
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
    >
      <circle className="conv-ring-track" cx="9" cy="9" r={r} fill="none" strokeWidth="2" />
      <circle
        className="conv-ring-fill"
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${length}`}
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}

/** 팝오버의 한 줄. 모르는 값은 줄째 뺀다 — 0으로 채우면 "안 썼다"는 거짓말이 된다(run-info FR-2). */
function row(label: string, value: ReactNode | null) {
  if (value === null) return null
  return <div className="conv-usage-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>
}

/**
 * 링(또는 글자)과 누적 사용량 팝오버 (FR-36).
 *
 * **비용은 누를 때만 보인다** — 화면에 돈을 상시 띄우지 않는다(run-info FR-4). 이름은
 * `사용량, ` + 지금 점유다: 무엇을 여는지와 지금 값을 함께 말한다.
 */
function UsageButton({ usage }: { usage: ConversationUsage }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const inside = useRef([trigger, popover] as const).current
  const popoverId = useId()

  useDismissOnOutside(open, inside, () => setOpen(false))
  useLayoutEffect(() => {
    if (open) popover.current?.togglePopover?.(true)
  }, [open])

  const { contextTokens, contextWindow } = usage
  const context = formatContext(contextTokens, contextWindow)
  // 링 곁의 글자(spec §8의 2) — 이름의 비율과 같은 함수라 화면과 스크린리더가 같은 수를 말한다.
  const percent = contextPercent(contextTokens, contextWindow)
  const knowsWindow = contextTokens !== null && contextWindow !== null && contextWindow > 0
  const n = (value: number | null) => (value === null ? null : value.toLocaleString('en-US'))

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!open || e.key !== 'Escape') return
    // 안쪽부터 푼다 — 메뉴와 같은 이유(FR-35·FR-39).
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <span className="conv-usage-wrap" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="conv-usage-button"
        aria-label={context ? `사용량, ${context}` : '사용량'}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen(!open)}
      >
        {/* 창을 모르면(OpenCode) 비율을 그릴 수 없다 — 링 대신 토큰 수 글자다. 알면 링 곁에
            퍼센트 글자를 둔다 — 낮은 점유의 링은 짧은 호라 값을 읽기 어렵다(spec §8의 2). */}
        {knowsWindow
          ? (
            <>
              <ContextRing ratio={contextTokens / contextWindow} />
              <span className="conv-usage-text">{percent}</span>
            </>
          )
          : <span className="conv-usage-text">{context ?? '사용량'}</span>}
      </button>
      {open && (
        <div
          ref={popover}
          id={popoverId}
          role="dialog"
          aria-label="이 대화의 누적 사용량"
          className="conv-usage"
          popover="manual"
        >
          <div className="conv-usage-title">이 대화의 누적 사용량</div>
          <dl>
            {row('입력', n(usage.inputTokens))}
            {row('출력', n(usage.outputTokens))}
            {row('캐시 읽기', n(usage.cacheReadTokens))}
            {row('캐시 쓰기', n(usage.cacheWriteTokens))}
            {row('추정 비용', usage.costUsd === null ? null : (
              <>
                {`$${usage.costUsd.toFixed(4)}`}
                <span className="conv-usage-note">정가 기준 추정</span>
              </>
            ))}
            {/* 점유는 더하지 않는다 — 마지막으로 안 턴의 프롬프트 크기다(CLAUDE.md). */}
            {row('마지막 턴 컨텍스트', contextTokens === null ? null
              : knowsWindow ? `${n(contextTokens)} / ${n(contextWindow)}` : n(contextTokens))}
          </dl>
        </div>
      )}
    </span>
  )
}

/**
 * 대화 헤더 (`docs/sdlc/conversation-timeline/` spec FR-33~FR-36, FR-29).
 *
 * 대화 칸 맨 위에 고정된다 — 대화록만 스크롤한다(FR-41). 왼쪽은 제목과 `⋯`, 그 아래 부제,
 * 오른쪽은 멈추기(도는 턴이 있을 때)와 컨텍스트 링. 둘째 줄은 이 대화에 담긴 것이다.
 *
 * **state는 메뉴·팝오버 열림뿐이다.** 이름 편집 여부는 Dock이 쥔다(`renaming`) — 목록 줄의
 * 편집과 **한 state**라 두 자리에서 같은 대화를 동시에 고치는 상태가 생기지 않는다(FR-34).
 */
export function ConversationHeader({
  conversation, repos, renaming, onStartRename, onRename, onCancelRename, onClose, onCancel, hasDraft,
  // 개발 버전: 선택 prop이다 — plan에서 필수로 올린다 (conversation-issue spec §7).
  workspaceId = '', pendingIssue = null, onClearPendingIssue = () => {}, onOpenIssue = () => {},
  onAssignIssue = () => {}
}: {
  /** null이면 새 대화다 — 제목 "새 대화"만 있고 메뉴·링이 없다 */
  conversation: Conversation | null
  repos: Repo[]
  /** 제목 자리에서 이름을 고치는 중인가 — Dock의 `renaming`이 헤더를 가리킬 때만 true */
  renaming: boolean
  onStartRename: () => void
  /** 빈 문자열이면 붙인 이름을 뗀다(fixes FR-21) */
  onRename: (title: string) => void
  onCancelRename: () => void
  /** 대화 끝내기 (lifecycle FR-12) */
  onClose: () => void
  /** 멈추기 — 도크의 `cancel`이다(실패하면 도크 배너로 보인다) */
  onCancel: (runId: string) => void
  /**
   * 이 대화의 입력칸에 보낼 것이 있는가 — `멈추기`는 그때만 선다(spec §8의 3). **필수다** — 선택
   * 인자면 도크의 배선 한 줄을 빠뜨려도 조용히 컴파일되고, 멈추기가 영영 안 서거나 늘 선다.
   */
  hasDraft: boolean
  /** 이슈 고르기가 읽을 workspace (conversation-issue FR-21) */
  workspaceId?: string
  /** 새 대화 칸에 걸린 할당 예정 이슈 (FR-20). 새 대화일 때만 의미가 있다 */
  pendingIssue?: AssignedIssue | null
  onClearPendingIssue?: () => void
  /** 할당된 이슈 상세를 연다 (FR-21) */
  onOpenIssue?: (issueId: string) => void
  /** 할당을 바꾼다. null이면 뗀다 (FR-21) */
  onAssignIssue?: (issueId: string | null) => void
}) {
  const [picking, setPicking] = useState(false)
  // 헤더는 대화가 바뀌어도 다시 마운트되지 않는다 — 열어 둔 이슈 고르기가 다른 대화로 따라가지 않게 닫는다.
  const conversationId = conversation?.id ?? null
  useEffect(() => { setPicking(false) }, [conversationId])

  if (!conversation) {
    return (
      <header className="conv-header">
        <div className="conv-header-top">
          <div className="conv-heading">
            <div className="conv-title-line">
              <span className="conv-title">새 대화</span>
            </div>
            {/* 할당 예정 (FR-20) — 첫 턴을 보내면 할당이 된다. */}
            {pendingIssue && (
              <div className="conv-sub-line">
                <span className="conv-pending-issue" title={pendingIssue.title}>이슈 · {pendingIssue.title}</span>
                <button
                  type="button"
                  className="row-action"
                  aria-label="이슈 할당 해제"
                  title="이슈 할당 해제"
                  onClick={onClearPendingIssue}
                >
                  <IconClose width="11" height="11" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    )
  }
  const issue = conversation.issue

  // 도는 턴 — 대화의 활성 턴 중 running이다(conversation-fixes FR-3). 예약은 겨누지 않는다:
  // 예약은 입력칸 위 칩의 `예약 취소`가 거둔다(FR-30).
  const running = conversation.active?.status === 'running' ? conversation.active : null
  // 멈추기는 **초안이 있을 때만** 선다 (spec §8의 3, 결정 2026-09-27). 입력칸이 비면 같은 자리의
  // 전송 버튼이 중지라, 헤더까지 서면 도는 턴 하나에 멈추기가 셋이었다(상태 줄 · 헤더 · 입력부).
  // 이 버튼이 있어야 하는 이유(FR-29 — 초안이 있어 전송이 실행이고 상태 줄이 화면 밖)는 초안이
  // 있을 때뿐이다. 그래서 입력부의 중지와 번갈아 서고, 상태 줄의 멈추기는 늘 있다.
  const stopTarget = running && hasDraft ? running : null
  const usage = conversationUsage(conversation.runs)
  const applied = contextOf(conversation)
  const appliedTexts = applied.map((item) => `${TYPE_LABELS[item.type]} · ${item.label}`)
  // 부제는 **한 덩어리 글자**다 — 조각을 따로 그리면 repo 이름만 담은 요소가 생겨, repo 이름을
  // exact로 찾는 셀렉터(목록 카드·옵션)와 부딪힌다.
  const sub = [
    AGENT_LABELS[conversation.last.agentKind],
    repoLabel(conversation, repos),
    ...(conversation.closedAt !== null ? ['끝낸 대화'] : [])
  ].join(' · ')

  return (
    <header className="conv-header">
      <div className="conv-header-top">
        <div className="conv-heading">
          <div className="conv-title-line">
            {renaming
              ? (
                // 비워서 저장하면 붙인 이름을 떼고 파생 제목으로 돌아간다 (fixes FR-21).
                <RenameField
                  initial={conversation.named ? conversation.title : ''}
                  label={`${conversation.title} 새 이름`}
                  allowEmpty
                  onSubmit={onRename}
                  onCancel={onCancelRename}
                />
              )
              : (
                // **버튼이 아니다** (FR-34). 제목과 같은 이름의 버튼이 생기면 이슈 줄
                // (`{ name: <이슈 이름>, exact: true }`)과 부딪힌다 — 대화 제목은 담은 이슈의
                // 이름이다. 키보드 경로는 메뉴의 `이름 바꾸기`다.
                <span className="conv-title" title="눌러서 이름 바꾸기" onClick={onStartRename}>
                  {conversation.title}
                </span>
              )}
            <ConversationMenu
              canClose={conversation.closedAt === null}
              onRename={onStartRename}
              onClose={onClose}
              assigned={issue !== null}
              onPickIssue={() => setPicking(true)}
              onUnassign={() => onAssignIssue(null)}
            />
            {picking && (
              <IssuePicker
                workspaceId={workspaceId || conversation.last.workspaceId}
                currentId={issue?.id ?? null}
                onPick={(id) => { setPicking(false); onAssignIssue(id) }}
                onClose={() => setPicking(false)}
              />
            )}
          </div>
          <div className="conv-sub-line">
            <div className="conv-sub" title={sub}>{sub}</div>
            {/* 할당된 이슈로 가는 길 (FR-21). 이름이 이슈 제목만이면 이슈 목록 줄(exact)과 부딪힌다(FR-23). 제목이 이미
                이슈 이름이면 글자는 `이슈`뿐이다 — 같은 이름을 두 번 보이지 않는다. */}
            {issue && (
              <button
                type="button"
                className="conv-issue-link"
                aria-label="할당된 이슈 열기"
                title={`이슈 · ${issue.title}`}
                onClick={() => onOpenIssue(issue.id)}
              >
                <IconExternalLink width="11" height="11" />
                {conversation.title === issue.title ? '이슈' : `이슈 · ${issue.title}`}
              </button>
            )}
          </div>
        </div>
        <div className="conv-header-side">
          {/* 멈추는 세 자리 중 하나 (FR-29) — 입력칸에 초안이 있어 전송 버튼이 실행이고, 대화록을
              위로 올려 상태 줄이 화면 밖이어도 여기서 한 번에 멈춘다. 그래서 초안이 있을 때만 선다
              (위 `stopTarget`). 이름에 "취소"를 넣지 않는다 — 예약의 `예약 취소`·첫 지시의
              `대기 취소`와 부분 일치로도 겹치지 않게. */}
          {stopTarget && (
            <button
              type="button"
              className="conv-stop"
              aria-label="이 대화의 실행 멈추기"
              onClick={() => onCancel(stopTarget.id)}
            >
              <IconStop width="12" height="12" />
              멈추기
            </button>
          )}
          {usage && <UsageButton usage={usage} />}
        </div>
      </div>
      {/* 이 대화가 이미 받은 것. 입력 카드의 칩 줄("이번 턴에 담을 것")과 짝을 이룬다 —
          실행하면 칩은 비워지지만(설계 §4-1) 대화는 그것을 기억하고 있다. 보기 전용이고,
          한 줄이라 넘치면 잘린다 — 전체는 줄의 title로 읽는다. */}
      {applied.length > 0 && (
        <div className="applied-context" title={appliedTexts.join(', ')}>
          <span className="applied-label">이 대화에 담긴 것</span>
          {applied.map((item, i) => (
            <span className="applied-chip" key={`${item.type}:${item.id}`} title={appliedTexts[i]}>
              {appliedTexts[i]}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
