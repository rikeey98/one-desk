import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { IconPlus } from './icons'

export function AddForm({ placeholder, onSubmit, multiline = false }: {
  placeholder: string
  onSubmit: (value: string) => Promise<void>
  /**
   * 여러 줄로 쓴다 — 이슈·메모의 "첫 줄이 제목, 나머지가 본문"(`renderer/titleBody.ts`). **Enter는 만들기, Shift+Enter는
   * 줄바꿈이다** — 한 줄로 던지던 습관(제목 + Enter)이 그대로 된다. 이름 칸(workspace·asset)은 한 줄이다.
   */
  multiline?: boolean
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      setValue('')
    } catch (err) {
      // 입력값은 지우지 않는다. 실패했는데 지우면 다시 타이핑해야 한다.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void submit()
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중의 Enter는 글자를 확정하는 것이다 — 만들지 않는다.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    void submit()
  }

  return (
    <form onSubmit={handleSubmit} className={multiline ? 'add-form add-form-multiline' : 'add-form'}>
      {/* 입력칸 왼쪽의 + 표시. "여기에 적으면 새로 생긴다"를 placeholder보다 먼저 말한다. */}
      <span className="add-form-icon"><IconPlus /></span>
      {multiline
        ? (
          <textarea
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder={placeholder}
            title="Enter로 만들기 · Shift+Enter로 줄바꿈 — 첫 줄이 제목이 됩니다"
            disabled={busy}
          />
        )
        : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={busy}
          />
        )}
      {error && <div role="alert" className="form-error">{error}</div>}
    </form>
  )
}
