import type { WorkspaceRepository } from './db/repositories/workspace'

/**
 * 홈 workspace에 사람이 손댈 길을 막는다 (docs/sdlc/home-conversation/ FR-4). 홈 행은 홈 대화가 사는 숨은 행이라 이름·기본값·경로를
 * 바꾸거나 지우거나 그 아래 repo·이슈·메모·asset을 만들 이유가 없다 — 렌더러는 그런 호출을 하지 않지만 IPC는 렌더러를 믿지 않는다.
 *
 * 바뀜 알림 래퍼(`changes.ts`)처럼 **저장소를 만드는 자리에서 한 번** 감싸고, 감싼 것을 IPC 표면과 MCP `deps`가 같이 받는다.
 */
export const HOME_LOCKED = '홈 workspace는 바꿀 수 없습니다'

/** 그 workspace가 홈인가 — core가 홈 행의 id로 판정한다 */
export type IsHome = (workspaceId: string) => boolean

function assertNotHome(isHome: IsHome, workspaceId: string): void {
  if (isHome(workspaceId)) throw new Error(HOME_LOCKED)
}

export function lockHomeWorkspace(repo: WorkspaceRepository, isHome: IsHome): WorkspaceRepository {
  return {
    ...repo,
    rename(id, name) {
      assertNotHome(isHome, id)
      return repo.rename(id, name)
    },
    updateDefaults(input) {
      assertNotHome(isHome, input.id)
      return repo.updateDefaults(input)
    },
    updatePaths(input) {
      assertNotHome(isHome, input.id)
      return repo.updatePaths(input)
    },
    remove(id) {
      assertNotHome(isHome, id)
      repo.remove(id)
    }
  }
}

/**
 * workspace 하나에 쓰는 메서드. 메서드 문법에서 꺼낸 함수 타입이라 매개변수를 쌍변으로 비교한다 — 저장소의 `create`는
 * `{ workspaceId }`보다 좁은 입력(`CreateIssueInput` 등)을 받는다.
 */
type WorkspaceScopedWrite = { write(input: { workspaceId: string }): unknown }['write']

/** `key` 메서드가 받는 입력의 `workspaceId`가 홈이면 던진다 — repo·이슈·메모의 `create`, asset의 `createAuthored` */
export function lockHomeCreate<K extends string, T extends Record<K, WorkspaceScopedWrite>>(repo: T, key: K, isHome: IsHome): T {
  const original = repo[key]
  const guarded = (input: { workspaceId: string }) => {
    assertNotHome(isHome, input.workspaceId)
    return original(input)
  }
  return { ...repo, [key]: guarded }
}
