import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RenameField } from './RenameField'

describe('RenameField', () => {
  it('현재 이름으로 시작하고 전체가 선택돼 있다 — 바로 덮어쓸 수 있게', () => {
    render(<RenameField initial="옛 이름" label="workspace 이름" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: 'workspace 이름' }) as HTMLInputElement
    expect(input.value).toBe('옛 이름')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('옛 이름'.length)
  })

  it('Enter로 저장한다', async () => {
    const onSubmit = vi.fn()
    render(<RenameField initial="옛" label="이름" onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), '새 이름{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('새 이름')
  })

  it('Esc는 저장하지 않고 취소한다', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<RenameField initial="옛" label="이름" onSubmit={onSubmit} onCancel={onCancel} />)
    await userEvent.type(screen.getByRole('textbox'), '바꿈{Escape}')
    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('포커스를 잃으면 저장한다 — 다른 곳을 클릭한 것도 "다 썼다"는 뜻이다', async () => {
    const onSubmit = vi.fn()
    render(<RenameField initial="옛" label="이름" onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), '새 이름')
    await userEvent.tab()
    expect(onSubmit).toHaveBeenCalledWith('새 이름')
  })

  it('바뀐 것이 없으면 저장하지 않는다 — 헛된 쓰기가 updatedAt만 올린다', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<RenameField initial="그대로" label="이름" onSubmit={onSubmit} onCancel={onCancel} />)
    await userEvent.tab()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('빈 이름은 저장하지 않고 취소로 끝난다', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<RenameField initial="옛" label="이름" onSubmit={onSubmit} onCancel={onCancel} />)
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), '   {Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('allowEmpty면 비운 이름을 저장한다 — 붙인 이름을 지워 기본 제목으로 되돌리는 길이다', async () => {
    // 대화 이름(`docs/sdlc/conversation-fixes/` spec FR-21). workspace·repo는 이름이
    // 없을 수 없지만, 대화 제목은 비우면 파생 제목으로 돌아간다.
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<RenameField initial="붙인 이름" label="이름" allowEmpty onSubmit={onSubmit} onCancel={onCancel} />)
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), '  {Enter}')
    expect(onSubmit).toHaveBeenCalledWith('')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('allowEmpty여도 처음부터 비어 있었고 그대로면 저장하지 않는다', async () => {
    // 이름이 없던 대화에서 칸을 열었다 닫은 것은 바뀐 것이 없다.
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<RenameField initial="" label="이름" allowEmpty onSubmit={onSubmit} onCancel={onCancel} />)
    await userEvent.tab()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('Esc는 위로 새지 않는다 — App이 document에 건 keydown이 패널을 함께 닫는다', async () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <RenameField initial="옛" label="이름" onSubmit={vi.fn()} onCancel={vi.fn()} />
      </div>
    )
    await userEvent.type(screen.getByRole('textbox'), '{Escape}')
    expect(outer).not.toHaveBeenCalled()
  })
})
