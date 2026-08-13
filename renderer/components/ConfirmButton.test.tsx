import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmButton } from './ConfirmButton'

describe('ConfirmButton', () => {
  it('한 번 눌러서는 부르지 않는다', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '정말 삭제?' })).toBeInTheDocument()
  })

  it('두 번 누르면 부른다', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Esc는 확인만 끄고 위로 새어나가지 않는다', async () => {
    // App이 Esc로 패널을 접는다. 삭제를 물리려다 편집 화면까지 닫히면 안 된다 (설계 §5).
    const onConfirm = vi.fn()
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={onConfirm} />
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
    expect(outer).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Esc가 document 리스너까지 새지 않는다', async () => {
    // App.tsx의 실제 Esc 리스너는 <div onKeyDown>이 아니라 document.addEventListener로
    // 붙는다. React의 합성 stopPropagation은 React 트리 안의 조상 핸들러만 막고, 루트
    // 컨테이너 바깥의 네이티브 document 리스너까지는 막지 못한다 — 그래서 위 테스트
    // (React onKeyDown 조상)만으로는 이 경로가 검증되지 않는다. 여기서 실제 document
    // 리스너로 App.tsx의 조건을 재현한다.
    const onConfirm = vi.fn()
    const onDocumentKeyDown = vi.fn()
    document.addEventListener('keydown', onDocumentKeyDown)
    try {
      render(<ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={onConfirm} />)
      await userEvent.click(screen.getByRole('button', { name: '삭제' }))
      await userEvent.keyboard('{Escape}')
      expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
      expect(onDocumentKeyDown).not.toHaveBeenCalled()
      expect(onConfirm).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocumentKeyDown)
    }
  })

  it('포커스가 빠지면 확인이 풀린다', async () => {
    render(
      <>
        <ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={vi.fn()} />
        <button>다른 곳</button>
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '다른 곳' }))
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
  })
})
