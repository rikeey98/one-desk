import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { PanelWindow } from './PanelWindow'
import type { OneDeskClient } from '@shared/client'
import type { Issue, ItemChange, Memo, Repo, Workspace } from '@shared/models'
import type { PanelScope } from '@shared/panelWindow'

const WS: Workspace = { id: 'w1', name: 'ws' } as Workspace
const API: Repo = { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api' } as Repo

function issue(over: Partial<Issue>): Issue {
  return {
    id: 'i1', workspaceId: 'w1', title: '로그인 오류', body: '', status: 'open',
    source: null, kind: null, priority: null, repoIds: ['r1'],
    createdAt: 1, updatedAt: 1, closedAt: null, startedAt: null, triagedAt: 1, seenAt: 1,
    ...over
  } as Issue
}

function makeClient(opts: { repos?: Repo[]; workspaces?: Workspace[]; issues?: Issue[]; memos?: Memo[] } = {}) {
  let listeners: Array<(c: ItemChange) => void> = []
  const repos = { list: vi.fn().mockResolvedValue(opts.repos ?? [API]) }
  const client = {
    workspaces: { list: vi.fn().mockResolvedValue(opts.workspaces ?? [WS]) },
    repos,
    issues: {
      list: vi.fn().mockResolvedValue(opts.issues ?? [issue({})]),
      markSeen: vi.fn().mockResolvedValue(undefined),
      updateIfUnchanged: vi.fn()
    },
    memos: { list: vi.fn().mockResolvedValue(opts.memos ?? []) },
    assets: { list: vi.fn().mockResolvedValue([]), readBody: vi.fn() },
    app: { openPanelWindow: vi.fn().mockResolvedValue(undefined) },
    events: {
      onRunUpdate: () => () => {},
      onItemChanged: (cb: (c: ItemChange) => void) => {
        listeners.push(cb)
        return () => { listeners = listeners.filter((l) => l !== cb) }
      }
    }
  } as unknown as OneDeskClient
  const emit = (c: ItemChange) => { for (const l of listeners) l(c) }
  return { client, emit, repos }
}

function renderWindow(client: OneDeskClient, scope: PanelScope | null) {
  return render(
    <ClientProvider client={client}>
      <PanelWindow scope={scope} />
    </ClientProvider>
  )
}

beforeEach(() => { document.title = '' })

describe('PanelWindow (docs/sdlc/item-windows/)', () => {
  it('읽을 수 없는 해시면 "열 수 없는 창입니다"', () => {
    const { client } = makeClient()
    renderWindow(client, null)
    expect(screen.getByRole('alert')).toHaveTextContent('열 수 없는 창입니다')
  })

  it('고정된 repo 범위로 이슈 패널을 그리고, 담기 토글과 "새 창으로 열기"가 없다 (FR-6·8)', async () => {
    const { client } = makeClient()
    renderWindow(client, { kind: 'issue', workspaceId: 'w1', repoId: 'r1' })
    expect(await screen.findByRole('button', { name: '로그인 오류' })).toBeInTheDocument()
    expect(client.issues.list).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1' })
    expect(screen.queryByRole('button', { name: /맥락에 담기/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /새 창으로 열기/ })).toBeNull()
  })

  it('제목은 "<종류> · <repo>"이고 창 제목도 같다 — 전체면 "<workspace> 전체" (FR-4)', async () => {
    const { client } = makeClient()
    renderWindow(client, { kind: 'issue', workspaceId: 'w1', repoId: 'r1' })
    expect(await screen.findByRole('heading', { name: '이슈 · api' })).toBeInTheDocument()
    expect(document.title).toBe('이슈 · api')
  })

  it('workspace 전체 범위의 메모 창', async () => {
    const { client } = makeClient()
    renderWindow(client, { kind: 'memo', workspaceId: 'w1', repoId: null })
    expect(await screen.findByRole('heading', { name: '메모 · ws 전체' })).toBeInTheDocument()
    expect(client.memos.list).toHaveBeenCalledWith({ workspaceId: 'w1' })
  })

  it('skill 창은 asset 패널을 그 repo로 거른다', async () => {
    const { client } = makeClient()
    renderWindow(client, { kind: 'asset', workspaceId: 'w1', repoId: 'r1' })
    expect(await screen.findByRole('heading', { name: 'skill · api' })).toBeInTheDocument()
    await waitFor(() => expect(client.assets.list).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1' }))
  })

  it('항목을 열면 상세가 서고 목록도 남는다 — 같은 항목을 다시 누르면 닫는다 (FR-7)', async () => {
    const { client } = makeClient()
    renderWindow(client, { kind: 'issue', workspaceId: 'w1', repoId: 'r1' })
    expect(await screen.findByText('왼쪽에서 이슈를 고르세요')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: '로그인 오류' }))
    expect(await screen.findByRole('button', { name: '이슈 id 복사' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그인 오류' })).toBeInTheDocument()
    expect(screen.queryByText('왼쪽에서 이슈를 고르세요')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '로그인 오류' }))
    expect(screen.queryByRole('button', { name: '이슈 id 복사' })).toBeNull()
    expect(screen.getByText('왼쪽에서 이슈를 고르세요')).toBeInTheDocument()
  })

  it('repo가 지워졌으면 그렇게 말한다 — 읽기 전에는 말하지 않는다 (FR-10)', async () => {
    const { client } = makeClient({ repos: [] })
    renderWindow(client, { kind: 'issue', workspaceId: 'w1', repoId: 'r1' })
    expect(await screen.findByRole('alert')).toHaveTextContent('이 repo는 삭제됐습니다')
  })

  it('workspace가 지워졌으면 그렇게 말한다', async () => {
    const { client } = makeClient({ workspaces: [] })
    renderWindow(client, { kind: 'memo', workspaceId: 'w1', repoId: null })
    expect(await screen.findByRole('alert')).toHaveTextContent('이 workspace는 삭제됐습니다')
  })

  it('다른 창에서 repo 이름을 바꾸면 제목이 따라간다 (FR-4·18)', async () => {
    const { client, emit, repos } = makeClient()
    renderWindow(client, { kind: 'issue', workspaceId: 'w1', repoId: 'r1' })
    await screen.findByRole('heading', { name: '이슈 · api' })
    repos.list.mockResolvedValue([{ ...API, name: 'api-v2' }])
    act(() => { emit({ workspaceId: 'w1', kind: 'repo' }) })
    expect(await screen.findByRole('heading', { name: '이슈 · api-v2' })).toBeInTheDocument()
  })
})
