import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useItemChanged } from './useItemChanged'
import type { DrawingSummary } from '@shared/models'

/**
 * 그림 목록 (docs/sdlc/drawings/ spec FR-17). repoId가 없으면 그 workspace 전부 — repo 삭제의 개수 경고가 쓴다(FR-19). 다른 창의
 * 저장·이름 바꾸기·지우기는 바뀜 알림으로 다시 읽는다. `loaded`는 지금 범위의 목록을 한 번이라도 읽었는가다(실패도 읽은 것으로 친다) —
 * 읽기 전에 "그림이 없습니다"를 띄우지 않게.
 */
export function useDrawings(workspaceId: string, repoId?: string) {
  const client = useClient()
  const [state, setState] = useState<{ key: string; list: DrawingSummary[]; error: string | null } | null>(null)
  const scope = `${workspaceId}\0${repoId ?? ''}`
  const current = useRef(scope)
  current.current = scope

  const refresh = useCallback(async () => {
    const key = scope
    try {
      const list = await client.drawings.list(repoId ? { workspaceId, repoId } : { workspaceId })
      if (current.current === key) setState({ key, list, error: null })
    } catch (err) {
      if (current.current === key) setState({ key, list: [], error: err instanceof Error ? err.message : String(err) })
    }
  }, [client, workspaceId, repoId, scope])

  useEffect(() => { void refresh() }, [refresh])
  useItemChanged(workspaceId, 'drawing', refresh)

  const mine = state && state.key === scope ? state : null
  return { drawings: mine?.list ?? [], loaded: mine !== null, error: mine?.error ?? null, refresh }
}
