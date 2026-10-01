import { useEffect, useRef } from 'react'
import { useClient } from '../client/ClientProvider'
import type { ItemChange } from '@shared/models'

/**
 * 다른 창(또는 agent의 MCP 쓰기)이 바꾼 것을 다시 읽는다 (docs/sdlc/item-windows/ spec FR-18).
 *
 * `workspaceId`가 null이면 workspace를 가리지 않는다(workspace 목록 자체를 읽는 훅). refresh가 매 렌더 새
 * 함수여도 구독을 다시 걸지 않게 최신 것만 들고 있는다.
 */
export function useItemChanged(
  workspaceId: string | null | undefined,
  kind: ItemChange['kind'],
  refresh: () => unknown
) {
  const client = useClient()
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    if (workspaceId === undefined) return
    return client.events.onItemChanged((change) => {
      if (change.kind !== kind) return
      if (workspaceId !== null && change.workspaceId !== workspaceId) return
      void latest.current()
    })
  }, [client, workspaceId, kind])
}
