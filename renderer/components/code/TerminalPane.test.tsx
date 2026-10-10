import { describe, it, expect, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OneDeskClient } from '@shared/client'
import type { Repo, TerminalData, TerminalExit, TerminalSession } from '@shared/models'
import { ClientProvider } from '../../client/ClientProvider'
import { TerminalPane } from './TerminalPane'
import type { TerminalViewProps } from './TerminalView'

// jsdom에서는 xterm을 그릴 수 없다 — 쓴 글을 기록하고, 키 입력을 흉내 내는 단추를 둔 대역이다(편집기와 같은 방식)
const view = { written: [] as string[], cleared: 0, focused: 0 }
vi.mock('./TerminalView', async () => {
  const { useEffect } = await import('react')
  return {
    TerminalView: ({ onReady, onData }: TerminalViewProps) => {
      // 진짜 껍데기처럼 마운트할 때 한 번만 알린다
      useEffect(() => {
        onReady({
          write: (t) => { view.written.push(t) },
          clear: () => { view.cleared++; view.written.length = 0 },
          size: () => ({ cols: 100, rows: 30 }),
          focus: () => { view.focused++ }
        })
      }, [])
      return (
        <div data-testid="xterm">
          <button type="button" onClick={() => onData('ls\r')}>키 입력</button>
        </div>
      )
    }
  }
})

const repo: Repo = { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }

function session(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    repoId: 'r1', generation: 1, shell: 'pwsh', shellPath: 'C:\\pwsh\\pwsh.exe',
    snapshot: { text: 'PS> ', end: 4 }, exited: null, ...over
  }
}

function setup(open: () => Promise<TerminalSession> = async () => session(), strict = false) {
  view.written.length = 0
  view.cleared = 0
  const listeners: { data: Array<(d: TerminalData) => void>; exit: Array<(e: TerminalExit) => void> } = { data: [], exit: [] }
  const client = {
    terminal: {
      open: vi.fn(open),
      restart: vi.fn(async () => session({ generation: 2, snapshot: { text: '', end: 0 } })),
      write: vi.fn(),
      resize: vi.fn()
    },
    events: {
      onTerminalData: vi.fn((cb: (d: TerminalData) => void) => { listeners.data.push(cb); return () => {} }),
      onTerminalExit: vi.fn((cb: (e: TerminalExit) => void) => { listeners.exit.push(cb); return () => {} })
    }
  } as unknown as OneDeskClient
  const onClose = vi.fn()
  const outer = vi.fn()
  const tree = (
    <ClientProvider client={client}>
      <div onKeyDown={outer}>
        <TerminalPane workspaceId="w1" repo={repo} onClose={onClose} />
      </div>
    </ClientProvider>
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  const emit = (d: TerminalData) => { act(() => { for (const cb of listeners.data) cb(d) }) }
  const exit = (e: TerminalExit) => { act(() => { for (const cb of listeners.exit) cb(e) }) }
  return { client, onClose, outer, emit, exit }
}

describe('TerminalPane (docs/sdlc/code-editor/terminal-spec.md)', () => {
  it('화면 크기로 그 repo의 셸을 열고, 스냅샷 뒤에 오는 출력을 이어 쓴다', async () => {
    const { client, emit } = setup()
    await waitFor(() => expect(client.terminal.open).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1', cols: 100, rows: 30 }))
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    emit({ repoId: 'r1', generation: 1, start: 4, data: 'dir' })
    expect(view.written).toEqual(['PS> ', 'dir'])
    expect(screen.getByText('pwsh')).toHaveAttribute('title', 'C:\\pwsh\\pwsh.exe')
  })

  it('껍데기가 두 번 마운트돼도(StrictMode·개발 모드) 스냅샷은 한 번만 쓴다 — 늦게 온 옛 응답은 버린다', async () => {
    const { client } = setup(async () => session(), true)
    await waitFor(() => expect(client.terminal.open).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    await new Promise((r) => setTimeout(r, 0))
    expect(view.written).toEqual(['PS> '])
  })

  it('구독은 열기 전에 건다 — 열기 응답 전에 온 출력도 잃지 않는다', async () => {
    let resolve: (s: TerminalSession) => void = () => {}
    const { client, emit } = setup(() => new Promise((r) => { resolve = r }))
    expect(client.events.onTerminalData).toHaveBeenCalled()
    await waitFor(() => expect(client.terminal.open).toHaveBeenCalled())
    emit({ repoId: 'r1', generation: 1, start: 0, data: 'PS> ls' })
    await act(async () => { resolve(session()) })
    expect(view.written.join('')).toBe('PS> ls')
  })

  it('키 입력은 그 repo의 셸로 간다', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    await userEvent.click(screen.getByRole('button', { name: '키 입력' }))
    expect(client.terminal.write).toHaveBeenCalledWith('r1', 'ls\r')
  })

  it('셸이 끝나면 종료 코드와 다시 시작을 보이고, 다시 시작하면 화면을 비우고 새 셸에 붙는다 (FR-7)', async () => {
    const { client, exit } = setup()
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    exit({ repoId: 'r1', generation: 1, exitCode: 3 })
    expect(screen.getByRole('status')).toHaveTextContent('셸이 끝났습니다 (종료 코드 3)')
    // 끝난 셸에는 끝낼 것이 없다 — 머리의 두 번 누르기 단추는 없고 끝남 줄의 단추 하나다
    expect(screen.getAllByRole('button', { name: '셸 다시 시작' })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: '셸 다시 시작' }))
    expect(client.terminal.restart).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1', cols: 100, rows: 30 })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(view.cleared).toBe(1)
  })

  it('도는 셸의 다시 시작은 두 번 눌러야 한다 — 셸이 띄운 dev 서버까지 끝난다 (FR-8)', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    await userEvent.click(screen.getByRole('button', { name: '셸 다시 시작' }))
    expect(client.terminal.restart).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /정말 다시 시작/ }))
    expect(client.terminal.restart).toHaveBeenCalledTimes(1)
  })

  it('다른 repo·옛 셸의 끝남은 무시한다', async () => {
    const { exit } = setup()
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    exit({ repoId: 'r2', generation: 1, exitCode: 1 })
    exit({ repoId: 'r1', generation: 0, exitCode: 1 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('이미 끝난 셸에 붙으면 끝남 줄이 바로 선다', async () => {
    setup(async () => session({ exited: { exitCode: 0 } }))
    expect(await screen.findByRole('status')).toHaveTextContent('셸이 끝났습니다 (종료 코드 0)')
  })

  it('셸을 띄우지 못하면 이유를 말하고 다시 시도할 수 있다', async () => {
    let fail = true
    const { client } = setup(async () => {
      if (fail) throw new Error('셸을 띄우지 못했습니다: C:\\없는\\셸.exe (File not found)')
      return session()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('셸을 띄우지 못했습니다')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    expect(client.terminal.open).toHaveBeenCalledTimes(2)
  })

  it('칸 안의 Esc는 밖(도크 최대화·열린 항목 닫기)으로 새지 않는다 (FR-16)', async () => {
    const { outer } = setup()
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    fireEvent.keyDown(screen.getByTestId('xterm'), { key: 'Escape' })
    expect(outer).not.toHaveBeenCalled()
  })

  it('코드 칸 닫기는 칸만 닫는다 — 셸은 core에서 계속 돈다', async () => {
    const { client, onClose } = setup()
    await waitFor(() => expect(view.written).toEqual(['PS> ']))
    await userEvent.click(screen.getByRole('button', { name: '코드 칸 닫기' }))
    expect(onClose).toHaveBeenCalled()
    expect(client.terminal.restart).not.toHaveBeenCalled()
  })
})
