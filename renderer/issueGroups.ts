import type { Issue, Repo } from '@shared/models'
import {
  PRIORITY_ORDER, SOURCE_ORDER, KIND_ORDER,
  PRIORITY_LABELS, SOURCE_LABELS, KIND_LABELS,
  UNSET_LABEL, DONE_LABEL, STALE_MS,
  type GroupAxis
} from './issueAxes'

export interface IssueGroup {
  /** 접기 상태의 키. 'unset' · 축 값 · repo id · 'done' */
  key: string
  label: string
  issues: Issue[]
}

/** 축 값이 비어 있는 그룹의 키. repo id와 겹치지 않게 예약어로 쓴다. */
const UNSET_KEY = 'unset'

/** 오래 안 본 이슈인가. done에는 붙이지 않는다. */
export function isStale(issue: Issue, now: number): boolean {
  if (issue.status === 'done') return false
  // seenAt이 null이면 createdAt으로 떨어진다. 폴백이 없으면 한 번도 안 연 이슈가
  // 영원히 방치로 잡히지 않는다 — 가장 잊히기 쉬운 것이 배지를 못 받는다.
  return now - (issue.seenAt ?? issue.createdAt) > STALE_MS
}

/**
 * 훑기 대기열. 저장소가 준 순서를 그대로 쓴다.
 *
 * 배너 개수·훑기 진행률·다음 대상 선택이 전부 이 술어 하나에서 나와야 한다.
 * 컴포넌트가 이 술어를 다시 적으면 두 자리가 어긋날 수 있다 — 실제로 한 번
 * `IssuePanel`이 `queue`를 인라인으로 다시 만들며 `untriagedCount`가 프로덕션에서
 * 죽은 채 남았던 자리다.
 */
export function triageQueue(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.triagedAt === null && i.status !== 'done')
}

/** 훑기 대기열의 크기. 배너가 이 값을 쓴다. */
export function untriagedCount(issues: Issue[]): number {
  return triageQueue(issues).length
}

/**
 * 훑기 큐에서 `fromId` 다음 항목. 없으면 undefined다.
 *
 * **저장 경로와 건너뛰기 경로가 같은 답을 내야 한다.** 저장한 항목은 refresh 뒤
 * 큐에서 빠지지만 건너뛴 항목은 남으므로, "fromId를 뺀 첫 항목"으로 고르면
 * 건너뛰기가 앞 항목으로 되돌아간다. 위치로 골라야 두 경로가 같이 전진한다.
 */
export function nextInQueue(queue: Issue[], fromId: string): Issue | undefined {
  const at = queue.findIndex((i) => i.id === fromId)
  if (at === -1) return undefined
  return queue[at + 1]
}

/**
 * 이슈를 그룹으로 나눈다.
 *
 * **정렬은 하지 않는다** (설계 §5). 저장소가 `seenAt` 오래된 순으로 이미 정렬해서
 * 주고, 이 함수는 그 순서를 보존하는 **안정 분할**만 한다. 양쪽에서 정렬하면
 * 규칙이 두 벌이 되고 어긋났을 때 어느 쪽이 옳은지 판정할 곳이 없어진다.
 *
 * **빈 그룹은 만들지 않는다.** 개수 0인 헤더는 화면의 잡음일 뿐이다.
 */
export function groupIssues(issues: Issue[], axis: GroupAxis, repos: Repo[]): IssueGroup[] {
  const live = issues.filter((i) => i.status !== 'done')
  const done = issues.filter((i) => i.status === 'done')

  const groups: IssueGroup[] = []

  function push(key: string, label: string, members: Issue[]) {
    if (members.length > 0) groups.push({ key, label, issues: members })
  }

  if (axis === 'repo') {
    // repo는 다대다다. 태그가 여럿이면 **이슈가 여러 그룹에 나타난다** —
    // 그래서 그룹 개수의 합이 전체보다 클 수 있다. "첫 repo만" 같은 규칙으로
    // 중복을 없앨 수는 있지만, 그건 화면에서 설명할 수 없다.
    push(UNSET_KEY, UNSET_LABEL, live.filter((i) => i.repoIds.length === 0))
    const ordered = [...repos].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const repo of ordered) {
      push(repo.id, repo.name, live.filter((i) => i.repoIds.includes(repo.id)))
    }
  } else {
    const order = axis === 'priority' ? PRIORITY_ORDER
      : axis === 'source' ? SOURCE_ORDER
      : KIND_ORDER
    const labels: Record<string, string> = axis === 'priority' ? PRIORITY_LABELS
      : axis === 'source' ? SOURCE_LABELS
      : KIND_LABELS

    // 미지정이 맨 위다. 아래에 두면 그것이 정확히 이 기능이 없애려는 "묻힘"이 된다.
    push(UNSET_KEY, UNSET_LABEL, live.filter((i) => i[axis] === null))
    for (const value of order) {
      push(value, labels[value] ?? value, live.filter((i) => i[axis] === value))
    }
  }

  push('done', DONE_LABEL, done)
  return groups
}
