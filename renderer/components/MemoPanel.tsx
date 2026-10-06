import { useEffect, useState } from 'react'
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { MemoDetail } from './MemoDetail'
import { useMemos } from '../hooks/useMemos'
import { useClient } from '../client/ClientProvider'
import { chipKey, type ContextPicker } from '../context'
import { splitTitleBody } from '../titleBody'
import { OpenWindowButton } from './OpenWindowButton'
import { ListToggleButton, WindowSplit } from './WindowSplit'
import { ConfirmButton } from './ConfirmButton'
import { IconCollapse, IconTrash } from './icons'
import type { Repo } from '@shared/models'

export function MemoPanel({
  workspaceId, repoId, repos, context, layout = 'columns', expanded, openId, onOpen
}: {
  workspaceId: string
  repoId: string | null
  /** 이 workspace의 repo 전부. 상세에서 붙일 후보다 (IssuePanel과 대칭). */
  repos: Repo[]
  /** 담기 토글. 패널 창에는 없다 — 없으면 토글을 그리지 않는다 (docs/sdlc/item-windows/ FR-8) */
  context?: ContextPicker
  /**
   * `window`면 패널 창이다 — 목록과 상세가 나란히 서고(FR-7) "새 창으로 열기"가 없다. 기본은 앱 창의 세 칸.
   */
  layout?: 'columns' | 'window'
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

  async function addMemo(text: string) {
    // 첫 줄이 제목, 나머지가 본문이다 (renderer/titleBody.ts) — 이슈의 추가 칸과 대칭이다.
    const { title, body } = splitTitleBody(text)
    await client.memos.create({
      workspaceId,
      title,
      ...(body ? { body } : {}),
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
      <AddForm placeholder="새 메모 (첫 줄이 제목)" onSubmit={addMemo} multiline />
      {!listError && memos.length === 0 && (
        <div className="panel-empty">
          메모가 없습니다
          <span className="panel-empty-hint">위 칸에 제목을 적고 Enter를 누르면 생깁니다</span>
        </div>
      )}
      <ul className="item-list">
        {memos.map((m) => {
          const picked = context?.keys.has(chipKey({ type: 'memo', id: m.id })) ?? false
          return (
            <li key={m.id} className={openId === m.id ? 'item item-active' : 'item'}>
              {context && (
                <button
                  type="button"
                  className={picked ? 'item-pick item-picked' : 'item-pick'}
                  aria-label={`${m.title} 맥락에 담기`}
                  aria-pressed={picked}
                  onClick={() => context.onToggle({ type: 'memo', id: m.id, label: m.title })}
                >
                  {picked ? '✓' : ''}
                </button>
              )}
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

  const inWindow = layout === 'window'
  const detail = (
    <>
      {!open && <div className="panel-empty">목록에서 메모를 고르세요</div>}
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
    </>
  )

  return (
    <Panel
      title="Memos"
      count={memos.length}
      expanded={expanded}
      window={inWindow}
      action={(
        <>
          {expanded && openId && (
            <button type="button" className="icon-button icon-button-sm" aria-label="축소" title="축소" onClick={() => onOpen(openId)}>
              <IconCollapse />
            </button>
          )}
          {inWindow && <ListToggleButton />}
          {!inWindow && <OpenWindowButton kind="memo" workspaceId={workspaceId} repoId={repoId} />}
        </>
      )}
    >
      {listError && <div role="alert" className="form-error">{listError}</div>}
      {deleteError && <div role="alert" className="form-error">{deleteError}</div>}
      {/* 감싸는 div의 엘리먼트 타입을 확장 여부와 무관하게 항상 유지한다.
          IssuePanel과 대칭 — 이유는 그쪽 주석 참고. */}
      {inWindow
        // 패널 창: 목록 | 경계 | 상세 — 목록을 숨기고 폭을 끌어 바꾼다 (item-windows FR-26·27).
        ? <WindowSplit list={list} detail={detail} />
        : (
            <div className={expanded ? 'panel-split' : undefined}>
              <div className={expanded ? 'panel-split-list' : undefined}>{list}</div>
              {expanded && <div className="panel-split-detail">{detail}</div>}
            </div>
          )}
    </Panel>
  )
}
