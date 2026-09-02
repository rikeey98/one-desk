import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, notInArray, or, sql } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, issueRepo, repo } from '../schema'
import { NotFoundError } from '../../errors'
import type {
  Issue, CreateIssueInput, UpdateIssueInput, ListQuery,
  GuardedUpdateIssueInput, IssueUpdateResult, IssueSource, IssueKind, IssuePriority
} from '@shared/models'

/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]

/** 충돌을 트랜잭션 밖으로 알리는 신호. 오류가 아니라 예상된 결과다. */
const CONFLICT = Symbol('conflict')

export function createIssueRepository(db: Database) {
  /** 여러 이슈의 repoIds를 한 번의 쿼리로 모아온다 (N+1 방지). */
  function loadRepoIds(issueIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (issueIds.length === 0) return map
    const rows = db.select().from(issueRepo)
      .where(inArray(issueRepo.issueId, issueIds)).all()
    for (const row of rows) {
      const list = map.get(row.issueId) ?? []
      list.push(row.repoId)
      map.set(row.issueId, list)
    }
    return map
  }

  /**
   * 태그로 붙이려는 repo가 전부 같은 workspace 소속인지 확인한다.
   * 외래키는 repo의 존재만 보장하고 소속은 보지 않으므로, 이 검증이 없으면
   * 다른 workspace의 repo id를 그대로 붙일 수 있다 (설계 §8의 보안 경계).
   */
  function assertReposInWorkspace(runner: Runner, workspaceId: string, repoIds: string[]) {
    if (repoIds.length === 0) return
    const found = runner
      .select({ id: repo.id })
      .from(repo)
      .where(and(eq(repo.workspaceId, workspaceId), inArray(repo.id, repoIds)))
      .all()
    const known = new Set(found.map((r) => r.id))
    const outside = repoIds.filter((id) => !known.has(id))
    if (outside.length > 0) {
      throw new Error(`이 workspace에 속하지 않는 repo입니다: ${outside.join(', ')}`)
    }
  }

  function replaceTags(runner: Runner, issueId: string, repoIds: string[]) {
    const unique = [...new Set(repoIds)]
    runner.delete(issueRepo).where(eq(issueRepo.issueId, issueId)).run()
    if (unique.length > 0) {
      runner.insert(issueRepo).values(unique.map((repoId) => ({ issueId, repoId }))).run()
    }
  }

  function getById(id: string): Issue {
    const row = db.select().from(issue).where(eq(issue.id, id)).get()
    if (!row) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${id}`)
    return { ...row, repoIds: loadRepoIds([id]).get(id) ?? [] }
  }

  /** buildPatch가 파생을 계산하려면 현재 축 값이 필요하다. */
  type Previous = {
    updatedAt: number
    source: IssueSource | null
    kind: IssueKind | null
    priority: IssuePriority | null
  }

  /**
   * UpdateIssueInput을 SET 절로 바꾼다. update와 updateIfUnchanged가 함께 쓴다.
   *
   * updatedAt은 낙관적 잠금의 버전 노릇도 한다 (본문 편집 설계 §6). 같은 밀리초에
   * 두 번 쓰면 값이 같아져 "그 사이 바뀌었다"를 놓치므로 반드시 이전 값보다 크게 만든다.
   */
  function buildPatch(input: UpdateIssueInput, previous: Previous): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      updatedAt: Math.max(Date.now(), previous.updatedAt + 1)
    }
    if (input.title !== undefined) patch['title'] = input.title
    if (input.body !== undefined) patch['body'] = input.body
    if (input.status !== undefined) {
      patch['status'] = input.status
      // closedAt은 status에서 파생된다. 호출자가 따로 관리하면 둘이 어긋난다.
      patch['closedAt'] = input.status === 'done' ? Date.now() : null
    }

    // triagedAt도 파생이다 (설계 §3). **축을 건드리는 갱신에서만 다시 계산한다** —
    // 매번 계산하면 본문만 고쳐도 triagedAt이 새 시각으로 덮여, "언제 정리했나"가
    // 아무 뜻도 없는 값이 된다.
    // 다만 이미 분류된 이슈의 축 하나만 다시 바꿔도 triagedAt은 지금 시각으로
    // 다시 찍힌다 — "최초 분류 시각"이 아니라 "마지막으로 축을 건드린 시각"이다.
    // triagedAt은 지금 null 여부로만 쓰이므로 무해하지만, 훗날 "분류한 날짜"를
    // 화면에 보여줄 일이 생기면 이 재스탬핑이 문제가 된다.
    const touchesAxes =
      input.source !== undefined || input.kind !== undefined || input.priority !== undefined
    if (touchesAxes) {
      const source = input.source ?? previous.source
      const kind = input.kind ?? previous.kind
      const priority = input.priority ?? previous.priority
      if (input.source !== undefined) patch['source'] = source
      if (input.kind !== undefined) patch['kind'] = kind
      if (input.priority !== undefined) patch['priority'] = priority
      patch['triagedAt'] = source && kind && priority ? Date.now() : null
    }
    return patch
  }

  return {
    /** id로 하나를 집어온다. workspace 소속은 보지 않는다 — 부르는 쪽의 책임이다. */
    get: getById,

    list(query: ListQuery): Issue[] {
      // repo 필터: 그 repo에 태그된 것 + 어디에도 태그되지 않은 공통 항목 (설계 §9)
      const taggedWithRepo = db.select({ id: issueRepo.issueId }).from(issueRepo)
        .where(eq(issueRepo.repoId, query.repoId ?? ''))
      const taggedWithAny = db.select({ id: issueRepo.issueId }).from(issueRepo)

      const where = query.repoId
        ? and(
            eq(issue.workspaceId, query.workspaceId),
            or(inArray(issue.id, taggedWithRepo), notInArray(issue.id, taggedWithAny))
          )
        : eq(issue.workspaceId, query.workspaceId)

      // 안 본 것이 위로 온다. seenAt이 null인 것(한 번도 안 연 것)이 가장 위다.
      // 예전의 updatedAt DESC는 정확히 반대로 돌았다 — 안 볼수록 아래로 밀었고,
      // agent가 MCP로 건드린 이슈를 사람이 본 것처럼 맨 위로 올렸다.
      // 첫 정렬 키 `(seenAt is null) desc`는 SQLite에서 사실 군더더기다 — 일반
      // ASC 정렬만으로도 NULL이 먼저 오므로 이 키가 없어도 결과는 같다. 의도를
      // 드러내려고 일부러 남겨뒀다. 다만 표현식이 첫 정렬 키라 이 쿼리는 seenAt
      // 단일 컬럼 인덱스를 못 타니, 나중에 정렬이 느려지면 이 키부터 의심할 것.
      const rows = db.select().from(issue).where(where)
        .orderBy(sql`(${issue.seenAt} is null) desc`, asc(issue.seenAt), asc(issue.createdAt))
        .all()

      const tagMap = loadRepoIds(rows.map((r) => r.id))
      return rows.map((r) => ({ ...r, repoIds: tagMap.get(r.id) ?? [] }))
    },

    create(input: CreateIssueInput): Issue {
      const id = randomUUID()
      const now = Date.now()
      const { source = null, kind = null, priority = null } = input
      db.transaction((tx) => {
        assertReposInWorkspace(tx, input.workspaceId, input.repoIds ?? [])
        tx.insert(issue).values({
          id,
          workspaceId: input.workspaceId,
          title: input.title,
          body: input.body ?? '',
          source,
          kind,
          priority,
          // 만들 때도 파생 규칙은 같다. agent가 MCP로 축까지 주면 훑기를 건너뛴다.
          triagedAt: source && kind && priority ? now : null,
          createdAt: now,
          updatedAt: now
        }).run()
        replaceTags(tx, id, input.repoIds ?? [])
      })
      return getById(id)
    },

    update(input: UpdateIssueInput): Issue {
      const owner = db
        .select({
          workspaceId: issue.workspaceId,
          updatedAt: issue.updatedAt,
          source: issue.source,
          kind: issue.kind,
          priority: issue.priority
        })
        .from(issue)
        .where(eq(issue.id, input.id))
        .get()
      if (!owner) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${input.id}`)

      const patch = buildPatch(input, owner)

      db.transaction((tx) => {
        tx.update(issue).set(patch).where(eq(issue.id, input.id)).run()
        if (input.repoIds !== undefined) {
          assertReposInWorkspace(tx, owner.workspaceId, input.repoIds)
          replaceTags(tx, input.id, input.repoIds)
        }
      })
      return getById(input.id)
    },

    /**
     * 내가 읽은 뒤로 바뀌지 않았을 때만 갱신한다 (설계 §6).
     *
     * 읽고 나서 쓰는데도 경합이 없다 — better-sqlite3는 동기이고 커넥션이 하나뿐이라
     * db.transaction 안에서는 다른 JS가 끼어들 수 없다. 조건부 UPDATE의 영향 행 수를
     * 세는 방법도 되지만, 읽는 쪽이 분명하고 충돌 시 돌려줄 최신 행이 이미 손에 있다.
     */
    updateIfUnchanged(input: GuardedUpdateIssueInput): IssueUpdateResult {
      try {
        db.transaction((tx) => {
          const row = tx
            .select({
              workspaceId: issue.workspaceId,
              updatedAt: issue.updatedAt,
              source: issue.source,
              kind: issue.kind,
              priority: issue.priority
            })
            .from(issue)
            .where(eq(issue.id, input.id))
            .get()
          if (!row) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${input.id}`)
          // 던져야 트랜잭션이 롤백된다. 여기서 return하면 앞선 쓰기가 남는다.
          if (row.updatedAt !== input.expectedUpdatedAt) throw CONFLICT

          tx.update(issue).set(buildPatch(input, row))
            .where(eq(issue.id, input.id)).run()
          if (input.repoIds !== undefined) {
            assertReposInWorkspace(tx, row.workspaceId, input.repoIds)
            replaceTags(tx, input.id, input.repoIds)
          }
        })
      } catch (err) {
        if (err === CONFLICT) return { ok: false, current: getById(input.id) }
        throw err
      }
      return { ok: true, issue: getById(input.id) }
    },

    /**
     * 사람이 이슈를 열었다는 사실만 기록한다.
     *
     * **buildPatch를 타지 않는다.** updatedAt을 올리면 열려 있는 IssueDetail의
     * 낙관적 잠금 기대값이 즉시 낡아, 다음 자동 저장이 사용자 자신의 열람을 agent의
     * 편집으로 착각해 유령 충돌 배너를 띄운다.
     */
    markSeen(id: string): void {
      const result = db.update(issue)
        .set({ seenAt: Date.now() })
        .where(eq(issue.id, id))
        .run()
      if (result.changes === 0) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${id}`)
    },

    remove(id: string): void {
      db.delete(issue).where(eq(issue.id, id)).run()
    }
  }
}

export type IssueRepository = ReturnType<typeof createIssueRepository>
