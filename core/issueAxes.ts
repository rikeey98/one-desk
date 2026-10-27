import { z } from 'zod'
import type { IssueSource, IssueKind, IssuePriority } from '@shared/models'

/**
 * 이슈 분류 축의 zod enum. MCP 도구(`create_issue`·`update_issue`·`propose_issue`)와 제안 payload(`core/proposals/payload.ts`)가
 * 같이 쓴다 — 따로 적으면 agent가 제안한 축을 DB 읽기가 버린다.
 */
const ISSUE_SOURCE_VALUES = ['customer', 'plan', 'meeting', 'dev'] as const
const ISSUE_KIND_VALUES = ['bug', 'feature', 'refactor', 'docs', 'research'] as const
const ISSUE_PRIORITY_VALUES = ['urgent', 'week', 'someday'] as const

/** 축이 추가·개명되면 이 줄에서 타입 오류가 난다 — 원소가 밖이면 제네릭 제약이, 타입 쪽이 더 많으면 `never`가 잡는다. */
type AssertSourceExhaustive<T extends readonly IssueSource[]> =
  IssueSource extends T[number] ? T : never
type AssertKindExhaustive<T extends readonly IssueKind[]> =
  IssueKind extends T[number] ? T : never
type AssertPriorityExhaustive<T extends readonly IssuePriority[]> =
  IssuePriority extends T[number] ? T : never

const issueSourceValues: AssertSourceExhaustive<typeof ISSUE_SOURCE_VALUES> = ISSUE_SOURCE_VALUES
const issueKindValues: AssertKindExhaustive<typeof ISSUE_KIND_VALUES> = ISSUE_KIND_VALUES
const issuePriorityValues: AssertPriorityExhaustive<typeof ISSUE_PRIORITY_VALUES> = ISSUE_PRIORITY_VALUES

export const ISSUE_SOURCE = z.enum(issueSourceValues)
export const ISSUE_KIND = z.enum(issueKindValues)
export const ISSUE_PRIORITY = z.enum(issuePriorityValues)
