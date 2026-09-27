import { RenameField } from './RenameField'
import { IconCheck, IconPencil } from './icons'
import type { Conversation } from '../conversation'
import type { Repo } from '@shared/models'

/** 좁은 칸이라 날짜는 버린다 — 같은 대화를 며칠에 걸쳐 이어가는 일은 드물다. */
function when(conv: Conversation): string {
  const at = conv.last.endedAt ?? conv.last.startedAt ?? conv.last.createdAt
  return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * 그 대화가 어느 repo에서 돌았는지. 등록된 repo면 이름을, 아니면 경로의 마지막
 * 칸을 보여준다 — 임의 디렉토리에서도 실행할 수 있으므로 "없음"으로 비우지 않는다.
 */
function repoLabel(conv: Conversation, repos: Repo[]): string {
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
function Row({ conv, selected, repos, onPick, onRename, onClose, renaming, onStartRename, onCancelRename }: {
  conv: Conversation
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
      <li className="dock-conv-row">
        <RenameField
          initial={conv.named ? conv.title : ''}
          label={`${conv.title} 새 이름`}
          onSubmit={(title) => onRename(conv, title)}
          onCancel={onCancelRename}
        />
      </li>
    )
  }

  return (
    <li className="dock-conv-row">
      <button
        type="button"
        className={selected ? 'dock-conv dock-conv-selected' : 'dock-conv'}
        onClick={() => onPick(conv)}
      >
        <span className="dock-conv-top">
          {/* **글자 없이 점만.** 좁은 레일에서 'succeeded' 같은 영어 단어가 제목을
              밀어낸다 — 여기서 중요한 것은 제목이다(2026-09-23 사용자 결정). 이름은
              role="img"+aria-label로 남고, 글자로 된 상태 칩은 대화록의 턴마다 그대로
              보인다. */}
          <span
            className={`status-dot status-${conv.last.status}`}
            role="img"
            aria-label={conv.last.status}
            title={conv.last.status}
          />
          {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. 배지가 없으면
              구분이 안 된다 — 이것만은 글자로 남긴다. */}
          {conv.last.needsAnswer && <span className="needs-answer">답변 필요</span>}
          {/* 잘린 제목은 호버로 읽는다. */}
          <span className="dock-conv-title" title={conv.title}>{conv.title}</span>
        </span>
        <span className="dock-conv-meta">
          {repoLabel(conv, repos)} · {conv.runs.length}턴 · {when(conv)}
        </span>
      </button>
      <span className="dock-conv-actions">
        <button
          type="button"
          className="row-action"
          aria-label={`${conv.title} 이름 바꾸기`}
          onClick={() => onStartRename(conv.id)}
        >
          <IconPencil />
        </button>
        {/* 끝낸 대화에는 끝내기가 없다 (spec FR-22) — 이름은 여전히 고칠 수 있다. */}
        {conv.closedAt === null && (
          <button
            type="button"
            className="row-action"
            aria-label={`${conv.title} 대화 끝내기`}
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
 * 도크 왼쪽의 세로 대화 목록 (`docs/sdlc/conversation-lifecycle/` FR-17~FR-23).
 *
 * **state를 쥐지 않는다** — 펼침·이름 편집 여부를 전부 `Dock`에서 받는다. 여기서
 * 들고 있으면 도크를 접었다 펴는 것만으로 편집하던 입력이 사라진다(설정 화면의
 * 초안 state를 `SettingsPanel`이 쥐는 것과 같은 이유).
 */
export function ConversationList({
  open, closed, selectedId, isNew, repos, showClosed, renamingId,
  onPickNew, onPick, onRename, onClose, onToggleClosed, onStartRename, onCancelRename
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
  onPickNew: () => void
  onPick: (conv: Conversation) => void
  onRename: (conv: Conversation, title: string) => void
  onClose: (conv: Conversation) => void
  onToggleClosed: () => void
  onStartRename: (id: string) => void
  onCancelRename: () => void
}) {
  function row(conv: Conversation) {
    return (
      <Row
        key={conv.id}
        conv={conv}
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

  return (
    <div className="dock-side">
      <button
        type="button"
        className={isNew ? 'dock-new dock-new-selected' : 'dock-new'}
        onClick={onPickNew}
      >
        ＋ 새 대화
      </button>
      <ul className="dock-conv-list">{open.map(row)}</ul>
      {/* 끝낸 것이 없으면 토글 자체를 그리지 않는다 (FR-20) — 늘 0이 붙어 있으면
          눈이 걸러내고, 처음 쓰는 사람에게는 무엇을 여는 것인지도 알 수 없다. */}
      {closed.length > 0 && (
        <>
          <button type="button" className="dock-closed-toggle" onClick={onToggleClosed}>
            {showClosed ? '▾' : '▸'} 끝낸 대화
            <span className="group-count">{closed.length}</span>
          </button>
          {showClosed && <ul className="dock-conv-list">{closed.map(row)}</ul>}
        </>
      )}
    </div>
  )
}
