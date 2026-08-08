import { useMemo, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { RepoStrip } from './components/RepoStrip'
import { IssuePanel } from './components/IssuePanel'
import { MemoPanel } from './components/MemoPanel'
import { AssetPanel } from './components/AssetPanel'
import { Dock } from './components/Dock'
import { useRuns } from './hooks/useRuns'
import { chipKey, type ContextChip } from './context'

export default function App() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [chips, setChips] = useState<ContextChip[]>([])
  const { runs, error: runsError } = useRuns(workspaceId)

  const chipKeys = useMemo(() => new Set(chips.map(chipKey)), [chips])

  function selectWorkspace(id: string) {
    setWorkspaceId(id)
    setRepoId(null)   // workspace가 바뀌면 이전 repo 필터는 무의미하다
    setChips([])      // 맥락도 마찬가지다. 다른 workspace의 항목은 실행 시 거부된다
  }

  function toggleChip(chip: ContextChip) {
    setChips((prev) => prev.some((c) => chipKey(c) === chipKey(chip))
      ? prev.filter((c) => chipKey(c) !== chipKey(chip))
      : [...prev, chip])
  }

  return (
    <div className="app">
      <Sidebar selectedId={workspaceId} onSelect={selectWorkspace} />
      <main className="main">
        {!workspaceId && <div className="blank">왼쪽에서 workspace를 선택하세요</div>}
        {workspaceId && (
          <>
            <RepoStrip
              workspaceId={workspaceId}
              selectedRepoId={repoId}
              onSelect={setRepoId}
              chipKeys={chipKeys}
              onToggleContext={toggleChip}
            />
            <div className="columns">
              <IssuePanel
                workspaceId={workspaceId}
                repoId={repoId}
                chipKeys={chipKeys}
                onToggleContext={toggleChip}
              />
              <MemoPanel
                workspaceId={workspaceId}
                repoId={repoId}
                chipKeys={chipKeys}
                onToggleContext={toggleChip}
              />
              <AssetPanel />
            </div>
            <Dock
              runs={runs}
              error={runsError}
              workspaceId={workspaceId}
              chips={chips}
              onRemoveChip={toggleChip}
              // 담은 맥락은 그 run에만 적용된다. 다음 실행은 빈 상태에서 시작한다.
              onRunStarted={() => setChips([])}
            />
          </>
        )}
      </main>
    </div>
  )
}
