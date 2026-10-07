import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useItemChanged } from './useItemChanged'
import type { Memo } from '@shared/models'

export function useMemos(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [memos, setMemos] = useState<Memo[]>([])
  const [error, setError] = useState<string | null>(null)
  // 지금 범위(workspace·repo)의 목록을 한 번이라도 읽었는가. 패널은 이것이 참일 때만 "열린 항목이 목록에 없다"를
  // 믿는다 — 빈 목록으로 막 마운트된 순간에 접으면, 다른 workspace에서 건너와 연 항목(리포트·도크의 이슈 링크)이
  // 목록이 오기도 전에 닫힌다 (docs/sdlc/period-report/ FR-19).
  const scope = `${workspaceId ?? ''}|${repoId ?? ''}`
  const [loadedScope, setLoadedScope] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setMemos([]); return }
    try {
      setMemos(await client.memos.list({
        workspaceId,
        ...(repoId ? { repoId } : {})
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // 실패도 "읽어 봤다"다 — 못 읽은 목록에 있다고 우기며 상세를 붙들지 않는다
      setLoadedScope(`${workspaceId}|${repoId ?? ''}`)
    }
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])

  /**
   * run이 끝나면 목록을 다시 읽는다.
   *
   * agent가 MCP로 만든 메모는 이 구독이 없으면 화면에 영영 안 뜬다 — 패널을
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

  // 다른 창이나 agent가 바꾼 것 (docs/sdlc/item-windows/ FR-18). workspace가 없으면 듣지 않는다.
  useItemChanged(workspaceId ?? undefined, 'memo', refresh)

  return { memos, error, refresh, loaded: loadedScope === scope }
}
