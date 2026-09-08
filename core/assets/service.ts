import { scanRepo as walk } from './scan'
import type { AssetRepository } from '../db/repositories/asset'
import type { RepoRepository } from '../db/repositories/repo'

export interface AssetServiceDeps {
  assets: AssetRepository
  repos: RepoRepository
}

/**
 * 스캔의 세 진입점. 설계 §3-2가 정한 시점이 각각 하나씩 부른다 —
 * repo 등록(scanRepo), 새로고침(scanWorkspace), 부팅(scanAll).
 *
 * 파일 감시는 하지 않는다. 예측 가능한 시점에만 돈다.
 */
export function createAssetService(deps: AssetServiceDeps) {
  async function scanOne(workspaceId: string, repoId: string, path: string): Promise<void> {
    const found = await walk(path)
    deps.assets.upsertDiscovered({ workspaceId, repoId, seenAt: Date.now(), found })
  }

  async function scanWorkspace(workspaceId: string): Promise<void> {
    for (const r of deps.repos.list(workspaceId)) {
      await scanOne(workspaceId, r.id, r.path)
    }
  }

  return {
    async scanRepo(workspaceId: string, repoId: string): Promise<void> {
      const target = deps.repos.list(workspaceId).find((r) => r.id === repoId)
      if (!target) return
      await scanOne(workspaceId, repoId, target.path)
    },

    scanWorkspace,

    /** 부팅에서 부른다. repo 하나가 사라져 있어도 나머지는 훑는다 — walk가 던지지 않는다 */
    async scanAll(): Promise<void> {
      for (const workspaceId of deps.repos.workspaceIds()) {
        await scanWorkspace(workspaceId)
      }
    }
  }
}

export type AssetService = ReturnType<typeof createAssetService>
