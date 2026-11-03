import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../db/open'
import { asset, issue, memo, repo, workspace } from '../db/schema'
import { validateTrigger } from './clock'
import type { AgentKind, ContextItemRef, Permission, ScheduleConversationMode, ScheduleInput } from '@shared/models'

/** 이름 상한 (spec FR-1) */
export const SCHEDULE_NAME_MAX = 60

const AGENT_KINDS: readonly AgentKind[] = ['claude-code', 'opencode']
const PERMISSIONS: readonly Permission[] = ['read_only', 'edit', 'full']
const MODES: readonly ScheduleConversationMode[] = ['new', 'continue']
const CONTEXT_TYPES = ['issue', 'memo', 'asset'] as const
type ScheduleContextType = typeof CONTEXT_TYPES[number]

function optionalText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}을(를) 읽을 수 없습니다`)
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label}을(를) 읽을 수 없습니다`)
  }
  return value as T
}

/**
 * 저장된·받은 맥락 JSON을 모양으로만 읽는다 — 존재 확인은 하지 않는다. 저장소가 DB의 `context` 컬럼을 읽을 때도 쓴다.
 * 모양이 틀리면 null.
 */
export function readScheduleContext(value: unknown): ContextItemRef[] | null {
  if (!Array.isArray(value)) return null
  const out: ContextItemRef[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null
    const { type, id } = item as Record<string, unknown>
    if (!(CONTEXT_TYPES as readonly unknown[]).includes(type) || typeof id !== 'string' || id === '') return null
    const key = `${String(type)}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: type as ScheduleContextType, id })
  }
  return out
}

/**
 * 만들기·고치기가 같이 타는 검증 한 자리 (spec FR-4). 다듬은 입력을 돌려주고, 틀리면 화면에 그대로 보일 한국어 한 문장으로 던진다.
 * IPC에서 온 값이라 타입을 믿지 않는다.
 */
export function validateScheduleInput(db: Database, value: ScheduleInput, now: number): ScheduleInput {
  const v = value as unknown as Record<string, unknown>

  if (typeof v.workspaceId !== 'string' ||
    // 홈 workspace는 없는 workspace와 같은 말이다 (home-conversation plan §0-8) — 홈 대화는 사람이 보낼 때만 돈다
    !db.select({ id: workspace.id }).from(workspace).where(and(eq(workspace.id, v.workspaceId), eq(workspace.kind, 'normal'))).get()) {
    throw new Error('workspace를 찾을 수 없습니다')
  }
  const workspaceId = v.workspaceId

  const repoRow = typeof v.repoId === 'string'
    ? db.select().from(repo).where(and(eq(repo.id, v.repoId), eq(repo.workspaceId, workspaceId))).get()
    : undefined
  if (!repoRow) throw new Error('이 workspace의 repo를 골라야 합니다')

  const name = typeof v.name === 'string' ? v.name.trim() : ''
  if (name === '' || name.includes('\n') || name.length > SCHEDULE_NAME_MAX) {
    throw new Error(`이름은 한 줄, 1~${SCHEDULE_NAME_MAX}자여야 합니다`)
  }

  if (typeof v.prompt !== 'string' || v.prompt.trim() === '') throw new Error('지시를 입력하세요')

  const checked = validateTrigger(v.trigger, v.timeZone, now)
  if (!checked.ok) throw new Error(checked.error)

  const agentKind = oneOf(v.agentKind, AGENT_KINDS, 'agent')
  // 실행 때 preflight가 같은 문구로 막는다(core/index.ts의 preflightFor) — 저장할 때 미리 말한다
  if (agentKind === 'opencode' && repoRow.agentEnv === 'wsl') throw new Error('WSL repo에서는 OpenCode를 아직 쓸 수 없습니다')

  const context = readScheduleContext(v.context)
  if (!context) throw new Error('맥락은 이슈·메모·skill/agent만 담을 수 있습니다')
  assertContextIn(db, workspaceId, context)

  return {
    workspaceId,
    repoId: repoRow.id,
    name,
    trigger: checked.trigger,
    timeZone: v.timeZone as string,
    conversationMode: oneOf(v.conversationMode, MODES, '대화 방식'),
    agentKind,
    model: optionalText(v.model, '모델'),
    effort: optionalText(v.effort, 'effort'),
    permission: oneOf(v.permission, PERMISSIONS, '권한'),
    prompt: v.prompt,
    context
  }
}

/** 맥락이 그 workspace에 지금 있는 것만인지 — 지시 파일은 CLI가 알아서 읽으므로 담을 수 없다(repo-instructions FR-9) */
function assertContextIn(db: Database, workspaceId: string, context: ContextItemRef[]): void {
  const present = presentContext(db, workspaceId, context)
  if (present.length !== context.length) throw new Error('맥락에 이 workspace에서 찾을 수 없는 항목이 있습니다')
}

/**
 * 맥락 중 지금 그 workspace에 있는 것만 (spec FR-17). 스케줄러가 실행할 때 지워진 항목을 빼는 데도 쓴다 —
 * `execution.start`는 없는 항목을 받으면 던진다.
 */
export function presentContext(db: Database, workspaceId: string, context: ContextItemRef[]): ContextItemRef[] {
  const ids = (type: ScheduleContextType) => context.filter((c) => c.type === type).map((c) => c.id)
  const found = new Set<string>()
  const issueIds = ids('issue')
  if (issueIds.length > 0) {
    for (const r of db.select({ id: issue.id }).from(issue)
      .where(and(eq(issue.workspaceId, workspaceId), inArray(issue.id, issueIds))).all()) found.add(`issue:${r.id}`)
  }
  const memoIds = ids('memo')
  if (memoIds.length > 0) {
    for (const r of db.select({ id: memo.id }).from(memo)
      .where(and(eq(memo.workspaceId, workspaceId), inArray(memo.id, memoIds))).all()) found.add(`memo:${r.id}`)
  }
  const assetIds = ids('asset')
  if (assetIds.length > 0) {
    for (const r of db.select({ id: asset.id, kind: asset.kind }).from(asset)
      .where(and(eq(asset.workspaceId, workspaceId), inArray(asset.id, assetIds))).all()) {
      if (r.kind !== 'instructions') found.add(`asset:${r.id}`)
    }
  }
  return context.filter((c) => found.has(`${c.type}:${c.id}`))
}
