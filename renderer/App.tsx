import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { RepoStrip } from './components/RepoStrip'
import { IssuePanel } from './components/IssuePanel'
import { MemoPanel } from './components/MemoPanel'
import { AssetPanel } from './components/AssetPanel'
import { Dock } from './components/Dock'
import { useRuns } from './hooks/useRuns'

export default function App() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  const { runs, error: runsError } = useRuns(workspaceId)

  function selectWorkspace(id: string) {
    setWorkspaceId(id)
    setRepoId(null)   // workspace가 바뀌면 이전 repo 필터는 무의미하다
  }

  return (
    <div className="app">
      <Sidebar selectedId={workspaceId} onSelect={selectWorkspace} />
      <main className="main">
        {!workspaceId && <div className="blank">왼쪽에서 workspace를 선택하세요</div>}
        {workspaceId && (
          <>
            <RepoStrip workspaceId={workspaceId} selectedRepoId={repoId} onSelect={setRepoId} />
            <div className="columns">
              <IssuePanel workspaceId={workspaceId} repoId={repoId} />
              <MemoPanel workspaceId={workspaceId} repoId={repoId} />
              <AssetPanel />
            </div>
            <Dock runs={runs} error={runsError} />
          </>
        )}
      </main>
    </div>
  )
}
