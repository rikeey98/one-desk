import { useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { AddRepoForm } from './AddRepoForm'
import { RenameField } from './RenameField'
import { ConfirmButton } from './ConfirmButton'
import { chipKey, type ContextChip } from '../context'
import { IconExternalLink, IconFolder, IconPencil, IconPlus, IconTrash } from './icons'
import type { Repo } from '@shared/models'

export function RepoStrip({ workspaceId, repos, error, refresh, selectedRepoId, onSelect, chipKeys, onToggleContext, onDeleted }: {
  workspaceId: string
  repos: Repo[]
  error: string | null
  refresh: () => Promise<void>
  selectedRepoId: string | null
  onSelect: (repoId: string | null) => void
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
  /** 삭제한 repo를 App이 알아야 필터를 풀 수 있다. */
  onDeleted: (id: string) => void
}) {
  const client = useClient()
  const [editing, setEditing] = useState<string | null>(null)
  // 열기 실패는 부모가 주는 `error`와 다른 출처다 — 목록을 읽다 난 오류가
  // 이 버튼 때문에 지워지면 안 된다.
  const [openError, setOpenError] = useState<string | null>(null)
  // 등록 폼은 "repo 등록"을 눌렀을 때만 펼친다 — 등록은 repo마다 한 번 있는 일이라
  // 늘 펼쳐 두면 사이드바만 길어진다. 등록이 끝나면 다시 접는다.
  const [adding, setAdding] = useState(false)

  async function renameRepo(id: string, name: string) {
    setEditing(null)
    await client.repos.rename(id, name)
    await refresh()
  }

  async function openInEditor(id: string) {
    setOpenError(null)
    try {
      await client.repos.openInEditor(id)
    } catch (err) {
      // 조용히 아무 일도 안 일어나면 VS Code가 없는 것인지 버튼이 죽은 것인지 모른다.
      setOpenError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeRepo(id: string) {
    await client.repos.remove(id)
    // 목록을 다시 읽기 전에 알린다 — App이 repo 필터를 풀어야 사라진 repo로
    // 걸러진 빈 목록이 남지 않는다.
    onDeleted(id)
    await refresh()
  }

  return (
    <div className="repo-strip">
      {error && <div role="alert" className="form-error">{error}</div>}
      {openError && <div role="alert" className="form-error">{openError}</div>}
      {/* 목록만 스크롤한다. AddRepoForm은 이 밖에 있어, repo가 아무리 늘어나도
          추가 줄은 스크롤과 무관하게 제자리에 남는다. */}
      <div className="repo-list">
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
            {editing === r.id ? (
              <RenameField
                initial={r.name}
                label={`${r.name} 새 이름`}
                onSubmit={(name) => void renameRepo(r.id, name)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className={r.id === selectedRepoId ? 'repo-card repo-card-selected' : 'repo-card'}
                  /* 사이드바에는 경로를 둘 자리가 없다 — 이름만 보이고 경로는 hover(title)로 닿는다.
                     고치는 것은 설정의 repo 탭이다. */
                  title={r.path}
                  /* 이름만으로는 상세의 repo 태그 칩("api")과 접근성 이름이 같아진다 —
                     스크린리더도 테스트도 둘을 못 가른다. */
                  aria-label={`${r.name} repo`}
                  onClick={() => onSelect(r.id === selectedRepoId ? null : r.id)}
                >
                  <IconFolder className="repo-icon" />
                  <span className="repo-name">{r.name}</span>
                </button>
                {/* 평소엔 CSS로 감춰 두고 호버·포커스에서 드러낸다. DOM에는 항상
                    있어야 키보드로도 닿는다. */}
                <span className="repo-actions">
                  <button
                    type="button"
                    className="row-action"
                    aria-label={`${r.name} VS Code로 열기`}
                    onClick={() => void openInEditor(r.id)}
                  >
                    <IconExternalLink />
                  </button>
                  <button
                    type="button"
                    className="row-action"
                    aria-label={`${r.name} 이름 바꾸기`}
                    onClick={() => setEditing(r.id)}
                  >
                    <IconPencil />
                  </button>
                  {/* repo 삭제는 이슈·메모에 붙은 태그만 떼고 본문은 남긴다 —
                      workspace 삭제와 달리 두 번 누르기로 무게가 맞는다. */}
                  <ConfirmButton
                    label={<IconTrash />}
                    className="row-action row-action-danger"
                    confirmLabel="정말 삭제?"
                    ariaLabel={`${r.name} 삭제`}
                    onConfirm={() => void removeRepo(r.id)}
                  />
                </span>
              </>
            )}
          </div>
        ))}
        {!error && repos.length === 0 && <div className="repo-empty">등록된 repo가 없습니다</div>}
      </div>
      {/* 이름에 "추가"를 넣지 않는다 — 폼의 "추가" 버튼을 부분 일치로 잡는 e2e와 부딪힌다. */}
      <button
        type="button"
        className="repo-add-toggle"
        aria-expanded={adding}
        onClick={() => setAdding((v) => !v)}
      >
        <IconPlus />
        repo 등록
      </button>
      {adding && (
        <AddRepoForm
          workspaceId={workspaceId}
          onAdded={async () => { await refresh(); setAdding(false) }}
        />
      )}
    </div>
  )
}
