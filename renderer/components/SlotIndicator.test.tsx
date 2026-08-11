import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlotIndicator } from './SlotIndicator'

describe('SlotIndicator', () => {
  it('실행 중인 수와 상한을 보여준다', () => {
    render(<SlotIndicator snapshot={{ running: 2, limit: 3, waiting: 0 }} onChangeLimit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /실행 슬롯/ })).toHaveTextContent('2/3')
  })

  it('대기가 있을 때만 대기 수를 보여준다', () => {
    const { rerender } = render(
      <SlotIndicator snapshot={{ running: 3, limit: 3, waiting: 0 }} onChangeLimit={vi.fn()} />
    )
    expect(screen.queryByText(/대기/)).toBeNull()
    rerender(<SlotIndicator snapshot={{ running: 3, limit: 3, waiting: 2 }} onChangeLimit={vi.fn()} />)
    expect(screen.getByText(/대기 2/)).toBeInTheDocument()
  })

  it('상한을 넘긴 상태를 감추지 않는다', () => {
    // 상한을 낮추면 돌던 것은 그대로 두므로 running > limit이 될 수 있다.
    // 감추면 왜 새 run이 안 뜨는지 알 수 없다.
    render(<SlotIndicator snapshot={{ running: 4, limit: 3, waiting: 1 }} onChangeLimit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /실행 슬롯/ })).toHaveTextContent('4/3')
  })

  it('눌러서 상한을 바꾸면 새 값으로 알린다', async () => {
    const onChangeLimit = vi.fn()
    render(<SlotIndicator snapshot={{ running: 0, limit: 3, waiting: 0 }} onChangeLimit={onChangeLimit} />)
    await userEvent.click(screen.getByRole('button', { name: /실행 슬롯/ }))
    const input = screen.getByLabelText('동시 실행 상한')
    await userEvent.clear(input)
    await userEvent.type(input, '1{Enter}')
    expect(onChangeLimit).toHaveBeenCalledWith(1)
  })

  it('스냅샷이 아직 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<SlotIndicator snapshot={null} onChangeLimit={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
