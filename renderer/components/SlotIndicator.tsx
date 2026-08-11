import { useState, type KeyboardEvent } from 'react'
import type { QueueSnapshot } from '@shared/models'

/**
 * 전역 실행 슬롯 표시기.
 *
 * 상한은 앱 전역인데 도크는 workspace별이라, 다른 workspace가 슬롯을 쥐고 있으면
 * 내 run이 왜 대기하는지 화면 어디에도 드러나지 않는다. 이 한 줄이 그 공백을 메운다.
 */
export function SlotIndicator({ snapshot, onChangeLimit }: {
  snapshot: QueueSnapshot | null
  onChangeLimit: (n: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!snapshot) return null

  function open() {
    setDraft(String(snapshot!.limit))
    setEditing(true)
  }

  function commit() {
    const n = Number(draft)
    setEditing(false)
    if (Number.isInteger(n) && n >= 1 && n !== snapshot!.limit) onChangeLimit(n)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <span className="dock-slots">
      <button
        type="button"
        className="dock-slots-button"
        aria-label="실행 슬롯"
        onClick={open}
      >
        실행 중 {snapshot.running}/{snapshot.limit}
      </button>
      {/* 대기가 0이면 숫자만 늘어나 눈에 걸린다. 있을 때만 보인다. */}
      {snapshot.waiting > 0 && <span className="dock-slots-waiting">· 대기 {snapshot.waiting}</span>}
      {editing && (
        <input
          className="dock-slots-input"
          type="number"
          min={1}
          aria-label="동시 실행 상한"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      )}
    </span>
  )
}
