import type { HomeTarget, HomeWorkspace } from '@shared/models'

/**
 * 새 대화 카드의 대상 (home FR-7·FR-11). 저장된 마지막 대상이 지금 요약에 있으면 그것, 없으면 첫 workspace의 첫 repo,
 * repo가 하나도 없으면 null(카드 대신 "repo를 등록하세요"). core의 `lastTarget`이 이미 지워진 id를 걸렀지만, 요약과
 * 저장값이 서로 다른 순간에 읽혀 어긋날 수 있어 여기서도 요약 안에서 찾는다.
 */
export function targetOf(saved: HomeTarget | null, workspaces: readonly HomeWorkspace[]): HomeTarget | null {
  if (saved) {
    const ws = workspaces.find((w) => w.workspaceId === saved.workspaceId)
    if (ws?.repos.some((r) => r.repoId === saved.repoId)) return saved
  }
  for (const ws of workspaces) {
    const repo = ws.repos[0]
    if (repo) return { workspaceId: ws.workspaceId, repoId: repo.repoId }
  }
  return null
}
