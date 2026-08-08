import { useState, type FormEvent } from 'react'
import { useClient } from '../client/ClientProvider'

export function AddRepoForm({ workspaceId, onAdded }: {
  workspaceId: string
  onAdded: () => Promise<void>
}) {
  const client = useClient()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !path.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await client.repos.create({ workspaceId, name: name.trim(), path: path.trim() })
      setName('')
      setPath('')
      await onAdded()
    } catch (err) {
      // 입력값은 지우지 않는다. 실패했는데 지우면 다시 타이핑해야 한다.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="add-repo-form">
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="repo 이름" disabled={busy} />
      <input value={path} onChange={(e) => setPath(e.target.value)}
        placeholder="/절대/경로" disabled={busy} />
      <button type="submit" disabled={busy}>추가</button>
      {error && <div role="alert" className="form-error">{error}</div>}
    </form>
  )
}
