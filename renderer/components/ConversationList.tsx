import { RenameField } from './RenameField'
import { IconCheck, IconChevronRight, IconPencil, IconPlus } from './icons'
import { RUN_STATUS_LABELS } from '../runStatus'
import { foldByIssue, titleOf, type Conversation } from '../conversation'
import type { Repo } from '@shared/models'

/** 좁은 칸이라 날짜는 버린다 — 같은 대화를 며칠에 걸쳐 이어가는 일은 드물다. */
function when(conv: Conversation): string {
  const at = conv.last.endedAt ?? conv.last.startedAt ?? conv.last.createdAt
  return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * 그 대화가 어느 repo에서 돌았는지. 등록된 repo면 이름을, 아니면 경로의 마지막
 * 칸을 보여준다 — 임의 디렉토리에서도 실행할 수 있으므로 "없음"으로 비우지 않는다.
 * 대화 헤더의 부제도 같은 이름을 쓴다(`docs/sdlc/conversation-timeline/` spec FR-33) —
 * 목록 줄과 헤더가 같은 대화의 repo를 다른 말로 부르면 안 된다.
 */
export function repoLabel(conv: Conversation, repos: Repo[]): string {
  const matched = repos.find((r) => r.path === conv.last.cwd)
  if (matched) return matched.name
  const parts = conv.last.cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? conv.last.cwd
}

/**
 * 대화 목록의 한 줄.
 *
 * 줄 끝 아이콘은 평소 폭 0이고 hover·포커스에만 펼쳐진다(`.ws-actions`와 같은 패턴).
 * 겹쳐 두면 제목 가운데를 누르는 클릭을 아이콘이 가로챈다 — repo 줄에서 실측된 것이다.
 */
function Row({ conv, label = conv.title, nested = false, selected, repos, onPick, onRename, onClose, renaming, onStartRename, onCancelRename }: {
  conv: Conversation
  /** 줄에 보이는 이름. 이슈 묶음 안에서는 제목이 전부 이슈 이름이라 다른 것을 보인다 */
  label?: string
  /** 이슈 묶음 안의 줄인가 — 들여 쓴다 */
  nested?: boolean
  selected: boolean
  repos: Repo[]
  onPick: (conv: Conversation) => void
  onRename: (conv: Conversation, title: string) => void
  onClose: (conv: Conversation) => void
  renaming: boolean
  onStartRename: (id: string) => void
  onCancelRename: () => void
}) {
  if (renaming) {
    return (
      <li className={nested ? 'dock-conv-row dock-conv-nested' : 'dock-conv-row'}>
        {/* 비워서 저장하면 붙인 이름을 떼고 파생 제목으로 돌아간다 (FR-21). */}
        <RenameField
          initial={conv.named ? conv.title : ''}
          label={`${label} 새 이름`}
          allowEmpty
          onSubmit={(title) => onRename(conv, title)}
          onCancel={onCancelRename}
        />
      </li>
    )
  }

  // 점의 색·이름·툴팁이 **한 값**에서 나온다 — 따로 적으면 색만 다른 턴을 볼 수 있다.
  //
  // **도는 턴이 먼저다**(`conv.active ?? conv.state`, 2026-09-27 결정 —
  // docs/sdlc/conversation-timeline/ spec FR-45 다듬음). 대표 턴(`state`)만 그리면 앞 턴이
  // 도는 동안 이어 보낸 예약이 점을 "대기 중"으로 만든다 — 대화 헤더와 대화록은 실행 중이라고
  // 말하는데 목록만 기다린다고 한다. **표시만 그렇다**: 답변 필요 표시와 자동 확인은 계속
  // 대표 턴을 본다(conversation-fixes FR-3) — 배지(core)가 세는 턴과 같아야 한다.
  const status = (conv.active ?? conv.state).status

  return (
    <li className={nested ? 'dock-conv-row dock-conv-nested' : 'dock-conv-row'}>
      <button
        type="button"
        className={selected ? 'dock-conv dock-conv-selected' : 'dock-conv'}
        onClick={() => onPick(conv)}
      >
        <span className="dock-conv-top">
          {/* **글자 없이 점만.** 좁은 레일에서 상태 단어가 제목을 밀어낸다 — 여기서
              중요한 것은 제목이다(2026-09-23 사용자 결정). 이름은 role="img"+aria-label로
              남고, 글자로 된 상태 알약은 대화록의 턴마다 그대로 보인다. 이름은 한국어 한
              표에서 온다(docs/sdlc/conversation-timeline/ spec FR-45) — 클래스는 enum
              그대로다: 색과 e2e(`e2e/dock.ts`)가 거기 걸려 있다.
              **마지막 턴이 아니다** — 시작도 못 하고 취소된 예약이 앞 턴의 실패·답변 필요를
              가리면 배지(core)와 줄이 다른 것을 말한다(docs/sdlc/conversation-fixes/ spec FR-3). */}
          <span
            className={`status-dot status-${status}`}
            role="img"
            aria-label={RUN_STATUS_LABELS[status]}
            title={RUN_STATUS_LABELS[status]}
          />
          {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. 배지가 없으면
              구분이 안 된다 — 이것만은 글자로 남긴다. */}
          {conv.state.needsAnswer && <span className="needs-answer">답변 필요</span>}
          {/* 잘린 제목은 호버로 읽는다. */}
          <span className="dock-conv-title" title={label}>{label}</span>
        </span>
        <span className="dock-conv-meta">
          {repoLabel(conv, repos)} · {conv.runs.length}턴 · {when(conv)}
        </span>
      </button>
      <span className="dock-conv-actions">
        <button
          type="button"
          className="row-action"
          aria-label={`${label} 이름 바꾸기`}
          onClick={() => onStartRename(conv.id)}
        >
          <IconPencil />
        </button>
        {/* 끝낸 대화에는 끝내기가 없다 (spec FR-22) — 이름은 여전히 고칠 수 있다. */}
        {conv.closedAt === null && (
          <button
            type="button"
            className="row-action"
            aria-label={`${label} 대화 끝내기`}
            onClick={() => onClose(conv)}
          >
            <IconCheck />
          </button>
        )}
      </span>
    </li>
  )
}

/**
 * 이슈 줄 — 대화가 둘 이상인 이슈를 접은 한 줄 (`docs/sdlc/conversation-issue/` FR-28).
 *
 * 누르면 펼치고 접는다 — 대화를 열지 않는다(어느 대화를 열지 모른다). 점은 묶음에서 도는 대화가 있으면 그것, 없으면
 * 가장 최근 대화의 것이다(목록 줄과 같은 `active ?? state`). 답변 필요는 하나라도 있으면 선다 — 접혀 있어도 놓치지 않게.
 * 접힌 채로 그 안의 대화를 보고 있으면 이 줄이 선택된 것으로 보인다.
 *
 * 이름은 이슈 제목만이 아니다(`<제목> 대화 N개`) — 이슈 목록 줄을 `{ name: <제목>, exact: true }`로 잡는 e2e와 갈린다(FR-23).
 */
function IssueRow({ issue, conversations, expanded, selected, repos, onToggle }: {
  issue: { id: string; title: string }
  conversations: Conversation[]
  expanded: boolean
  selected: boolean
  repos: Repo[]
  onToggle: (issueId: string) => void
}) {
  const latest = conversations[0]!
  const lead = conversations.find((c) => c.active?.status === 'running') ?? latest
  const status = (lead.active ?? lead.state).status
  const needsAnswer = conversations.some((c) => c.state.needsAnswer)
  return (
    <li className="dock-conv-row">
      <button
        type="button"
        className={selected && !expanded ? 'dock-conv dock-conv-issue dock-conv-selected' : 'dock-conv dock-conv-issue'}
        aria-expanded={expanded}
        aria-label={`${issue.title} 대화 ${conversations.length}개`}
        onClick={() => onToggle(issue.id)}
      >
        <span className="dock-conv-top">
          <IconChevronRight className="dock-issue-chevron" width="11" height="11" />
          <span
            className={`status-dot status-${status}`}
            role="img"
            aria-label={RUN_STATUS_LABELS[status]}
            title={RUN_STATUS_LABELS[status]}
          />
          {needsAnswer && <span className="needs-answer">답변 필요</span>}
          <span className="dock-conv-title" title={issue.title}>{issue.title}</span>
          <span className="group-count">{conversations.length}</span>
        </span>
        <span className="dock-conv-meta">
          이슈 · {repoLabel(latest, repos)} · {when(latest)}
        </span>
      </button>
    </li>
  )
}

/**
 * 도크 왼쪽의 세로 대화 목록 (`docs/sdlc/conversation-lifecycle/` FR-17~FR-23).
 *
 * **state를 쥐지 않는다** — 펼침·이름 편집 여부를 전부 `Dock`에서 받는다. 여기서
 * 들고 있으면 도크를 접었다 펴는 것만으로 편집하던 입력이 사라진다(설정 화면의
 * 초안 state를 `SettingsPanel`이 쥐는 것과 같은 이유).
 */
export function ConversationList({
  open, closed, selectedId, isNew, repos, showClosed, renamingId, expandedIssues,
  onPickNew, onPick, onRename, onClose, onToggleClosed, onStartRename, onCancelRename, onToggleIssue
}: {
  /** 끝나지 않은 대화. 마지막 턴 최신순 */
  open: Conversation[]
  /** 끝낸 대화. 토글을 펼쳤을 때만 그린다 */
  closed: Conversation[]
  selectedId: string | null
  /** 지금 "새 대화"를 보고 있는가 */
  isNew: boolean
  repos: Repo[]
  showClosed: boolean
  renamingId: string | null
  /** 펼친 이슈 줄의 이슈 id (FR-28). 기본은 접힘이다 */
  expandedIssues: ReadonlySet<string>
  onPickNew: () => void
  onPick: (conv: Conversation) => void
  onRename: (conv: Conversation, title: string) => void
  onClose: (conv: Conversation) => void
  onToggleClosed: () => void
  onStartRename: (id: string) => void
  onCancelRename: () => void
  onToggleIssue: (issueId: string) => void
}) {
  function row(conv: Conversation, nested = false) {
    return (
      <Row
        key={conv.id}
        conv={conv}
        // 묶음 안에서는 제목이 전부 이슈 이름이다 — 붙인 이름이 없으면 첫 지시로 가른다.
        label={nested && !conv.named ? titleOf(conv.runs[0]!) : conv.title}
        nested={nested}
        selected={!isNew && conv.id === selectedId}
        repos={repos}
        onPick={onPick}
        onRename={onRename}
        onClose={onClose}
        renaming={renamingId === conv.id}
        onStartRename={onStartRename}
        onCancelRename={onCancelRename}
      />
    )
  }

  function rows(conversations: Conversation[]) {
    return foldByIssue(conversations).flatMap((entry) => {
      if (entry.kind === 'conversation') return [row(entry.conversation)]
      const expanded = expandedIssues.has(entry.issue.id)
      // key에 목록 칸을 섞지 않는다 — 열린 목록과 끝낸 목록은 따로 그리는 <ul>이다.
      return [
        <IssueRow
          key={`issue:${entry.issue.id}`}
          issue={entry.issue}
          conversations={entry.conversations}
          expanded={expanded}
          selected={!isNew && entry.conversations.some((c) => c.id === selectedId)}
          repos={repos}
          onToggle={onToggleIssue}
        />,
        ...(expanded ? entry.conversations.map((c) => row(c, true)) : [])
      ]
    })
  }

  return (
    <div className="dock-side">
      {/* 글리프(전각 ＋) 대신 아이콘이다 (`docs/sdlc/conversation-timeline/` spec FR-48) — 이름은
          정확히 "새 대화"다(e2e가 `{ name: '새 대화', exact: true }`로 잡는다). */}
      <button
        type="button"
        className={isNew ? 'dock-new dock-new-selected' : 'dock-new'}
        onClick={onPickNew}
      >
        <IconPlus width="14" height="14" />
        새 대화
      </button>
      <ul className="dock-conv-list">{rows(open)}</ul>
      {/* 끝낸 것이 없으면 토글 자체를 그리지 않는다 (FR-20) — 늘 0이 붙어 있으면
          눈이 걸러내고, 처음 쓰는 사람에게는 무엇을 여는 것인지도 알 수 없다. */}
      {closed.length > 0 && (
        <>
          <button
            type="button"
            className="dock-closed-toggle"
            aria-expanded={showClosed}
            onClick={onToggleClosed}
          >
            {/* 펼치면 CSS가 돌려 아래를 향하게 한다 — 움직이지 않고 돌아가 있을 뿐이다. */}
            <IconChevronRight className="dock-closed-chevron" width="12" height="12" />
            끝낸 대화
            <span className="group-count">{closed.length}</span>
          </button>
          {showClosed && <ul className="dock-conv-list">{rows(closed)}</ul>}
        </>
      )}
    </div>
  )
}
