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
        <RepoStrip
          workspaceId="w1"
          repos={repos}
          error={null}
          refresh={vi.fn()}
          selectedRepoId={null}
          onSelect={vi.fn()}
          chipKeys={new Set()}
          onToggleContext={vi.fn()}
          onDeleted={vi.fn()}
        />
      </ClientProvider>
    )
    expect(await screen.findByText('api-server')).toBeTruthy()
    expect(screen.getByText('web-client')).toBeTruthy()
  })

  it('선택된 repo를 다시 클릭하면 선택이 해제된다', async () => {
    const onSelect = vi.fn()
    render(
      <ClientProvider client={client}>
        <RepoStrip
          workspaceId="w1"
          repos={repos}
          error={null}
          refresh={vi.fn()}
          selectedRepoId="r1"
          onSelect={onSelect}
          chipKeys={new Set()}
          onToggleContext={vi.fn()}
          onDeleted={vi.fn()}
        />
      </ClientProvider>
    )
    await userEvent.click(await screen.findByText('api-server'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })
})

describe('RepoStrip 맥락 담기 토글', () => {
  // 이슈·메모 목록과 같은 약속이다 — 셋이 같은 모양이어야 같은 동작으로 읽힌다.
  function renderStrip(chipKeys = new Set<string>()) {
    render(
      <ClientProvider client={client}>
        <RepoStrip
          workspaceId="w1"
          repos={repos}
          error={null}
          refresh={vi.fn()}
          selectedRepoId={null}
          onSelect={vi.fn()}
          chipKeys={chipKeys}
          onToggleContext={vi.fn()}
          onDeleted={vi.fn()}
        />
      </ClientProvider>
    )
  }

  it('토글이 카드보다 앞에 온다', () => {
    renderStrip()
    const pick = screen.getByRole('button', { name: 'api-server 맥락에 담기' })
    expect(pick.parentElement!.firstElementChild).toBe(pick)
  })

  it('담긴 repo만 체크 표시를 갖는다', () => {
    renderStrip(new Set(['repo:r1']))
    expect(screen.getByRole('button', { name: 'api-server 맥락에 담기' })).toHaveTextContent('✓')
    expect(screen.getByRole('button', { name: 'web-client 맥락에 담기' })).not.toHaveTextContent('✓')
  })

  it('담긴 상태를 aria-pressed로도 알린다 — 이슈·메모 짝과 대칭이다', () => {
    renderStrip(new Set(['repo:r1']))
    expect(screen.getByRole('button', { name: 'api-server 맥락에 담기' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'web-client 맥락에 담기' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('RepoStrip repo 관리', () => {
  function renderWith(over: { rename?: unknown; remove?: unknown; refresh?: () => Promise<void>; onDeleted?: (id: string) => void } = {}) {
    const c = {
      repos: {
        list: vi.fn().mockResolvedValue(repos),
        create: vi.fn(),
        rename: over.rename ?? vi.fn().mockResolvedValue(undefined),
        remove: over.remove ?? vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as OneDeskClient
    render(
      <ClientProvider client={c}>
        <RepoStrip
          workspaceId="w1"
          repos={repos}
          error={null}
          refresh={over.refresh ?? vi.fn().mockResolvedValue(undefined)}
          selectedRepoId={null}
          onSelect={vi.fn()}
          chipKeys={new Set()}
          onToggleContext={vi.fn()}
          onDeleted={over.onDeleted ?? vi.fn()}
        />
      </ClientProvider>
    )
    return c
  }

  it('이름 바꾸기를 누르면 그 자리가 입력창이 된다', async () => {
    renderWith()
    await userEvent.click(screen.getByRole('button', { name: 'api-server 이름 바꾸기' }))
    expect(screen.getByRole('textbox', { name: 'api-server 새 이름' })).toBeInTheDocument()
  })

  it('저장하면 rename을 부르고 목록을 다시 읽는다', async () => {
    const rename = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderWith({ rename, refresh })

    await userEvent.click(screen.getByRole('button', { name: 'api-server 이름 바꾸기' }))
    const input = screen.getByRole('textbox', { name: 'api-server 새 이름' })
    await userEvent.clear(input)
    await userEvent.type(input, 'api-v2{Enter}')

    await waitFor(() => expect(rename).toHaveBeenCalledWith('r1', 'api-v2'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('삭제는 두 번 눌러야 한다 — repo 삭제는 이슈·메모의 태그만 떼고 본문은 남긴다', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    renderWith({ remove, onDeleted })

    await userEvent.click(screen.getByRole('button', { name: 'api-server 삭제' }))
    expect(remove).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /정말/ }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('r1'))
  })
})
