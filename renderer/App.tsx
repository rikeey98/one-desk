import { useEffect, useMemo, useState } from 'react'
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
import { useMcpStatus } from './hooks/useMcpStatus'
import { useWorkspaces } from './hooks/useWorkspaces'
import { useClient } from './client/ClientProvider'
import { chipKey, type ContextChip } from './context'
import { conversationIdOf } from './conversation'
import type { Run } from '@shared/models'

export default function App() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [chips, setChips] = useState<ContextChip[]>([])
  const [view, setView] = useState<'workspace' | 'inbox'>('workspace')
  // 인박스의 "대화 열기"·"다시 실행"이 세운다. Dock은 화면 전환 때 다시 마운트돼
  // 내부 상태가 초기화되므로, 어느 대화를 열지 여기서 지정해야 한다.
  // Dock에는 run이 아니라 그 run이 속한 대화 id로 직접 내려간다 — 변환이 필요 없다.
  const [focusConversationId, setFocusConversationId] = useState<string | null>(null)
  const [draftPrompt, setDraftPrompt] = useState('')
  // "다시 실행"이 요구하는 작업 디렉토리. 프롬프트만 옮기면 RunPanel의 cwd가 첫 repo로
  // 초기화돼 있어 원본과 다른 저장소에서 agent가 돈다.
  const [draftCwd, setDraftCwd] = useState<string | null>(null)
  // 확장된 패널과 그 안에서 열린 항목. **한 번에 하나뿐이다.**
  // 각 패널이 따로 들면 둘 다 열린 상태가 만들어지고, 컬럼 비율을 누가 정하는지도
  // 흐려진다. useRepos·useWorkspaces를 자식이 각자 부르다 두 번 사고가 났다.
  const [openItem, setOpenItem] = useState<{ panel: 'issue' | 'memo'; id: string } | null>(null)
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
  const mcpStatus = useMcpStatus()
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

  /**
   * 지운 workspace가 지금 고른 것이면 선택을 푼다.
   *
   * 풀지 않으면 사라진 workspace의 화면이 그대로 남아, 이슈·메모 패널이 없는
   * id로 조회하며 빈 목록을 그린다 — 사용자에게는 "지웠는데 아직 있다"로 보인다.
   * 맥락 칩과 열린 항목도 그 workspace의 것이므로 함께 비운다.
   */
  function forgetWorkspace(id: string) {
    if (id !== workspaceId) return
    setWorkspaceId(null)
    setRepoId(null)
    setChips([])
    setOpenItem(null)
  }

  /** 지운 repo로 걸러 두었으면 필터를 푼다 — 아니면 빈 목록만 남는다. */
  function forgetRepo(id: string) {
    if (id !== repoId) return
    setRepoId(null)
  }

  function selectWorkspace(id: string) {
    setWorkspaceId(id)
    setView('workspace')
    setRepoId(null)   // workspace가 바뀌면 이전 repo 필터는 무의미하다
    setChips([])      // 맥락도 마찬가지다. 다른 workspace의 항목은 실행 시 거부된다
    setOpenItem(null) // 다른 workspace의 항목을 열어둔 채로 둘 수 없다
  }

  function toggleChip(chip: ContextChip) {
    setChips((prev) => prev.some((c) => chipKey(c) === chipKey(chip))
      ? prev.filter((c) => chipKey(c) !== chipKey(chip))
      : [...prev, chip])
  }

  /** 같은 항목을 다시 누르면 접는다. 다른 패널을 누르면 그쪽으로 옮겨간다. */
  function openIn(panel: 'issue' | 'memo', id: string) {
    setOpenItem((prev) => (prev?.panel === panel && prev.id === id ? null : { panel, id }))
  }

  // Esc로 접는다. 상세 안의 삭제 확인은 자기가 먼저 Esc를 삼키므로(설계 §5)
  // 여기까지 올라오지 않는다.
  useEffect(() => {
    if (!openItem) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenItem(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [openItem])

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

  /**
   * 인박스가 부르는 확인 표시. 인박스 항목은 대화의 마지막 턴이므로, 그 id를 그대로
   * 찍으면 대화가 인박스에서 내려가지 않는다(Task 5의 판정은 root run의 reviewedAt
   * 기준). 뿌리로 변환해 review에 넘긴다.
   */
  function reviewConversation(run: Run, kind: 'confirmed' | 'archived') {
    review(conversationIdOf(run), kind)
  }

  /** 인박스 항목을 그 run의 workspace 화면으로 데려간다. */
  function goToRun(run: Run) {
    setWorkspaceId(run.workspaceId)
    setRepoId(null)
    setChips([])
    setView('workspace')
  }

  /**
   * 인박스 항목을 그 대화로 데려간다.
   *
   * 항목은 대화의 마지막 턴이므로 여는 것은 그 뿌리다. 대화창이 대화록과
   * 입력을 함께 주므로 "로그 보기"와 "이어서 실행"이 하나로 합쳐졌다 (설계 §5).
   *
   * RunPanel의 draftPrompt effect는 대화가 있으면(!conversation이 아니면) 반영하지
   * 않지만(설계 §7), 그것만 믿고 여기서 draft를 안 지우면 두 컴포넌트에 걸친
   * 타이밍 계약이 생긴다: Dock이 마운트 첫 렌더부터 focusConversationId로 그
   * 대화를 미리 찾아 두지 못하면(예: 다른 workspace의 run을 열어 그 workspace의
   * runs가 아직 안 왔을 때) conversation이 잠깐 비어 있고, 그 찰나에 낡은
   * draftPrompt가 새어 들어간다(실측: "다시 실행" 뒤 인박스로 돌아가 다른 대화를
   * 열면 이전 draft가 그 대화 입력에 채워짐). 여기서 미리 비워 두면 그 값 자체가
   * 없으니 새어 들어갈 것도 없다 — RunPanel의 가드와 함께 두 겹의 방어가 된다.
   */
  function openConversation(run: Run) {
    goToRun(run)
    setDraftPrompt('')
    setDraftCwd(null)
    setFocusConversationId(conversationIdOf(run))
  }

  function restart(run: Run) {
    goToRun(run)
    setDraftPrompt(run.userPrompt)
    // 원본이 돌던 디렉토리까지 함께 옮긴다. 이것이 빠지면 RunPanel이 첫 repo로
    // 실행해 엉뚱한 저장소가 편집된다 (권한 기본값이 edit이다).
    setDraftCwd(run.cwd)
    // focusConversationId를 비워야 Dock이 새 대화 탭(draftPrompt/draftCwd가 채워진)을
    // 연다 — 남아 있으면 "다시 실행"이 겨눈 대화가 대신 열린다.
    setFocusConversationId(null)
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
      .then(() => { review(conversationIdOf(run), 'archived') })
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
        mcpStatus={mcpStatus}
        onDeleted={forgetWorkspace}
      />
      <main className="main">
        {view === 'inbox' && (
          <InboxPanel
            items={inboxItems}
            workspaces={workspaces}
            error={inboxActionError ?? inboxError}
            onReview={reviewConversation}
            onOpenConversation={openConversation}
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
              onDeleted={forgetRepo}
            />
            <div className="columns">
              <IssuePanel
                workspaceId={workspaceId}
                repoId={repoId}
                chipKeys={chipKeys}
                onToggleContext={toggleChip}
                expanded={openItem?.panel === 'issue'}
                openId={openItem?.panel === 'issue' ? openItem.id : null}
                onOpen={(id) => openIn('issue', id)}
              />
              <MemoPanel
                workspaceId={workspaceId}
                repoId={repoId}
                chipKeys={chipKeys}
                onToggleContext={toggleChip}
                expanded={openItem?.panel === 'memo'}
                openId={openItem?.panel === 'memo' ? openItem.id : null}
                onOpen={(id) => openIn('memo', id)}
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
              draftPrompt={draftPrompt}
              draftCwd={draftCwd}
              focusConversationId={focusConversationId}
              // 담은 맥락은 그 턴에만 적용된다. 다음 실행은 빈 상태에서 시작한다.
              onRunStarted={() => { setChips([]); setDraftPrompt(''); setDraftCwd(null) }}
            />
          </>
        )}
      </main>
    </div>
  )
}
