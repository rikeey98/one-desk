import { useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Repo, Workspace } from '@shared/models'
import type { ReposByWorkspace } from '../inboxView'

/**
 * 인박스가 묶음과 소속에 쓰는 repo — workspace마다 (`docs/sdlc/inbox-views/` FR-16·17).
 *
 * 인박스는 workspace를 넘는 목록인데 App의 `useRepos`는 고른 workspace 하나만 읽으므로 따로 읽는다. **인박스 화면이
 * 열려 있을 때만** 읽고, workspace 목록이 바뀌면(id 기준 — 배열이 새로 와도 같은 workspace면 다시 읽지 않는다) 다시 읽는다.
 * 한 workspace를 못 읽으면 그 workspace만 빠지고(그 항목은 `기타`) 실패 문장을 `error`로 낸다 — 조용히 삼키면 "왜 전부
 * 기타지?"에 답이 없다.
 *
 * @param open 인박스 화면이 떠 있는지
 */
export function useInboxRepos(workspaces: readonly Workspace[], open: boolean): {
  repos: ReposByWorkspace
  error: string | null
} {
  const client = useClient()
  const [repos, setRepos] = useState<ReposByWorkspace>({})
  const [error, setError] = useState<string | null>(null)
  const idsKey = workspaces.map((w) => w.id).join(',')

  useEffect(() => {
    if (!open) return
    const ids = idsKey === '' ? [] : idsKey.split(',')
    // 늦게 온 옛 응답(workspace 목록이 그 사이 바뀌었다)은 버린다
    let stale = false
    void Promise.allSettled(ids.map((id) => client.repos.list(id))).then((results) => {
      if (stale) return
      const next: Record<string, Repo[]> = {}
      let failure: string | null = null
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') next[ids[i]!] = result.value
        else if (failure === null) {
          const reason: unknown = result.reason
          failure = `repo 목록을 읽지 못했습니다: ${reason instanceof Error ? reason.message : String(reason)}`
        }
      })
      setRepos(next)
      setError(failure)
    })
    return () => { stale = true }
  }, [client, open, idsKey])

  return { repos, error }
}
