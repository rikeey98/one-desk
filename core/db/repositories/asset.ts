import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../open'
import { asset } from '../schema'
import type {
  Asset, CreateAuthoredAssetInput, GuardedUpdateAssetInput, AssetUpdateResult, ListAssetQuery
} from '@shared/models'
import type { FoundAsset } from '../../assets/scan'

export interface UpsertDiscoveredInput {
  workspaceId: string
  repoId: string
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

    list(query: ListAssetQuery): Asset[] {
      return db.select().from(asset)
        .where(eq(asset.workspaceId, query.workspaceId))
        .all() as Asset[]
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
