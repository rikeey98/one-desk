import type { AgentKind, ContextItemRef, Permission, Repo, Schedule, ScheduleConversationMode, ScheduleInput, Workspace } from '@shared/models'
import type { HourlyStep, ScheduleTrigger, TriggerKind } from '@shared/scheduleTrigger'
import { defaultEffortOf, defaultModelOf } from '../runDefaults'
import { agentBlockedReason } from '../agentEnv'

/**
 * 정기 실행 편집 칸의 초안 (`docs/sdlc/scheduled-runs/` spec FR-28~31). 주기의 칸은 종류마다 따로 쥔다 — 종류를 바꿔도 다른 종류에
 * 쳐 둔 값이 사라지지 않게. 저장할 때 고른 종류의 칸만 `ScheduleTrigger`가 된다. 검증은 core가 한다(렌더러는 croner를 모른다).
 */
export interface ScheduleDraft {
  workspaceId: string
  repoId: string
  name: string
  triggerKind: TriggerKind
  /** daily·weekdays·weekly의 HH:MM */
  time: string
  /** weekly */
  days: number[]
  everyHours: HourlyStep
  minute: number
  cron: string
  conversationMode: ScheduleConversationMode
  agentKind: AgentKind
  model: string
  effort: string
  permission: Permission
  prompt: string
  context: ContextItemRef[]
}

const TRIGGER_DEFAULTS = { time: '09:00', days: [1], everyHours: 3 as HourlyStep, minute: 0, cron: '0 9 * * 1-5' }

/**
 * 새 정기 실행 — 실행 패널과 같은 기본값 함수(`runDefaults.ts`)가 그 workspace에서 만든다. WSL repo에서 OpenCode가 막히면 Claude Code로
 * 떨어뜨린다(`newRunInput`과 같은 규칙).
 */
export function emptyDraft(workspace: Workspace, repos: readonly Repo[]): ScheduleDraft {
  const repo = repos[0]
  const wanted = workspace.defaultAgentKind
  const agentKind: AgentKind = repo && agentBlockedReason(repo.agentEnv, wanted) ? 'claude-code' : wanted
  return {
    workspaceId: workspace.id,
    repoId: repo?.id ?? '',
    name: '',
    triggerKind: 'weekdays',
    ...TRIGGER_DEFAULTS,
    conversationMode: 'new',
    agentKind,
    model: defaultModelOf(workspace, agentKind),
    effort: defaultEffortOf(workspace, agentKind),
    permission: workspace.defaultPermission,
    prompt: '',
    context: []
  }
}

/** 저장된 정기 실행의 초안. 쓰지 않는 종류의 칸은 기본값이다 */
export function draftOf(s: Schedule): ScheduleDraft {
  const t = s.trigger
  return {
    workspaceId: s.workspaceId,
    repoId: s.repoId ?? '',
    name: s.name,
    triggerKind: t.kind,
    time: t.kind === 'daily' || t.kind === 'weekdays' || t.kind === 'weekly' ? t.time : TRIGGER_DEFAULTS.time,
    days: t.kind === 'weekly' ? [...t.days] : TRIGGER_DEFAULTS.days,
    everyHours: t.kind === 'hourly' ? t.everyHours : TRIGGER_DEFAULTS.everyHours,
    minute: t.kind === 'hourly' ? t.minute : TRIGGER_DEFAULTS.minute,
    cron: t.kind === 'cron' ? t.expr : TRIGGER_DEFAULTS.cron,
    conversationMode: s.conversationMode,
    agentKind: s.agentKind,
    model: s.model ?? '',
    effort: s.effort ?? '',
    permission: s.permission,
    prompt: s.prompt,
    context: s.context
  }
}

export function triggerOf(d: ScheduleDraft): ScheduleTrigger {
  switch (d.triggerKind) {
    case 'daily': return { kind: 'daily', time: d.time }
    case 'weekdays': return { kind: 'weekdays', time: d.time }
    case 'weekly': return { kind: 'weekly', days: [...d.days].sort((a, b) => a - b), time: d.time }
    case 'hourly': return { kind: 'hourly', everyHours: d.everyHours, minute: d.minute }
    case 'cron': return { kind: 'cron', expr: d.cron }
  }
}

/** 보낼 입력. 빈 모델·effort는 null(= CLI 기본값) */
export function inputOf(d: ScheduleDraft, timeZone: string): ScheduleInput {
  return {
    workspaceId: d.workspaceId,
    repoId: d.repoId,
    name: d.name.trim(),
    trigger: triggerOf(d),
    timeZone,
    conversationMode: d.conversationMode,
    agentKind: d.agentKind,
    model: d.model.trim() || null,
    effort: d.effort.trim() || null,
    permission: d.permission,
    prompt: d.prompt,
    context: d.context
  }
}

/** 저장 버튼은 바뀐 것이 있을 때만 (FR-31). 새 정기 실행은 늘 저장할 것이 있다 */
export function isDirty(d: ScheduleDraft, saved: Schedule | null): boolean {
  if (!saved) return true
  // 시간대는 둘 다 저장된 것을 넣으므로 비교에 영향이 없다
  return JSON.stringify(inputOf(d, saved.timeZone)) !== JSON.stringify(inputOf(draftOf(saved), saved.timeZone))
}

/** 전체 허용으로 "올리는가" (FR-29) — 이미 전체 허용인 것에서 다른 것만 고칠 때는 묻지 않는다. 처음 만들 때 전체 허용이면 올리는 것이다 */
export function raisesToFull(d: ScheduleDraft, saved: Schedule | null): boolean {
  return d.permission === 'full' && saved?.permission !== 'full'
}

/** 이어 가던 대화가 끊기는가 (FR-30) — 세션은 그 CLI·그 디렉토리의 것이라 이을 수 없다 */
export function conversationBreaks(d: ScheduleDraft, saved: Schedule | null): boolean {
  if (!saved || saved.conversationMode !== 'continue' || saved.conversationId === null) return false
  return d.conversationMode === 'new' || d.agentKind !== saved.agentKind || d.repoId !== saved.repoId
}
