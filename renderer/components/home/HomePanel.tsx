import { useEffect, useRef, useState } from 'react'
import type { AgentProbes, AgentStatuses, HomeSummary, HomeTarget, StartRunInput, Workspace } from '@shared/models'
import type { SetupState } from '../../home/setup'
import { startOfDay } from '../../report/period'
import { HomeRunning } from './HomeRunning'
import { HomeTodos } from './HomeTodos'
import { HomeTimeline } from './HomeTimeline'
import { HomeWorkspaces } from './HomeWorkspaces'
import { HomeComposer } from './HomeComposer'
import { HomeSetup } from './HomeSetup'

/** 이 폭부터 둘·셋 열이고 타임라인을 그린다 (FR-13). CSS 컨테이너 쿼리와 같은 수다 */
export const HOME_WIDE_PX = 1280

/** 홈 줄의 행동 — 전부 App이 내리는 **필수** prop이다(FR-8, CLAUDE.md "배선도 검증 대상") */
export interface HomeActions {
  onOpenConversation: (workspaceId: string, conversationId: string) => void
  onReply: (workspaceId: string, conversationId: string) => void
  onResend: (workspaceId: string, runId: string) => void
  onStop: (runId: string) => void
  onTriage: (workspaceId: string) => void
  onOpenIssues: (workspaceId: string) => void
  onOpenWorkspace: (workspaceId: string) => void
  onStartConversation: (input: StartRunInput, target: HomeTarget) => Promise<void>
  /** 준비 단계 (FR-16) */
  onFocusWorkspaceAdd: () => void
  onOpenRepoForm: () => void
  onRefreshCli: () => void
  onOpenSettings: () => void
  onStartFirstConversation: () => void
}

/**
 * 홈 (`docs/sdlc/home/`). 그리기만 한다 — 요약은 `useHome`, 판정은 `renderer/home/*`·core. `setup.done`이 아니면 본문 대신
 * 준비 단계다(FR-14). 폭은 `ResizeObserver`로 재서 `HomeBody`에 넘긴다 — jsdom에는 그것이 없어 테스트는 `HomeBody`를 폭과 함께 본다.
 */
export function HomePanel({
  summary, error, lastTarget, setup, workspaces, cli, now, platform, actions
}: {
  summary: HomeSummary | null
  error: string | null
  lastTarget: HomeTarget | null
  /** core의 셋 + CLI 칸 + done — App이 `setupStateOf`로 합친다. 요약 전이면 null */
  setup: SetupState | null
  workspaces: Workspace[]
  cli: { statuses: AgentStatuses | null; probes: AgentProbes | null; probing: boolean }
  now: number
  platform: string
  actions: HomeActions
}) {
  const ref = useRef<HTMLElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  return (
    <section className="home" ref={ref} aria-label="홈">
      {error && <div role="alert" className="form-error">{error}</div>}
      {!summary || !setup
        ? <p className="home-empty">불러오는 중…</p>
        : !setup.done
          ? (
            <HomeSetup
              setup={setup}
              workspaces={summary.workspaces}
              statuses={cli.statuses}
              probes={cli.probes}
              probing={cli.probing}
              platform={platform}
              onFocusWorkspaceAdd={actions.onFocusWorkspaceAdd}
              onOpenRepoForm={actions.onOpenRepoForm}
              onRefreshCli={actions.onRefreshCli}
              onOpenSettings={actions.onOpenSettings}
              onStartFirstConversation={actions.onStartFirstConversation}
            />
          )
          : <HomeBody summary={summary} lastTarget={lastTarget} workspaces={workspaces} now={now} width={width ?? HOME_WIDE_PX} actions={actions} />}
    </section>
  )
}

/** 본문 — 폭을 prop으로 받는다(테스트가 1280 아래를 본다). 1280px 아래에서는 타임라인을 그리지 않는다(FR-13) */
export function HomeBody({
  summary, lastTarget, workspaces, now, width, actions
}: {
  summary: HomeSummary
  lastTarget: HomeTarget | null
  workspaces: Workspace[]
  now: number
  width: number
  actions: HomeActions
}) {
  const wide = width >= HOME_WIDE_PX
  return (
    <div className={wide ? 'home-body home-body-wide' : 'home-body'}>
      <div className="home-top">
        <HomeRunning running={summary.running} queued={summary.queued} slots={summary.slots} now={now} onOpen={actions.onOpenConversation} onStop={actions.onStop} />
        {wide && <HomeTimeline rows={summary.timeline} dayStart={startOfDay(now)} now={now} />}
      </div>
      <HomeTodos
        todos={summary.todos}
        now={now}
        onReply={actions.onReply}
        onResend={actions.onResend}
        onOpenConversation={actions.onOpenConversation}
        onTriage={actions.onTriage}
        onOpenIssues={actions.onOpenIssues}
      />
      <HomeWorkspaces workspaces={summary.workspaces} doneToday={summary.doneToday} now={now} onOpenWorkspace={actions.onOpenWorkspace} />
      <HomeComposer workspaces={workspaces} rows={summary.workspaces} lastTarget={lastTarget} onStartConversation={actions.onStartConversation} />
    </div>
  )
}
