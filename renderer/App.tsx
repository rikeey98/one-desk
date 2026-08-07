import { useState } from 'react'
import { useClient } from './client/ClientProvider'
import { useWorkspaces } from './hooks/useWorkspaces'

function App(): React.JSX.Element {
  const client = useClient()
  const { workspaces, refresh } = useWorkspaces()
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>one-desk</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <p>workspace {workspaces.length}개</p>
      <button
        onClick={() => {
          client.workspaces
            .create({ name: `테스트 ${Date.now()}` })
            .then(() => refresh())
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
