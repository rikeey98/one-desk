import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts, Run } from '@shared/models'

const EMPTY: InboxCounts = { total: 0, byWorkspace: {} }

/**
 * 인박스 목록과 배지 건수. 모든 workspace를 가로지른다.
 *
 * 건수는 event:inboxUpdate가 payload로 실어 오므로 그대로 쓴다. 목록은 인박스가
 * 열려 있을 때만 다시 읽는다 — `client.runs.inbox()`는 미확인 대화의 전체 행을
 * 읽고 맥락까지 hydrate하므로, 인박스를 한 번도 열지 않은 사용자에게는 순수한
 * 비용이다. (건수 쪽 `inboxCounts()`는 리뷰 I-2 이후 hydrate 없이 최소 컬럼만
 * 읽지만 `run` 테이블을 훑는 것 자체는 여전하다 — reviewed_at에 인덱스가 없다는
 * 알려진 한계(설계 §8)가 남아 있다. 여기서 피하는 것은 목록 쪽의 hydrate 비용이다.)
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
