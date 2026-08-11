import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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

  // 실제 브라우저는 Escape/Enter가 editing을 닫아 포커스된 input을 언마운트시키는
  // 바로 그 커밋 사이클 안에서, 아직 붙어 있는 그 input에 네이티브 blur를 곧바로
  // 발생시킨다(포커스된 요소가 DOM에서 제거되면 브라우저가 자동으로 blur를 낸다).
  // jsdom은 언마운트로 인한 blur를 전혀 흉내내지 않으므로 — keydown 이후 별도로
  // fireEvent.blur를 쏴도 그때는 이미 input이 실제로 제거된 뒤라 이벤트가 어디에도
  // 닿지 못해 버그가 있든 없든 테스트가 항상 통과해 버린다(실측 확인함).
  // 그래서 두 네이티브 이벤트를 하나의 act() 블록 안에서 연달아 디스패치해, React가
  // 아직 언마운트를 커밋하지 않은 "그 사이"에 blur가 도착하는 순서를 재현한다.
  // React는 onBlur를 raw 'blur'가 아니라 버블링되는 'focusout'에 위임해서 구현한다
  // (react-dom 소스로 실측 확인) — 그래서 'blur'가 아니라 'focusout'을 쏴야 잡힌다.
  function pressKeyThenBlur(input: HTMLElement, key: string) {
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }))
    })
  }

  it('Escape로 취소하면 상한을 바꾸지 않는다', async () => {
    const onChangeLimit = vi.fn()
    render(<SlotIndicator snapshot={{ running: 0, limit: 3, waiting: 0 }} onChangeLimit={onChangeLimit} />)
    await userEvent.click(screen.getByRole('button', { name: /실행 슬롯/ }))
    const input = screen.getByLabelText('동시 실행 상한')
    await userEvent.clear(input)
    await userEvent.type(input, '5')
    pressKeyThenBlur(input, 'Escape')
    expect(onChangeLimit).not.toHaveBeenCalled()
  })

  it('Enter로 커밋하면 정확히 한 번만 알린다', async () => {
    const onChangeLimit = vi.fn()
    render(<SlotIndicator snapshot={{ running: 0, limit: 3, waiting: 0 }} onChangeLimit={onChangeLimit} />)
    await userEvent.click(screen.getByRole('button', { name: /실행 슬롯/ }))
    const input = screen.getByLabelText('동시 실행 상한')
    await userEvent.clear(input)
    await userEvent.type(input, '5')
    pressKeyThenBlur(input, 'Enter')
    expect(onChangeLimit).toHaveBeenCalledTimes(1)
    expect(onChangeLimit).toHaveBeenCalledWith(5)
  })

  it('스냅샷이 아직 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<SlotIndicator snapshot={null} onChangeLimit={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
