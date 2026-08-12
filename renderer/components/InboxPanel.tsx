import { inboxCategory, CATEGORY_LABELS, type InboxCategory } from '../inbox'
import type { Run, Workspace } from '@shared/models'

/** 지시의 첫 줄만. 목록에서는 그것으로 충분하다. */
function label(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || '(빈 지시)'
}

function when(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toLocaleString('ko-KR')
}

/** 카테고리마다 다음 수를 미리 제시한다 (설계 §5). */
function shows(category: InboxCategory, action: 'log' | 'resume' | 'restart' | 'confirm' | 'archive' | 'makeIssue'): boolean {
  switch (action) {
    // 대기 중 취소됨은 시작도 못 해 로그 파일이 없다.
    case 'log': return category !== 'dropped'
    case 'resume': return category === 'needs-answer' || category === 'done'
    case 'restart': return category === 'failed' || category === 'interrupted' || category === 'dropped'
    case 'confirm': return category === 'done'
    case 'archive': return category !== 'done'
    case 'makeIssue': return category === 'failed'
  }
}

export function InboxPanel({
  items, workspaces, error, onReview, onOpenLog, onResume, onRestart, onCloseIssue, onMakeIssue
}: {
  items: Run[]
  workspaces: Workspace[]
  error: string | null
  onReview: (runId: string, kind: 'confirmed' | 'archived') => void
  onOpenLog: (run: Run) => void
  onResume: (run: Run) => void
  onRestart: (run: Run) => void
  onCloseIssue: (run: Run, issueId: string) => void
  onMakeIssue: (run: Run) => void
}) {
  return (
    <section className="inbox">
      {error && <div role="alert" className="form-error">{error}</div>}
      {items.length === 0 && !error && (
        <div className="panel-empty">처리할 결과가 없습니다</div>
      )}
      <ul className="inbox-list">
        {items.map((run) => {
          const category = inboxCategory(run)
          const ws = workspaces.find((w) => w.id === run.workspaceId)
          const issueIds = run.contextItems.filter((c) => c.type === 'issue').map((c) => c.id)
          return (
            <li key={run.id} className="inbox-item">
              <div className="inbox-head">
                <span className={`status status-${run.status}`}>{CATEGORY_LABELS[category]}</span>
                {/* 전역 목록이라 어느 workspace 것인지가 없으면 맥락이 사라진다. */}
                <span className="inbox-ws">{ws?.name ?? '(사라진 workspace)'}</span>
                <span className="inbox-when">{when(run.endedAt)}</span>
              </div>
              <div className="inbox-prompt">{label(run)}</div>
              {run.errorMessage && <div className="inbox-error">{run.errorMessage}</div>}
              <div className="inbox-actions">
                {shows(category, 'log') && (
                  <button type="button" onClick={() => onOpenLog(run)}>로그 보기</button>
                )}
                {/* 세션이 없으면 이어받을 것이 없다. 보여주면 눌러서야 알게 된다. */}
                {shows(category, 'resume') && run.externalSessionId && (
                  <button type="button" onClick={() => onResume(run)}>
                    {category === 'needs-answer' ? '답하고 이어서' : '이어서 실행'}
                  </button>
                )}
                {shows(category, 'restart') && (
                  <button type="button" onClick={() => onRestart(run)}>다시 실행</button>
                )}
                {shows(category, 'makeIssue') && (
                  <button type="button" onClick={() => onMakeIssue(run)}>이슈로 만들기</button>
                )}
                {issueIds.map((id) => (
                  <button key={id} type="button" onClick={() => onCloseIssue(run, id)}>
                    관련 이슈 닫기
                  </button>
                ))}
                {shows(category, 'confirm') && (
                  <button type="button" onClick={() => onReview(run.id, 'confirmed')}>확인함</button>
                )}
                {shows(category, 'archive') && (
                  <button type="button" onClick={() => onReview(run.id, 'archived')}>보관</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
