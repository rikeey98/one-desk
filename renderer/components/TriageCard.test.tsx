import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TriageCard } from './TriageCard'
import type { Issue } from '@shared/models'

const NOW = Date.now()

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'ws', title: '회원 탈퇴 플로우 문의', body: '', status: 'open',
    repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: null, seenAt: null,
    ...over
  }
}

describe('TriageCard', () => {
  it('이슈 제목과 위치를 보여준다', () => {
    render(
      <TriageCard issue={makeIssue()} position={1} total={6}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    expect(screen.getByText('회원 탈퇴 플로우 문의')).toBeInTheDocument()
    expect(screen.getByText(/6건 중 1번째/)).toBeInTheDocument()
  })

  it('축이 덜 찍히면 다음 버튼이 막혀 있다', async () => {
    render(
      <TriageCard issue={makeIssue()} position={1} total={1}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    const next = screen.getByRole('button', { name: '다음' })
    expect(next).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '기능' }))
    // 두 축만 찍었다. 아직 막혀 있어야 한다 — 부분 저장은 triagedAt을 찍지 못해
    // 그 이슈가 대기열에 남고, 사용자는 왜 다시 나오는지 알 수 없다.
    expect(next).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '이번주' }))
    expect(next).toBeEnabled()
  })

  it('다음을 누르면 고른 축을 넘긴다', async () => {
    const onDone = vi.fn()
    render(
      <TriageCard issue={makeIssue()} position={1} total={1}
        onDone={onDone} onSkip={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '고객' }))
    await userEvent.click(screen.getByRole('button', { name: '버그' }))
    await userEvent.click(screen.getByRole('button', { name: '긴급' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    expect(onDone).toHaveBeenCalledWith({ source: 'customer', kind: 'bug', priority: 'urgent' })
  })

  it('건너뛰기는 아무것도 저장하지 않는다', async () => {
    const onDone = vi.fn()
    const onSkip = vi.fn()
    render(
      <TriageCard issue={makeIssue()} position={1} total={2}
        onDone={onDone} onSkip={onSkip} />
    )
    await userEvent.click(screen.getByRole('button', { name: '고객' }))
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))

    expect(onSkip).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('이미 찍힌 축을 미리 골라둔다', () => {
    render(
      <TriageCard issue={makeIssue({ source: 'dev' })} position={1} total={1}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: '개발중' }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})
