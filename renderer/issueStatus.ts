import type { IssueStatus } from '@shared/models'

/**
 * 이슈 상태의 화면 이름 (docs/sdlc/ux-polish/ FR-3). `renderer/runStatus.ts`와 같은 자리·같은 이유다 —
 * 상세 드롭다운·목록 배지·훑기·인박스가 한 표를 나눠 쓴다. 영어 enum은 화면에 나가지 않는다.
 * **클래스는 enum 그대로다**(`.status-<enum>`) — 색과 e2e가 거기 걸려 있다.
 */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: '열림',
  doing: '진행 중',
  done: '완료'
}

/** 목록 줄의 배지는 기본 상태를 그리지 않는다 — `open`은 정보가 없다(③의 작은 것). */
export function showsStatusBadge(status: IssueStatus): boolean {
  return status !== 'open'
}
