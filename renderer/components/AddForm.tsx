import { useState, type FormEvent } from 'react'
import { IconPlus } from './icons'

export function AddForm({ placeholder, onSubmit }: {
  placeholder: string
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
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

  return (
    <form onSubmit={handleSubmit} className="add-form">
      {/* 입력칸 왼쪽의 + 표시. "여기에 적으면 새로 생긴다"를 placeholder보다 먼저 말한다. */}
      <span className="add-form-icon"><IconPlus /></span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={busy}
      />
      {error && <div role="alert" className="form-error">{error}</div>}
    </form>
  )
}
