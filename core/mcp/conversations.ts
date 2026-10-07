import { representativeTurn } from '@shared/inbox'
import type { Run, RunStatus } from '@shared/models'
import { toIso } from './time'
import { groupTurns, conversationSpan, spanOverlaps } from '../period/conversations'
import type { Range } from '../period/range'

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
  /** 이 대화에 할당된 이슈 (docs/sdlc/conversation-issue/ FR-25). 없거나 지워졌으면 null — 본문은 get_issue로 */
  issueId: string | null
  firstPrompt: string
  lastAnswer: string | null
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars)}…` : text
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
  runs: readonly Run[], range: Range = {}
): ConversationSummary[] {
  const groups = groupTurns(runs)

  const rows: Array<{ at: number; summary: ConversationSummary }> = []
  for (const [rootId, turns] of groups) {
    const latestFirst = [...turns].sort((a, b) => b.createdAt - a.createdAt)
    const root = turns.find((t) => t.id === rootId) ?? latestFirst[latestFirst.length - 1]!
    const state = representativeTurn(latestFirst)!
    const { startedAt, lastAt } = conversationSpan(turns)
    if (!spanOverlaps({ startedAt, lastAt }, range)) continue

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
        issueId: root.issue?.id ?? null,
        firstPrompt: clip(root.userPrompt, FIRST_PROMPT_CHARS),
        lastAnswer: state.resultText === null ? null : clip(state.resultText, LAST_ANSWER_CHARS)
      }
    })
  }
  return rows.sort((a, b) => b.at - a.at).map((r) => r.summary)
}

/** `get_conversation`의 턴 한 줄에 싣는 글자 수 */
const TURN_PROMPT_CHARS = 500
const TURN_ANSWER_CHARS = 1000
const TURN_ERROR_CHARS = 300

/**
 * `get_conversation`의 턴 하나 (docs/sdlc/timestamps/ FR-9). 시각은 ISO, 걸린 시간은 초다(소수 한 자리).
 *
 * - `requestedAt` — 지시를 보낸 때(행을 만든 때). 슬롯이 차 있거나 앞 턴이 돌면 여기서 기다린다.
 * - `startedAt` — 실제로 실행이 시작된 때. 시작하지 못하고 취소된 턴은 null.
 * - `endedAt` — 끝난 때(성공·실패·취소 모두). 아직 돌거나 기다리면 null.
 * - `waitSeconds` = startedAt − requestedAt, `durationSeconds` = endedAt − startedAt. 모르면 null.
 */
export interface ConversationTurn {
  id: string
  requestedAt: string
  startedAt: string | null
  endedAt: string | null
  waitSeconds: number | null
  durationSeconds: number | null
  status: RunStatus
  needsAnswer: boolean
  agent: Run['agentKind']
  /** 실제로 돈 모델(관측값), 모르면 요청한 모델, 그것도 없으면 null(CLI 기본값) */
  model: string | null
  prompt: string
  answer: string | null
  error: string | null
}

export interface ConversationDetail {
  id: string
  title: string
  closed: boolean
  /** 이 대화에 할당된 이슈 (FR-25). 없거나 지워졌으면 null */
  issueId: string | null
  /** 오래된 순 */
  turns: ConversationTurn[]
}

const seconds = (ms: number) => Math.round(ms / 100) / 10

/**
 * 대화 하나를 턴 단위로 편다. `id`는 뿌리 id(`list_conversations`의 id)든 그 대화의 아무 턴 id든 받는다.
 * **`runs`는 이미 토큰의 workspace로 거른 목록이어야 한다** — 여기서 못 찾으면 null이고, 호출자가 없는 id와
 * 같은 말로 떨군다(다른 workspace의 대화가 있는지 새지 않게).
 */
export function conversationDetail(runs: readonly Run[], id: string): ConversationDetail | null {
  const hit = runs.find((r) => r.id === id)
  if (!hit) return null
  const rootId = hit.rootRunId ?? hit.id
  const turns = runs.filter((r) => (r.rootRunId ?? r.id) === rootId).sort((a, b) => a.createdAt - b.createdAt)
  const root = turns.find((t) => t.id === rootId) ?? turns[0]!
  const firstLine = root.userPrompt.split('\n')[0] ?? ''
  return {
    id: rootId,
    title: root.title ?? clip(firstLine, TITLE_CHARS),
    closed: root.closedAt !== null,
    issueId: root.issue?.id ?? null,
    turns: turns.map((t) => ({
      id: t.id,
      requestedAt: toIso(t.createdAt)!,
      startedAt: toIso(t.startedAt),
      endedAt: toIso(t.endedAt),
      waitSeconds: t.startedAt === null ? null : seconds(t.startedAt - t.createdAt),
      durationSeconds: t.startedAt === null || t.endedAt === null ? null : seconds(t.endedAt - t.startedAt),
      status: t.status,
      needsAnswer: t.needsAnswer,
      agent: t.agentKind,
      model: t.usage?.model ?? t.model,
      prompt: clip(t.userPrompt, TURN_PROMPT_CHARS),
      answer: t.resultText === null ? null : clip(t.resultText, TURN_ANSWER_CHARS),
      error: t.errorMessage === null ? null : clip(t.errorMessage, TURN_ERROR_CHARS)
    }))
  }
}
