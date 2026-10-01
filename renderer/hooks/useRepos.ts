import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useItemChanged } from './useItemChanged'
import type { Repo } from '@shared/models'

export function useRepos(workspaceId: string | null) {
  const client = useClient()
  const [repos, setRepos] = useState<Repo[]>([])
  const [error, setError] = useState<string | null>(null)
  // 한 번이라도 읽었는가 — 빈 목록이 "아직 안 읽음"인지 "정말 없음"인지 가른다. 패널 창이 창을 띄우자마자
  // "이 repo는 삭제됐습니다"를 깜빡이지 않게 한다 (docs/sdlc/item-windows/ FR-10).
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    if (!workspaceId) { setRepos([]); return }
    try {
      setRepos(await client.repos.list(workspaceId))
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  // 다른 창에서 등록·이름 변경·삭제한 것 (docs/sdlc/item-windows/ FR-18). 패널 창의 제목과 "삭제됐습니다"가 이것을 본다.
  useItemChanged(workspaceId ?? undefined, 'repo', refresh)
  return { repos, error, refresh, loaded }
}
