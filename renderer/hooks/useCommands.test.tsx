import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OneDeskClient } from '@shared/client'
import type { CommandListResult } from '@shared/models'
import { ClientProvider } from '../client/ClientProvider'
import { useCommands } from './useCommands'

const result = (name: string): CommandListResult => ({
  commands: [{ name, description: null, usesArguments: false }], error: null
})

function setup(list = vi.fn().mockResolvedValue(result('review'))) {
  const refresh = vi.fn().mockResolvedValue(result('new-command'))
  const client = { commands: { list, refresh } } as unknown as OneDeskClient
  const wrapper = ({ children }: { children: ReactNode }) => <ClientProvider client={client}>{children}</ClientProvider>
  return { list, refresh, wrapper }
}

describe('useCommands', () => {
  it('cwd가 없으면 조회하지 않고 비어 있다', () => {
    const { list, wrapper } = setup()
    const { result: hook } = renderHook(() => useCommands('w1', ''), { wrapper })
    expect(hook.current.commands).toEqual([])
    expect(hook.current.loading).toBe(false)
    expect(list).not.toHaveBeenCalled()
  })

  it('cwd를 바꾸면 이전 목록과 늦게 도착한 응답을 버린다', async () => {
    let oldReply!: (value: CommandListResult) => void
    const list = vi.fn().mockImplementation(({ cwd }) => cwd === '/a'
      ? new Promise<CommandListResult>((resolve) => { oldReply = resolve })
      : Promise.resolve(result('b-only')))
    const { wrapper } = setup(list)
    const { result: hook, rerender } = renderHook(({ cwd }) => useCommands('w1', cwd), {
      wrapper, initialProps: { cwd: '/a' }
    })
    expect(hook.current.loading).toBe(true)
    rerender({ cwd: '/b' })
    await waitFor(() => expect(hook.current.commands[0]?.name).toBe('b-only'))
    await act(async () => { oldReply(result('a-only')) })
    expect(hook.current.commands[0]?.name).toBe('b-only')
    expect(list).toHaveBeenLastCalledWith({ workspaceId: 'w1', cwd: '/b' })
    rerender({ cwd: '' })
    expect(hook.current.commands).toEqual([])
  })

  it('새로고침은 core 캐시를 갱신하고 결과를 바꾼다', async () => {
    const { wrapper, refresh } = setup()
    const { result: hook } = renderHook(() => useCommands('w1', '/a'), { wrapper })
    await waitFor(() => expect(hook.current.commands[0]?.name).toBe('review'))
    await act(async () => { await hook.current.refresh() })
    expect(refresh).toHaveBeenCalledWith({ workspaceId: 'w1', cwd: '/a' })
    expect(hook.current.commands[0]?.name).toBe('new-command')
  })

  it('IPC 실패가 입력을 막지 않고 사유로 남는다', async () => {
    const { wrapper } = setup(vi.fn().mockRejectedValue(new Error('조회 실패')))
    const { result: hook } = renderHook(() => useCommands('w1', '/a'), { wrapper })
    await waitFor(() => expect(hook.current.error).toBe('조회 실패'))
    expect(hook.current.commands).toEqual([])
    expect(hook.current.loading).toBe(false)
  })
})
