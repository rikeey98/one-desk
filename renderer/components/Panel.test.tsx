import { describe, it, expect, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Panel } from './Panel'

describe('Panel 레일', () => {
  it('레일이면 이름과 개수만 남은 버튼 하나이고, 누르면 세 패널로 돌아가는 콜백을 부른다', async () => {
    const onRestore = vi.fn()
    render(
      <Panel title="메모" count={4} mode={{ kind: 'rail', onRestore }} action={<button type="button">새 창</button>}>
        <input aria-label="새 메모" defaultValue="쓰던 글" />
      </Panel>
    )

    const rail = screen.getByRole('button', { name: '메모 보기' })
    expect(rail).toHaveTextContent('메모4')
    expect(rail).toHaveAttribute('aria-description', '4개')
    expect(screen.queryByRole('button', { name: '새 창' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '새 메모' })).not.toBeInTheDocument()

    await userEvent.click(rail)
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('레일로 접혀도 본문은 언마운트하지 않는다 — 펼치면 쓰던 글이 남아 있다', () => {
    const { rerender } = render(
      <Panel title="메모" count={4} mode={{ kind: 'normal' }}>
        <input aria-label="새 메모" defaultValue="" />
      </Panel>
    )
    screen.getByRole('textbox', { name: '새 메모' }).setAttribute('data-typed', 'yes')
    ;(screen.getByRole('textbox', { name: '새 메모' }) as HTMLInputElement).value = '쓰던 글'

    rerender(
      <Panel title="메모" count={4} mode={{ kind: 'rail', onRestore: () => {} }}>
        <input aria-label="새 메모" defaultValue="" />
      </Panel>
    )
    rerender(
      <Panel title="메모" count={4} mode={{ kind: 'normal' }}>
        <input aria-label="새 메모" defaultValue="" />
      </Panel>
    )

    const input = screen.getByRole('textbox', { name: '새 메모' }) as HTMLInputElement
    expect(input).toHaveAttribute('data-typed', 'yes')
    expect(input.value).toBe('쓰던 글')
  })

  it.each([
    ['Enter로 누르면', '{Enter}'],
    ['Esc로 열린 항목을 닫으면', '{Escape}']
  ])('레일에 포커스가 있을 때 %s 포커스가 body로 떨어지지 않고 돌아온 패널로 간다', async (_, key) => {
    function Harness() {
      const [rail, setRail] = useState(true)
      useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setRail(false) }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [])
      return (
        <Panel title="메모" count={4} mode={rail ? { kind: 'rail', onRestore: () => setRail(false) } : { kind: 'normal' }}>
          <p>목록</p>
        </Panel>
      )
    }
    render(<Harness />)

    screen.getByRole('button', { name: '메모 보기' }).focus()
    await userEvent.keyboard(key)

    expect(screen.queryByRole('button', { name: '메모 보기' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('region', { name: '메모' }))
  })

  it('펼친 패널과 보통 패널에는 레일 버튼이 없고 헤더가 선다', () => {
    const { rerender } = render(
      <Panel title="이슈" count={8} mode={{ kind: 'expanded' }}><p>상세</p></Panel>
    )
    expect(screen.getByRole('region', { name: '이슈' })).toHaveClass('panel-expanded')
    expect(screen.queryByRole('button', { name: '이슈 보기' })).not.toBeInTheDocument()

    rerender(<Panel title="이슈" count={8} mode={{ kind: 'normal' }}><p>목록</p></Panel>)
    expect(screen.getByRole('region', { name: '이슈' })).not.toHaveClass('panel-expanded')
    expect(screen.queryByRole('button', { name: '이슈 보기' })).not.toBeInTheDocument()
    expect(screen.getByText('목록')).toBeVisible()
  })
})
