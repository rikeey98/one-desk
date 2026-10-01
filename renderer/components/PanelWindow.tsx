import { useCallback, useEffect, useState } from 'react'
import { IssuePanel } from './IssuePanel'
import { MemoPanel } from './MemoPanel'
import { AssetPanel } from './AssetPanel'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useRepos } from '../hooks/useRepos'
import { PANEL_KIND_LABELS } from '../panelKinds'
import { WindowSplitProvider } from './WindowSplit'
import type { PanelScope } from '@shared/panelWindow'

/**
 * 패널 창의 뿌리 (docs/sdlc/item-windows/). 범위(종류, workspace, repo)는 창을 연 순간 해시로 정해지고
 * **바뀌지 않는다**(FR-2) — 앱 창의 repo 선택과 아무것도 나누지 않는다. 그리는 것은 앱 창과 같은 패널
 * 컴포넌트다(FR-6). 맥락 담기는 넘기지 않는다(FR-8).
 *
 * `scope`가 null이면 해시가 패널 창 모양인데 읽을 수 없는 것이다(FR-13).
 */
export function PanelWindow({ scope }: { scope: PanelScope | null }) {
  if (!scope) {
    return (
      <div className="panel-window-root">
        <p role="alert" className="panel-window-gone">열 수 없는 창입니다</p>
      </div>
    )
  }
  return <ScopedPanel scope={scope} />
}

function ScopedPanel({ scope }: { scope: PanelScope }) {
  const { workspaces, loading } = useWorkspaces()
  const { repos, loaded: reposLoaded } = useRepos(scope.workspaceId)
  const [openId, setOpenId] = useState<string | null>(null)

  const workspace = workspaces.find((w) => w.id === scope.workspaceId) ?? null
  const repo = scope.repoId ? repos.find((r) => r.id === scope.repoId) ?? null : null

  // 범위가 사라졌는가 (FR-10). 읽기 전에는 판단하지 않는다 — 뜨자마자 "삭제됐습니다"가 깜빡인다.
  const workspaceGone = !loading && workspace === null
  const repoGone = !workspaceGone && scope.repoId !== null && reposLoaded && repo === null

  const kindLabel = PANEL_KIND_LABELS[scope.kind]
  const scopeName = repo?.name ?? (scope.repoId === null && workspace ? `${workspace.name} 전체` : null)
  const title = scopeName ? `${kindLabel} · ${scopeName}` : kindLabel

  // 창 제목 (FR-4). Electron이 문서 제목을 창 제목으로 쓰므로 main이 따로 볼 필요가 없다. 이름이 바뀌면
  // 바뀜 알림으로 목록을 다시 읽고(useWorkspaces·useRepos) 여기가 다시 그려진다.
  useEffect(() => { document.title = title }, [title])

  /** 같은 항목을 다시 누르면 닫는다 — 앱 창의 openIn과 같은 규칙. */
  const onOpen = useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id))
  }, [])

  // Esc로 열린 상세를 닫는다(FR-9). 이슈·메모 상세는 자기 Esc로 저장을 흘려보낸 뒤 닫으며 전파를 막으므로
  // 여기는 asset 상세의 길이다. 창은 닫지 않는다 — 상세를 닫으려다 창이 사라지면 안 된다.
  useEffect(() => {
    if (!openId) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [openId])

  if (workspaceGone || repoGone) {
    return (
      <div className="panel-window-root">
        <p role="alert" className="panel-window-gone">
          {workspaceGone ? '이 workspace는 삭제됐습니다' : '이 repo는 삭제됐습니다'}
        </p>
      </div>
    )
  }

  const common = { workspaceId: scope.workspaceId, repoId: scope.repoId, repos, layout: 'window' as const, openId }
  return (
    <div className="panel-window-root">
      <h1 className="panel-window-title">{title}</h1>
      {/* 목록 폭·숨김은 종류마다 이 장비에 남는다 (FR-26~28). */}
      <WindowSplitProvider kind={scope.kind}>
        {scope.kind === 'issue' && <IssuePanel {...common} expanded={false} onOpen={onOpen} />}
        {scope.kind === 'memo' && <MemoPanel {...common} expanded={false} onOpen={onOpen} />}
        {scope.kind === 'asset' && <AssetPanel {...common} expanded={false} onOpen={onOpen} />}
      </WindowSplitProvider>
    </div>
  )
}
