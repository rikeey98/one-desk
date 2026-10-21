import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { AgentProbes, AgentStatuses } from '@shared/models'

/**
 * CLI 판정 — 홈의 준비 단계가 설정 화면 실행 탭과 **같은 데이터**를 그리기 위한 훅 (`docs/sdlc/home/` FR-15).
 * 빠른 칸(`checkAgents`, 실행 파일)과 느린 칸(`probeAgents`, 인증·모델)을 따로 받는 것, 늦게 온 응답을 순번으로 버리는 것,
 * 실패해도 화면을 비우지 않는 것이 `SettingsPanel`의 `check`·`probe`와 같다.
 *
 * `workspaceId`가 null이거나 `active`가 아니면 묻지 않는다 — workspace가 없으면 단계 1이 먼저고(FR-15), 홈을 떠나면
 * (workspace 화면·설정) 가짜 CLI를 쓰는 e2e에 `--version`이 또 돌 이유가 없다(plan 위험 2).
 */
export function useCliReadiness(workspaceId: string | null, active: boolean) {
  const client = useClient()
  const [statuses, setStatuses] = useState<AgentStatuses | null>(null)
  const [probes, setProbes] = useState<AgentProbes | null>(null)
  const [probing, setProbing] = useState(false)
  const seq = useRef(0)

  const ask = useCallback(async (id: string, refresh: boolean) => {
    const mine = ++seq.current
    setProbing(true)
    try {
      const fast = await client.workspaces.checkAgents(id)
      if (mine === seq.current) setStatuses(fast)
    } catch {
      if (mine === seq.current) setStatuses(null)
    }
    try {
      const slow = await client.workspaces.probeAgents(id, refresh)
      if (mine === seq.current) setProbes(slow)
    } catch {
      // IPC 자체가 끊긴 경우다 — 아무 말도 지어내지 않고 비워 둔다(SettingsPanel과 같다)
      if (mine === seq.current) setProbes(null)
    } finally {
      if (mine === seq.current) setProbing(false)
    }
  }, [client])

  useEffect(() => {
    if (!active || workspaceId === null) return
    void ask(workspaceId, false)
  }, [active, workspaceId, ask])

  const refresh = useCallback(() => {
    if (workspaceId !== null) void ask(workspaceId, true)
  }, [workspaceId, ask])

  return { statuses, probes, probing, refresh }
}
