import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IssueProposalBanner } from './IssueProposalBanner'
import type { IssueBanner } from '../proposal'
import type { IssueProposal, Repo } from '@shared/models'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'web', path: '/tmp/web', description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0 }
]

function proposal(over: Partial<IssueProposal> = {}): IssueProposal {
  return {
    id: 'p1', workspaceId: 'w1', rootRunId: 'c1', runId: 'c1', status: 'pending', createdAt: 1, decidedAt: null,
    kind: 'conversation-issue', existingIssue: null,
    payload: {
      title: '모바일 로그인 버튼이 눌리지 않음', body: 'Safari에서 오버레이가 탭을 가로챈다.', repoIds: ['r1'],
      source: null, kind: 'bug', priority: 'week', existingIssueId: null
    },
    ...over
  }
}

const NEW: IssueBanner = { mode: 'new', proposal: proposal() }
const EXISTING_ISSUE = { id: 'i1', title: '로그인 버튼 반응 없음', status: 'open' as const }
const EXISTING: IssueBanner = { mode: 'existing', proposal: proposal({ existingIssue: EXISTING_ISSUE }), existing: EXISTING_ISSUE }

function renderBanner(banner: IssueBanner, over: { onAccept?: () => Promise<void>; onDecline?: () => Promise<void> } = {}) {
  const onAccept = vi.fn(over.onAccept ?? (async () => {}))
  const onDecline = vi.fn(over.onDecline ?? (async () => {}))
  render(<IssueProposalBanner banner={banner} repos={repos} onAccept={onAccept} onDecline={onDecline} />)
  return { onAccept, onDecline }
}

describe('IssueProposalBanner (agent-proposals spec FR-21~23)', () => {
  it('새 이슈 갈래 — 제목 칸·본문·repo와 축 알약·버튼 둘', () => {
    renderBanner(NEW)
    const banner = screen.getByRole('status', { name: '이 대화를 이슈로 만들까요?' })
    expect(banner).toHaveTextContent('이 대화를 이슈로 만들까요?')
    expect(screen.getByRole('textbox', { name: '제안된 이슈 제목' })).toHaveValue('모바일 로그인 버튼이 눌리지 않음')
    expect(banner).toHaveTextContent('Safari에서 오버레이가 탭을 가로챈다.')
    expect(banner).toHaveTextContent('web')
    expect(banner).toHaveTextContent('버그')
    expect(banner).toHaveTextContent('이번주')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['이슈로 만들기', '이슈로 만들지 않기'])
  })

  it('고친 제목으로 만든다', async () => {
    const { onAccept } = renderBanner(NEW)
    const input = screen.getByRole('textbox', { name: '제안된 이슈 제목' })
    await userEvent.clear(input)
    await userEvent.type(input, '고친 제목')
    await userEvent.click(screen.getByRole('button', { name: '이슈로 만들기' }))
    expect(onAccept).toHaveBeenCalledWith({ mode: 'new', title: '고친 제목' })
  })

  it('제목 칸에서 Enter로도 만든다', async () => {
    const { onAccept } = renderBanner(NEW)
    await userEvent.type(screen.getByRole('textbox', { name: '제안된 이슈 제목' }), '!{Enter}')
    expect(onAccept).toHaveBeenCalledWith({ mode: 'new', title: '모바일 로그인 버튼이 눌리지 않음!' })
  })

  it('빈 제목이면 이슈로 만들기가 잠긴다', async () => {
    const { onAccept } = renderBanner(NEW)
    await userEvent.clear(screen.getByRole('textbox', { name: '제안된 이슈 제목' }))
    expect(screen.getByRole('button', { name: '이슈로 만들기' })).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: '제안된 이슈 제목' }), '   {Enter}')
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('기존 이슈 갈래 — 붙이기가 먼저이고, 이슈로 만들기를 누르면 그때 제목 칸이 펼쳐진다', async () => {
    const { onAccept } = renderBanner(EXISTING)
    expect(screen.getByRole('status')).toHaveTextContent('기존 이슈 「로그인 버튼 반응 없음」에 붙일까요?')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['기존 이슈에 붙이기', '이슈로 만들기', '이슈로 만들지 않기'])
    await userEvent.click(screen.getByRole('button', { name: '기존 이슈에 붙이기' }))
    expect(onAccept).toHaveBeenCalledWith({ mode: 'existing' })
  })

  it('기존 이슈 갈래에서 새로 만들면 제목 칸을 거친다', async () => {
    const { onAccept } = renderBanner(EXISTING)
    await userEvent.click(screen.getByRole('button', { name: '이슈로 만들기' }))
    expect(onAccept).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '제안된 이슈 제목' })).toHaveValue('모바일 로그인 버튼이 눌리지 않음')
    await userEvent.click(screen.getByRole('button', { name: '이슈로 만들기' }))
    expect(onAccept).toHaveBeenCalledWith({ mode: 'new', title: '모바일 로그인 버튼이 눌리지 않음' })
  })

  it('누르는 동안 세 버튼이 잠긴다', async () => {
    let release = () => {}
    renderBanner(EXISTING, { onAccept: () => new Promise<void>((r) => { release = r }) })
    await userEvent.click(screen.getByRole('button', { name: '기존 이슈에 붙이기' }))
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
    release()
  })

  it('실패하면 배너 안에 이유가 남고 버튼이 다시 풀린다', async () => {
    renderBanner(NEW, { onDecline: async () => { throw new Error('이미 처리된 제안입니다') } })
    await userEvent.click(screen.getByRole('button', { name: '이슈로 만들지 않기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 처리된 제안입니다')
    expect(screen.getByRole('button', { name: '이슈로 만들지 않기' })).toBeEnabled()
  })
})
