import { useState, type KeyboardEvent } from 'react'

/**
 * 두 번 눌러야 실행되는 버튼. 되돌릴 수 없는 동작에 쓴다.
 *
 * 이 앱에는 모달이 없고 SlotIndicator가 이미 인라인 확인 패턴을 쓴다 (설계 §5).
 */
export function ConfirmButton({ label, confirmLabel, ariaLabel, onConfirm }: {
  label: string
  confirmLabel: string
  /**
   * 접근성 이름. 같은 화면에 이 버튼이 여럿일 때(예: repo마다 하나) 무엇을
   * 지우는 버튼인지 구분되어야 한다. 없으면 보이는 라벨이 이름이 된다.
   */
  ariaLabel?: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !armed) return
    // Esc는 안쪽부터 푼다. App.tsx는 document에 직접 keydown 리스너를 걸어 패널을
    // 접으므로, 여기서 막지 않으면 삭제 확인을 취소하려던 Esc가 편집 화면까지 닫아
    // 버린다. 합성 stopPropagation은 SyntheticEvent 내부에서 nativeEvent.stopPropagation도
    // 함께 호출하고(react-dom 소스로 실측 확인), React 19는 리스너를 document가 아니라
    // 루트 컨테이너에 붙이므로, 여기서 멈추면 네이티브 이벤트가 document까지 올라가지
    // 못한다 — 그래서 이 한 줄로 충분하다.
    e.stopPropagation()
    setArmed(false)
  }

  return (
    <button
      type="button"
      className={armed ? 'confirm-button confirm-armed' : 'confirm-button'}
      {...(armed || !ariaLabel ? {} : { 'aria-label': ariaLabel })}
      onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}
      onBlur={() => setArmed(false)}
      onKeyDown={handleKeyDown}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
