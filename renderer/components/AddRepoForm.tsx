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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !path.trim() || busy) return
    setBusy(true)
    try {
      await client.repos.create({ workspaceId, name: name.trim(), path: path.trim() })
      setName('')
      setPath('')
      await onAdded()
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
    </form>
  )
}
