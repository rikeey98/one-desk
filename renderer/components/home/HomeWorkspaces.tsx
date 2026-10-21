import type { HomeDoneIssue, HomeRepoState, HomeWorkspace } from '@shared/models'
import { whenLabel } from './HomeTodos'

const REPO_STATE_LABELS: Record<HomeRepoState, string> = {
  running: '실행 중',
  'needs-answer': '답변 필요',
  failed: '실패',
  done: '완료',
  none: '대화 없음'
}

/**
 * workspace 카드 (`docs/sdlc/home/` FR-6) — 열림·진행 중·오늘 완료와 repo별 한 줄(상태 점). 누르면 그 workspace 화면이다.
 * 카드 버튼의 이름은 `<이름> 워크스페이스 열기`다 — workspace 이름 그대로면 사이드바의 버튼과 같은 이름이 둘이 된다(NFR-3).
 * 그 아래 오늘 완료 목록.
 */
export function HomeWorkspaces({
  workspaces, doneToday, now, onOpenWorkspace
}: {
  workspaces: HomeWorkspace[]
  doneToday: HomeDoneIssue[]
  now: number
  onOpenWorkspace: (workspaceId: string) => void
}) {
  return (
    <section className="home-card home-workspaces" aria-labelledby="home-ws-head">
      <header className="home-card-head">
        <h2 id="home-ws-head">워크스페이스</h2>
      </header>
      <ul className="home-ws-grid">
        {workspaces.map((w) => (
          <li key={w.workspaceId}>
            <button type="button" className="home-ws-card" aria-label={`${w.name} 워크스페이스 열기`} onClick={() => onOpenWorkspace(w.workspaceId)}>
              <span className="home-ws-name">{w.name}</span>
              <span className="home-ws-counts">
                <span>열림 <b>{w.open}</b></span>
                <span>진행 중 <b>{w.doing}</b></span>
                <span>오늘 완료 <b>{w.doneToday}</b></span>
                {w.untriaged > 0 && <span className="home-ws-warn">정리 안 됨 <b>{w.untriaged}</b></span>}
              </span>
              <span className="home-ws-repos">
                {w.repos.length === 0
                  ? <span className="home-row-faint">등록된 repo 없음</span>
                  : w.repos.map((r) => (
                    <span key={r.repoId} className="home-ws-repo">
                      <span className={`status-dot status-${r.state === 'needs-answer' ? 'needs-answer' : r.state === 'running' ? 'running' : r.state === 'failed' ? 'failed' : r.state === 'done' ? 'succeeded' : 'none'}`} title={REPO_STATE_LABELS[r.state]} />
                      <span className="home-ws-repo-name">{r.name}</span>
                      <span className="home-ws-repo-meta">이슈 {r.open} · 대화 {r.conversations}</span>
                    </span>
                  ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="home-done">
        <h3>오늘 완료 <span className="group-count">{doneToday.length}</span></h3>
        {doneToday.length === 0
          ? <p className="home-empty">오늘 완료한 이슈가 아직 없습니다</p>
          : (
            <ul className="home-done-list">
              {doneToday.map((d) => (
                <li key={d.issueId}>
                  <span className="status-dot status-succeeded" aria-hidden="true" />
                  <span className="home-done-title">{d.title}</span>
                  <span className="path-text">{d.workspaceName}</span>
                  <span className="home-row-faint">{whenLabel(d.closedAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  )
}
