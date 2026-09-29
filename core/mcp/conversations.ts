import { representativeTurn } from '@shared/inbox'
import type { Run, RunStatus } from '@shared/models'
import { toIso } from './time'

/** 제목이 없을 때 첫 지시에서 가져오는 글자 수 */
const TITLE_CHARS = 60
const FIRST_PROMPT_CHARS = 200
const LAST_ANSWER_CHARS = 300

/**
 * `list_conversations`의 한 줄 (`docs/sdlc/timestamps/` FR-7). 지시·답 전체와 맥락은 싣지 않는다 — 크다.
 * 시각은 ISO다(FR-4).
 */
export interface ConversationSummary {
  id: string
  title: string
  startedAt: string
  lastActivityAt: string
  status: RunStatus
  needsAnswer: boolean
  turns: number
  closed: boolean
  firstPrompt: string
  lastAnswer: string | null
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars)}…` : text
}

/** 턴의 마지막 활동 시각 — 끝났으면 끝난 때, 아니면 시작한 때, 그것도 없으면 만든 때 */
function lastActivity(run: Run): number {
  return run.endedAt ?? run.startedAt ?? run.createdAt
}

/**
 * workspace의 run(최신순 아니어도 된다)을 대화로 묶어 요약한다. 최신 활동순.
 *
 * 상태는 **대표 턴**이다(`representativeTurn`) — 인박스·배지·도크가 보는 턴과 같아야 agent가 말하는 상태와
 * 화면이 갈리지 않는다. 뿌리는 id로 찾는다(`groupConversations`와 같은 이유 — 가장 오래된 행이 뿌리라는
 * 가정에 기대지 않는다).
 *
 * 기간(`since`·`until`, ms)은 `[시작, 마지막 활동]`이 `[since, until)`과 겹치면 든다.
 */
export function summarizeConversations(
  runs: readonly Run[], range: { since?: number; until?: number } = {}
): ConversationSummary[] {
  const groups = new Map<string, Run[]>()
  for (const run of runs) {
    const key = run.rootRunId ?? run.id
    const list = groups.get(key) ?? []
    list.push(run)
    groups.set(key, list)
  }

  const rows: Array<{ at: number; summary: ConversationSummary }> = []
  for (const [rootId, turns] of groups) {
    const latestFirst = [...turns].sort((a, b) => b.createdAt - a.createdAt)
    const root = turns.find((t) => t.id === rootId) ?? latestFirst[latestFirst.length - 1]!
    const state = representativeTurn(latestFirst)!
    const startedAt = Math.min(...turns.map((t) => t.createdAt))
    const lastAt = Math.max(...turns.map(lastActivity))
    if (range.since !== undefined && lastAt < range.since) continue
    if (range.until !== undefined && startedAt >= range.until) continue

    const firstLine = root.userPrompt.split('\n')[0] ?? ''
    rows.push({
      at: lastAt,
      summary: {
        id: rootId,
        title: root.title ?? clip(firstLine, TITLE_CHARS),
        startedAt: toIso(startedAt)!,
        lastActivityAt: toIso(lastAt)!,
        status: state.status,
        needsAnswer: state.needsAnswer,
        turns: turns.length,
        closed: root.closedAt !== null,
        firstPrompt: clip(root.userPrompt, FIRST_PROMPT_CHARS),
        lastAnswer: state.resultText === null ? null : clip(state.resultText, LAST_ANSWER_CHARS)
      }
    })
  }
  return rows.sort((a, b) => b.at - a.at).map((r) => r.summary)
}
