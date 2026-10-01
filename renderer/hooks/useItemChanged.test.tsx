import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ClientProvider } from '../client/ClientProvider'
import { useItemChanged } from './useItemChanged'
import { useIssues } from './useIssues'
import { useMemos } from './useMemos'
import { useAssets } from './useAssets'
import { useRepos } from './useRepos'
import { useWorkspaces } from './useWorkspaces'
import type { OneDeskClient } from '@shared/client'
import type { ItemChange } from '@shared/models'

function setup() {
  let listeners: Array<(c: ItemChange) => void> = []
  const client = {
    issues: { list: vi.fn().mockResolvedValue([]) },
    memos: { list: vi.fn().mockResolvedValue([]) },
    assets: { list: vi.fn().mockResolvedValue([]) },
    repos: { list: vi.fn().mockResolvedValue([]) },
    workspaces: { list: vi.fn().mockResolvedValue([]) },
    events: {
      onRunUpdate: () => () => {},
      onItemChanged: vi.fn((cb: (c: ItemChange) => void) => {
        listeners.push(cb)
        return () => { listeners = listeners.filter((l) => l !== cb) }
      })
    }
  } as unknown as OneDeskClient
  const wrapper = ({ children }: { children: ReactNode }) => <ClientProvider client={client}>{children}</ClientProvider>
  const emit = (c: ItemChange) => { for (const l of listeners) l(c) }
  return { client, wrapper, emit, count: () => listeners.length }
}

describe('useItemChanged (docs/sdlc/item-windows/ FR-18)', () => {
  it('같은 workspace·같은 종류일 때만 다시 읽는다', () => {
    const { wrapper, emit } = setup()
    const refresh = vi.fn()
    renderHook(() => useItemChanged('w1', 'issue', refresh), { wrapper })
    emit({ workspaceId: 'w2', kind: 'issue' })
    emit({ workspaceId: 'w1', kind: 'memo' })
    expect(refresh).not.toHaveBeenCalled()
    emit({ workspaceId: 'w1', kind: 'issue' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('workspace가 null이면 모든 workspace를 듣고, undefined면 듣지 않는다', () => {
    const { wrapper, emit, count } = setup()
    const all = vi.fn()
    renderHook(() => useItemChanged(null, 'workspace', all), { wrapper })
    emit({ workspaceId: 'any', kind: 'workspace' })
    expect(all).toHaveBeenCalledTimes(1)
    const before = count()
    renderHook(() => useItemChanged(undefined, 'issue', vi.fn()), { wrapper })
    expect(count()).toBe(before)
  })

  it('언마운트하면 구독을 푼다', () => {
    const { wrapper, count } = setup()
    const { unmount } = renderHook(() => useItemChanged('w', 'memo', vi.fn()), { wrapper })
    expect(count()).toBe(1)
    unmount()
    expect(count()).toBe(0)
  })

  it.each([
    ['useIssues', 'issue', (c: OneDeskClient) => c.issues.list, () => useIssues('w', null)],
    ['useMemos', 'memo', (c: OneDeskClient) => c.memos.list, () => useMemos('w', null)],
    ['useAssets', 'asset', (c: OneDeskClient) => c.assets.list, () => useAssets('w', '', null)],
    ['useRepos', 'repo', (c: OneDeskClient) => c.repos.list, () => useRepos('w')],
    ['useWorkspaces', 'workspace', (c: OneDeskClient) => c.workspaces.list, () => useWorkspaces()]
  ] as const)('%s는 %s 알림으로 목록을 다시 읽는다', async (_name, kind, listOf, hook) => {
    const { client, wrapper, emit } = setup()
    renderHook(hook as () => unknown, { wrapper })
    const list = listOf(client) as unknown as ReturnType<typeof vi.fn>
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    emit({ workspaceId: 'w', kind })
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })
})
