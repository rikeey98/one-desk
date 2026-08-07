import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { Sidebar } from './Sidebar'
import type { OneDeskClient } from '@shared/client'
import type { Workspace } from '@shared/models'

function makeWorkspace(name: string, id: string): Workspace {
  return {
    id, name, description: null,
    defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null,
    defaultPermission: 'edit',
    claudePath: null, opencodePath: null,
    createdAt: 0, updatedAt: 0
  }
}

function makeClient(workspaces: Workspace[]): OneDeskClient {
  return {
    workspaces: { list: vi.fn().mockResolvedValue(workspaces), create: vi.fn(), remove: vi.fn() },
    repos: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    issues: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    memos: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }
  } as unknown as OneDeskClient
}

describe('Sidebar', () => {
  it('workspace 목록을 보여준다', async () => {
    const client = makeClient([makeWorkspace('사내 플랫폼', 'w1'), makeWorkspace('one-desk', 'w2')])
    render(
      <ClientProvider client={client}>
        <Sidebar selectedId={null} onSelect={vi.fn()} />
      </ClientProvider>
    )
    expect(await screen.findByText('사내 플랫폼')).toBeTruthy()
    expect(screen.getByText('one-desk')).toBeTruthy()
  })

  it('workspace를 클릭하면 onSelect가 그 id로 불린다', async () => {
    const onSelect = vi.fn()
    const client = makeClient([makeWorkspace('사내 플랫폼', 'w1')])
    render(
      <ClientProvider client={client}>
        <Sidebar selectedId={null} onSelect={onSelect} />
      </ClientProvider>
    )
    await userEvent.click(await screen.findByText('사내 플랫폼'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('w1'))
  })
})
