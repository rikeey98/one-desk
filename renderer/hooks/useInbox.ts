import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts, Run } from '@shared/models'

const EMPTY: InboxCounts = { total: 0, byWorkspace: {} }

/**
 * 인박스 목록과 배지 건수. 모든 workspace를 가로지른다.
 *
 * 건수는 event:inboxUpdate가 payload로 실어 오므로 그대로 쓴다. 목록은 인박스가
 * 열려 있을 때만 다시 읽는다 — run 행이 바뀔 때마다 전체 미확인 run 조회와 맥락
 * hydrate를 도는 것은 인박스를 한 번도 열지 않은 사용자에게는 순수한 비용이고,
 * reviewed_at에 인덱스가 없다는 알려진 한계(설계 §8)와 곱해진다.
 * 목록은 스냅샷이지 진실의 출처가 아니다.
 *
 * @param open 인박스 화면이 떠 있는지
 */
export function useInbox(open: boolean) {
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

  // 배지는 인박스를 열지 않아도 맞아야 한다. 닫혀 있으면 건수만 읽는다.
  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await client.runs.inboxCounts())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client])

  useEffect(() => { void (open ? refresh() : refreshCounts()) }, [open, refresh, refreshCounts])

  useEffect(() => client.events.onInboxUpdate((next) => {
    setCounts(next)
    // 열려 있을 때만 목록을 다시 읽는다. 오류를 지우는 것은 그 조회의 성공이 맡는다.
    if (open) void refresh()
    else setError(null)
  }), [client, open, refresh])

  return { items, counts, error, refresh }
}
