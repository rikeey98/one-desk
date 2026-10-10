import { useState, type ReactNode } from 'react'
import { inboxCategory, CATEGORY_LABELS, type InboxCategory } from '@shared/inbox'
import type { Run, Workspace } from '@shared/models'
import {
  groupByStatus, groupByWorkspace, readInboxCollapsed, readInboxView, sortInbox, sourceLabel, writeInboxCollapsed, writeInboxView,
  type InboxMode, type InboxOrder, type InboxView, type ReposByWorkspace
} from '../inboxView'
import { IconArrowDown, IconChevronRight } from './icons'

/** 지시의 첫 줄만. 목록에서는 그것으로 충분하다. */
function label(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || '(빈 지시)'
}

function when(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toLocaleString('ko-KR')
}

/** 카테고리마다 다음 수를 미리 제시한다 (설계 §5). */
function shows(category: InboxCategory, action: 'open' | 'restart' | 'confirm' | 'archive' | 'makeIssue'): boolean {
  switch (action) {
    // 대화창이 로그와 이어서 실행을 함께 주므로 "대화 열기" 하나로 충분하다
    // (설계 §5 — 옛 "로그 보기"·"이어서 실행" 두 조건의 합집합). dropped라고
    // 예외로 숨기지 않는다 — 항목은 run이 아니라 대화이고, 대표 턴이 시작
    // 전에 취소됐어도(모든 턴이 그랬을 때만 그렇다 — representativeTurn) 대화록이 있다. 1턴짜리 대화가 시작도 못
    // 하고 dropped됐다면 열었을 때 Transcript의 pending 이른 반환은 걸리지
    // 않는다 — 그건 status === 'pending'에만 걸리고 취소된 턴은 이미
    // 'canceled'다. 대신 사용자 프롬프트와 "canceled" 상태 칩이 그려진다
    // (빈 대화록이 아니다). 그래도 열 수 있게 하는 편이 아예 못 여는 것보다
    // 낫다 (리뷰 I-3).
    case 'open': return true
    case 'restart': return category === 'failed' || category === 'interrupted' || category === 'dropped'
    case 'confirm': return category === 'done'
    case 'archive': return category !== 'done'
    case 'makeIssue': return category === 'failed'
  }
}

const MODE_LABELS: ReadonlyArray<[InboxMode, string]> = [['time', '시간순'], ['workspace', 'workspace별'], ['status', '상태별']]
const ORDER_LABELS: Record<InboxOrder, string> = { desc: '최신 먼저', asc: '오래된 먼저' }

interface ItemActions {
  onReview: (run: Run, kind: 'confirmed' | 'archived') => void
  onOpenConversation: (run: Run) => void
  onRestart: (run: Run) => void
  onCloseIssue: (run: Run, issueId: string) => void
  onMakeIssue: (run: Run) => void
}

/**
 * 항목 카드 하나. 머리에 무엇을 보일지는 보기가 정한다 (`docs/sdlc/inbox-views/` FR-9·11) — 묶음 머리가 이미 말하는 것은
 * 뺀다. 몸통과 행동은 보기와 무관하다(FR-18).
 */
function InboxItem({ run, showCategory, source, actions }: {
  run: Run
  showCategory: boolean
  /** 소속(`workspace · repo`). null이면 머리에서 뺀다 */
  source: string | null
  actions: ItemActions
}) {
  const category = inboxCategory(run)
  const issueIds = run.contextItems.filter((c) => c.type === 'issue').map((c) => c.id)
  return (
    <li className="inbox-item">
      <div className="inbox-head">
        {showCategory && <span className={`status status-${run.status}`}>{CATEGORY_LABELS[category]}</span>}
        {/* 전역 목록이라 어느 workspace 것인지가 없으면 맥락이 사라진다. */}
        {source !== null && <span className="inbox-ws">{source}</span>}
        <span className="inbox-when">{when(run.endedAt)}</span>
      </div>
      <div className="inbox-prompt">{label(run)}</div>
      {run.errorMessage && <div className="inbox-error">{run.errorMessage}</div>}
      <div className="inbox-actions">
        {shows(category, 'open') && (
          <button type="button" onClick={() => actions.onOpenConversation(run)}>
            대화 열기
          </button>
        )}
        {shows(category, 'restart') && (
          <button type="button" onClick={() => actions.onRestart(run)}>다시 실행</button>
        )}
        {shows(category, 'makeIssue') && (
          <button type="button" onClick={() => actions.onMakeIssue(run)}>이슈로 만들기</button>
        )}
        {issueIds.map((id) => (
          <button key={id} type="button" onClick={() => actions.onCloseIssue(run, id)}>
            관련 이슈 닫기
          </button>
        ))}
        {shows(category, 'confirm') && (
          <button type="button" onClick={() => actions.onReview(run, 'confirmed')}>확인함</button>
        )}
        {shows(category, 'archive') && (
          <button type="button" onClick={() => actions.onReview(run, 'archived')}>보관</button>
        )}
      </div>
    </li>
  )
}

/**
 * 묶음 하나 — 머리와, 펼쳐 있으면 그 안 (FR-12·13). 머리를 누르면 접고 편다 — 항목을 열지 않는다. 이름은 `<이름> 묶음`
 * — "접기/펼치기"를 이름에 넣지 않는다(턴의 `접기`와 부분 일치로 부딪힌다, CLAUDE.md). 도크의 repo 구획 머리와 같은 규칙이다.
 */
function InboxGroup({ groupKey, label, name, title, count, needsAnswer, level, collapsed, onToggle, children }: {
  groupKey: string
  label: string
  /** 접근성 이름 — `<이름> 묶음` */
  name: string
  title?: string
  count: number
  /** 접혔을 때 `답변 필요` 표식을 보일지 */
  needsAnswer: boolean
  level: 'top' | 'sub'
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
  children: ReactNode
}) {
  const isCollapsed = collapsed.has(groupKey)
  return (
    <li className={`inbox-group inbox-group-${level}`}>
      <button
        type="button"
        className="inbox-group-head"
        aria-expanded={!isCollapsed}
        aria-label={name}
        title={title}
        onClick={() => onToggle(groupKey)}
      >
        <IconChevronRight className="inbox-group-chevron" width="11" height="11" />
        <span className="inbox-group-name">{label}</span>
        <span className="group-count">{count}</span>
        {isCollapsed && needsAnswer && <span className="needs-answer">답변 필요</span>}
      </button>
      {!isCollapsed && children}
    </li>
  )
}

export function InboxPanel({
  items, workspaces, reposByWorkspace, error, onReview, onOpenConversation, onRestart, onCloseIssue, onMakeIssue
}: {
  items: Run[]
  workspaces: Workspace[]
  /**
   * workspace id → 그 workspace의 repo (FR-16). App이 인박스가 열려 있을 때 workspace마다 읽어 내린다 — **필수다**:
   * 선택이면 App의 한 줄을 지워도 조용히 컴파일되고 모든 항목이 `기타`로 간다.
   */
  reposByWorkspace: ReposByWorkspace
  error: string | null
} & ItemActions) {
  // 보기·정렬·접힘은 보기 취향이라 이 장비에 남는다 (FR-3·14). 인박스는 화면을 옮길 때마다 다시 마운트되므로 저장소에서 연다.
  const [view, setView] = useState<InboxView>(readInboxView)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readInboxCollapsed)
  const actions: ItemActions = { onReview, onOpenConversation, onRestart, onCloseIssue, onMakeIssue }

  function changeView(next: InboxView) {
    setView(next)
    writeInboxView(next)
  }

  function toggle(key: string) {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
    writeInboxCollapsed(next)
  }

  const source = (run: Run) => sourceLabel(run, workspaces, reposByWorkspace)

  function list(runs: readonly Run[], show: { category: boolean; source: boolean }) {
    return (
      <ul className="inbox-list">
        {runs.map((run) => (
          <InboxItem
            key={run.id}
            run={run}
            showCategory={show.category}
            source={show.source ? source(run) : null}
            actions={actions}
          />
        ))}
      </ul>
    )
  }

  function body() {
    if (view.mode === 'time') return list(sortInbox(items, view.order), { category: true, source: true })
    if (view.mode === 'workspace') {
      return (
        <ul className="inbox-groups">
          {groupByWorkspace(items, view.order, workspaces, reposByWorkspace).map((ws) => (
            <InboxGroup
              key={ws.key} groupKey={ws.key} label={ws.label} name={`${ws.label} 묶음`} count={ws.count}
              needsAnswer={ws.needsAnswer} level="top" collapsed={collapsed} onToggle={toggle}
            >
              <ul className="inbox-groups">
                {ws.repos.map((r) => (
                  <InboxGroup
                    key={r.key} groupKey={r.key} label={r.label} name={`${ws.label} · ${r.label} 묶음`}
                    title={r.repo?.path ?? '등록하지 않은 경로에서 나눈 대화'} count={r.items.length}
                    needsAnswer={r.needsAnswer} level="sub" collapsed={collapsed} onToggle={toggle}
                  >
                    {list(r.items, { category: true, source: false })}
                  </InboxGroup>
                ))}
              </ul>
            </InboxGroup>
          ))}
        </ul>
      )
    }
    return (
      <ul className="inbox-groups">
        {groupByStatus(items, view.order).map((g) => (
          <InboxGroup
            key={g.key} groupKey={g.key} label={g.label} name={`${g.label} 묶음`} count={g.items.length}
            // 답변 필요 묶음은 이름이 곧 그것이고, 다른 카테고리 묶음에는 답변 필요가 들 수 없다
            needsAnswer={false} level="top" collapsed={collapsed} onToggle={toggle}
          >
            {list(g.items, { category: false, source: true })}
          </InboxGroup>
        ))}
      </ul>
    )
  }

  return (
    <section className="inbox">
      {error && <div role="alert" className="form-error">{error}</div>}
      {items.length === 0 && !error && (
        <div className="panel-empty">처리할 결과가 없습니다</div>
      )}
      {items.length > 0 && (
        <div className="inbox-toolbar">
          <div className="inbox-mode" role="group" aria-label="인박스 보기">
            {MODE_LABELS.map(([mode, text]) => (
              <button
                key={mode}
                type="button"
                className="inbox-mode-button"
                aria-pressed={view.mode === mode}
                onClick={() => changeView({ ...view, mode })}
              >
                {text}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="inbox-order"
            data-order={view.order}
            aria-label={`정렬: ${ORDER_LABELS[view.order]}`}
            title="누르면 순서를 뒤집습니다 — 기준은 대화가 끝난 시각"
            onClick={() => changeView({ ...view, order: view.order === 'desc' ? 'asc' : 'desc' })}
          >
            <IconArrowDown width="12" height="12" />
            {ORDER_LABELS[view.order]}
          </button>
        </div>
      )}
      {items.length > 0 && body()}
    </section>
  )
}
