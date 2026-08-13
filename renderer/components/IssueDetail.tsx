import { useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { ConflictBanner } from './ConflictBanner'
import { ConfirmButton } from './ConfirmButton'
import type { Issue, IssueStatus } from '@shared/models'

export function IssueDetail({ issue, onChanged, onDeleted }: {
  issue: Issue
  /** 목록을 다시 읽게 한다 */
  onChanged: () => void
  onDeleted: () => void
}) {
  const client = useClient()
  const [title, setTitle] = useState(issue.title)
  const [body, setBody] = useState(issue.body)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Issue | null>(null)
  // 낙관적 잠금의 기대값. **성공한 모든 쓰기가 이것을 갱신한다** (설계 §6).
  //
  // 초기값은 마운트 때 한 번만 읽는다. 항목이 바뀌면 IssuePanel의 key가 이 컴포넌트를
  // 통째로 다시 마운트하므로 여기서 issue를 다시 볼 일이 없다 — 오히려 목록이 갱신될
  // 때마다 버퍼를 초기화하면 타이핑 중에 글자가 되돌아간다.
  const expected = useRef(issue.updatedAt)

  async function persist(patch: { title?: string; body?: string; status?: IssueStatus }) {
    setError(null)
    const result = await client.issues.updateIfUnchanged({
      id: issue.id, ...patch, expectedUpdatedAt: expected.current
    })
    if (!result.ok) { setConflict(result.current); return }
    expected.current = result.issue.updatedAt
    onChanged()
  }

  const bodySave = useDebouncedSave(async (value) => {
    // 배너가 떠 있으면 멈춘다. 계속 재시도하면 결국 덮어쓰기가 되어 잠금이 무의미해진다.
    if (conflict) return
    try { await persist({ body: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  // 제목도 같은 규칙을 쓴다. 훅을 따로 걸어 본문 타이머와 섞이지 않게 한다.
  const titleSave = useDebouncedSave(async (value) => {
    if (conflict) return
    try { await persist({ title: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  return (
    <div className="detail">
      {conflict && (
        <ConflictBanner
          onReload={() => {
            // 배너가 뜬 채로 계속 타이핑하면 충돌 전(스테일) 텍스트를 든 디바운스
            // 타이머가 걸려 있을 수 있다. 취소하지 않으면 그 타이머가 다시 불러온
            // 뒤에도 살아남아, 마침 새로 맞춰진 expectedUpdatedAt과 함께 스테일한
            // 값을 몰래 써버려 화면과 DB가 갈린다 — 버퍼를 통째로 버리는 시점이니
            // 여기서도 같은 이유로 버린다 (아래 삭제와 대칭).
            bodySave.cancel()
            titleSave.cancel()
            setTitle(conflict.title)
            setBody(conflict.body)
            expected.current = conflict.updatedAt
            setConflict(null)
            onChanged()
          }}
          onOverwrite={() => {
            void (async () => {
              try {
                const saved = await client.issues.update({ id: issue.id, title, body })
                expected.current = saved.updatedAt
                setConflict(null)
                onChanged()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            })()
          }}
        />
      )}
      {error && <div className="form-error">{error}</div>}

      <input
        aria-label="제목"
        className="detail-title"
        value={title}
        onChange={(e) => { setTitle(e.target.value); titleSave.schedule(e.target.value) }}
        onBlur={() => { void titleSave.flush() }}
      />
      <textarea
        aria-label="본문"
        className="detail-body"
        value={body}
        onChange={(e) => { setBody(e.target.value); bodySave.schedule(e.target.value) }}
        onBlur={() => { void bodySave.flush() }}
      />

      <div className="detail-actions">
        <ConfirmButton
          label="삭제"
          confirmLabel="정말 삭제?"
          onConfirm={() => {
            // 지우기 전에 대기 중인 저장을 버린다 — 버리지 않으면 그 타이머(실제
            // 화면에서는 언마운트 flush)가 나중에 살아남아 이미 지워진 행에 쓰기를
            // 시도한다 (onReload와 같은 이유로, 여기서도 버퍼를 통째로 버린다).
            bodySave.cancel()
            titleSave.cancel()
            void (async () => {
              try { await client.issues.remove(issue.id); onDeleted() }
              catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            })()
          }}
        />
      </div>
    </div>
  )
}
