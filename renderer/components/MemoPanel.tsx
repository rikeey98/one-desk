import { useEffect, useState } from 'react'
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { MemoDetail } from './MemoDetail'
import { useMemos } from '../hooks/useMemos'
import { useClient } from '../client/ClientProvider'
import { chipKey, type ContextChip } from '../context'
import { ConfirmButton } from './ConfirmButton'
import { IconCollapse, IconTrash } from './icons'
import type { Repo } from '@shared/models'

export function MemoPanel({
  workspaceId, repoId, repos, chipKeys, onToggleContext, expanded, openId, onOpen
}: {
  workspaceId: string
  repoId: string | null
  /** 이 workspace의 repo 전부. 상세에서 붙일 후보다 (IssuePanel과 대칭). */
  repos: Repo[]
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
  expanded: boolean
  openId: string | null
  onOpen: (id: string) => void
}) {
  const client = useClient()
  const { memos, error: listError, refresh } = useMemos(workspaceId, repoId)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const open = openId ? memos.find((m) => m.id === openId) ?? null : null

  // 열린 항목이 목록에서 사라졌으면(지워졌거나 필터가 바뀌었으면) 접는다.
  // 존재하지 않는 항목의 상세를 그리지 않는다 (설계 §8).
  useEffect(() => {
    if (openId && !open) onOpen(openId)
  }, [openId, open, onOpen])

  async function addMemo(title: string) {
    await client.memos.create({
      workspaceId,
      title,
      repoIds: repoId ? [repoId] : []
    })
    await refresh()
  }

  /**
   * 목록 줄에서 바로 지운다 (IssuePanel과 대칭 — 이유는 그쪽 주석 참고).
   */
  async function removeMemo(id: string) {
    setDeleteError(null)
    try {
      await client.memos.remove(id)
      await refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    }
  }

  const list = (
    <>
      <AddForm placeholder="새 메모 제목…" onSubmit={addMemo} />
      {!listError && memos.length === 0 && (
        <div className="panel-empty">
          메모가 없습니다
          <span className="panel-empty-hint">위 칸에 제목을 적고 Enter를 누르면 생깁니다</span>
        </div>
      )}
      <ul className="item-list">
        {memos.map((m) => {
          const picked = chipKeys.has(chipKey({ type: 'memo', id: m.id }))
          return (
            <li key={m.id} className={openId === m.id ? 'item item-active' : 'item'}>
              <button
                type="button"
                className={picked ? 'item-pick item-picked' : 'item-pick'}
                aria-label={`${m.title} 맥락에 담기`}
                aria-pressed={picked}
                onClick={() => onToggleContext({ type: 'memo', id: m.id, label: m.title })}
              >
                {picked ? '✓' : ''}
              </button>
              {/* 담기 토글이 줄의 맨 앞이다 — 체크박스처럼 읽히도록.
                  클릭은 "열어본다"이고 맥락에 담는 것은 이 토글이 맡는다 (설계 §5). */}
              <button
                type="button"
                className={openId === m.id ? 'item-title item-open' : 'item-title'}
                onClick={() => onOpen(m.id)}
              >
                {m.title}
              </button>
              {/* 평소엔 폭 0으로 접혀 있다가 hover·포커스에 펼쳐진다 (IssuePanel과 대칭). */}
              <span className="item-actions">
                <ConfirmButton
                  label={<IconTrash />}
                  className="row-action row-action-danger"
                  confirmLabel="정말 삭제?"
                  ariaLabel={`${m.title} 삭제`}
                  onConfirm={() => void removeMemo(m.id)}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )

  return (
    <Panel
      title="Memos"
      count={memos.length}
      expanded={expanded}
      action={expanded && openId && (
        <button type="button" className="icon-button icon-button-sm" aria-label="축소" title="축소" onClick={() => onOpen(openId)}>
          <IconCollapse />
        </button>
      )}
    >
      {listError && <div role="alert" className="form-error">{listError}</div>}
      {deleteError && <div role="alert" className="form-error">{deleteError}</div>}
      {/* 감싸는 div의 엘리먼트 타입을 확장 여부와 무관하게 항상 유지한다.
          IssuePanel과 대칭 — 이유는 그쪽 주석 참고. */}
      <div className={expanded ? 'panel-split' : undefined}>
        <div className={expanded ? 'panel-split-list' : undefined}>{list}</div>
        {expanded && (
          <div className="panel-split-detail">
            {open && (
              <MemoDetail
                // key가 핵심이다. 다른 메모로 옮기면 상세를 통째로 다시 마운트해,
                // 옛 컴포넌트가 자기 클로저를 들고 언마운트되며 대기 중인 저장을
                // 올바른 메모에 흘려보낸다 (MemoDetail 내부 설명 참고).
                key={open.id}
                memo={open}
                repos={repos}
                onChanged={() => { void refresh() }}
                onDeleted={() => { onOpen(open.id); void refresh() }}
                // 같은 id로 onOpen을 부르면 App의 토글이 접는다. 상세가 대기 중인
                // 저장을 먼저 끝낸 뒤에만 부르므로, 접히면서 쓰기를 잃지 않는다.
                onRequestClose={() => { onOpen(open.id) }}
              />
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
