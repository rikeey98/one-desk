import { useRef, useState, type KeyboardEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { ConflictBanner } from './ConflictBanner'
import { ConfirmButton } from './ConfirmButton'
import type { Memo } from '@shared/models'

export function MemoDetail({ memo, onChanged, onDeleted, onRequestClose }: {
  memo: Memo
  /** 목록을 다시 읽게 한다 */
  onChanged: () => void
  onDeleted: () => void
  /** Esc로 접기를 청한다. 대기 중인 저장을 흘려보낸 뒤에만 부른다 (설계 §7). */
  onRequestClose: () => void
}) {
  const client = useClient()
  const [title, setTitle] = useState(memo.title)
  const [body, setBody] = useState(memo.body)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Memo | null>(null)
  // 배너 상태를 ref로도 들고 있는다. Esc 경로는 flush를 await한 뒤에 충돌 여부를 봐야
  // 하는데, 그 시점에 핸들러의 클로저가 쥔 conflict는 await 이전 렌더의 값이라 방금
  // 세워진 배너를 보지 못한다. 화면은 state가, 판단은 ref가 맡는다.
  const conflictRef = useRef<Memo | null>(null)
  // 낙관적 잠금의 기대값. **성공한 모든 쓰기가 이것을 갱신한다** (설계 §6).
  //
  // 초기값은 마운트 때 한 번만 읽는다. 항목이 바뀌면 MemoPanel의 key가 이 컴포넌트를
  // 통째로 다시 마운트하므로 여기서 memo를 다시 볼 일이 없다 — 오히려 목록이 갱신될
  // 때마다 버퍼를 초기화하면 타이핑 중에 글자가 되돌아간다.
  const expected = useRef(memo.updatedAt)

  function showConflict(next: Memo | null) {
    conflictRef.current = next
    setConflict(next)
  }

  async function persist(patch: { title?: string; body?: string }) {
    setError(null)
    const result = await client.memos.updateIfUnchanged({
      id: memo.id, ...patch, expectedUpdatedAt: expected.current
    })
    if (!result.ok) { showConflict(result.current); return }
    expected.current = result.memo.updatedAt
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

  /**
   * Esc는 상세가 살아 있는 동안 여기서 처리한다 (설계 §7).
   *
   * App.tsx의 document 리스너까지 올라가면 상세가 그 자리에서 언마운트되고, 언마운트
   * flush가 낸 충돌은 이미 사라진 컴포넌트의 setState라 React가 조용히 버린다 — 배너도
   * 오류도 없이, flush가 이미 소비한 텍스트만 사라진다. 그래서 먼저 flush를 끝내고,
   * 충돌이 났으면 닫지 않고 배너를 남겨 사용자가 판단할 자리를 지킨다.
   *
   * stopPropagation 한 줄로 App까지 못 가게 막는다 — ConfirmButton과 같은 이유·같은
   * 방법이다(그쪽 주석 참고). 삭제 확인이 켜져 있으면 ConfirmButton이 Esc를 먼저
   * 삼키므로 여기까지 오지 않는다.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    void (async () => {
      try {
        await titleSave.flush()
        await bodySave.flush()
      } catch (err) {
        // 저장 콜백이 스스로 잡지 못한 오류. 띄우고 닫지 않는다 (설계 §8).
        setError(err instanceof Error ? err.message : String(err))
        return
      }
      if (conflictRef.current) return
      onRequestClose()
    })()
  }

  return (
    <div className="detail" onKeyDown={handleKeyDown}>
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
            showConflict(null)
            onChanged()
          }}
          onOverwrite={() => {
            void (async () => {
              try {
                const saved = await client.memos.update({ id: memo.id, title, body })
                expected.current = saved.updatedAt
                showConflict(null)
                onChanged()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            })()
          }}
        />
      )}
      {/* 자동 저장은 사용자가 결과를 보지 않는다 — 실패를 숨기면 안 썼는데 썼다고
          믿게 된다 (설계 §8). 이 앱의 다른 오류 자리와 같이 role="alert"로 알린다. */}
      {error && <div role="alert" className="form-error">{error}</div>}

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
              try { await client.memos.remove(memo.id); onDeleted() }
              catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            })()
          }}
        />
      </div>
    </div>
  )
}
