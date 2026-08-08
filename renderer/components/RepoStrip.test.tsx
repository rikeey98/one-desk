import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RepoStrip } from './RepoStrip'
import type { OneDeskClient } from '@shared/client'
import type { Repo } from '@shared/models'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api-server', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 },
  { id: 'r2', workspaceId: 'w1', name: 'web-client', path: '/tmp/web', description: null, sortOrder: 0, createdAt: 0 }
]

const client = {
  repos: { list: vi.fn().mockResolvedValue(repos), create: vi.fn(), remove: vi.fn() }
} as unknown as OneDeskClient

describe('RepoStrip', () => {
  it('repo 카드를 모두 보여준다', async () => {
    render(
      <ClientProvider client={client}>
        <RepoStrip workspaceId="w1" selectedRepoId={null} onSelect={vi.fn()} />
      </ClientProvider>
    )
    expect(await screen.findByText('api-server')).toBeTruthy()
    expect(screen.getByText('web-client')).toBeTruthy()
  })

  it('선택된 repo를 다시 클릭하면 선택이 해제된다', async () => {
    const onSelect = vi.fn()
    render(
      <ClientProvider client={client}>
        <RepoStrip workspaceId="w1" selectedRepoId="r1" onSelect={onSelect} />
      </ClientProvider>
    )
    await userEvent.click(await screen.findByText('api-server'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })
})
