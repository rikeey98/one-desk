import type { ItemChange } from '@shared/models'
import type { IssueRepository } from './db/repositories/issue'
import type { MemoRepository } from './db/repositories/memo'
import type { AssetRepository } from './db/repositories/asset'
import type { RepoRepository } from './db/repositories/repo'
import type { WorkspaceRepository } from './db/repositories/workspace'

/**
 * 쓰기마다 바뀜 알림을 내는 저장소 래퍼 (docs/sdlc/item-windows/ spec FR-17).
 *
 * **core가 한 번 만들어 IPC 표면과 MCP `deps`에 같이 넘긴다.** MCP 도구는 저장소를 직접 쓰므로, IPC 쪽에만
 * 알림을 붙이면 agent가 고친 것이 열려 있는 패널 창에 보이지 않는다. 읽기(`get`·`list`)와 `markSeen`은 내지
 * 않는다 — 열람 기록으로 목록을 다시 읽으면 방금 연 항목이 눈앞에서 맨 아래로 도망간다(IssueDetail 참고).
 *
 * 충돌로 끝난 `updateIfUnchanged`도 내지 않는다 — 아무것도 바뀌지 않았다.
 *
 * 이슈와 메모 래퍼가 거의 같은 것은 의도다(CLAUDE.md "의도된 중복") — 대칭으로 둔다.
 */
export type Notify = (change: ItemChange) => void

/** 지울 행의 workspace를 먼저 읽는다. 없는 id면 저장소의 remove처럼 조용히 아무것도 하지 않는다. */
function workspaceOrNull(read: () => { workspaceId: string }): string | null {
  try { return read().workspaceId } catch { return null }
}

export function notifyingIssues(repo: IssueRepository, notify: Notify): IssueRepository {
  return {
    ...repo,
    create(input) {
      const made = repo.create(input)
      notify({ workspaceId: made.workspaceId, kind: 'issue' })
      return made
    },
    update(input) {
      const updated = repo.update(input)
      notify({ workspaceId: updated.workspaceId, kind: 'issue' })
      return updated
    },
    updateIfUnchanged(input) {
      const result = repo.updateIfUnchanged(input)
      if (result.ok) notify({ workspaceId: result.issue.workspaceId, kind: 'issue' })
      return result
    },
    remove(id) {
      const ws = workspaceOrNull(() => repo.get(id))
      repo.remove(id)
      if (ws !== null) notify({ workspaceId: ws, kind: 'issue' })
    }
  }
}

export function notifyingMemos(repo: MemoRepository, notify: Notify): MemoRepository {
  return {
    ...repo,
    create(input) {
      const made = repo.create(input)
      notify({ workspaceId: made.workspaceId, kind: 'memo' })
      return made
    },
    update(input) {
      const updated = repo.update(input)
      notify({ workspaceId: updated.workspaceId, kind: 'memo' })
      return updated
    },
    updateIfUnchanged(input) {
      const result = repo.updateIfUnchanged(input)
      if (result.ok) notify({ workspaceId: result.memo.workspaceId, kind: 'memo' })
      return result
    },
    remove(id) {
      const ws = workspaceOrNull(() => repo.get(id))
      repo.remove(id)
      if (ws !== null) notify({ workspaceId: ws, kind: 'memo' })
    }
  }
}

/** 앱에서 쓰는 asset만 감싼다. 스캔이 쓰는 것(upsert·prune·move)은 스캔이 끝날 때 한 번 낸다(core). */
export function notifyingAssets(repo: AssetRepository, notify: Notify): AssetRepository {
  return {
    ...repo,
    createAuthored(input) {
      const made = repo.createAuthored(input)
      notify({ workspaceId: made.workspaceId, kind: 'asset' })
      return made
    },
    updateIfUnchanged(input) {
      const result = repo.updateIfUnchanged(input)
      if (result.ok) notify({ workspaceId: result.asset.workspaceId, kind: 'asset' })
      return result
    },
    remove(id) {
      const ws = workspaceOrNull(() => repo.get(id))
      repo.remove(id)
      if (ws !== null) notify({ workspaceId: ws, kind: 'asset' })
    }
  }
}

/** repo의 이름은 패널 창의 제목이고, 지워지면 창이 그것을 말한다 (FR-4·FR-10). */
export function notifyingRepos(repo: RepoRepository, notify: Notify): RepoRepository {
  return {
    ...repo,
    create(input) {
      const made = repo.create(input)
      notify({ workspaceId: made.workspaceId, kind: 'repo' })
      return made
    },
    rename(id, name) {
      const renamed = repo.rename(id, name)
      notify({ workspaceId: renamed.workspaceId, kind: 'repo' })
      return renamed
    },
    update(id, patch) {
      const updated = repo.update(id, patch)
      notify({ workspaceId: updated.workspaceId, kind: 'repo' })
      return updated
    },
    remove(id) {
      const ws = workspaceOrNull(() => repo.get(id))
      repo.remove(id)
      if (ws !== null) notify({ workspaceId: ws, kind: 'repo' })
    }
  }
}

export function notifyingWorkspaces(repo: WorkspaceRepository, notify: Notify): WorkspaceRepository {
  return {
    ...repo,
    rename(id, name) {
      const renamed = repo.rename(id, name)
      notify({ workspaceId: id, kind: 'workspace' })
      return renamed
    },
    remove(id) {
      repo.remove(id)
      notify({ workspaceId: id, kind: 'workspace' })
    }
  }
}
