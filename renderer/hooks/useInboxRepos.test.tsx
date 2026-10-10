import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { useInboxRepos } from './useInboxRepos'
import type { OneDeskClient } from '@shared/client'
import type { Repo, Workspace } from '@shared/models'
import type { ReactNode } from 'react'

function wrap(client: OneDeskClient) {
  return ({ children }: { children: ReactNode }) => (
    <ClientProvider client={client}>{children}</ClientProvider>
  )
}

const ws = (id: string) => ({ id, name: id }) as Workspace
const repo = (id: string, workspaceId: string) =>
  ({ id, workspaceId, name: id, path: `/${id}`, description: null, sortOrder: 0, createdAt: 0 }) as Repo

function clientWith(list: (workspaceId: string) => Promise<Repo[]>): OneDeskClient {
  return { repos: { list: vi.fn(list) } } as unknown as OneDeskClient
}

describe('useInboxRepos (docs/sdlc/inbox-views/ FR-16·17)', () => {
  it('인박스가 열려 있으면 workspace마다 repo를 읽어 workspace id로 묶는다', async () => {
    const client = clientWith(async (id) => [repo(`${id}-r`, id)])
    const { result } = renderHook(() => useInboxRepos([ws('w1'), ws('w2')], true), { wrapper: wrap(client) })
    await waitFor(() => expect(Object.keys(result.current.repos).sort()).toEqual(['w1', 'w2']))
    expect(result.current.repos.w2?.map((r) => r.id)).toEqual(['w2-r'])
    expect(result.current.error).toBeNull()
  })

  it('닫혀 있으면 읽지 않는다', async () => {
    const client = clientWith(async () => [])
    renderHook(() => useInboxRepos([ws('w1')], false), { wrapper: wrap(client) })
    await new Promise((r) => setTimeout(r, 0))
    expect(client.repos.list).not.toHaveBeenCalled()
  })

  it('workspace가 늘면 그 repo도 읽는다', async () => {
    const client = clientWith(async (id) => [repo(`${id}-r`, id)])
    const { result, rerender } = renderHook(
      ({ workspaces }) => useInboxRepos(workspaces, true),
      { wrapper: wrap(client), initialProps: { workspaces: [ws('w1')] } }
    )
    await waitFor(() => expect(result.current.repos.w1).toBeDefined())
    rerender({ workspaces: [ws('w1'), ws('w2')] })
    await waitFor(() => expect(result.current.repos.w2?.map((r) => r.id)).toEqual(['w2-r']))
  })

  it('같은 workspace들이면 배열이 새로 와도 다시 읽지 않는다', async () => {
    const client = clientWith(async (id) => [repo(`${id}-r`, id)])
    const { result, rerender } = renderHook(
      ({ workspaces }) => useInboxRepos(workspaces, true),
      { wrapper: wrap(client), initialProps: { workspaces: [ws('w1')] } }
    )
    await waitFor(() => expect(result.current.repos.w1).toBeDefined())
    rerender({ workspaces: [ws('w1')] })
    await new Promise((r) => setTimeout(r, 0))
    expect(client.repos.list).toHaveBeenCalledTimes(1)
  })

  it('한 workspace를 못 읽으면 나머지는 쓰고, 실패를 조용히 삼키지 않는다', async () => {
    const client = clientWith(async (id) => {
      if (id === 'w2') throw new Error('디스크 오류')
      return [repo(`${id}-r`, id)]
    })
    const { result } = renderHook(() => useInboxRepos([ws('w1'), ws('w2')], true), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.error).toBe('repo 목록을 읽지 못했습니다: 디스크 오류'))
    expect(Object.keys(result.current.repos)).toEqual(['w1'])
  })

  it('늦게 온 옛 응답은 버린다', async () => {
    let releaseOld: (repos: Repo[]) => void = () => {}
    const client = clientWith((id) => id === 'old'
      ? new Promise<Repo[]>((resolve) => { releaseOld = resolve })
      : Promise.resolve([repo(`${id}-r`, id)]))
    const { result, rerender } = renderHook(
      ({ workspaces }) => useInboxRepos(workspaces, true),
      { wrapper: wrap(client), initialProps: { workspaces: [ws('old')] } }
    )
    rerender({ workspaces: [ws('new')] })
    await waitFor(() => expect(result.current.repos.new).toBeDefined())
    releaseOld([repo('stale', 'old')])
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(result.current.repos)).toEqual(['new'])
  })
})
