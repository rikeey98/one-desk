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
        repos={[]}
        repoId={null}
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

describe('AssetPanel — authored 만들기', () => {
  it('이름을 넣으면 skill로 만든다', async () => {
    const createAuthored = vi.fn().mockResolvedValue(asset({ source: 'authored' }))
    renderPanel(makeClient([], { createAuthored }))

    await userEvent.type(screen.getByPlaceholderText('새 asset 이름…'), '내 스킬{Enter}')

    expect(createAuthored).toHaveBeenCalledWith({
      workspaceId: 'w1', kind: 'skill', name: '내 스킬'
    })
  })

  it('종류를 agent로 바꾸면 agent로 만든다', async () => {
    const createAuthored = vi.fn().mockResolvedValue(asset({ source: 'authored' }))
    renderPanel(makeClient([], { createAuthored }))

    await userEvent.selectOptions(screen.getByLabelText('새 asset 종류'), 'agent')
    await userEvent.type(screen.getByPlaceholderText('새 asset 이름…'), '내 agent{Enter}')

    expect(createAuthored).toHaveBeenCalledWith({
      workspaceId: 'w1', kind: 'agent', name: '내 agent'
    })
  })

  it('이름을 누르면 상세가 열린다', async () => {
    const onOpen = vi.fn()
    renderPanel(makeClient([asset({ name: '알파' })]), { onOpen })
    await userEvent.click(await screen.findByRole('button', { name: '알파' }))
    expect(onOpen).toHaveBeenCalledWith('a1')
  })
})

describe('AssetPanel — 출처와 필터', () => {
  const repos = [
    { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
  ]

  it('출처를 세 가지로 구분해 보여준다', () => {
    // 이름에 라벨 단어를 넣지 않는다 — 넣으면 이름에 걸려 통과하는 자기충족 테스트가 된다.
    renderPanel(makeClient([
      asset({ id: 'a1', name: '하나', repoId: null, filePath: '/home/g/SKILL.md' }),
      asset({ id: 'a2', name: '둘', repoId: 'r1', filePath: '/tmp/api/a/SKILL.md' }),
      asset({
        id: 'a3', name: '셋', source: 'authored',
        repoId: null, filePath: null, lastSeenAt: null
      })
    ]), { repos })

    return waitFor(() => {
      expect(screen.getByRole('listitem', { name: '하나' })).toHaveTextContent('글로벌')
      expect(screen.getByRole('listitem', { name: '둘' })).toHaveTextContent('api')
      expect(screen.getByRole('listitem', { name: '셋' })).toHaveTextContent('앱에서 작성')
    })
  })

  it('repoId를 조회에 실어 보낸다', async () => {
    // 거르는 것은 저장소가 한다. 패널은 무엇을 물어볼지만 정한다.
    const client = makeClient([])
    renderPanel(client, { repoId: 'r1', repos })
    await waitFor(() => expect(client.assets.list)
      .toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1' }))
  })

  it('repo를 고르지 않으면 repoId 없이 묻는다', async () => {
    const client = makeClient([])
    renderPanel(client, { repoId: null })
    await waitFor(() => expect(client.assets.list)
      .toHaveBeenCalledWith({ workspaceId: 'w1', repoId: null }))
  })
})
