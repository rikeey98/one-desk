import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Asset } from '@shared/models'

/**
 * asset 목록.
 *
 * `useIssues`/`useMemos`와 달리 run 완료를 구독하지 않는다 — agent가 MCP로
 * asset을 만들 수 없기 때문이다(설계 §1의 "빠지는 것"). 목록이 바뀌는 경로는
 * 스캔과 사용자의 작성뿐이고 둘 다 여기를 지난다.
 */
export function useAssets(workspaceId: string | null, repoKey = '') {
  const client = useClient()
  const [assets, setAssets] = useState<Asset[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setAssets([]); return }
    try {
      setAssets(await client.assets.list({ workspaceId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    // repoKey는 값을 쓰지 않고 의존성으로만 쓴다 — repo가 등록·삭제되면 그 repo의
    // asset도 함께 달라지므로 목록을 다시 읽어야 한다.
  }, [client, workspaceId, repoKey])

  useEffect(() => { void refresh() }, [refresh])

  const rescan = useCallback(async () => {
    setError(null)
    if (!workspaceId) return
    try {
      setAssets(await client.assets.rescan(workspaceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId])

  return { assets, error, refresh, rescan }
}
