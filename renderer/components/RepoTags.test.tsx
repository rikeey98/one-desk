import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoTags } from './RepoTags'
import type { Repo } from '@shared/models'

function makeRepo(id: string, name: string): Repo {
  return {
    id, workspaceId: 'ws', name, path: `/tmp/${id}`,
    description: null, sortOrder: 0, createdAt: 0
  }
}

const REPOS = [makeRepo('r1', 'api'), makeRepo('r2', 'web')]

describe('RepoTags', () => {
  it('repo 이름을 칩으로 그리고 고른 것을 눌린 상태로 표시한다', () => {
    render(<RepoTags repos={REPOS} picked={['r2']} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'api' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'web' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('안 눌린 칩을 누르면 더한 목록을 준다', async () => {
    const onChange = vi.fn()
    render(<RepoTags repos={REPOS} picked={['r2']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'api' }))
    expect(onChange).toHaveBeenCalledWith(['r2', 'r1'])
  })

  it('눌린 칩을 누르면 뺀 목록을 준다', async () => {
    // 축과 달리 다중 선택이다 — 하나의 이슈가 여러 repo에 걸치는 일이 실제로 잦다.
    const onChange = vi.fn()
    render(<RepoTags repos={REPOS} picked={['r1', 'r2']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'web' }))
    expect(onChange).toHaveBeenCalledWith(['r1'])
  })

  it('둘을 차례로 켜면 둘 다 남는다', async () => {
    // 한 번 누를 때마다 부모가 picked를 갱신해 되먹인다. 컴포넌트가 스스로
    // state를 들면 부모(=DB)와 갈라지므로 여기서는 항상 prop만 본다.
    const onChange = vi.fn()
    const { rerender } = render(<RepoTags repos={REPOS} picked={[]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'api' }))
    expect(onChange).toHaveBeenLastCalledWith(['r1'])

    rerender(<RepoTags repos={REPOS} picked={['r1']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'web' }))
    expect(onChange).toHaveBeenLastCalledWith(['r1', 'r2'])
  })

  it('repo가 하나도 없으면 아무것도 그리지 않는다', () => {
    // 빈 줄은 화면에 상주하는 잡음이다. 등록된 repo가 없으면 고를 것도 없다.
    const { container } = render(<RepoTags repos={[]} picked={[]} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('사라진 repo id가 picked에 남아 있어도 그것 때문에 죽지 않는다', () => {
    // repo를 지우면 issue_repo가 cascade로 지워지지만, 목록을 다시 읽기 전의
    // 화면에는 옛 id가 남아 있을 수 있다.
    render(<RepoTags repos={REPOS} picked={['사라진것']} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'api' })).toHaveAttribute('aria-pressed', 'false')
  })
})
