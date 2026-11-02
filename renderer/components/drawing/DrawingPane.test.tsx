import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OneDeskClient } from '@shared/client'
import type { Drawing, DrawingSummary, ItemChange, Repo } from '@shared/models'
import { ClientProvider } from '../../client/ClientProvider'
import { DrawingPane, statusText } from './DrawingPane'

// jsdom은 Excalidraw를 그리지 못한다 — 연 그림의 id와 제목만 보이는 대역이다(편집기·터미널과 같은 방식)
vi.mock('./DrawingCanvas', () => ({
  default: ({ drawing, onStatus, onDeleted }: { drawing: Drawing; onStatus: (s: unknown) => void; onDeleted: () => void }) => (
    <div data-testid="canvas" data-id={drawing.id}>
      <button type="button" onClick={() => onStatus({ kind: 'saved' })}>저장 흉내</button>
      <button type="button" onClick={() => onStatus({ kind: 'failed', message: '디스크가 꽉 찼습니다' })}>실패 흉내</button>
      <button type="button" onClick={onDeleted}>지워짐 흉내</button>
    </div>
  )
}))

const repo: Repo = { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0 }

const summary = (id: string, title: string, updatedAt: number): DrawingSummary =>
  ({ id, workspaceId: 'w1', repoId: 'r1', title, createdAt: updatedAt, updatedAt })

function setup(initial: DrawingSummary[]) {
  let list = [...initial]
  const changed: Array<(c: ItemChange) => void> = []
  let n = list.length
  const client = {
    drawings: {
      list: vi.fn(async () => list),
      get: vi.fn(async (id: string): Promise<Drawing | null> => {
        const s = list.find((d) => d.id === id)
        return s ? { ...s, scene: '{"elements":[]}' } : null
      }),
      create: vi.fn(async () => {
        n += 1
        const made = summary(`d${n}`, `그림 ${n}`, 100 + n)
        list = [...list, made]
        return { ...made, scene: '{"elements":[]}' }
      }),
      rename: vi.fn(async (id: string, title: string) => {
        list = list.map((d) => (d.id === id ? { ...d, title } : d))
        return list.find((d) => d.id === id)!
      }),
      remove: vi.fn(async (id: string) => { list = list.filter((d) => d.id !== id) }),
      saveScene: vi.fn()
    },
    app: { openDrawingWindow: vi.fn(async () => {}) },
    events: { onItemChanged: (cb: (c: ItemChange) => void) => { changed.push(cb); return () => {} } }
  }
  const onClose = vi.fn()
  render(
    <ClientProvider client={client as unknown as OneDeskClient}>
      <DrawingPane workspaceId="w1" repo={repo} onClose={onClose} />
    </ClientProvider>
  )
  return {
    client, onClose,
    /** 다른 창이 바꿨다 */
    replaceList: (next: DrawingSummary[]) => { list = next; for (const cb of changed) cb({ workspaceId: 'w1', kind: 'drawing' }) }
  }
}

describe('그림 칸 (docs/sdlc/drawings/ spec §6)', () => {
  beforeEach(() => { localStorage.clear() })

  it('그림이 없으면 안내와 첫 그림 만들기다 — 고르기·새 창은 잠긴다', async () => {
    const { client } = setup([])
    expect(await screen.findByText('이 repo에 그림이 없습니다')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '그림 고르기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '그림 새 창으로 열기' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '첫 그림 만들기' }))
    expect(client.drawings.create).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1' })
    expect((await screen.findByTestId('canvas')).dataset['id']).toBe('d1')
    expect(screen.getByRole('button', { name: '그림 고르기' })).toHaveTextContent('그림 1')
  })

  it('기억한 그림이 없으면 가장 최근에 고친 그림을 연다 (FR-14)', async () => {
    setup([summary('a', '구조도', 5), summary('b', '흐름', 9)])
    expect((await screen.findByTestId('canvas')).dataset['id']).toBe('b')
  })

  it('이 장비가 기억한 그림을 연다 — 고르면 기억을 바꾼다 (FR-13·14)', async () => {
    localStorage.setItem('one-desk.drawing.open.r1', 'a')
    setup([summary('a', '구조도', 5), summary('b', '흐름', 9)])
    expect((await screen.findByTestId('canvas')).dataset['id']).toBe('a')
    await userEvent.click(screen.getByRole('button', { name: '그림 고르기' }))
    const menu = screen.getByRole('menu', { name: '그림 고르기' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['구조도', '흐름'])
    expect(items[0]).toHaveAttribute('aria-current', 'true')
    await userEvent.click(items[1]!)
    await waitFor(() => { expect(screen.getByTestId('canvas').dataset['id']).toBe('b') })
    expect(localStorage.getItem('one-desk.drawing.open.r1')).toBe('b')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('메뉴의 Esc는 메뉴만 닫고 밖으로 새지 않는다', async () => {
    setup([summary('a', '구조도', 5)])
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: '그림 고르기' }))
    const outside = vi.fn()
    document.addEventListener('keydown', outside)
    fireEvent.keyDown(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!, { key: 'Escape' })
    document.removeEventListener('keydown', outside)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(outside).not.toHaveBeenCalled()
  })

  it('새 그림은 만들고 곧바로 연다 (FR-15)', async () => {
    const { client } = setup([summary('a', '구조도', 5)])
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: '새 그림' }))
    expect(client.drawings.create).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(screen.getByTestId('canvas').dataset['id']).toBe('d2') })
  })

  it('이름을 바꾼다 — 빈 이름은 취소다', async () => {
    const { client } = setup([summary('a', '구조도', 5)])
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: '그림 이름 바꾸기' }))
    const field = screen.getByRole('textbox', { name: '구조도 새 이름' })
    await userEvent.clear(field)
    await userEvent.type(field, '전체 흐름{Enter}')
    expect(client.drawings.rename).toHaveBeenCalledWith('a', '전체 흐름')
    await waitFor(() => { expect(screen.getByRole('button', { name: '그림 고르기' })).toHaveTextContent('전체 흐름') })
  })

  it('지우면 두 번 눌러야 하고, 남은 것 중 가장 최근에 고친 것을 연다 (FR-16)', async () => {
    localStorage.setItem('one-desk.drawing.open.r1', 'b')
    const { client } = setup([summary('a', '구조도', 5), summary('b', '흐름', 9), summary('c', '배포', 7)])
    await waitFor(() => { expect(screen.getByTestId('canvas').dataset['id']).toBe('b') })
    await userEvent.click(screen.getByRole('button', { name: '그림 삭제' }))
    expect(client.drawings.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    expect(client.drawings.remove).toHaveBeenCalledWith('b')
    await waitFor(() => { expect(screen.getByTestId('canvas').dataset['id']).toBe('c') })
  })

  it('새 창 버튼은 지금 그림의 창을 연다 (FR-9)', async () => {
    const { client } = setup([summary('a', '구조도', 5)])
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: '그림 새 창으로 열기' }))
    expect(client.app.openDrawingWindow).toHaveBeenCalledWith('a')
  })

  it('다른 창의 이름 바꾸기·지우기를 따라간다 (FR-17)', async () => {
    const h = setup([summary('a', '구조도', 5), summary('b', '흐름', 3)])
    await screen.findByTestId('canvas')
    await act(async () => { h.replaceList([summary('a', '새 이름', 6), summary('b', '흐름', 3)]) })
    await waitFor(() => { expect(screen.getByRole('button', { name: '그림 고르기' })).toHaveTextContent('새 이름') })
    await act(async () => { h.replaceList([summary('b', '흐름', 3)]) })
    await waitFor(() => { expect(screen.getByTestId('canvas').dataset['id']).toBe('b') })
  })

  it('캔버스가 알린 저장 상태를 머리에 보인다', async () => {
    setup([summary('a', '구조도', 5)])
    await screen.findByTestId('canvas')
    await userEvent.click(screen.getByRole('button', { name: '저장 흉내' }))
    expect(screen.getByRole('status')).toHaveTextContent('저장됨')
    await userEvent.click(screen.getByRole('button', { name: '실패 흉내' }))
    expect(screen.getByRole('status')).toHaveTextContent('그림을 저장하지 못했습니다: 디스크가 꽉 찼습니다')
  })

  it('코드 칸 닫기', async () => {
    const { onClose } = setup([])
    await userEvent.click(screen.getByRole('button', { name: '코드 칸 닫기' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('저장 상태 글자', () => {
    expect(statusText(null)).toBeNull()
    expect(statusText({ kind: 'saving' })).toBe('저장 중…')
  })
})
