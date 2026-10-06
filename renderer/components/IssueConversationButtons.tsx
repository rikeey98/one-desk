import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { IconChevronDown, IconPlus } from './icons'
import { RUN_STATUS_LABELS } from '../runStatus'
import type { Conversation } from '../conversation'

/** 목록 줄의 시각 — 날짜까지 보인다(이슈의 대화는 며칠에 걸쳐 쌓인다) */
function when(conv: Conversation): string {
  const at = conv.last.endedAt ?? conv.last.startedAt ?? conv.last.createdAt
  return new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 점은 도크 목록 줄과 같은 규칙이다 — 도는 턴이 먼저, 없으면 대표 턴 (conversation-timeline FR-45 다듬음) */
function shownStatus(conv: Conversation) {
  return (conv.active ?? conv.state).status
}

/**
 * 이슈 상세의 대화 단추 (`docs/sdlc/conversation-issue/` FR-13·FR-14).
 *
 * - **여는 단추** — 끝내지 않은 대화가 있으면 `대화 열기`(가장 최근 것), 없으면 `대화 시작`. **끝낸 대화는 보지 않는다** —
 *   "대화 끝내기 → 이슈에서 다시 시작"이 그대로 인수인계가 되려면 끝낸 대화만 남은 이슈는 `대화 시작`이어야 한다.
 * - **목록 단추 `▾`** — 그 이슈의 대화가 하나라도 있으면 선다. 끝내지 않은 것이 먼저, 끝낸 것이 뒤, 맨 아래
 *   `이 이슈로 새 대화`(agent 바꾸기·다시 시도).
 *
 * 메뉴는 대화 헤더의 `⋯` 메뉴와 같은 모양이다 — popover, ↑↓, **Esc는 여기서 멈춘다**(안 멈추면 같은 Esc가 App의
 * "열린 항목 닫기"까지 돌아 이슈 상세가 닫힌다).
 */
export function IssueConversationButtons({ conversations, onOpen, onStart }: {
  /** 그 이슈가 할당된 대화들. 마지막 턴 최신순 */
  conversations: Conversation[]
  onOpen: (conversation: Conversation) => void
  onStart: () => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const live = conversations.filter((c) => c.closedAt === null)
  const latest = live[0] ?? null
  const ordered = [...live, ...conversations.filter((c) => c.closedAt !== null)]

  useLayoutEffect(() => {
    if (!open) return
    menu.current?.togglePopover?.(true)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  // 바깥을 누르면 닫는다. 여는 단추는 안쪽이다 — 바깥으로 치면 누르는 순간 닫혔다가 click이 다시 연다.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: Event) {
      const target = e.target as Node | null
      if (target && (trigger.current?.contains(target) || menu.current?.contains(target))) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open])

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
      return
    }
    if (e.key === 'Tab') setOpen(false)
  }

  function pick(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <span className="issue-conv" onKeyDown={onKeyDown}>
      {latest
        ? (
          <button
            type="button"
            className="issue-conv-open"
            aria-label="이 이슈의 대화 열기"
            title={`${RUN_STATUS_LABELS[shownStatus(latest)]} · ${latest.title}`}
            onClick={() => onOpen(latest)}
          >
            {/* 상태는 이름에 넣지 않는다 — 이름이 상태마다 바뀌면 e2e가 상태마다 깨진다(spec NFR-5). title로 보인다. */}
            <span className={`status-dot status-${shownStatus(latest)}`} aria-hidden="true" />
            대화 열기
          </button>
        )
        : (
          <button type="button" className="issue-conv-open" aria-label="이 이슈로 대화 시작" onClick={onStart}>
            <IconPlus width="12" height="12" />
            대화 시작
          </button>
        )}
      {conversations.length > 0 && (
        <button
          ref={trigger}
          type="button"
          className="issue-conv-more"
          aria-label="이 이슈의 대화 목록"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <IconChevronDown width="11" height="11" />
          <span className="group-count">{conversations.length}</span>
        </button>
      )}
      {open && (
        <div ref={menu} role="menu" aria-label="이 이슈의 대화" className="issue-conv-menu" popover="manual">
          {ordered.map((conv) => {
            const status = shownStatus(conv)
            return (
              <button
                key={conv.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="issue-conv-item"
                title={conv.title}
                onClick={() => pick(() => onOpen(conv))}
              >
                <span className={`status-dot status-${status}`} aria-hidden="true" />
                <span className="issue-conv-item-text">
                  {RUN_STATUS_LABELS[status]} · {conv.runs.length}턴 · {when(conv)}
                  {conv.closedAt !== null && ' · 끝낸 대화'}
                  {conv.named && ` · ${conv.title}`}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="issue-conv-item issue-conv-new"
            onClick={() => pick(onStart)}
          >
            <IconPlus width="11" height="11" />
            이 이슈로 새 대화
          </button>
        </div>
      )}
    </span>
  )
}
