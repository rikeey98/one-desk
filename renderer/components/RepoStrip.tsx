import { AddRepoForm } from './AddRepoForm'
import { chipKey, type ContextChip } from '../context'
import type { Repo } from '@shared/models'

export function RepoStrip({ workspaceId, repos, error, refresh, selectedRepoId, onSelect, chipKeys, onToggleContext }: {
  workspaceId: string
  repos: Repo[]
  error: string | null
  refresh: () => Promise<void>
  selectedRepoId: string | null
  onSelect: (repoId: string | null) => void
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
}) {
  return (
    <div className="repo-strip">
      {error && <div role="alert" className="form-error">{error}</div>}
      {repos.map((r) => (
        // 카드 클릭은 필터, 별도 버튼이 맥락 담기다. 버튼 안에 버튼을 넣을 수 없어 감싼다.
        <div key={r.id} className="repo-slot">
          {/* 이슈·메모 목록과 같은 자리·같은 모양이다 — 왼쪽 끝의 원형 체크. */}
          <button
            type="button"
            className={chipKeys.has(chipKey({ type: 'repo', id: r.id }))
              ? 'repo-context repo-context-picked' : 'repo-context'}
            aria-label={`${r.name} 맥락에 담기`}
            aria-pressed={chipKeys.has(chipKey({ type: 'repo', id: r.id }))}
            onClick={() => onToggleContext({ type: 'repo', id: r.id, label: r.name })}
          >
            {chipKeys.has(chipKey({ type: 'repo', id: r.id })) ? '✓' : ''}
          </button>
          <button
            type="button"
            className={r.id === selectedRepoId ? 'repo-card repo-card-selected' : 'repo-card'}
            onClick={() => onSelect(r.id === selectedRepoId ? null : r.id)}
          >
            <span className="repo-name">{r.name}</span>
            <span className="repo-path">{r.path}</span>
          </button>
        </div>
      ))}
      {!error && repos.length === 0 && <div className="repo-empty">등록된 repo가 없습니다</div>}
      <AddRepoForm workspaceId={workspaceId} onAdded={refresh} />
    </div>
  )
}
