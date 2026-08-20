import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/**
 * 제자리에서 이름을 고치는 입력. workspace와 repo가 함께 쓴다.
 *
 * 이 앱에는 모달이 없다(설계 §5) — 목록의 이름이 그 자리에서 입력창으로 바뀐다.
 * Enter와 포커스 잃기는 저장, Esc는 취소다. 바뀐 것이 없거나 빈 이름이면
 * 저장하지 않고 취소로 끝낸다 — 헛된 쓰기가 updatedAt만 올리는 것을 막는다.
 */
export function RenameField({ initial, label, onSubmit, onCancel }: {
  initial: string
  /** 접근성 이름. 무엇의 이름을 고치는 중인지 읽어줘야 한다 */
  label: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  // 끝내고 나서 blur가 다시 오면 저장이 두 번 나간다.
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    // 전체를 선택해 둔다 — 이름을 통째로 바꾸는 것이 대부분이고,
    // 일부만 고치려면 방향키 한 번이면 된다.
    ref.current?.select()
  }, [])

  function finish() {
    if (done.current) return
    done.current = true
    const trimmed = value.trim()
    if (trimmed === '' || trimmed === initial) {
      onCancel()
      return
    }
    onSubmit(trimmed)
  }

  function cancel() {
    if (done.current) return
    done.current = true
    onCancel()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
      return
    }
    if (e.key !== 'Escape') return
    // Esc는 안쪽부터 푼다. App.tsx가 document에 keydown을 걸어 열린 패널을
    // 접으므로, 여기서 멈추지 않으면 이름 편집을 취소하려던 Esc가 화면까지 닫는다
    // (ConfirmButton이 같은 이유로 같은 일을 한다).
    e.stopPropagation()
    e.preventDefault()
    cancel()
  }

  return (
    <input
      ref={ref}
      className="rename-field"
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={finish}
    />
  )
}
