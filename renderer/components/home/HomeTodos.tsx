import type { HomeTodo } from '@shared/models'
import { CATEGORY_LABELS } from '@shared/inbox'

/** 시각 — 오늘이면 `HH:MM`, 아니면 `M/D HH:MM` */
export function whenLabel(at: number | null, now: number): string {
  if (at === null) return ''
  const d = new Date(at)
  const n = new Date(now)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/**
 * 오늘 할 일 (`docs/sdlc/home/` FR-3·FR-9) — workspace를 넘어 한 목록, **줄마다 버튼 하나**(실패·중단만 둘). 끝나면 요약을
 * 다시 읽을 때 줄이 빠진다 — 낙관적으로 미리 지우지 않는다(실패하면 거짓이 된다).
 *
 * 버튼 이름: `답하기` · `다시 보내기` · `대화 열기` · `훑기` · `방치 이슈 보기`(`보기`는 `마크다운으로 보기` 등과 부딪힌다 — NFR-3).
 */
export function HomeTodos({
  todos, now, onReply, onResend, onOpenConversation, onTriage, onOpenIssues
}: {
  todos: HomeTodo[]
  now: number
  onReply: (workspaceId: string, conversationId: string) => void
  onResend: (workspaceId: string, runId: string) => void
  onOpenConversation: (workspaceId: string, conversationId: string) => void
  onTriage: (workspaceId: string) => void
  onOpenIssues: (workspaceId: string) => void
}) {
  return (
    <section className="home-card home-todos" aria-labelledby="home-todos-head">
      <header className="home-card-head">
        <h2 id="home-todos-head">오늘 할 일</h2>
        <span className="home-card-meta"><span className="group-count">{todos.length}</span></span>
      </header>
      {todos.length === 0
        ? <p className="home-empty">할 일 없음 — 답을 기다리는 대화도, 정리할 이슈도 없습니다</p>
        : (
          <ul className="home-rows" aria-label="오늘 할 일">
            {todos.map((t) => <TodoRow key={keyOf(t)} todo={t} now={now} onReply={onReply} onResend={onResend} onOpenConversation={onOpenConversation} onTriage={onTriage} onOpenIssues={onOpenIssues} />)}
          </ul>
        )}
    </section>
  )
}

function keyOf(t: HomeTodo): string {
  return 'runId' in t ? `${t.kind}:${t.conversationId}` : `${t.kind}:${t.workspaceId}`
}

function TodoRow({
  todo, now, onReply, onResend, onOpenConversation, onTriage, onOpenIssues
}: {
  todo: HomeTodo
  now: number
  onReply: (workspaceId: string, conversationId: string) => void
  onResend: (workspaceId: string, runId: string) => void
  onOpenConversation: (workspaceId: string, conversationId: string) => void
  onTriage: (workspaceId: string) => void
  onOpenIssues: (workspaceId: string) => void
}) {
  if ('runId' in todo) {
    const isAnswer = todo.kind === 'needs-answer'
    return (
      <li className={`home-row home-todo home-todo-${todo.kind}`}>
        <span className={`status-dot ${isAnswer ? 'status-needs-answer' : 'status-failed'}`} aria-label={CATEGORY_LABELS[todo.kind]} title={CATEGORY_LABELS[todo.kind]} />
        <div className="home-row-body">
          <div className="home-row-title">{todo.title}</div>
          {todo.detail && <div className="home-row-sub">{todo.detail}</div>}
          <div className="home-row-scope">
            <span className="path-text">{todo.repoName ? `${todo.workspaceName} · ${todo.repoName}` : todo.workspaceName}</span>
            <span>{CATEGORY_LABELS[todo.kind]}</span>
            {todo.at !== null && <span>{whenLabel(todo.at, now)}</span>}
          </div>
        </div>
        <div className="home-row-actions">
          {isAnswer
            ? <button type="button" className="home-primary" onClick={() => onReply(todo.workspaceId, todo.conversationId)}>답하기</button>
            : (
              <>
                <button type="button" className="home-primary" onClick={() => onResend(todo.workspaceId, todo.runId)}>다시 보내기</button>
                <button type="button" onClick={() => onOpenConversation(todo.workspaceId, todo.conversationId)}>대화 열기</button>
              </>
            )}
        </div>
      </li>
    )
  }
  const untriaged = todo.kind === 'untriaged'
  return (
    <li className={`home-row home-todo home-todo-${todo.kind}`}>
      <span className="status-dot status-muted" aria-hidden="true" />
      <div className="home-row-body">
        <div className="home-row-title">
          {untriaged ? '정리 안 된 이슈' : '오래 안 본 이슈'} <span className="group-count">{todo.count}</span>
        </div>
        <div className="home-row-sub">{todo.titles.join(' · ')}{todo.count > todo.titles.length ? ' …' : ''}</div>
        <div className="home-row-scope"><span className="path-text">{todo.workspaceName}</span></div>
      </div>
      <div className="home-row-actions">
        {untriaged
          ? <button type="button" className="home-primary" onClick={() => onTriage(todo.workspaceId)}>훑기</button>
          : <button type="button" onClick={() => onOpenIssues(todo.workspaceId)}>방치 이슈 보기</button>}
      </div>
    </li>
  )
}
