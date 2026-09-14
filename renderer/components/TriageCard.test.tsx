import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TriageCard } from './TriageCard'
import type { Issue, Repo } from '@shared/models'

const NOW = Date.now()

function makeRepo(id: string, name: string): Repo {
  return {
    id, workspaceId: 'ws', name, path: `/tmp/${id}`,
    description: null, sortOrder: 0, createdAt: 0
  }
}

const REPOS = [makeRepo('r1', 'api'), makeRepo('r2', 'web')]

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
      <TriageCard repos={[]} issue={makeIssue()} position={1} total={6}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    expect(screen.getByText('회원 탈퇴 플로우 문의')).toBeInTheDocument()
    expect(screen.getByText(/6건 중 1번째/)).toBeInTheDocument()
  })

  it('축이 덜 찍히면 다음 버튼이 막혀 있다', async () => {
    render(
      <TriageCard repos={[]} issue={makeIssue()} position={1} total={1}
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
      <TriageCard repos={[]} issue={makeIssue()} position={1} total={1}
        onDone={onDone} onSkip={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '고객' }))
    await userEvent.click(screen.getByRole('button', { name: '버그' }))
    await userEvent.click(screen.getByRole('button', { name: '긴급' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    // repo를 안 찍었으므로 빈 배열이 함께 나간다 — "공통"을 뜻한다.
    expect(onDone).toHaveBeenCalledWith({
      source: 'customer', kind: 'bug', priority: 'urgent', repoIds: []
    })
  })

  it('건너뛰기는 아무것도 저장하지 않는다', async () => {
    const onDone = vi.fn()
    const onSkip = vi.fn()
    render(
      <TriageCard repos={[]} issue={makeIssue()} position={1} total={2}
        onDone={onDone} onSkip={onSkip} />
    )
    await userEvent.click(screen.getByRole('button', { name: '고객' }))
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))

    expect(onSkip).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('이미 찍힌 축을 미리 골라둔다', () => {
    render(
      <TriageCard repos={[]} issue={makeIssue({ source: 'dev' })} position={1} total={1}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: '개발중' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('붙일 repo를 칩으로 보여주고, 이미 붙은 것은 켜진 채로 시작한다', () => {
    render(
      <TriageCard repos={REPOS} issue={makeIssue({ repoIds: ['r2'] })} position={1} total={1}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'api' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'web' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('repo를 하나도 안 찍어도 다음으로 넘어갈 수 있다', async () => {
    // 설계 §4: repo 태그는 **선택이다**. 요구하면 workspace 공통 이슈를 훑을 수 없다 —
    // 태그가 하나도 없는 것이 곧 "공통"이라는 것이 전체 설계 §150의 규칙이다.
    const onDone = vi.fn()
    render(
      <TriageCard repos={REPOS} issue={makeIssue()} position={1} total={1}
        onDone={onDone} onSkip={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '기능' }))
    await userEvent.click(screen.getByRole('button', { name: '이번주' }))

    const next = screen.getByRole('button', { name: '다음' })
    expect(next).toBeEnabled()
    await userEvent.click(next)
    expect(onDone).toHaveBeenCalledWith({
      source: 'meeting', kind: 'feature', priority: 'week', repoIds: []
    })
  })

  it('찍은 repo가 저장할 값에 실려 나간다', async () => {
    const onDone = vi.fn()
    render(
      <TriageCard repos={REPOS} issue={makeIssue()} position={1} total={1}
        onDone={onDone} onSkip={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '기능' }))
    await userEvent.click(screen.getByRole('button', { name: '이번주' }))
    await userEvent.click(screen.getByRole('button', { name: 'api' }))
    await userEvent.click(screen.getByRole('button', { name: 'web' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    expect(onDone).toHaveBeenCalledWith({
      source: 'meeting', kind: 'feature', priority: 'week', repoIds: ['r1', 'r2']
    })
  })

  it('이미 붙어 있던 repo를 떼면 뺀 채로 저장한다', async () => {
    // 비우는 것도 정상적인 결과다 — 여러 repo에 걸쳤다가 하나로 좁히는 일이 잦다.
    const onDone = vi.fn()
    render(
      <TriageCard repos={REPOS} issue={makeIssue({ repoIds: ['r1', 'r2'] })} position={1} total={1}
        onDone={onDone} onSkip={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '회의' }))
    await userEvent.click(screen.getByRole('button', { name: '기능' }))
    await userEvent.click(screen.getByRole('button', { name: '이번주' }))
    await userEvent.click(screen.getByRole('button', { name: 'web' }))
    await userEvent.click(screen.getByRole('button', { name: '다음' }))

    expect(onDone).toHaveBeenCalledWith({
      source: 'meeting', kind: 'feature', priority: 'week', repoIds: ['r1']
    })
  })
})
