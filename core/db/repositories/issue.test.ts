import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createIssueRepository } from './issue'
import type { Database } from '../open'
import { NotFoundError } from '../../errors'

describe('IssueRepository', () => {
  let db: Database
  let issues: ReturnType<typeof createIssueRepository>
  let workspaceId: string
  let apiRepoId: string
  let webRepoId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    apiRepoId = repos.create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    webRepoId = repos.create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    issues = createIssueRepository(db)
  })

  it('생성 시 repoIds를 함께 저장하고 다시 읽어온다', () => {
    const created = issues.create({
      workspaceId, title: '토큰 버그', repoIds: [apiRepoId, webRepoId]
    })
    expect(created.repoIds.sort()).toEqual([apiRepoId, webRepoId].sort())

    const [fetched] = issues.list({ workspaceId })
    expect(fetched?.repoIds.sort()).toEqual([apiRepoId, webRepoId].sort())
  })

  it('repo 필터는 그 repo의 항목과 태그 없는 공통 항목을 함께 반환한다', () => {
    issues.create({ workspaceId, title: 'api 전용', repoIds: [apiRepoId] })
    issues.create({ workspaceId, title: 'web 전용', repoIds: [webRepoId] })
    issues.create({ workspaceId, title: '공통', repoIds: [] })

    const titles = issues.list({ workspaceId, repoId: apiRepoId })
      .map((i) => i.title).sort()
    expect(titles).toEqual(['api 전용', '공통'])
  })

  it('status를 done으로 바꾸면 closedAt이 채워진다', () => {
    const created = issues.create({ workspaceId, title: '끝낼것' })
    expect(created.closedAt).toBeNull()

    const updated = issues.update({ id: created.id, status: 'done' })
    expect(updated.status).toBe('done')
    expect(updated.closedAt).toBeTypeOf('number')
  })

  it('done에서 open으로 되돌리면 closedAt이 지워진다', () => {
    const created = issues.create({ workspaceId, title: '되돌릴것' })
    issues.update({ id: created.id, status: 'done' })
    const reopened = issues.update({ id: created.id, status: 'open' })
    expect(reopened.closedAt).toBeNull()
  })

  it('repoIds를 갱신하면 기존 태그를 대체한다', () => {
    const created = issues.create({ workspaceId, title: 'x', repoIds: [apiRepoId] })
    const updated = issues.update({ id: created.id, repoIds: [webRepoId] })
    expect(updated.repoIds).toEqual([webRepoId])
  })

  it('연달아 생성한 이슈가 생성순(오래된 것 먼저)으로 정렬된다', async () => {
    // 셋 다 한 번도 안 봤다(seenAt 전부 null) → 안 본 것 그룹 안에서는
    // createdAt ASC가 순서를 정한다. 예전에는 updatedAt DESC라 역순이었다.
    issues.create({ workspaceId, title: 'A' })
    await new Promise((r) => setTimeout(r, 5))
    issues.create({ workspaceId, title: 'B' })
    await new Promise((r) => setTimeout(r, 5))
    issues.create({ workspaceId, title: 'C' })

    const titles = issues.list({ workspaceId }).map((i) => i.title)
    expect(titles).toEqual(['A', 'B', 'C'])
  })

  it('태그 삽입이 실패하면 이슈 본문도 저장되지 않는다', () => {
    expect(() =>
      issues.create({ workspaceId, title: '고아 이슈', repoIds: ['존재하지-않는-repo'] })
    ).toThrow()

    expect(issues.list({ workspaceId })).toHaveLength(0)
  })

  it('다른 workspace의 repo는 태그로 붙일 수 없다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    const otherRepo = createRepoRepository(db)
      .create({ workspaceId: other.id, name: '남의repo', path: '/tmp/other' })

    expect(() =>
      issues.create({ workspaceId, title: '경계 침범', repoIds: [otherRepo.id] })
    ).toThrow(/workspace/)

    expect(issues.list({ workspaceId })).toHaveLength(0)
  })

  it('update가 경계 위반으로 거부되면 제목·상태 변경도 롤백된다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    const otherRepo = createRepoRepository(db)
      .create({ workspaceId: other.id, name: '남의repo', path: '/tmp/other' })
    const created = issues.create({ workspaceId, title: '원래제목', repoIds: [apiRepoId] })

    expect(() =>
      issues.update({ id: created.id, title: '바뀐제목', status: 'done', repoIds: [otherRepo.id] })
    ).toThrow(/workspace/)

    const after = issues.list({ workspaceId })[0]!
    expect(after.title).toBe('원래제목')
    expect(after.status).toBe('open')
    expect(after.repoIds).toEqual([apiRepoId])
  })

  it('같은 repo를 중복해서 넘겨도 거부하지 않는다', () => {
    const created = issues.create({
      workspaceId, title: '중복 태그', repoIds: [apiRepoId, apiRepoId]
    })
    expect(created.repoIds).toEqual([apiRepoId])
  })

  describe('분류 축과 triagedAt 파생', () => {
    it('축 셋이 다 있으면 triagedAt이 찍힌다', () => {
      const created = issues.create({
        workspaceId, title: '결제 취소 API 응답 지연',
        source: 'customer', kind: 'bug', priority: 'urgent'
      })
      expect(created.triagedAt).not.toBeNull()
      expect(created.source).toBe('customer')
    })

    it('축이 하나라도 비면 triagedAt은 null이다', () => {
      const created = issues.create({
        workspaceId, title: '회원 탈퇴 플로우 문의', source: 'meeting'
      })
      expect(created.triagedAt).toBeNull()
    })

    it('나중에 나머지 축을 채우면 triagedAt이 찍힌다', () => {
      const created = issues.create({ workspaceId, title: '이미지 업로드 용량 제한' })
      expect(created.triagedAt).toBeNull()

      issues.update({ id: created.id, source: 'customer', kind: 'feature' })
      expect(issues.get(created.id).triagedAt).toBeNull()

      issues.update({ id: created.id, priority: 'week' })
      expect(issues.get(created.id).triagedAt).not.toBeNull()
    })

    it('백필된 이슈(축 없이 triagedAt만 있음)의 축을 건드리면 대기열로 돌아온다', () => {
      // 마이그레이션 0003이 만드는 유일한 예외 상태다 (설계 §3). 축을 처음 건드리는
      // 순간 파생 규칙이 적용돼 예외가 스스로 사라진다.
      const created = issues.create({ workspaceId, title: '옛 이슈' })
      db.$client.prepare('UPDATE issue SET triaged_at = created_at WHERE id = ?').run(created.id)
      expect(issues.get(created.id).triagedAt).not.toBeNull()

      issues.update({ id: created.id, source: 'dev' })
      expect(issues.get(created.id).triagedAt).toBeNull()
    })

    it('축을 건드리지 않는 갱신은 triagedAt을 바꾸지 않는다', () => {
      // touchesAxes 가드가 없으면 본문만 고쳐도 축 셋이 다시 채워진 것으로 읽혀
      // triagedAt이 새 시각으로 덮인다. create와 update가 같은 밀리초에 떨어지면
      // 그 새 시각이 옛 시각과 우연히 같아져 가드가 사라져도 이 테스트가 속는다 —
      // 시계를 벌려야 진짜 시험이 된다.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_700_000_000_000)
        const created = issues.create({
          workspaceId, title: '알림 메일 오타',
          source: 'dev', kind: 'docs', priority: 'someday'
        })
        const stamped = created.triagedAt

        vi.setSystemTime(1_700_000_001_000)
        issues.update({ id: created.id, body: '본문만 고친다' })
        expect(issues.get(created.id).triagedAt).toBe(stamped)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('markSeen', () => {
    it('seenAt을 찍는다', () => {
      const created = issues.create({ workspaceId, title: '배포 스크립트 문서화' })
      expect(created.seenAt).toBeNull()
      issues.markSeen(created.id)
      expect(issues.get(created.id).seenAt).not.toBeNull()
    })

    it('updatedAt을 건드리지 않는다', () => {
      // 이것이 핵심이다. 올리면 열려 있는 IssueDetail의 기대값이 낡아
      // 다음 자동 저장이 사용자 자신의 열람을 agent의 편집으로 착각한다.
      //
      // 시계를 고정해야 진짜 시험이 된다 — create와 markSeen이 같은 밀리초에
      // 떨어지면 회귀가 나도 두 값이 우연히 같아져 이 테스트가 통과해 버린다.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_700_000_000_000)
        const created = issues.create({ workspaceId, title: '로그인 리다이렉트' })
        vi.setSystemTime(1_700_000_001_000)
        issues.markSeen(created.id)
        expect(issues.get(created.id).updatedAt).toBe(created.updatedAt)
      } finally {
        vi.useRealTimers()
      }
    })

    it('없는 이슈면 NotFoundError를 던진다', () => {
      expect(() => issues.markSeen('없는-id')).toThrow(NotFoundError)
    })
  })

  describe('목록 정렬', () => {
    it('안 본 것이 먼저 온다', () => {
      // markSeen 사이에 시계를 벌려야 seenAt이 진짜로 갈라진다 — 안 그러면
      // 같은 밀리초에 찍혀 A/B 사이의 순서가 SQLite의 우연한 스캔 순서에 맡겨진다.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_700_000_000_000)
        const a = issues.create({ workspaceId, title: 'A' })
        const b = issues.create({ workspaceId, title: 'B' })
        issues.create({ workspaceId, title: 'C' })

        // A와 B는 봤고 C는 한 번도 안 봤다. C가 맨 위여야 한다.
        vi.setSystemTime(1_700_000_001_000)
        issues.markSeen(a.id)
        vi.setSystemTime(1_700_000_002_000)
        issues.markSeen(b.id)

        const titles = issues.list({ workspaceId }).map((i) => i.title)
        expect(titles[0]).toBe('C')
        // A를 B보다 먼저 봤으므로 A가 더 오래됐다 → A가 B보다 위
        expect(titles.indexOf('A')).toBeLessThan(titles.indexOf('B'))
      } finally {
        vi.useRealTimers()
      }
    })

    it('updatedAt이 올라가도 순서가 바뀌지 않는다', () => {
      // agent가 MCP로 본문을 고쳐도 목록 맨 위로 올라오면 안 된다.
      //
      // 일부러 B를 먼저 보고 A를 나중에 봐서 옛 규칙과 새 규칙이 서로 다른 답을
      // 내게 만든다 — 옛 updatedAt DESC라면 방금 고친 A가 위였을 것이다. 그래야
      // 이 테스트가 그 회귀를 실제로 잡는다. 시계를 벌려야 seenAt이 진짜로 갈라진다.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_700_000_000_000)
        const a = issues.create({ workspaceId, title: 'A' })
        const b = issues.create({ workspaceId, title: 'B' })

        vi.setSystemTime(1_700_000_001_000)
        issues.markSeen(b.id)
        vi.setSystemTime(1_700_000_002_000)
        issues.markSeen(a.id)

        vi.setSystemTime(1_700_000_003_000)
        issues.update({ id: a.id, body: 'agent가 쓴 것' })

        const titles = issues.list({ workspaceId }).map((i) => i.title)
        // B를 먼저 봤으므로(seenAt이 더 오래됨) B가 위 — A의 updatedAt이 더
        // 최근이어도 순서는 바뀌지 않는다.
        expect(titles).toEqual(['B', 'A'])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('여러 repo에 걸친 항목', () => {
    it('두 repo에 태그하면 어느 쪽으로 걸러도 나온다', () => {
      // 전체 설계 §150 — 하나가 여러 repo에 걸치는 일이 자주 있다. 한쪽에서만 보이면
      // 다른 repo를 보던 사람이 그 일을 놓친다. 저장·조회 왕복은 이미 검증돼 있었지만
      // **필터를 통과하는지는 비어 있었다**(docs/sdlc/asset-scope/spec.md FR-10).
      issues.create({ workspaceId, title: '양쪽', repoIds: [apiRepoId, webRepoId] })
      issues.create({ workspaceId, title: 'api만', repoIds: [apiRepoId] })

      const fromApi = issues.list({ workspaceId, repoId: apiRepoId }).map((r) => r.title)
      const fromWeb = issues.list({ workspaceId, repoId: webRepoId }).map((r) => r.title)

      expect(fromApi).toContain('양쪽')
      expect(fromWeb).toContain('양쪽')
      // 한쪽에만 태그된 것은 반대편에서 보이지 않는다 — 필터가 실제로 거른다는 증거다.
      expect(fromWeb).not.toContain('api만')
    })
  })
})

describe('updateIfUnchanged', () => {
  it('기대값이 맞으면 갱신하고 새 updatedAt을 돌려준다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })

    const result = issues.updateIfUnchanged({
      id: created.id, body: '고침', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issue.body).toBe('고침')
    expect(result.issue.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  it('그 사이 바뀌었으면 거부하고 최신 행을 돌려준다', () => {
    // agent가 MCP로 본문을 바꾼 상황. 화면의 낡은 버퍼가 덮어쓰면 안 된다.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })
    issues.update({ id: created.id, body: 'agent가 쓴 것' })

    const result = issues.updateIfUnchanged({
      id: created.id, title: '사람이 바꾼 제목', body: '사람이 쓴 것', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.current.body).toBe('agent가 쓴 것')
    // title은 사람도 agent도 손대지 않은 값 — 버전 검사가 title/body 둘 다 막았는지 함께 본다.
    expect(result.current.title).toBe('제목')
  })

  it('없는 id면 NotFoundError를 던진다', () => {
    const db = makeTestDb()
    expect(() => createIssueRepository(db).updateIfUnchanged({
      id: '없는-id', body: 'x', expectedUpdatedAt: 1
    })).toThrow(/찾을 수 없습니다/)
  })

  it('같은 밀리초에 두 번 써도 updatedAt이 달라진다', () => {
    // updatedAt이 잠금의 버전 노릇을 한다. 값이 같아지면 "그 사이 바뀌었다"를
    // 놓쳐서, 이 기능이 막으려던 덮어쓰기가 그대로 일어난다.
    //
    // **시계를 고정해야 진짜 시험이 된다.** 그냥 두 번 쓰고 second > first만 보면
    // 두 쓰기가 밀리초 경계를 넘는 순간 단조 보정(buildPatch의 Math.max)을 지워도
    // 초록이 된다 — 실제 시각이 알아서 1 늘어나기 때문이다. 시각을 못박아 같은
    // 밀리초를 강제하면 남는 것은 보정뿐이라, 값까지 정확히 못박을 수 있다.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      const db = makeTestDb()
      const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
      const issues = createIssueRepository(db)
      const created = issues.create({ workspaceId, title: '제목', body: 'a' })

      const first = issues.update({ id: created.id, body: 'b' })
      const second = issues.update({ id: created.id, body: 'c' })

      expect(created.updatedAt).toBe(1_700_000_000_000)
      expect(first.updatedAt).toBe(1_700_000_000_001)
      expect(second.updatedAt).toBe(1_700_000_000_002)
    } finally {
      vi.useRealTimers()
    }
  })

  it('축을 마저 채우면 updateIfUnchanged로도 triagedAt이 찍힌다', () => {
    // Previous 타입은 컬럼을 select에 담게 컴파일 타임에 강제할 뿐, 파생이
    // 실제로 도는지는 보증하지 않는다 — updateIfUnchanged 경로를 직접 검증한다.
    // IssueDetail이 축을 저장할 때 쓰는 경로가 바로 이것이다.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({
      workspaceId, title: '결제 실패 알림 지연', source: 'customer', kind: 'bug'
    })
    expect(created.triagedAt).toBeNull()

    const result = issues.updateIfUnchanged({
      id: created.id, priority: 'urgent', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issue.triagedAt).not.toBeNull()
  })

  it('repoIds도 함께 갱신하고, 다른 workspace의 repo는 거부한다', () => {
    const db = makeTestDb()
    const workspaces = createWorkspaceRepository(db)
    const wsA = workspaces.create({ name: 'A' }).id
    const wsB = workspaces.create({ name: 'B' }).id
    const repos = createRepoRepository(db)
    const repoA = repos.create({ workspaceId: wsA, name: 'api', path: '/tmp/a' }).id
    const repoB = repos.create({ workspaceId: wsB, name: 'web', path: '/tmp/b' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId: wsA, title: '제목', body: '원본' })

    const ok = issues.updateIfUnchanged({
      id: created.id, repoIds: [repoA], expectedUpdatedAt: created.updatedAt
    })
    expect(ok.ok).toBe(true)
    expect(issues.get(created.id).repoIds).toEqual([repoA])

    const beforeReject = issues.get(created.id)
    // assertReposInWorkspace는 tx.update(issue)가 이미 실행된 뒤에 던진다 — 그러니 여기서
    // title/body가 그대로인지 보는 것은 "쓰기가 없었다"가 아니라 "쓴 뒤 트랜잭션이
    // 롤백됐다"를 검증하는 진짜 시험이다 (설계 §6).
    expect(() => issues.updateIfUnchanged({
      id: created.id, title: '바뀐제목', body: '바뀐본문', repoIds: [repoB],
      expectedUpdatedAt: beforeReject.updatedAt
    })).toThrow(/속하지 않는 repo/)

    const after = issues.get(created.id)
    expect(after.title).toBe('제목')
    expect(after.body).toBe('원본')
    expect(after.repoIds).toEqual([repoA])
  })
})
