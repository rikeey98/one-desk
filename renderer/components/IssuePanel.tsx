import { useEffect, useState } from 'react'
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { IssueDetail } from './IssueDetail'
import { useIssues } from '../hooks/useIssues'
import { useClient } from '../client/ClientProvider'
import { chipKey, type ContextChip } from '../context'
import type { IssueStatus } from '@shared/models'

export function IssuePanel({
  workspaceId, repoId, chipKeys, onToggleContext, expanded, openId, onOpen
}: {
  workspaceId: string
  repoId: string | null
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
  expanded: boolean
  openId: string | null
  onOpen: (id: string) => void
}) {
  const client = useClient()
  const { issues, error: listError, refresh } = useIssues(workspaceId, repoId)
  const [error, setError] = useState<string | null>(null)
  // 목록 조회 실패와 패널 동작 실패를 한 자리에서 보여준다.
  const shown = error ?? listError

  const open = openId ? issues.find((i) => i.id === openId) ?? null : null

  // 열린 항목이 목록에서 사라졌으면(지워졌거나 필터가 바뀌었으면) 접는다.
  // 존재하지 않는 항목의 상세를 그리지 않는다 (설계 §8).
  useEffect(() => {
    if (openId && !open) onOpen(openId)
  }, [openId, open, onOpen])

  async function addIssue(title: string) {
    await client.issues.create({
      workspaceId,
      title,
      repoIds: repoId ? [repoId] : []
    })
    await refresh()
  }

  async function cycleStatus(id: string, current: IssueStatus) {
    const next = current === 'open' ? 'doing' : current === 'doing' ? 'done' : 'open'
    setError(null)
    try {
      await client.issues.update({ id, status: next })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const list = (
    <>
      <AddForm placeholder="새 이슈 제목…" onSubmit={addIssue} />
      {!listError && issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}
      <ul className="item-list">
        {issues.map((i) => {
          const picked = chipKeys.has(chipKey({ type: 'issue', id: i.id }))
          return (
            <li key={i.id} className="item">
              {/* 클릭은 "열어본다"다. 맥락에 담는 것은 옆 토글이 맡는다 (설계 §5). */}
              <button
                type="button"
                className={openId === i.id ? 'item-title item-open' : 'item-title'}
                onClick={() => onOpen(i.id)}
              >
                {i.title}
              </button>
              <button
                type="button"
                className={picked ? 'item-pick item-picked' : 'item-pick'}
                aria-label={`${i.title} 맥락에 담기`}
                aria-pressed={picked}
                onClick={() => onToggleContext({ type: 'issue', id: i.id, label: i.title })}
              >
                ＋
              </button>
              <button
                type="button"
                className={`status status-${i.status}`}
                onClick={() => cycleStatus(i.id, i.status)}
              >
                {i.status}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )

  return (
    <Panel title="Issues" expanded={expanded}>
      {shown && <div role="alert" className="form-error">{shown}</div>}
      {/* 감싸는 div의 엘리먼트 타입을 확장 여부와 무관하게 항상 유지한다.
          expanded에 따라 div ↔ Fragment로 타입이 바뀌면 React가 이 자리를
          통째로 언마운트-재마운트해 item-title 버튼의 DOM 정체성이 사라진다 —
          "같은 항목을 다시 클릭하면 접힌다" 테스트에서 실측한 결함이다:
          첫 클릭으로 확장되며 버튼이 새 DOM 노드로 교체되고, 테스트가 들고 있던
          예전 참조로 두 번째 클릭을 해도 이벤트가 루트까지 버블링하지 못해
          무시됐다. */}
      <div className={expanded ? 'panel-split' : undefined}>
        <div className={expanded ? 'panel-split-list' : undefined}>{list}</div>
        {expanded && (
          <div className="panel-split-detail">
            {open && (
              <IssueDetail
                // key가 핵심이다. 다른 이슈로 옮기면 상세를 통째로 다시 마운트해,
                // 옛 컴포넌트가 자기 클로저를 들고 언마운트되며 대기 중인 저장을
                // 올바른 이슈에 흘려보낸다 (IssueDetail 내부 설명 참고).
                key={open.id}
                issue={open}
                onChanged={() => { void refresh() }}
                onDeleted={() => { onOpen(open.id); void refresh() }}
              />
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
