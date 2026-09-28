import { useEffect, useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { FileHit } from '@shared/models'

/** 치는 동안 질의마다 IPC를 보내지 않는다 (docs/sdlc/input-triggers/ §5-4) */
export const FILE_SEARCH_DEBOUNCE_MS = 120

interface FileSearchState {
  files: FileHit[]
  reason: string | null
  truncated: boolean
  loading: boolean
}

const IDLE: FileSearchState = { files: [], reason: null, truncated: false, loading: false }

/**
 * `@` 피커의 검색 (§5-4). `useCommands`의 모양이다 — 순번으로 늦게 온 옛 응답을 버리고, **키(repo·질의)가
 * 바뀌면 옛 결과를 보이지 않는다.** 옛 결과가 남아 있으면 응답을 기다리는 사이의 Enter가 지금 질의와
 * 다른 파일을 넣는다.
 *
 * `enabled`가 거짓이면(피커가 닫힘) 부르지 않는다. repo가 없으면 부르지 않고 호출자가 이유를 보인다.
 */
export function useFileSearch(workspaceId: string, repoId: string | null, query: string, enabled: boolean) {
  const client = useClient()
  const key = JSON.stringify([workspaceId, repoId, query])
  const sequence = useRef(0)
  const [state, setState] = useState<FileSearchState & { key: string }>({ ...IDLE, key: '' })
  const active = enabled && repoId !== null

  useEffect(() => {
    if (!active || repoId === null) return
    const request = ++sequence.current
    const timer = setTimeout(() => {
      client.files.search({ workspaceId, repoId, query }).then(
        (result) => {
          if (request !== sequence.current) return
          setState(result.ok
            ? { key, files: result.files, reason: null, truncated: result.truncated, loading: false }
            : { key, files: [], reason: result.reason, truncated: false, loading: false })
        },
        (error: unknown) => {
          if (request !== sequence.current) return
          setState({ key, files: [], truncated: false, loading: false, reason: error instanceof Error ? error.message : String(error) })
        }
      )
    }, FILE_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      sequence.current++
    }
  }, [client, workspaceId, repoId, query, key, active])

  if (!active) return IDLE
  return state.key === key ? state : { ...IDLE, loading: true }
}
