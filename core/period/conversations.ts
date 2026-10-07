import type { Run } from '@shared/models'
import type { Range } from './range'

/**
 * run을 대화로 묶는다 — 키는 뿌리 id(`rootRunId`, 없으면 자기 id). 순서는 받은 그대로다.
 * MCP `list_conversations`와 기간 리포트가 같이 쓴다 (`docs/sdlc/period-report/` FR-2).
 */
export function groupTurns<T extends Pick<Run, 'id' | 'rootRunId'>>(runs: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const run of runs) {
    const key = run.rootRunId ?? run.id
    const list = groups.get(key) ?? []
    list.push(run)
    groups.set(key, list)
  }
  return groups
}

type Timed = Pick<Run, 'createdAt' | 'startedAt' | 'endedAt'>

/** 턴의 마지막 활동 시각 — 끝났으면 끝난 때, 아니면 시작한 때, 그것도 없으면 만든 때 */
export function lastActivity(run: Timed): number {
  return run.endedAt ?? run.startedAt ?? run.createdAt
}

/** 대화의 `[첫 턴 생성, 마지막 활동]` */
export function conversationSpan(turns: readonly Timed[]): { startedAt: number; lastAt: number } {
  return {
    startedAt: Math.min(...turns.map((t) => t.createdAt)),
    lastAt: Math.max(...turns.map(lastActivity))
  }
}

/** 대화가 기간과 겹치는가 — `[시작, 마지막 활동]`과 `[since, until)` */
export function spanOverlaps(span: { startedAt: number; lastAt: number }, range: Range): boolean {
  if (range.since !== undefined && span.lastAt < range.since) return false
  if (range.until !== undefined && span.startedAt >= range.until) return false
  return true
}
