import { describe, it, expect } from 'vitest'
import { groupIssues, isStale, untriagedCount } from './issueGroups'
import { STALE_MS } from './issueAxes'
import type { Issue, Repo } from '@shared/models'

const NOW = 1_800_000_000_000

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'ws', title: '제목', body: '', status: 'open',
    repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: null, seenAt: null,
    ...over
  }
}

describe('groupIssues', () => {
  it('미지정이 첫 그룹이다', () => {
    const groups = groupIssues([
      makeIssue({ id: 'a', priority: 'urgent' }),
      makeIssue({ id: 'b', priority: null })
    ], 'priority', [])
    expect(groups[0]?.key).toBe('unset')
    expect(groups[0]?.label).toBe('미지정')
  })

  it('축 순서대로 묶는다', () => {
    const groups = groupIssues([
      makeIssue({ id: 'a', priority: 'someday' }),
      makeIssue({ id: 'b', priority: 'urgent' }),
      makeIssue({ id: 'c', priority: 'week' })
    ], 'priority', [])
    expect(groups.map((g) => g.key)).toEqual(['urgent', 'week', 'someday'])
  })

  it('빈 그룹은 만들지 않는다', () => {
    const groups = groupIssues([makeIssue({ priority: 'urgent' })], 'priority', [])
    expect(groups).toHaveLength(1)
  })

  it('저장소가 준 순서를 그룹 안에서 보존한다', () => {
    // 정렬은 저장소가 한다 (설계 §5). 여기서 다시 정렬하면 규칙이 두 벌이 된다.
    const groups = groupIssues([
      makeIssue({ id: 'first', priority: 'urgent' }),
      makeIssue({ id: 'second', priority: 'urgent' })
    ], 'priority', [])
    expect(groups[0]?.issues.map((i) => i.id)).toEqual(['first', 'second'])
  })

  it('done은 축 그룹에서 빠지고 맨 아래 완료 그룹으로 간다', () => {
    const groups = groupIssues([
      makeIssue({ id: 'a', priority: 'urgent' }),
      makeIssue({ id: 'z', priority: 'urgent', status: 'done' })
    ], 'priority', [])
    expect(groups[0]?.issues.map((i) => i.id)).toEqual(['a'])
    const last = groups[groups.length - 1]
    expect(last?.key).toBe('done')
    expect(last?.label).toBe('완료')
    expect(last?.issues.map((i) => i.id)).toEqual(['z'])
  })

  it('done이 없으면 완료 그룹도 없다', () => {
    const groups = groupIssues([makeIssue({ priority: 'urgent' })], 'priority', [])
    expect(groups.some((g) => g.key === 'done')).toBe(false)
  })

  it('repo 축은 repo 이름으로 묶고, 태그가 여럿이면 여러 그룹에 나타난다', () => {
    const repos: Repo[] = [
      { id: 'r1', workspaceId: 'ws', name: 'api', path: '/a', description: null, sortOrder: 0, createdAt: 0 },
      { id: 'r2', workspaceId: 'ws', name: 'web', path: '/b', description: null, sortOrder: 1, createdAt: 0 }
    ]
    const groups = groupIssues([
      makeIssue({ id: 'both', repoIds: ['r1', 'r2'] }),
      makeIssue({ id: 'none', repoIds: [] })
    ], 'repo', repos)
    expect(groups.map((g) => g.key)).toEqual(['unset', 'r1', 'r2'])
    expect(groups[1]?.label).toBe('api')
    expect(groups[1]?.issues.map((i) => i.id)).toEqual(['both'])
    expect(groups[2]?.issues.map((i) => i.id)).toEqual(['both'])
    expect(groups[0]?.issues.map((i) => i.id)).toEqual(['none'])
  })
})

describe('isStale', () => {
  it('seenAt이 임계값보다 오래되면 방치다', () => {
    expect(isStale(makeIssue({ seenAt: NOW - STALE_MS - 1 }), NOW)).toBe(true)
    expect(isStale(makeIssue({ seenAt: NOW - 1000 }), NOW)).toBe(false)
  })

  it('한 번도 안 본 이슈는 createdAt으로 판정한다', () => {
    // 폴백이 없으면 가장 잊히기 쉬운 것이 영원히 배지를 못 받는다.
    expect(isStale(makeIssue({ seenAt: null, createdAt: NOW - STALE_MS - 1 }), NOW)).toBe(true)
    expect(isStale(makeIssue({ seenAt: null, createdAt: NOW }), NOW)).toBe(false)
  })

  it('done에는 붙지 않는다', () => {
    expect(isStale(makeIssue({ status: 'done', seenAt: NOW - STALE_MS - 1 }), NOW)).toBe(false)
  })
})

describe('untriagedCount', () => {
  it('triagedAt이 없는 것만 센다', () => {
    expect(untriagedCount([
      makeIssue({ id: 'a', triagedAt: null }),
      makeIssue({ id: 'b', triagedAt: NOW })
    ])).toBe(1)
  })

  it('done은 세지 않는다', () => {
    // 정리되지 않은 채 끝난 이슈를 이제 와서 분류하라고 요구하지 않는다.
    expect(untriagedCount([makeIssue({ triagedAt: null, status: 'done' })])).toBe(0)
  })
})
