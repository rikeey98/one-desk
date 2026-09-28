import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilePicker } from './FilePicker'

function renderPicker(over: Partial<Parameters<typeof FilePicker>[0]> = {}) {
  const onPick = vi.fn()
  const { container } = render(
    <FilePicker
      id="files" optionId={(i) => `files-f${i}`}
      files={[{ path: 'notes/a.txt' }, { path: 'README.md' }]}
      selectedIndex={0} loading={false} reason={null} truncated={false} onPick={onPick}
      {...over}
    />
  )
  return { container, onPick }
}

describe('FilePicker (docs/sdlc/input-triggers/ FR-2·FR-7)', () => {
  it('option 이름은 상대 경로 그대로이고 디렉토리 부분은 흐린 칸이다. listbox 이름은 `파일 참조`, 그룹 머리는 `파일`', () => {
    const { container } = renderPicker()

    expect(screen.getByRole('listbox', { name: '파일 참조' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'notes/a.txt' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'README.md' })).toHaveAttribute('id', 'files-f1')
    expect(container.querySelector('.file-option-dir')?.textContent).toBe('notes/')
    expect(container.querySelector('.file-picker-group')?.textContent).toBe('파일')
  })

  it('누르면 그 파일을 고른다', () => {
    const { onPick } = renderPicker()
    screen.getByRole('option', { name: 'README.md' }).click()
    expect(onPick).toHaveBeenCalledWith({ path: 'README.md' })
  })

  it('불러오는 중·결과 없음·이유를 각각 보인다', () => {
    const { unmount } = render(
      <FilePicker id="f" optionId={(i) => `f${i}`} files={[]} selectedIndex={0} loading reason={null} truncated={false} onPick={vi.fn()} />
    )
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중…')
    unmount()

    renderPicker({ files: [] })
    expect(screen.getByRole('status')).toHaveTextContent('일치하는 파일이 없습니다')
  })

  it('못 찾는 이유는 alert이고 "없음" 문구를 겹쳐 보이지 않는다', () => {
    renderPicker({ files: [], reason: 'git 저장소가 아니라 파일 목록을 만들 수 없습니다' })
    expect(screen.getByRole('alert')).toHaveTextContent('git 저장소가 아니라')
    expect(screen.queryByText('일치하는 파일이 없습니다')).toBeNull()
  })

  it('목록이 잘렸으면 일부에서만 찾는다고 알린다', () => {
    renderPicker({ truncated: true })
    expect(screen.getByText('파일이 많아 일부에서만 찾습니다')).toBeInTheDocument()
  })
})
