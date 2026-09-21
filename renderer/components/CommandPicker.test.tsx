import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPicker } from './CommandPicker'

const commands = [
  { name: 'review', description: '코드 검사', usesArguments: false },
  { name: 'compact', description: null, usesArguments: false }
]

describe('CommandPicker', () => {
  it('설명 없는 이름도 남기고 선택과 새로고침을 전달한다', async () => {
    const onPick = vi.fn()
    const onRefresh = vi.fn()
    render(<CommandPicker id="lb" optionId={(name) => `lb-${name}`} commands={commands} selectedIndex={0} loading={false} error={null}
      onPick={onPick} onRefresh={onRefresh} />)
    expect(screen.getByText('코드 검사')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: '/compact' }))
    expect(onPick).toHaveBeenCalledWith(commands[1])
    await userEvent.click(screen.getByRole('button', { name: '커맨드 새로고침' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('로딩·실패·빈 결과를 구분해 표시한다', () => {
    const props = { id: 'lb', optionId: (name: string) => `lb-${name}`, commands: [], selectedIndex: 0, onPick: vi.fn(), onRefresh: vi.fn() }
    const { rerender } = render(<CommandPicker {...props} loading={true} error={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    rerender(<CommandPicker {...props} loading={false} error="시간이 초과됐습니다" />)
    expect(screen.getByRole('alert')).toHaveTextContent('시간이 초과됐습니다')
    rerender(<CommandPicker {...props} loading={false} error={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('일치하는 커맨드가 없습니다')
  })
})
