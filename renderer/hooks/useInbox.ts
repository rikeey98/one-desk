import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts, Run } from '@shared/models'

const EMPTY: InboxCounts = { total: 0, byWorkspace: {} }

/**
 * 인박스 목록과 배지 건수. 모든 workspace를 가로지른다.
 *
 * 건수는 event:inboxUpdate로 push되고, 그때 목록도 다시 읽는다 —
 * 목록은 스냅샷이지 진실의 출처가 아니다.
 */
export function useInbox() {
  const client = useClient()
  const [items, setItems] = useState<Run[]>([])
  const [counts, setCounts] = useState<InboxCounts>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, next] = await Promise.all([client.runs.inbox(), client.runs.inboxCounts()])
      setItems(list)
      setCounts(next)
      // 한 번 실패한 뒤 성공하면 오류를 지운다 — 남겨두면 이후 오류를 영구히 가린다.
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => client.events.onInboxUpdate(() => { void refresh() }), [client, refresh])

  return { items, counts, error, refresh }
}
