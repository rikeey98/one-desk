import { scanRepo as walk, scanDir } from './scan'
import type { AssetRepository } from '../db/repositories/asset'
import type { RepoRepository } from '../db/repositories/repo'

export interface AssetServiceDeps {
  assets: AssetRepository
  repos: RepoRepository
  /**
   * 훑을 글로벌 경로. 설정에서 바뀌므로 **값이 아니라 함수로 받는다** — 서비스를
   * 만든 뒤에 사용자가 경로를 바꿔도 다음 스캔에 반영돼야 한다.
   */
  globalRoots: () => string[]
  /**
   * 훑을 workspace 전부. `repos`에서 뽑지 않는 이유: 글로벌 asset은 repo가 하나도
   * 없는 workspace에도 보여야 한다.
   */
  workspaceIds: () => string[]
}

/**
 * 스캔의 세 진입점. 설계 §3-2가 정한 시점이 각각 하나씩 부른다 —
 * repo 등록(scanRepo), 새로고침(scanWorkspace), 부팅(scanAll).
 *
 * 파일 감시는 하지 않는다. 예측 가능한 시점에만 돈다.
 *
 * **한 번의 스캔은 시각 하나를 찍는다.** 화면의 "없음"은 그 workspace에서 가장 최근에
 * 본 시각보다 오래된 asset이다(설계 §3-4). 배치(repo 하나, 글로벌 루트 하나)마다
 * `Date.now()`를 따로 찍으면 먼저 훑은 repo의 asset이 나중에 훑은 글로벌보다 몇 ms
 * 오래돼, 방금 본 파일에 "없음"이 붙는다 — 글로벌 skill이 많은 장비일수록 잘 난다.
 */
export function createAssetService(deps: AssetServiceDeps) {
  async function scanOne(workspaceId: string, repoId: string, path: string, seenAt: number): Promise<void> {
    const found = await walk(path)
    deps.assets.upsertDiscovered({ workspaceId, repoId, seenAt, found })
  }

  async function scanWorkspace(workspaceId: string): Promise<void> {
    const seenAt = Date.now()
    for (const r of deps.repos.list(workspaceId)) {
      await scanOne(workspaceId, r.id, r.path, seenAt)
    }
    // 글로벌은 repo와 무관하다. repo를 하나도 등록하지 않은 workspace에서도 보여야 한다.
    for (const root of deps.globalRoots()) {
      const found = await scanDir(root)
      deps.assets.upsertDiscovered({ workspaceId, repoId: null, seenAt, found })
    }
  }

  return {
    async scanRepo(workspaceId: string, repoId: string): Promise<void> {
      const target = deps.repos.list(workspaceId).find((r) => r.id === repoId)
      if (!target) return
      await scanOne(workspaceId, repoId, target.path, Date.now())
    },

    scanWorkspace,

    /** 부팅에서 부른다. 경로 하나가 사라져 있어도 나머지는 훑는다 — 스캔이 던지지 않는다 */
    async scanAll(): Promise<void> {
      for (const workspaceId of deps.workspaceIds()) {
        await scanWorkspace(workspaceId)
      }
    }
  }
}

export type AssetService = ReturnType<typeof createAssetService>
