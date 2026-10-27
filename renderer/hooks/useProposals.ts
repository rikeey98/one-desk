import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useItemChanged } from './useItemChanged'
import type { Proposal } from '@shared/models'

/**
 * 그 workspace의 기다리는 제안 (`docs/sdlc/agent-proposals/` spec FR-24). agent의 `propose_issue`·받기·거절이 바뀜 알림
 * `proposal`을 내면 다시 읽는다 — 도크가 쥐고 대화 칸에 내린다.
 */
export function useProposals(workspaceId: string) {
  const client = useClient()
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await client.proposals.pending(workspaceId)
      setProposals(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  useItemChanged(workspaceId, 'proposal', refresh)

  return { proposals, error }
}
