import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListToggleButton, WindowSplit, WindowSplitProvider } from './WindowSplit'
import { DEFAULT_LIST_PX, readListHidden, readListWidth } from '../listWidth'

function renderSplit() {
  return render(
    <WindowSplitProvider kind="issue">
      <ListToggleButton />
      <WindowSplit list={<input aria-label="새 이슈 제목" />} detail={<p>상세</p>} />
    </WindowSplitProvider>
  )
}

const listBox = (c: HTMLElement) => c.querySelector<HTMLElement>('.panel-split-list')!
const separator = () => screen.getByRole('separator', { name: '목록 폭 조절' })

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
})

// fireEvent.pointer*는 이 jsdom에서 clientX를 싣지 않는다 — Dock.test와 같이 MouseEvent로 보낸다.
describe('WindowSplit (docs/sdlc/item-windows/ FR-26~28)', () => {
  it('목록 숨기기는 목록을 언마운트하지 않고 숨긴다 — 치던 글자가 남고, 다시 보이면 그대로다', async () => {
    const { container } = renderSplit()
    await userEvent.type(screen.getByRole('textbox', { name: '새 이슈 제목' }), '쓰던 것')
    await userEvent.click(screen.getByRole('button', { name: '목록 숨기기' }))
    expect(listBox(container)).toHaveAttribute('hidden')
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByText('상세')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '목록 보이기' }))
    expect(listBox(container)).not.toHaveAttribute('hidden')
    expect(screen.getByRole('textbox', { name: '새 이슈 제목' })).toHaveValue('쓰던 것')
  })

  it('숨김은 이 장비에 남는다 — 다시 열어도 숨긴 채다', async () => {
    const first = renderSplit()
    await userEvent.click(screen.getByRole('button', { name: '목록 숨기기' }))
    expect(readListHidden('issue')).toBe(true)
    first.unmount()
    const { container } = renderSplit()
    expect(listBox(container)).toHaveAttribute('hidden')
  })

  it('경계를 끌면 폭이 바뀌고, 놓을 때 저장한다', () => {
    const { container } = renderSplit()
    expect(listBox(container).style.flexBasis).toBe(`${DEFAULT_LIST_PX}px`)
    act(() => { separator().dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, bubbles: true })) })
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 520 })) })
    expect(listBox(container).style.flexBasis).toBe(`${DEFAULT_LIST_PX + 120}px`)
    expect(readListWidth('issue')).toBe(DEFAULT_LIST_PX)
    act(() => { window.dispatchEvent(new MouseEvent('pointerup')) })
    expect(readListWidth('issue')).toBe(DEFAULT_LIST_PX + 120)
  })

  it('하한 200px, 상한 창 폭의 60%로 자른다', () => {
    const { container } = renderSplit()
    act(() => { separator().dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, bubbles: true })) })
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0 })) })
    expect(listBox(container).style.flexBasis).toBe('200px')
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 2000 })) })
    expect(listBox(container).style.flexBasis).toBe('720px')
    act(() => { window.dispatchEvent(new MouseEvent('pointerup')) })
  })

  it('키보드 ←→로 16px씩 바꾸고 곧바로 저장한다, 두 번 누르면 기본 폭', () => {
    const { container } = renderSplit()
    fireEvent.keyDown(separator(), { key: 'ArrowRight' })
    expect(listBox(container).style.flexBasis).toBe(`${DEFAULT_LIST_PX + 16}px`)
    expect(readListWidth('issue')).toBe(DEFAULT_LIST_PX + 16)
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' })
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' })
    expect(listBox(container).style.flexBasis).toBe(`${DEFAULT_LIST_PX - 16}px`)
    fireEvent.doubleClick(separator())
    expect(listBox(container).style.flexBasis).toBe(`${DEFAULT_LIST_PX}px`)
    expect(readListWidth('issue')).toBe(DEFAULT_LIST_PX)
  })

  it('창이 좁아지면 저장된 폭이어도 그리는 폭은 창에 맞춘다', () => {
    localStorage.setItem('one-desk.panelWindow.issue.listWidth', '700')
    const { container } = renderSplit()
    expect(listBox(container).style.flexBasis).toBe('700px')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    fireEvent(window, new Event('resize'))
    expect(listBox(container).style.flexBasis).toBe('480px')
  })
})
