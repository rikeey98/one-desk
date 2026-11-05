import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextPick } from './ContextPick'
import type { ContextChip } from '../context'

const CHIP: ContextChip = { type: 'issue', id: 'i1', label: '토큰 만료' }

function picker(picked: boolean) {
  return { keys: new Set(picked ? ['issue:i1'] : []), onToggle: vi.fn() }
}

describe('ContextPick', () => {
  it('줄의 토글은 항목 이름을 대고, 풍선이 무엇을 하는지 말한다', async () => {
    const p = picker(false)
    render(<ContextPick chip={CHIP} picker={p} place="row" />)

    const pick = screen.getByRole('button', { name: '토큰 만료 맥락에 담기' })
    expect(pick).toHaveAttribute('aria-pressed', 'false')
    expect(pick).toHaveAttribute('title', '대화에 담기')

    await userEvent.click(pick)
    expect(p.onToggle).toHaveBeenCalledWith(CHIP)
  })

  it('줄의 버튼은 담기 전후를 글자로 말하고, 풍선은 빼는 동작을 말한다', () => {
    const { rerender } = render(<ContextPick chip={CHIP} picker={picker(false)} place="row" />)
    expect(screen.getByRole('button', { name: '토큰 만료 맥락에 담기' })).toHaveTextContent('담기')

    rerender(<ContextPick chip={CHIP} picker={picker(true)} place="row" />)
    const pick = screen.getByRole('button', { name: '토큰 만료 맥락에 담기' })
    expect(pick).toHaveTextContent('담김')
    expect(pick).toHaveAttribute('aria-pressed', 'true')
    expect(pick).toHaveAttribute('title', '대화에서 빼기')
  })

  it('헤더의 버튼은 어디에 담는지까지 글자로 말하고, 이름은 그대로다', () => {
    const { rerender } = render(<ContextPick chip={CHIP} picker={picker(false)} place="header" />)
    expect(screen.getByRole('button', { name: '대화에 담기' })).toHaveTextContent('대화에 담기')

    rerender(<ContextPick chip={CHIP} picker={picker(true)} place="header" />)
    const pick = screen.getByRole('button', { name: '대화에 담기', pressed: true })
    expect(pick).toHaveTextContent('대화에 담김')
    expect(pick).toHaveAttribute('title', '대화에서 빼기')
  })

  it('헤더의 이름은 줄의 이름과 겹치지 않는다 — 상세가 열려도 목록은 DOM에 남는다', () => {
    render(<ContextPick chip={CHIP} picker={picker(false)} place="header" />)
    expect(screen.queryByRole('button', { name: /맥락에 담기/ })).toBeNull()
  })

  it('repo 줄은 자리가 없어 글자 없이 아이콘뿐이다', () => {
    render(<ContextPick chip={{ type: 'repo', id: 'r1', label: 'api' }} picker={picker(false)} place="repo" />)
    expect(screen.getByRole('button', { name: 'api 맥락에 담기' })).toHaveTextContent('')
  })
})
