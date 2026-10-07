import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ClientProvider } from '../client/ClientProvider'
import { ReportPanel, initialReportQuery, type ReportQuery } from './ReportPanel'
import type { OneDeskClient } from '@shared/client'
import type { BuildReportInput, Memo, ReportData, ReportWorkspace, Workspace } from '@shared/models'

const HOUR = 3_600_000

function workspace(id: string, name: string): Workspace {
  return { id, name } as Workspace
}

const WORKSPACES = [workspace('w1', 'one-desk'), workspace('w2', '회사')]

/** 기간 시작 기준의 예시 — 어떤 기간을 물어도 그 안에 든다 */
function fixture(input: BuildReportInput): ReportData {
  const t = (h: number) => input.since + h * HOUR
  const all: ReportWorkspace[] = [
    {
      id: 'w1', name: 'one-desk',
      issues: [{ id: 'i1', title: '대화에 이슈 할당', status: 'done', priority: null, createdAt: t(1), startedAt: t(2), closedAt: t(30), updatedAt: t(30) }],
      memos: [],
      conversations: [{
        id: 'c1', title: '저장소 작업', status: 'succeeded', needsAnswer: false, closed: false, issueId: 'i1', issueTitle: '대화에 이슈 할당',
        turns: [{ createdAt: t(3), startedAt: t(3), endedAt: t(3) + 600_000 }], lastAnswer: '끝냈습니다'
      }]
    },
    {
      id: 'w2', name: '회사',
      issues: [{ id: 'i2', title: '환불 웹훅', status: 'doing', priority: null, createdAt: t(5), startedAt: t(6), closedAt: null, updatedAt: t(6) }],
      memos: [],
      conversations: []
    }
  ]
  return { since: input.since, until: input.until, workspaces: all.filter((w) => input.workspaceIds.includes(w.id)) }
}

function makeClient(over: { build?: (input: BuildReportInput) => Promise<ReportData> } = {}) {
  const build = vi.fn(over.build ?? (async (input: BuildReportInput) => fixture(input)))
  const create = vi.fn(async (input: { workspaceId: string; title: string; body?: string }): Promise<Memo> => ({
    id: 'memo-1', workspaceId: input.workspaceId, title: input.title, body: input.body ?? '', repoIds: [], createdAt: 1, updatedAt: 1
  }))
  const client = {
    reports: { build },
    memos: { create },
    events: { onRunUpdate: vi.fn(() => () => {}), onItemChanged: vi.fn(() => () => {}) }
  } as unknown as OneDeskClient
  return { client, build, create }
}

function Harness(props: {
  client: OneDeskClient
  targetWorkspaceId?: string | null
  onOpenIssue?: (ws: string, id: string) => void
  onPolish?: (memo: Memo) => void
  onQuery?: (q: ReportQuery) => void
}) {
  const [query, setQuery] = useState(() => initialReportQuery(Date.now()))
  return (
    <ClientProvider client={props.client}>
      <ReportPanel
        workspaces={WORKSPACES}
        query={query}
        onQueryChange={(q) => { setQuery(q); props.onQuery?.(q) }}
        targetWorkspaceId={props.targetWorkspaceId ?? null}
        onOpenIssue={props.onOpenIssue ?? vi.fn()}
        onOpenConversation={vi.fn()}
        onOpenMemo={vi.fn()}
        onPolish={props.onPolish ?? vi.fn()}
      />
    </ClientProvider>
  )
}

beforeEach(() => { localStorage.clear() })

describe('ReportPanel (docs/sdlc/period-report/)', () => {
  it('workspace를 전부 한 번에 읽고 문서 보기로 그린다', async () => {
    const { client, build } = makeClient()
    render(<Harness client={client} />)
    const doc = await screen.findByRole('article', { name: '리포트 문서' })
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ workspaceIds: ['w1', 'w2'] }))
    expect(within(doc).getByRole('region', { name: 'one-desk 리포트' })).toHaveTextContent('대화에 이슈 할당')
    expect(within(doc).getByRole('region', { name: '회사 리포트' })).toHaveTextContent('환불 웹훅')
    // 이슈 밑의 대화와 마지막 답 한 줄
    expect(doc).toHaveTextContent('저장소 작업')
    expect(doc).toHaveTextContent('끝냈습니다')
  })

  it('workspace를 빼면 다시 읽지 않고 그 절만 사라진다', async () => {
    const { client, build } = makeClient()
    render(<Harness client={client} />)
    await screen.findByRole('region', { name: '회사 리포트' })
    const calls = build.mock.calls.length
    await userEvent.click(screen.getByRole('checkbox', { name: '회사 포함' }))
    expect(screen.queryByRole('region', { name: '회사 리포트' })).toBeNull()
    expect(screen.getByRole('region', { name: 'one-desk 리포트' })).toBeInTheDocument()
    expect(build.mock.calls.length).toBe(calls)
  })

  it('보기를 바꿔도 조건이 남고, 마지막 보기를 기억한다', async () => {
    const { client } = makeClient()
    const { unmount } = render(<Harness client={client} />)
    await screen.findByRole('article', { name: '리포트 문서' })
    await userEvent.click(screen.getByRole('button', { name: '지난 30일' }))
    await userEvent.click(screen.getByRole('tab', { name: '요일' }))
    expect(screen.getByRole('tab', { name: '요일' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '지난 30일' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByRole('table', { name: '요일 보드' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '이슈 흐름' }))
    expect(await screen.findByRole('region', { name: 'one-desk 흐름' })).toBeInTheDocument()
    unmount()

    render(<Harness client={client} />)
    expect(screen.getByRole('tab', { name: '이슈 흐름' })).toHaveAttribute('aria-selected', 'true')
  })

  it('요일 보기에서 사건을 누르면 곁 칸에 자세히, 이슈 열기는 그 workspace의 이슈로', async () => {
    const onOpenIssue = vi.fn()
    const { client } = makeClient()
    render(<Harness client={client} onOpenIssue={onOpenIssue} />)
    await userEvent.click(await screen.findByRole('tab', { name: '요일' }))
    await userEvent.click(await screen.findByRole('button', { name: '시작 · 환불 웹훅' }))
    const side = screen.getByRole('complementary', { name: '고른 사건' })
    expect(side).toHaveTextContent('회사')
    await userEvent.click(within(side).getByRole('button', { name: '이슈 열기' }))
    expect(onOpenIssue).toHaveBeenCalledWith('w2', 'i2')
  })

  it('마크다운 복사는 고른 workspace를 담은 글이다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { client } = makeClient()
    render(<Harness client={client} />)
    await screen.findByRole('article', { name: '리포트 문서' })
    await userEvent.click(screen.getByRole('button', { name: '마크다운 복사' }))
    const text = writeText.mock.calls[0]![0] as string
    expect(text).toMatch(/^# 리포트 /)
    expect(text).toContain('## one-desk')
    expect(text).toContain('## 회사')
    expect(await screen.findByRole('button', { name: '복사함' })).toBeInTheDocument()
  })

  it('메모로 저장은 고른 workspace에, 없으면 첫 workspace에 — 버튼 글자가 대상을 말한다', async () => {
    const { client, create } = makeClient()
    render(<Harness client={client} targetWorkspaceId="w2" />)
    await screen.findByRole('article', { name: '리포트 문서' })
    await userEvent.click(screen.getByRole('button', { name: '회사에 메모로 저장' }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w2', title: expect.stringMatching(/^리포트 /) }))
    expect(create.mock.calls[0]![0].body).toContain('## one-desk')
    expect(await screen.findByRole('button', { name: '메모 열기' })).toBeInTheDocument()
  })

  it('agent에게 다듬기는 메모를 저장한 뒤 그 메모로 onPolish를 부른다', async () => {
    const onPolish = vi.fn()
    const { client, create } = makeClient()
    render(<Harness client={client} onPolish={onPolish} />)
    await screen.findByRole('article', { name: '리포트 문서' })
    expect(screen.getByRole('button', { name: 'one-desk에 메모로 저장' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'agent에게 다듬기' }))
    await waitFor(() => expect(onPolish).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledOnce()
    expect(onPolish.mock.calls[0]![0]).toMatchObject({ id: 'memo-1', workspaceId: 'w1' })
  })

  it('비었으면 안내와 지난 30일, 내보내기는 잠긴다', async () => {
    const onQuery = vi.fn()
    const { client } = makeClient({ build: async (input) => ({ since: input.since, until: input.until, workspaces: [] }) })
    render(<Harness client={client} onQuery={onQuery} />)
    expect(await screen.findByText(/이 기간에 손댄 이슈와 대화가 없습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '마크다운 복사' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent에게 다듬기' })).toBeDisabled()
    const buttons = screen.getAllByRole('button', { name: '지난 30일' })
    await userEvent.click(buttons[buttons.length - 1]!)
    expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'last-30' }))
  })

  it('읽기 실패는 배너와 다시 시도', async () => {
    let fail = true
    const { client } = makeClient({
      build: async (input) => {
        if (fail) throw new Error('DB 잠김')
        return fixture(input)
      }
    })
    render(<Harness client={client} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('DB 잠김')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('article', { name: '리포트 문서' })).toBeInTheDocument()
  })
})
