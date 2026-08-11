import { useMemo, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { RepoStrip } from './components/RepoStrip'
import { IssuePanel } from './components/IssuePanel'
import { MemoPanel } from './components/MemoPanel'
import { AssetPanel } from './components/AssetPanel'
import { Dock } from './components/Dock'
import { useRuns } from './hooks/useRuns'
import { useRepos } from './hooks/useRepos'
import { useQueue } from './hooks/useQueue'
import { useClient } from './client/ClientProvider'
import { chipKey, type ContextChip } from './context'

export default function App() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [chips, setChips] = useState<ContextChip[]>([])
  const { runs, error: runsError } = useRuns(workspaceId)
  // RepoStrip과 RunPanel(Dock 아래)이 각자 useRepos를 부르면 서로의 상태를 모른다 —
  // repo를 등록해도 RunPanel의 작업 디렉토리 select가 영원히 비는 실제 결함이었다.
  // useRuns와 같은 패턴으로 여기서 한 번만 불러 양쪽에 내려준다.
  const { repos, error: reposError, refresh: refreshRepos } = useRepos(workspaceId)
  // 훅을 공통 부모에 둔다. RepoStrip과 RunPanel이 각자 useRepos 인스턴스를 갖는 바람에
  // repo를 등록해도 한쪽만 갱신된 사고가 있었다(커밋 fbcd0e6).
  const { snapshot: queue, error: queueError } = useQueue()
  // 상한 변경 실패도 큐 오류와 같은 자리에 뜬다. 방금 누른 것이 더 급하므로 앞에 온다.
  const [limitError, setLimitError] = useState<string | null>(null)
  const client = useClient()

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

  function changeLimit(n: number) {
    // 성공한 스냅샷은 event:queueUpdate로도 오므로 여기서 따로 쓰지 않는다.
    // 실패는 삼키지 않는다 — 삼키면 표시기가 그냥 안 움직이고 사용자는 이유를
    // 알 길이 없다. Dock이 queueError를 그리는 기존 배너로 흘려 보낸다.
    setLimitError(null)
    client.runs.setConcurrencyLimit(n).catch((err: unknown) => {
      setLimitError(err instanceof Error ? err.message : String(err))
    })
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
              repos={repos}
              error={reposError}
              refresh={refreshRepos}
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
              repos={repos}
              reposError={reposError}
              queue={queue}
              queueError={limitError ?? queueError}
              onChangeLimit={changeLimit}
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
