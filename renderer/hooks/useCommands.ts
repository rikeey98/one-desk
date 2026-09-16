import { useCallback, useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { CommandListResult } from '@shared/models'

export function useCommands(workspaceId: string, cwd: string) {
  const client = useClient()
  const key = JSON.stringify([workspaceId, cwd])
  const sequence = useRef(0)
  const [state, setState] = useState<CommandListResult & { key: string; loading: boolean }>({
    key: '', commands: [], error: null, loading: false
  })

  const load = useCallback(async (method: 'list' | 'refresh') => {
    const request = ++sequence.current
    setState({ key, commands: [], error: null, loading: Boolean(cwd) })
    if (!cwd) return
    try {
      const result = await client.commands[method]({ workspaceId, cwd })
      if (request === sequence.current) setState({ ...result, key, loading: false })
    } catch (error) {
      if (request === sequence.current) setState({
        key, commands: [], loading: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [client, workspaceId, cwd, key])

  useEffect(() => {
    void load('list')
    return () => { sequence.current++ }
  }, [load])

  const refresh = useCallback(() => load('refresh'), [load])
  // effect가 돌기 전에도 이전 디렉토리의 커맨드를 선택할 수 없게 한다.
  const visible = state.key === key ? state : { commands: [], error: null, loading: Boolean(cwd) }
  return { ...visible, refresh }
}
