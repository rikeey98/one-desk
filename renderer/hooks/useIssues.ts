import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Issue } from '@shared/models'

export function useIssues(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [issues, setIssues] = useState<Issue[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setIssues([]); return }
    try {
      setIssues(await client.issues.list({
        workspaceId,
        ...(repoId ? { repoId } : {})
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])

  /**
   * run이 끝나면 목록을 다시 읽는다.
   *
   * agent가 MCP로 만든 이슈는 이 구독이 없으면 화면에 영영 안 뜬다 — 패널을
   * 다시 마운트시켜야만(다른 화면에 갔다 오기) 보였다. 4단계가 "UI 변경 없음"으로
   * 미뤄둔 경계인데, MCP가 실제로 돌기 시작하면서 매번 걸리는 자리가 됐다.
   *
   * **다른 workspace의 run은 무시한다.** MCP 토큰이 workspace 단위라 그쪽
   * run은 이 목록을 건드릴 수 없다.
   */
  useEffect(() => {
    if (!workspaceId) return
    // 끝난 run은 확인함/보관으로 또 갱신된다. 그때마다 다시 읽지 않는다.
    const refreshed = new Set<string>()
    return client.events.onRunUpdate((run) => {
      if (run.workspaceId !== workspaceId) return
      if (run.endedAt === null || refreshed.has(run.id)) return
      refreshed.add(run.id)
      void refresh()
    })
  }, [client, workspaceId, refresh])

  return { issues, error, refresh }
}
