/**
 * "이 기간에 무슨 일이 있었나"의 판정 — MCP(`list_issues`·`list_memos`)와 기간 리포트가 같이 쓴다
 * (`docs/sdlc/timestamps/` FR-6, `docs/sdlc/period-report/` FR-2). 따로 두면 agent가 센 수와 화면의 수가 갈린다.
 */

/** `[since, until)`, epoch ms. 둘 다 선택이다 */
export interface Range {
  since?: number
  until?: number
}

/** 시각 중 하나라도 `[since, until)` 안이면 참. 기간이 없으면 늘 참이다 */
export function touchedIn(times: ReadonlyArray<number | null>, range: Range): boolean {
  if (range.since === undefined && range.until === undefined) return true
  return times.some((t) => t !== null
    && (range.since === undefined || t >= range.since)
    && (range.until === undefined || t < range.until))
}

/** 이슈는 만듦·시작·완료·수정 중 하나 */
export function issueTouchedIn(
  issue: { createdAt: number; startedAt: number | null; closedAt: number | null; updatedAt: number },
  range: Range
): boolean {
  return touchedIn([issue.createdAt, issue.startedAt, issue.closedAt, issue.updatedAt], range)
}

/** 메모는 만듦·수정 */
export function memoTouchedIn(memo: { createdAt: number; updatedAt: number }, range: Range): boolean {
  return touchedIn([memo.createdAt, memo.updatedAt], range)
}
