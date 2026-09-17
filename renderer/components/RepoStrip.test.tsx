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

describe('RepoStrip 세로 목록', () => {
  function renderStrip() {
    return render(
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
  }

  it('repo 슬롯은 전부 목록 안에 들어간다', () => {
    const { container } = renderStrip()
    const list = container.querySelector('.repo-list')!
    expect(list).toBeTruthy()
    expect(list.querySelectorAll('.repo-slot')).toHaveLength(repos.length)
  })

  it('추가 폼은 목록 밖에 있다 — 목록만 스크롤하고 추가 줄은 늘 보여야 한다', () => {
    // 폼이 목록 안으로 들어가면 repo가 늘어났을 때 스크롤을 끝까지 내려야만 새 repo를
    // 등록할 수 있다. 추가는 목록 길이와 무관하게 닿을 수 있어야 한다.
    const { container } = renderStrip()
    const form = container.querySelector('form.add-repo-form')!
    expect(form).toBeTruthy()
    expect(container.querySelector('.repo-list')!.contains(form)).toBe(false)
    expect(container.querySelector('.repo-strip')!.contains(form)).toBe(true)
  })

  it('경로 전체는 title로 닿는다 — 좁은 줄에서는 말줄임으로 잘린다', () => {
    renderStrip()
    expect(screen.getByTitle('/tmp/api')).toHaveTextContent('/tmp/api')
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

describe('RepoStrip VS Code로 열기', () => {
  function renderStrip(c: OneDeskClient) {
    return render(
      <ClientProvider client={c}>
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
  }

  it('버튼을 누르면 그 repo의 id로 연다', async () => {
    const openInEditor = vi.fn().mockResolvedValue(undefined)
    renderStrip({ repos: { ...client.repos, openInEditor } } as unknown as OneDeskClient)

    await userEvent.click(await screen.findByLabelText('web-client VS Code로 열기'))

    await waitFor(() => expect(openInEditor).toHaveBeenCalledWith('r2'))
  })

  it('열기에 실패하면 이유를 보여준다', async () => {
    // 조용히 아무 일도 안 일어나면 VS Code가 없는 것인지 버튼이 죽은 것인지 모른다.
    const openInEditor = vi.fn().mockRejectedValue(new Error('VS Code가 설치돼 있지 않습니다'))
    renderStrip({ repos: { ...client.repos, openInEditor } } as unknown as OneDeskClient)

    await userEvent.click(await screen.findByLabelText('api-server VS Code로 열기'))

    expect(await screen.findByRole('alert')).toHaveTextContent('VS Code가 설치돼 있지 않습니다')
  })
})
