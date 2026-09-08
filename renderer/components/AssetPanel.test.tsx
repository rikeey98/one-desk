import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { AssetPanel } from './AssetPanel'
import type { Asset } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: 'a1', workspaceId: 'w1', kind: 'skill', source: 'discovered',
    name: '알파', description: '스킬 설명', repoId: 'r1',
    filePath: '/tmp/api/.claude/skills/알파/SKILL.md', content: null,
    lastSeenAt: 1000, createdAt: 0, updatedAt: 0, ...over
  }
}

function makeClient(list: Asset[], over: Record<string, unknown> = {}): OneDeskClient {
  return {
    assets: {
      list: vi.fn().mockResolvedValue(list),
      createAuthored: vi.fn(),
      updateIfUnchanged: vi.fn(),
      remove: vi.fn(),
      rescan: vi.fn().mockResolvedValue(list),
      ...over
    }
  } as unknown as OneDeskClient
}

function renderPanel(client: OneDeskClient, props: Record<string, unknown> = {}) {
  render(
    <ClientProvider client={client}>
      <AssetPanel
        workspaceId="w1"
        chipKeys={new Set<string>()}
        onToggleContext={vi.fn()}
        {...props}
      />
    </ClientProvider>
  )
}

describe('AssetPanel', () => {
  it('kind로 나눠 보여준다', async () => {
    renderPanel(makeClient([
      asset({ id: 'a1', kind: 'skill', name: '알파' }),
      asset({ id: 'a2', kind: 'agent', name: '베타' })
    ]))
    expect(await screen.findByText('알파')).toBeInTheDocument()
    expect(screen.getByText('베타')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SKILLS' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AGENTS' })).toBeInTheDocument()
  })

  it('이번 스캔에서 안 보인 파일에 "없음" 배지를 붙인다', async () => {
    renderPanel(makeClient([
      asset({ id: 'a1', name: '있음', lastSeenAt: 2000 }),
      asset({ id: 'a2', name: '사라짐', lastSeenAt: 1000 })
    ]))
    await screen.findByText('사라짐')
    expect(screen.getByRole('listitem', { name: '사라짐' })).toHaveTextContent('없음')
    expect(screen.getByRole('listitem', { name: '있음' })).not.toHaveTextContent('없음')
  })

  it('authored에는 "없음"이 절대 붙지 않는다', async () => {
    // lastSeenAt이 null이다. 스캔과 무관하다.
    renderPanel(makeClient([
      asset({
        id: 'a1', name: '내가 쓴 것', source: 'authored',
        lastSeenAt: null, filePath: null, repoId: null
      }),
      asset({ id: 'a2', name: '발견된 것', lastSeenAt: 5000 })
    ]))
    await screen.findByText('내가 쓴 것')
    expect(screen.getByRole('listitem', { name: '내가 쓴 것' })).not.toHaveTextContent('없음')
  })

  it('새로고침을 누르면 다시 훑는다', async () => {
    const rescan = vi.fn().mockResolvedValue([asset({ name: '새로 발견' })])
    renderPanel(makeClient([], { rescan }))
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }))
    expect(rescan).toHaveBeenCalledWith('w1')
    expect(await screen.findByText('새로 발견')).toBeInTheDocument()
  })

  it('담기 토글을 누르면 맥락에 담긴다', async () => {
    const onToggleContext = vi.fn()
    renderPanel(makeClient([asset({ name: '알파' })]), { onToggleContext })
    await screen.findByText('알파')
    await userEvent.click(screen.getByRole('button', { name: '알파 맥락에 담기' }))
    expect(onToggleContext).toHaveBeenCalledWith({ type: 'asset', id: 'a1', label: '알파' })
  })

  it('workspace가 없으면 목록을 부르지 않는다', async () => {
    const client = makeClient([])
    renderPanel(client, { workspaceId: null })
    await waitFor(() => expect(client.assets.list).not.toHaveBeenCalled())
  })
})
