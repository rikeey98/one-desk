import { useRef, useState, type KeyboardEvent } from 'react'
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
  // Enter/Escape로 editing을 false로 만들면 input이 언마운트된다. 브라우저는
  // 포커스된 요소가 DOM에서 제거되면 네이티브 blur를 발생시키고, React가 그걸 잡아
  // 아직 붙어 있는 onBlur={commit}을 다시 실행한다 — Escape가 취소한 값을 되살리거나
  // Enter의 commit이 두 번 실행되는 사고로 이어진다. 이 플래그로 "keydown이 이미
  // 처리한 close"에 뒤이어 오는 그 blur만 무시한다.
  const suppressBlurRef = useRef(false)

  if (!snapshot) return null
  // 닫힌(nested) 함수 안에서 좁혀진 타입을 유지하려면 const로 옮겨 담아야 한다 —
  // 매개변수는 재할당 가능하다고 간주돼 TS가 클로저 너머로 null 배제를 보존하지 않는다.
  const limit = snapshot.limit

  function open() {
    setDraft(String(limit))
    // 플래그를 blur에서만 지우면, keydown으로 닫혔는데 focusout이 뒤따르지 않는
    // 경우가 한 번이라도 생겼을 때 켜진 채로 남아 다음 편집의 첫 바깥 클릭이
    // 조용히 무시된다. 편집을 여는 자리에서 항상 초기화해 그 경로를 막는다.
    suppressBlurRef.current = false
    setEditing(true)
  }

  function commit() {
    const n = Number(draft)
    setEditing(false)
    if (Number.isInteger(n) && n >= 1 && n !== limit) onChangeLimit(n)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      suppressBlurRef.current = true
      commit()
    }
    if (e.key === 'Escape') {
      // 취소다 — 절대 커밋하지 않는다.
      suppressBlurRef.current = true
      setEditing(false)
    }
  }

  function onBlur() {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false
      return
    }
    commit()
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
          onBlur={onBlur}
        />
      )}
    </span>
  )
}
