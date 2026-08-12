import { useMemo, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { RepoStrip } from './components/RepoStrip'
import { IssuePanel } from './components/IssuePanel'
import { MemoPanel } from './components/MemoPanel'
import { AssetPanel } from './components/AssetPanel'
import { Dock } from './components/Dock'
import { InboxPanel } from './components/InboxPanel'
import { useRuns } from './hooks/useRuns'
import { useRepos } from './hooks/useRepos'
import { useQueue } from './hooks/useQueue'
import { useInbox } from './hooks/useInbox'
import { useWorkspaces } from './hooks/useWorkspaces'
import { useClient } from './client/ClientProvider'
import { chipKey, type ContextChip } from './context'
import type { Run } from '@shared/models'

export default function App() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [chips, setChips] = useState<ContextChip[]>([])
  const [view, setView] = useState<'workspace' | 'inbox'>('workspace')
  // 인박스의 "이어서 실행"·"다시 실행"이 세우고, Dock 아래 RunPanel이 읽는다.
  const [resumeFrom, setResumeFrom] = useState<Run | null>(null)
  // 인박스의 "로그 보기"가 세운다. Dock은 화면 전환 때 다시 마운트돼 내부 상태가
  // 초기화되므로, 어느 run의 로그를 열지 여기서 지정해야 한다.
  const [focusRun, setFocusRun] = useState<Run | null>(null)
  const [draftPrompt, setDraftPrompt] = useState('')
  // "다시 실행"이 요구하는 작업 디렉토리. 프롬프트만 옮기면 RunPanel의 cwd가 첫 repo로
  // 초기화돼 있어 원본과 다른 저장소에서 agent가 돈다.
  const [draftCwd, setDraftCwd] = useState<string | null>(null)
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
  // 목록은 인박스가 열려 있을 때만 다시 읽는다 — 배지는 push된 건수로 세운다.
  const { items: inboxItems, counts: inboxCounts, error: inboxError } = useInbox(view === 'inbox')
  // Sidebar와 RunPanel이 각자 useWorkspaces()를 부르면 서로의 상태를 모른다 — Sidebar에서
  // workspace를 만들어도 App 쪽 인스턴스(→ InboxPanel)는 그 사실을 몰라, 인박스가 방금
  // 만든 workspace를 "(사라진 workspace)"로 그리는 실제 결함이었다(2026-08-12, task 9
  // e2e에서 발견 — 단위 테스트는 컴포넌트를 하나씩 렌더링해 인스턴스가 항상 하나뿐이라
  // 잡지 못했다). useRepos와 같은 패턴으로(커밋 fbcd0e6) 여기서 한 번만 불러
  // Sidebar·RunPanel·InboxPanel 모두에 내려준다.
  const { workspaces, loading: workspacesLoading, error: workspacesError, refresh: refreshWorkspaces } = useWorkspaces()
  // 인박스 행동(확인함/보관/이슈 연동) 실패도 조용히 삼키지 않는다 — inboxError와
  // 같은 자리에 뜨되, 방금 누른 행동의 오류가 더 급하므로 앞에 온다.
  const [inboxActionError, setInboxActionError] = useState<string | null>(null)
  const client = useClient()

  const chipKeys = useMemo(() => new Set(chips.map(chipKey)), [chips])

  function selectWorkspace(id: string) {
    setWorkspaceId(id)
    setView('workspace')
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

  function review(runId: string, kind: 'confirmed' | 'archived') {
    setInboxActionError(null)
    client.runs.markReviewed(runId, kind).catch((err: unknown) => {
      setInboxActionError(err instanceof Error ? err.message : String(err))
    })
  }

  /** 인박스 항목을 그 run의 workspace 화면으로 데려간다. */
  function goToRun(run: Run) {
    setWorkspaceId(run.workspaceId)
    setRepoId(null)
    setChips([])
    setView('workspace')
  }

  function openLog(run: Run) {
    goToRun(run)
    // Dock은 화면이 바뀌며 다시 마운트돼 내부 view가 'new'로 돌아간다 — 어느 run의
    // 로그를 열지 여기서 지정하지 않으면 버튼이 실행 패널만 열고 만다.
    setResumeFrom(null)
    setDraftPrompt('')
    setDraftCwd(null)
    setFocusRun(run)
  }

  function startResume(run: Run) {
    goToRun(run)
    setResumeFrom(run)
    // resume 모드의 프롬프트와 맥락 칩은 비어 있다 (설계 §7). "다시 실행"을 눌렀다가
    // 실행하지 않고 돌아오면 그때 세운 draft가 그대로 남아 프롬프트를 채운다.
    setDraftPrompt('')
    setDraftCwd(null)
    // 로그를 보던 상태가 남아 있으면 Dock이 실행 패널 대신 그 로그를 연다.
    setFocusRun(null)
  }

  function restart(run: Run) {
    goToRun(run)
    setResumeFrom(null)
    setDraftPrompt(run.userPrompt)
    // 원본이 돌던 디렉토리까지 함께 옮긴다. 이것이 빠지면 RunPanel이 첫 repo로
    // 실행해 엉뚱한 저장소가 편집된다 (권한 기본값이 edit이다).
    setDraftCwd(run.cwd)
    setFocusRun(null)
  }

  /**
   * 이슈만 닫고 run은 인박스에 남긴다.
   *
   * 설계 §5의 reviewedKind 표에 이 행동이 없고, 같은 절이 "이슈가 여럿이면 각각
   * 보인다"고 적었다. 여기서 run까지 확인 처리하면 첫 이슈를 닫는 순간 항목이
   * 사라져 나머지를 닫을 수 없다. 확인은 사용자의 "확인함"에 맡긴다.
   */
  function closeIssue(_run: Run, issueId: string) {
    setInboxActionError(null)
    client.issues.update({ id: issueId, status: 'done' })
      .catch((err: unknown) => {
        setInboxActionError(err instanceof Error ? err.message : String(err))
      })
  }

  function makeIssue(run: Run) {
    setInboxActionError(null)
    // 실패는 대개 나중에 다뤄야 할 일인데, 인박스에서 사라지면 그대로 잊힌다.
    const title = run.userPrompt.trim().split('\n')[0] || '실패한 실행'
    client.issues.create({
      workspaceId: run.workspaceId,
      title,
      body: run.errorMessage ?? ''
    })
      .then(() => { review(run.id, 'archived') })
      .catch((err: unknown) => {
        setInboxActionError(err instanceof Error ? err.message : String(err))
      })
  }

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        loading={workspacesLoading}
        error={workspacesError}
        refresh={refreshWorkspaces}
        selectedId={workspaceId}
        onSelect={selectWorkspace}
        view={view}
        onSelectInbox={() => setView('inbox')}
        counts={inboxCounts}
        countsError={inboxError}
      />
      <main className="main">
        {view === 'inbox' && (
          <InboxPanel
            items={inboxItems}
            workspaces={workspaces}
            error={inboxActionError ?? inboxError}
            onReview={review}
            onOpenLog={openLog}
            onResume={startResume}
            onRestart={restart}
            onCloseIssue={closeIssue}
            onMakeIssue={makeIssue}
          />
        )}
        {view === 'workspace' && !workspaceId && (
          <div className="blank">왼쪽에서 workspace를 선택하세요</div>
        )}
        {view === 'workspace' && workspaceId && (
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
              workspaces={workspaces}
              repos={repos}
              reposError={reposError}
              queue={queue}
              queueError={limitError ?? queueError}
              onChangeLimit={changeLimit}
              chips={chips}
              onRemoveChip={toggleChip}
              resumeFrom={resumeFrom}
              draftPrompt={draftPrompt}
              draftCwd={draftCwd}
              focusRun={focusRun}
              onExitResume={() => { setResumeFrom(null); setDraftPrompt(''); setDraftCwd(null) }}
              // 담은 맥락은 그 run에만 적용된다. 다음 실행은 빈 상태에서 시작한다.
              // resume 모드도 실행이 시작되면 풀어야 다음이 새 실행으로 돌아간다.
              onRunStarted={() => { setChips([]); setResumeFrom(null); setDraftPrompt(''); setDraftCwd(null) }}
            />
          </>
        )}
      </main>
    </div>
  )
}
