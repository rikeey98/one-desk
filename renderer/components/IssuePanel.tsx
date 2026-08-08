import { useState } from 'react'
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { useIssues } from '../hooks/useIssues'
import { useClient } from '../client/ClientProvider'
import type { IssueStatus } from '@shared/models'

export function IssuePanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const client = useClient()
  const { issues, error: listError, refresh } = useIssues(workspaceId, repoId)
  const [error, setError] = useState<string | null>(null)
  // 목록 조회 실패와 패널 동작 실패를 한 자리에서 보여준다.
  const shown = error ?? listError

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

  return (
    <Panel title="Issues">
      {shown && <div role="alert" className="form-error">{shown}</div>}
      <AddForm placeholder="새 이슈 제목…" onSubmit={addIssue} />
      {!listError && issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}
      <ul className="item-list">
        {issues.map((i) => (
          <li key={i.id} className="item">
            <span className="item-title">{i.title}</span>
            <button
              type="button"
              className={`status status-${i.status}`}
              onClick={() => cycleStatus(i.id, i.status)}
            >
              {i.status}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
