import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddForm } from './AddForm'

describe('AddForm', () => {
  it('제출이 실패하면 오류를 화면에 보여주고 입력값을 유지한다', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('저장할 수 없습니다'))
    render(<AddForm placeholder="새 항목" onSubmit={onSubmit} />)

    const input = screen.getByPlaceholderText('새 항목')
    await userEvent.type(input, '실패할 항목{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('저장할 수 없습니다')
    expect(input).toHaveValue('실패할 항목')
  })

  it('제출이 성공하면 입력값을 비우고 오류를 남기지 않는다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AddForm placeholder="새 항목" onSubmit={onSubmit} />)

    const input = screen.getByPlaceholderText('새 항목')
    await userEvent.type(input, '성공할 항목{Enter}')

    expect(input).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
