import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { Database } from '../open'
import { asset } from '../schema'
import type {
  Asset, CreateAuthoredAssetInput, GuardedUpdateAssetInput, AssetUpdateResult, ListAssetQuery
} from '@shared/models'
import type { FoundAsset } from '../../assets/scan'

/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]

export interface MovePathPrefixInput {
  workspaceId: string
  /** 옮길 repo. 글로벌(repo_id NULL)은 대상이 아니다 */
  repoId: string
  from: string
  to: string
}

/** 경로 경계(구분자 앞)에서만 맞는 접두사. `/tmp/api`가 `/tmp/api2`를 끌고 가면 안 된다. */
function underPrefix(filePath: string, prefix: string): boolean {
  return filePath === prefix
    || filePath.startsWith(prefix + '/')
    || filePath.startsWith(prefix + '\\')
}

/**
 * repo 경로가 바뀔 때 그 repo의 asset `file_path`를 새 접두사로 옮긴다 (spec FR-9).
 *
 * **행을 새로 만들지 않는다** — 과거 run이 첨부한 asset은 id로 이어져 있어, 옛 행을
 * "없음"으로 두고 새 행을 만들면 기록이 끊기고 목록이 두 벌이 된다(설계 §232).
 *
 * 트랜잭션은 부르는 쪽(repo 저장소)이 쥔다 — repo 경로 갱신과 이 치환이 하나로
 * 묶여야 절반만 반영된 상태가 남지 않는다. 유니크 인덱스에 걸리면 던지고 트랜잭션이
 * 통째로 되돌아간다.
 *
 * **글로벌 행은 `repo_id`가 NULL이라 `eq(asset.repoId, repoId)`에 절대 걸리지
 * 않는다** — 그것이 의도다. 이 조건을 `isNull`이나 `or`로 넓히면 글로벌이 딸려 온다.
 */
export function moveAssetPathPrefix(runner: Runner, input: MovePathPrefixInput): void {
  const rows = runner.select({ id: asset.id, filePath: asset.filePath }).from(asset).where(and(
    eq(asset.workspaceId, input.workspaceId),
    eq(asset.repoId, input.repoId)
  )).all()
  for (const row of rows) {
    if (row.filePath === null || !underPrefix(row.filePath, input.from)) continue
    const moved = input.to + row.filePath.slice(input.from.length)
    runner.update(asset).set({ filePath: moved }).where(eq(asset.id, row.id)).run()
  }
}

export interface UpsertDiscoveredInput {
  workspaceId: string
  /** 발견된 repo. **글로벌 경로에서 발견했으면 null이다** */
  repoId: string | null
  /** 이번 스캔의 시각. 발견한 것에만 찍는다 */
  seenAt: number
  found: FoundAsset[]
}

export function createAssetRepository(db: Database) {
  function getById(id: string): Asset {
    const row = db.select().from(asset).where(eq(asset.id, id)).get()
    if (!row) throw new Error(`asset을 찾을 수 없습니다: ${id}`)
    return row as Asset
  }

  return {
    get: getById,

    /**
     * repo를 지정하면 **글로벌 + 그 repo + 앱에서 작성한 것**만 준다.
     *
     * 이슈·메모의 필터 규칙과 같은 모양이다(전체 설계 §150) — 그 repo 것과 "공통"이
     * 함께 보인다. asset에서 `repo_id`가 NULL인 것이 곧 공통이고, 글로벌과 authored가
     * 둘 다 거기 해당한다.
     */
    list(query: ListAssetQuery): Asset[] {
      const where = query.repoId
        ? and(
            eq(asset.workspaceId, query.workspaceId),
            or(isNull(asset.repoId), eq(asset.repoId, query.repoId))
          )
        : eq(asset.workspaceId, query.workspaceId)
      return db.select().from(asset).where(where).all() as Asset[]
    },

    createAuthored(input: CreateAuthoredAssetInput): Asset {
      const now = Date.now()
      const row = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        kind: input.kind,
        source: 'authored' as const,
        name: input.name,
        description: input.description ?? null,
        repoId: null,
        filePath: null,
        content: input.content ?? '',
        lastSeenAt: null,
        createdAt: now,
        updatedAt: now
      }
      db.insert(asset).values(row).run()
      return row as Asset
    },

    /**
     * 스캔 결과를 반영한다.
     *
     * **사라진 파일의 행을 지우지 않는다** (설계 §3-4). 발견한 것에만 `lastSeenAt`을
     * 찍으므로, 안 보인 행은 값이 그대로 남아 화면에서 "없음"으로 판정된다.
     *
     * **`authored` 행은 손대지 않는다.** 건드리면 앱에서 쓴 asset이 첫 스캔에
     * 전부 "없음"이 된다.
     */
    upsertDiscovered(input: UpsertDiscoveredInput): void {
      db.transaction((tx) => {
        for (const item of input.found) {
          // **조회 키는 (workspace_id, file_path)다 — repo_id를 넣지 않는다.**
          // 글로벌 asset은 repo_id가 NULL인데 SQL의 `repo_id = NULL`은 절대 참이 되지
          // 않아, 넣어두면 매번 INSERT를 시도하다 유니크 인덱스에 걸려 스캔이 죽는다.
          // 유니크 인덱스와 같은 키를 봐야 한다.
          const existing = tx.select().from(asset).where(and(
            eq(asset.workspaceId, input.workspaceId),
            eq(asset.filePath, item.filePath)
          )).get()

          if (existing) {
            tx.update(asset).set({
              kind: item.kind,
              repoId: input.repoId,
              name: item.name,
              description: item.description,
              lastSeenAt: input.seenAt,
              updatedAt: Math.max(Date.now(), existing.updatedAt + 1)
            }).where(eq(asset.id, existing.id)).run()
            continue
          }

          const now = Date.now()
          tx.insert(asset).values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            kind: item.kind,
            source: 'discovered',
            name: item.name,
            description: item.description,
            repoId: input.repoId,
            filePath: item.filePath,
            content: null,
            lastSeenAt: input.seenAt,
            createdAt: now,
            updatedAt: now
          }).run()
        }
      })
    },

    /**
     * 낙관적 잠금 갱신. `authored`에만 쓴다.
     *
     * `updatedAt`은 반드시 이전 값보다 커야 한다 — 같은 밀리초 안에 두 번 쓰면
     * `Date.now()`만으로는 값이 같아져 "그 사이 바뀌었다"를 놓친다.
     */
    updateIfUnchanged(input: GuardedUpdateAssetInput): AssetUpdateResult {
      const current = getById(input.id)
      if (current.source !== 'authored') {
        throw new Error('discovered asset은 앱에서 고칠 수 없습니다. 파일이 원본입니다.')
      }
      if (current.updatedAt !== input.expectedUpdatedAt) return { ok: false, current }

      const patch: Record<string, unknown> = {
        updatedAt: Math.max(Date.now(), current.updatedAt + 1)
      }
      if (input.name !== undefined) patch['name'] = input.name
      if (input.description !== undefined) patch['description'] = input.description
      if (input.content !== undefined) patch['content'] = input.content

      db.update(asset).set(patch).where(and(
        eq(asset.id, input.id),
        eq(asset.updatedAt, input.expectedUpdatedAt)
      )).run()

      return { ok: true, asset: getById(input.id) }
    },

    remove(id: string): void {
      db.delete(asset).where(eq(asset.id, id)).run()
    },

    /** `moveAssetPathPrefix`를 자기 트랜잭션으로 감싼 것. repo 저장소 밖에서 쓸 때 */
    movePathPrefix(input: MovePathPrefixInput): void {
      db.transaction((tx) => { moveAssetPathPrefix(tx, input) })
    },

    /** 맥락 조립이 쓴다. workspace 밖 id는 걸러진다 */
    byIds(workspaceId: string, ids: string[]): Asset[] {
      if (ids.length === 0) return []
      return db.select().from(asset).where(and(
        eq(asset.workspaceId, workspaceId), inArray(asset.id, ids)
      )).all() as Asset[]
    }
  }
}

export type AssetRepository = ReturnType<typeof createAssetRepository>
