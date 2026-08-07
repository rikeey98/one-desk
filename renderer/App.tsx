import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/models'

function App(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.oneDesk.workspaces
      .list()
      .then(setWorkspaces)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>one-desk</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <p>workspace {workspaces.length}개</p>
      <button
        onClick={() => {
          window.oneDesk.workspaces
            .create({ name: `테스트 ${Date.now()}` })
            .then(() => window.oneDesk.workspaces.list())
            .then(setWorkspaces)
            .catch((e: unknown) => setError(String(e)))
        }}
      >
        workspace 추가
      </button>
      <ul>
        {workspaces.map((w) => (
          <li key={w.id}>{w.name}</li>
        ))}
      </ul>
    </div>
  )
}

export default App
