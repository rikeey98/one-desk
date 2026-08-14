import { useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { McpStatus } from '@shared/models'

/**
 * MCP 서버의 기동 상태.
 *
 * **한 번 읽기와 구독이 둘 다 필요하다.** 부팅 기동은 비동기라 창이 먼저
 * 뜰 수 있는데, 구독만 있으면 이미 지나간 전이를 놓쳐 영원히 '시작 중'으로
 * 굳는다. 반대로 읽기만 있으면 창이 기동보다 먼저 떴을 때 같은 자리에서
 * 멈춘다. 어느 순서로 일어나도 맞는 값이 보이려면 둘 다 있어야 한다.
 */
export function useMcpStatus(): McpStatus {
  const client = useClient()
  const [status, setStatus] = useState<McpStatus>({ state: 'starting' })

  useEffect(() => {
    let alive = true
    void client.mcp.status().then((s) => { if (alive) setStatus(s) })
    const off = client.events.onMcpStatus(setStatus)
    return () => { alive = false; off() }
  }, [client])

  return status
}
