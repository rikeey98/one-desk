import type { IssueSource, IssueKind, IssuePriority } from '@shared/models'

/** 묶는 축. 목록의 드롭다운이 고른다. */
export type GroupAxis = 'priority' | 'source' | 'kind' | 'repo'

export const AXIS_LABELS: Record<GroupAxis, string> = {
  priority: '급함',
  source: '출처',
  kind: '성격',
  repo: 'repo'
}

/** 각 축의 그룹 순서. **나열 순서가 곧 화면 순서다.** */
export const PRIORITY_ORDER = ['urgent', 'week', 'someday'] as const satisfies readonly IssuePriority[]
export const SOURCE_ORDER = ['customer', 'plan', 'meeting', 'dev'] as const satisfies readonly IssueSource[]
export const KIND_ORDER = ['bug', 'feature', 'refactor', 'docs', 'research'] as const satisfies readonly IssueKind[]

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: '긴급',
  week: '이번주',
  someday: '언젠가'
}

export const SOURCE_LABELS: Record<IssueSource, string> = {
  customer: '고객',
  plan: '기획',
  meeting: '회의',
  dev: '개발중'
}

export const KIND_LABELS: Record<IssueKind, string> = {
  bug: '버그',
  feature: '기능',
  refactor: '리팩',
  docs: '문서',
  research: '조사'
}

/**
 * 축 값이 비어 있는 그룹의 이름.
 *
 * **"정리 안 됨"과 다른 말이다** (설계 §3). "정리 안 됨"은 훑기 대기열
 * (`triagedAt === null`)이고, "미지정"은 지금 묶은 축의 값이 없다는 뜻이다.
 * 마이그레이션으로 백필된 이슈는 정리는 됐지만 축이 비어 있어 두 값이 갈린다.
 */
export const UNSET_LABEL = '미지정'
export const DONE_LABEL = '완료'

/** 이만큼 안 보면 방치로 친다. */
export const STALE_MS = 14 * 24 * 60 * 60 * 1000
