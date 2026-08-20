import { useState } from 'react'

/**
 * 이름을 정확히 입력해야 열리는 삭제 확인.
 *
 * `ConfirmButton`(두 번 누르기)은 되돌릴 수 없지만 잃는 것이 작은 동작에 쓴다.
 * workspace 삭제는 그 안의 이슈·메모·실행 기록이 cascade로 함께 사라지므로
 * 무게가 맞지 않는다 — 무엇을 지우는지 손으로 한 번 쓰게 한다.
 */
export function DeleteByName({ name, onConfirm, onCancel }: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === name

  return (
    <div className="delete-by-name">
      <p className="delete-by-name-warning">
        이 workspace의 이슈·메모·실행 기록이 함께 지워집니다. 되돌릴 수 없습니다.
      </p>
      <input
        className="delete-by-name-input"
        aria-label={`삭제하려면 ${name} 을 입력`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          // ConfirmButton과 같은 이유다 — App이 document에 건 keydown이
          // 취소하려던 Esc로 열린 패널까지 닫아 버린다.
          e.stopPropagation()
          onCancel()
        }}
      />
      <div className="delete-by-name-actions">
        <button
          type="button"
          className="row-action-danger"
          aria-label={`${name} 삭제 확인`}
          disabled={!matches}
          onClick={onConfirm}
        >
          삭제
        </button>
        <button type="button" onClick={onCancel}>취소</button>
      </div>
    </div>
  )
}
