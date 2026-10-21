import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { useCliReadiness } from './useCliReadiness'
import type { OneDeskClient } from '@shared/client'
import type { ReactNode } from 'react'

function wrap(client: OneDeskClient) {
  return ({ children }: { children: ReactNode }) => (
    <ClientProvider client={client}>{children}</ClientProvider>
  )
}

const statuses = { 'claude-code': { ok: true, executable: '/bin/claude' }, opencode: { ok: false, reason: '없음' } }
const probes = {
  'claude-code': { auth: { state: 'ok', method: null, plan: null }, model: { state: 'resolved', model: 'sonnet' }, version: null, models: [] },
  opencode: { auth: { state: 'unknown', reason: 'x' }, model: { state: 'skipped', reason: 'x' }, version: null, models: [] }
}

function makeClient() {
  return {
    workspaces: {
      checkAgents: vi.fn().mockResolvedValue(statuses),
      probeAgents: vi.fn().mockResolvedValue(probes)
    }
  } as unknown as OneDeskClient
}

describe('useCliReadiness (home FR-15)', () => {
  it('홈이 보이고 workspace가 있으면 빠른 칸과 느린 칸을 차례로 읽는다', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useCliReadiness('w1', true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.probes).not.toBeNull())
    expect(result.current.statuses).toEqual(statuses)
    expect(result.current.probing).toBe(false)
    expect(client.workspaces.probeAgents).toHaveBeenCalledWith('w1', false)
  })

  it('workspace가 없거나 홈이 보이지 않으면 묻지 않는다 — 단계 1이 먼저고, e2e의 가짜 CLI가 또 돌지 않는다', () => {
    const client = makeClient()
    renderHook(() => useCliReadiness(null, true), { wrapper: wrap(client) })
    renderHook(() => useCliReadiness('w1', false), { wrapper: wrap(client) })
    expect(client.workspaces.checkAgents).not.toHaveBeenCalled()
  })

  it('다시 확인은 캐시를 버리고(refresh) 다시 묻는다', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useCliReadiness('w1', true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.probes).not.toBeNull())
    act(() => result.current.refresh())
    await waitFor(() => expect(client.workspaces.probeAgents).toHaveBeenCalledWith('w1', true))
  })

  it('느린 칸이 실패해도 빠른 칸은 남는다', async () => {
    const client = makeClient()
    ;(client.workspaces.probeAgents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IPC'))
    const { result } = renderHook(() => useCliReadiness('w1', true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.probing).toBe(false))
    expect(result.current.statuses).toEqual(statuses)
    expect(result.current.probes).toBeNull()
  })
})
