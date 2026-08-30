import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { IssuePanel } from './IssuePanel'
import type { Issue, Repo } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

const NOW = Date.now()

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'ws', title: '제목', body: '', status: 'open',
    repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: NOW, seenAt: NOW,
    ...over
  }
}

interface PanelMocks {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  markSeen: ReturnType<typeof vi.fn>
}

function renderPanel(issues: Issue[], over: {
  openId?: string | null
  expanded?: boolean
  onOpen?: (id: string) => void
  repos?: Repo[]
} = {}): PanelMocks {
  const mocks: PanelMocks = {
    list: vi.fn(async () => issues),
    create: vi.fn(),
    update: vi.fn(async (i: { id: string }) => makeIssue({ id: i.id })),
    markSeen: vi.fn(async () => {})
  }
  const client = {
    issues: {
      ...mocks,
      updateIfUnchanged: vi.fn(),
      remove: vi.fn()
    },
    // useIssues가 run 완료를 구독한다. 해제 함수를 돌려주지 않으면 언마운트가 터진다.
    events: { onRunUpdate: () => () => {} }
  } as unknown as OneDeskClient

  render(
    <ClientProvider client={client}>
      <IssuePanel
        workspaceId="ws"
        repoId={null}
        repos={over.repos ?? []}
        chipKeys={new Set()}
        onToggleContext={() => {}}
        expanded={over.expanded ?? false}
        openId={over.openId ?? null}
        onOpen={over.onOpen ?? (() => {})}
      />
    </ClientProvider>
  )
  return mocks
}

describe('IssuePanel 그룹', () => {
  it('그룹 헤더에 개수를 보여준다', async () => {
    renderPanel([
      makeIssue({ id: 'a', title: 'A', priority: 'urgent' }),
      makeIssue({ id: 'b', title: 'B', priority: 'urgent' })
    ])
    expect(await screen.findByRole('button', { name: /긴급 \(2\)/ })).toBeInTheDocument()
  })

  it('접어도 개수는 계속 보인다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'someday' })])
    const header = await screen.findByRole('button', { name: /언젠가 \(1\)/ })
    await userEvent.click(header)
    expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument()
    // 접힌 뒤에도 개수는 남아야 한다. 이것이 A안을 고른 이유 자체다.
    expect(screen.getByRole('button', { name: /언젠가 \(1\)/ })).toBeInTheDocument()
  })

  it('완료 그룹은 처음부터 접혀 있다', async () => {
    renderPanel([makeIssue({ id: 'z', title: 'Z', status: 'done' })])
    expect(await screen.findByRole('button', { name: /완료 \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Z' })).not.toBeInTheDocument()
  })

  it('축을 바꾸면 다시 묶는다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'urgent', source: 'customer' })])
    await screen.findByRole('button', { name: /긴급 \(1\)/ })
    await userEvent.selectOptions(screen.getByLabelText('묶기'), 'source')
    expect(await screen.findByRole('button', { name: /고객 \(1\)/ })).toBeInTheDocument()
  })

  it('정리 안 된 이슈가 있으면 배너가 뜬다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: null })])
    expect(await screen.findByText(/정리 안 됨 \(1\)/)).toBeInTheDocument()
  })

  it('정리 안 된 이슈가 없으면 배너가 없다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: NOW })])
    await screen.findByRole('button', { name: 'A' })
    expect(screen.queryByText(/정리 안 됨/)).not.toBeInTheDocument()
  })

  it('오래 안 본 이슈에 방치 배지가 붙는다', async () => {
    const old = NOW - 20 * 24 * 60 * 60 * 1000
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'urgent', seenAt: old })])
    expect(await screen.findByLabelText('오래 방치됨')).toBeInTheDocument()
  })

  it('행에 성격·출처 축 칩을 보여준다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', kind: 'bug', source: 'customer' })])
    await screen.findByRole('button', { name: 'A' })
    // 칩 클래스까지 확인한다 — 전역 .chip과 충돌해 클릭 가능한 파란 배경을
    // 물려받는 사고를 이 테스트가 함께 막는다.
    expect(screen.getByText('버그')).toHaveClass('axis-chip')
    expect(screen.getByText('고객')).toHaveClass('axis-chip')
  })
})
