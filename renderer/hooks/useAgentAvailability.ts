import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useItemChanged } from './useItemChanged'
import type { AgentStatuses } from '@shared/models'

/**
 * 사이드바 하단 줄의 "쓸 수 있는 agent" (`docs/sdlc/agent-status/` FR-1 개정) — 설정 실행 탭·홈과 **같은 빠른 칸**
 * `checkAgents`만 부른다(실행 파일). 느린 칸(`probeAgents` — 인증·모델)은 부르지 않는다: 하단 줄은 늘 떠 있어, 그것을 늘
 * 부르면 workspace를 고를 때마다 claude init probe가 돌고(홈의 준비 단계가 겪은 캡처 파일 덮기와 같은 경합) 비용도 든다.
 *
 * 다시 묻는 때: 대상 workspace가 바뀔 때, 그 workspace의 경로·기본값이 바뀌거나(`workspace` 바뀜 알림) repo가 바뀔 때(WSL repo가
 * 생기면 WSL 줄이 선다), 그리고 `active`가 다시 참이 될 때 — App은 설정 화면에 있는 동안 끄고 나오면 켠다(앱 탭의 CLI 기본
 * 경로는 바뀜 알림이 없다). 꺼져 있는 동안 마지막 값은 남긴다.
 *
 * opencode 판정은 `--version`을 한 번 띄우지만 (경로, 크기, mtime)으로 캐시된다 — 그 뒤로는 stat뿐이다.
 */
export function useAgentAvailability(workspaceId: string | null, active: boolean): AgentStatuses | null {
  const client = useClient()
  const [statuses, setStatuses] = useState<AgentStatuses | null>(null)
  // 늦게 온 옛 응답이 새 workspace의 판정을 덮지 않게
  const seq = useRef(0)

  const check = useCallback(async () => {
    const mine = ++seq.current
    if (workspaceId === null) {
      setStatuses(null)
      return
    }
    try {
      const next = await client.workspaces.checkAgents(workspaceId)
      if (mine === seq.current) setStatuses(next)
    } catch {
      // 판정을 못 얻었다 — "없음"이라고 지어내지 않고 "확인 전"으로 둔다
      if (mine === seq.current) setStatuses(null)
    }
  }, [client, workspaceId])

  useEffect(() => {
    if (!active) return
    void check()
  }, [active, check])

  const watched = active && workspaceId !== null ? workspaceId : undefined
  useItemChanged(watched, 'workspace', check)
  useItemChanged(watched, 'repo', check)

  return statuses
}
