import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OneDeskClient } from '@shared/client'
import type { Drawing, ItemChange, Repo } from '@shared/models'
import { ClientProvider } from '../../client/ClientProvider'
import { DrawingWindow } from './DrawingWindow'

vi.mock('./DrawingCanvas', () => ({
  default: ({ drawing, onDeleted }: { drawing: Drawing; onDeleted: () => void }) => (
    <div data-testid="canvas" data-id={drawing.id}>
      <button type="button" onClick={onDeleted}>지워짐 흉내</button>
    </div>
  )
}))

const repo: Repo = { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0 }
const drawing: Drawing = { id: 'd1', workspaceId: 'w1', repoId: 'r1', title: '구조도', createdAt: 1, updatedAt: 1, scene: '{"elements":[]}' }

function setup(found: Drawing | null) {
  let current = found
  const changed: Array<(c: ItemChange) => void> = []
  const client = {
    drawings: { get: vi.fn(async () => current) },
    repos: { list: vi.fn(async () => [repo]) },
    events: { onItemChanged: (cb: (c: ItemChange) => void) => { changed.push(cb); return () => {} } }
  }
  render(
    <ClientProvider client={client as unknown as OneDeskClient}>
      <DrawingWindow drawingId="d1" />
    </ClientProvider>
  )
  return {
    change: (next: Drawing | null) => { current = next; for (const cb of changed) cb({ workspaceId: 'w1', kind: 'drawing' }) }
  }
}

describe('그림 창 (docs/sdlc/drawings/ spec FR-10)', () => {
  it('그림의 제목과 repo를 머리에, 창 제목에 `그림 · <제목>`을 보이고 캔버스를 그린다', async () => {
    setup(drawing)
    expect((await screen.findByTestId('canvas')).dataset['id']).toBe('d1')
    expect(screen.getByRole('heading', { name: '구조도' })).toBeInTheDocument()
    expect(await screen.findByText('api')).toBeInTheDocument()
    await waitFor(() => { expect(document.title).toBe('그림 · 구조도') })
    // 이름 바꾸기·지우기는 칸에만 있다
    expect(screen.queryByRole('button', { name: '그림 이름 바꾸기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '그림 삭제' })).not.toBeInTheDocument()
  })

  it('코드 칸에서 바꾼 이름을 따라가고, 지우면 안내로 바뀐다', async () => {
    const h = setup(drawing)
    await screen.findByTestId('canvas')
    await act(async () => { h.change({ ...drawing, title: '전체 흐름' }) })
    await waitFor(() => { expect(document.title).toBe('그림 · 전체 흐름') })
    await act(async () => { h.change(null) })
    expect(await screen.findByRole('alert')).toHaveTextContent('이 그림은 삭제됐습니다')
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument()
  })

  it('처음부터 없는 그림이면 안내다', async () => {
    setup(null)
    expect(await screen.findByRole('alert')).toHaveTextContent('이 그림은 삭제됐습니다')
  })

  it('캔버스가 지워졌다고 알리면 안내로 바뀐다', async () => {
    setup(drawing)
    await userEvent.click(await screen.findByRole('button', { name: '지워짐 흉내' }))
    expect(screen.getByRole('alert')).toHaveTextContent('이 그림은 삭제됐습니다')
  })

  it('읽을 수 없는 해시면 안내다', () => {
    render(
      <ClientProvider client={{} as OneDeskClient}>
        <DrawingWindow drawingId={null} />
      </ClientProvider>
    )
    expect(screen.getByRole('alert')).toHaveTextContent('열 수 없는 창입니다')
  })
})
