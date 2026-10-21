import type { Issue } from './models'

/**
 * 이슈의 "정리 안 됨"·"오래 안 본" 판정 — 이슈 패널(`renderer/issueGroups.ts`)과 홈 요약(`core/home/summary.ts`)이 같이 쓴다
 * (`docs/sdlc/home/` NFR-2). 따로 적으면 홈 배지가 세는 수와 이슈 패널의 배너·`⚠ 오래 방치됨` 수가 갈린다.
 *
 * `Issue` 전체가 아니라 판정에 쓰는 필드만 받는다 — core가 슬림한 select로 읽은 행도 그대로 들어간다.
 */

/** 이만큼 안 보면 방치로 친다 (설계 `2026-08-27-issue-triage-design.md` §3). 시안은 7일로 그렸지만 두 화면이 다른 수를 말하면 안 된다. */
export const STALE_MS = 14 * 24 * 60 * 60 * 1000

/** 오래 안 본 이슈인가. done에는 붙이지 않는다. */
export function isStale(issue: Pick<Issue, 'status' | 'seenAt' | 'createdAt'>, now: number): boolean {
  if (issue.status === 'done') return false
  // seenAt이 null이면 createdAt으로 떨어진다. 폴백이 없으면 한 번도 안 연 이슈가
  // 영원히 방치로 잡히지 않는다 — 가장 잊히기 쉬운 것이 배지를 못 받는다.
  return now - (issue.seenAt ?? issue.createdAt) > STALE_MS
}

/**
 * 훑기 대기열에 있는가 — "정리 안 됨"(`triagedAt IS NULL`). "미지정"(축 값이 빔)과 다른 말이다(CLAUDE.md).
 * done은 훑지 않는다.
 */
export function isUntriaged(issue: Pick<Issue, 'status' | 'triagedAt'>): boolean {
  return issue.triagedAt === null && issue.status !== 'done'
}
