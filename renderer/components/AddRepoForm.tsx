import { useState, type FormEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import { IconFolder } from './icons'

/** 경로의 마지막 조각. 렌더러에는 node:path가 없고, 구분자는 OS마다 다르다. */
function folderName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? ''
}

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

  async function pickFolder() {
    setError(null)
    try {
      const picked = await client.app.pickDirectory()
      if (picked === null) return
      setPath(picked)
      // 이미 적어 둔 이름은 사람이 고른 것이다 — 덮어쓰지 않는다.
      setName((current) => current.trim() ? current : folderName(picked))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="add-repo-form">
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="repo 이름" disabled={busy} />
      {/* 직접 치는 칸도 남긴다 — 경로를 붙여 넣는 편이 빠를 때가 있고, e2e가 이 칸을 쓴다. */}
      <div className="add-repo-path">
        <input value={path} onChange={(e) => setPath(e.target.value)}
          placeholder="/절대/경로" disabled={busy} />
        <button type="button" className="add-repo-pick" aria-label="폴더 선택" title="폴더 선택"
          onClick={() => void pickFolder()} disabled={busy}>
          <IconFolder />
        </button>
      </div>
      <button type="submit" disabled={busy}>추가</button>
      {error && <div role="alert" className="form-error">{error}</div>}
    </form>
  )
}
