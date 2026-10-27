import { z } from 'zod'
import { ISSUE_SOURCE, ISSUE_KIND, ISSUE_PRIORITY } from '../issueAxes'
import type { ConversationIssuePayload } from '@shared/models'

/**
 * `propose_issue`의 입력과 DB의 payload가 **같은 스키마**다 (`docs/sdlc/agent-proposals/` spec FR-2·FR-7) — 따로 두면 도구가 받은
 * 값을 목록 읽기가 버린다. MCP의 `inputSchema`는 이 모양(`shape`)을 그대로 받는다.
 */
export const ISSUE_PROPOSAL_SHAPE = {
  title: z.string().trim().min(1).max(200).regex(/^[^\n]+$/, '제목은 한 줄이어야 합니다')
    .describe('한 줄, 무엇을 해야 하는지가 드러나게'),
  body: z.string().max(4000).default('').describe('한두 줄'),
  repoIds: z.array(z.string()).default([]).describe('관련 repo. 같은 workspace여야 한다'),
  source: ISSUE_SOURCE.nullish().describe('어디서 온 일인가'),
  kind: ISSUE_KIND.nullish().describe('무슨 성격의 일인가'),
  priority: ISSUE_PRIORITY.nullish().describe('얼마나 급한가'),
  existingIssueId: z.string().nullish().describe('같은 일을 하는 열린 이슈의 id. 있으면 새 이슈 대신 그것을 권한다')
}

export const conversationIssuePayload = z.object(ISSUE_PROPOSAL_SHAPE).transform((v): ConversationIssuePayload => ({
  title: v.title,
  body: v.body,
  repoIds: v.repoIds,
  source: v.source ?? null,
  kind: v.kind ?? null,
  priority: v.priority ?? null,
  existingIssueId: v.existingIssueId ?? null
}))

/** DB의 payload 열. 깨졌거나 스키마에 맞지 않으면 null — 앱이 쓴 값만 들어가므로 일어나면 결함이다(읽는 쪽이 알린다) */
export function parseIssuePayload(json: string): ConversationIssuePayload | null {
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return null }
  const parsed = conversationIssuePayload.safeParse(raw)
  return parsed.success ? parsed.data : null
}
