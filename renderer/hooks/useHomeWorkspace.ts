import { useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { HomeConversationPlace } from '@shared/models'

/**
 * 홈 대화의 자리 — 숨은 workspace와 그 대화가 뜨는 빈 폴더 (`docs/sdlc/home-conversation/` plan §0-3). 앱이 사는 동안 바뀌지 않으므로
 * 마운트 때 한 번 읽는다. 홈 도크·인박스·홈 패널이 이것을 필수 prop으로 받는다.
 */
export function useHomeWorkspace(): { place: HomeConversationPlace | null; error: string | null } {
  const client = useClient()
  const [place, setPlace] = useState<HomeConversationPlace | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    client.workspaces.home().then(
      (got) => { if (!stale) setPlace(got) },
      (err: unknown) => { if (!stale) setError(`홈 대화를 열지 못했습니다: ${err instanceof Error ? err.message : String(err)}`) }
    )
    return () => { stale = true }
  }, [client])

  return { place, error }
}
