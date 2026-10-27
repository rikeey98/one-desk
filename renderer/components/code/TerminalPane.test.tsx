import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OneDeskClient } from '@shared/client'
import {
  TERMINAL_TABS_PER_REPO,
  type Repo, type TerminalCreateInput, type TerminalData, type TerminalExit, type TerminalSession, type TerminalShellOption, type TerminalTab
} from '@shared/models'
import { ClientProvider } from '../../client/ClientProvider'
import { TerminalPane } from './TerminalPane'
import type { TerminalViewProps } from './TerminalView'

// jsdom에서는 xterm을 그릴 수 없다 — 쓴 글을 기록하고, 키 입력을 흉내 내는 단추를 둔 대역이다(편집기와 같은 방식)
const view = { written: [] as string[], cleared: 0, focused: 0, selection: '' }
vi.mock('./TerminalView', async () => {
  const { useEffect } = await import('react')
  return {
    TerminalView: ({ onReady, onData, onSelectionChange }: TerminalViewProps) => {
      // 진짜 껍데기처럼 마운트할 때 한 번만 알린다(그릴 때마다 부르면 열기 → state → 다시 그리기가 끝없이 돈다)
      useEffect(() => {
        view.written.length = 0
        onReady({
          write: (t) => { view.written.push(t) },
          clear: () => { view.cleared++; view.written.length = 0 },
          size: () => ({ cols: 100, rows: 30 }),
          focus: () => { view.focused++ },
          getSelection: () => view.selection,
          clearSelection: () => { view.selection = ''; onSelectionChange(false) }
        })
      }, [])
      return (
        <div data-testid="xterm">
          <button type="button" onClick={() => onData('ls\r')}>키 입력</button>
          <button type="button" onClick={() => { view.selection = 'FAIL a.test.ts'; onSelectionChange(true) }}>글 고르기</button>
        </div>
      )
    }
  }
})

const repo: Repo = { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0 }

const tabOf = (tabId: string, label: string, over: Partial<TerminalTab> = {}): TerminalTab => ({
  tabId, repoId: 'r1', label, shellKey: 'default', shellPath: 'C:\\pwsh\\pwsh.exe', exited: null, ...over
})

const SHELLS: TerminalShellOption[] = [
  { key: 'pwsh', label: 'PowerShell 7', path: 'C:\\pwsh\\pwsh.exe', isDefault: true },
  { key: 'cmd', label: '명령 프롬프트', path: 'C:\\Windows\\System32\\cmd.exe', isDefault: false }
]

/** 가짜 core — 탭 목록을 쥐고, 붙으면 탭마다 다른 스냅샷(`<이름>> `)을 준다 */
function setup(opts: { tabs?: TerminalTab[]; open?: () => Promise<TerminalTab[]>; strict?: boolean } = {}) {
  view.written.length = 0
  view.cleared = 0
  view.selection = ''
  let tabs = opts.tabs ?? [tabOf('t1', 'pwsh')]
  let made = 0
  let generation = 10
  const sessionOf = (t: TerminalTab, over: Partial<TerminalSession> = {}): TerminalSession => ({
    ...t, generation: generation++, snapshot: { text: `${t.label}> `, end: t.label.length + 2 }, ...over
  })
  const listeners: { data: Array<(d: TerminalData) => void>; exit: Array<(e: TerminalExit) => void> } = { data: [], exit: [] }
  const client = {
    terminal: {
      open: vi.fn(opts.open ?? (async () => tabs)),
      shells: vi.fn(async () => SHELLS),
      create: vi.fn(async (input: TerminalCreateInput) => {
        made++
        const t = tabOf(`n${made}`, input.shell === 'cmd' ? 'cmd' : `pwsh ${made + 1}`, { shellKey: input.shell })
        tabs = [...tabs, t]
        return sessionOf(t, { snapshot: { text: '', end: 0 } })
      }),
      attach: vi.fn(async ({ tabId }: { tabId: string }) => {
        const t = tabs.find((x) => x.tabId === tabId)
        if (!t) throw new Error('열린 터미널이 없습니다')
        return sessionOf(t)
      }),
      restart: vi.fn(async ({ tabId }: { tabId: string }) =>
        sessionOf(tabs.find((x) => x.tabId === tabId)!, { exited: null, snapshot: { text: '', end: 0 } })),
      close: vi.fn(async ({ tabId }: { tabId: string }) => { tabs = tabs.filter((t) => t.tabId !== tabId) }),
      write: vi.fn(),
      resize: vi.fn()
    },
    events: {
      onTerminalData: vi.fn((cb: (d: TerminalData) => void) => {
        listeners.data.push(cb)
        return () => { listeners.data.splice(listeners.data.indexOf(cb), 1) }
      }),
      onTerminalExit: vi.fn((cb: (e: TerminalExit) => void) => {
        listeners.exit.push(cb)
        return () => { listeners.exit.splice(listeners.exit.indexOf(cb), 1) }
      })
    }
  } as unknown as OneDeskClient
  const onClose = vi.fn()
  const onSendSelection = vi.fn()
  const outer = vi.fn()
  const tree = (
    <ClientProvider client={client}>
      <div onKeyDown={outer}>
        <TerminalPane workspaceId="w1" repo={repo} onClose={onClose} onSendSelection={onSendSelection} />
      </div>
    </ClientProvider>
  )
  render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree)
  const emit = (d: TerminalData) => { act(() => { for (const cb of [...listeners.data]) cb(d) }) }
  const exit = (e: TerminalExit) => { act(() => { for (const cb of [...listeners.exit]) cb(e) }) }
  const lastGeneration = () => generation - 1
  return { client, onClose, onSendSelection, outer, emit, exit, lastGeneration }
}

const tab = (name: string) => screen.getByRole('tab', { name })
const selectedTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')

beforeEach(() => { localStorage.clear() })

describe('TerminalPane — 붙기 (docs/sdlc/code-editor/terminal-spec.md, terminal-tabs FR-4·5)', () => {
  it('그 repo의 탭 목록을 열고 보이는 탭에 붙는다 — 스냅샷 뒤에 오는 출력을 이어 쓰고 셸 크기를 칸에 맞춘다', async () => {
    const { client, emit, lastGeneration } = setup()
    await waitFor(() => expect(client.terminal.open).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1', cols: 80, rows: 24 }))
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    expect(client.terminal.attach).toHaveBeenCalledWith({ workspaceId: 'w1', tabId: 't1' })
    expect(client.terminal.resize).toHaveBeenCalledWith('t1', 100, 30)
    emit({ tabId: 't1', generation: lastGeneration(), start: 6, data: 'dir' })
    expect(view.written).toEqual(['pwsh> ', 'dir'])
    expect(tab('pwsh')).toHaveAttribute('aria-selected', 'true')
    expect(tab('pwsh')).toHaveAttribute('title', 'C:\\pwsh\\pwsh.exe')
  })

  it('껍데기가 두 번 마운트돼도(StrictMode·개발 모드) 스냅샷은 한 번만 쓴다 — 늦게 온 옛 응답은 버린다', async () => {
    const { client } = setup({ strict: true })
    await waitFor(() => expect(client.terminal.attach).toHaveBeenCalled())
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await new Promise((r) => setTimeout(r, 0))
    expect(view.written).toEqual(['pwsh> '])
  })

  it('구독은 붙기 전에 건다 — 붙기 응답 전에 온 출력도 잃지 않는다', async () => {
    const { client, emit } = setup()
    let resolve: (s: TerminalSession) => void = () => {}
    vi.mocked(client.terminal.attach).mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    await waitFor(() => expect(client.terminal.attach).toHaveBeenCalled())
    emit({ tabId: 't1', generation: 77, start: 0, data: 'PS> ls' })
    await act(async () => { resolve({ ...tabOf('t1', 'pwsh'), generation: 77, snapshot: { text: 'PS> ', end: 4 } }) })
    expect(view.written.join('')).toBe('PS> ls')
  })

  it('키 입력은 보이는 탭의 셸로 간다', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: '키 입력' }))
    expect(client.terminal.write).toHaveBeenCalledWith('t1', 'ls\r')
  })

  it('셸을 띄우지 못하면 이유를 말하고 다시 시도할 수 있다', async () => {
    let fail = true
    const { client } = setup({
      open: async () => {
        if (fail) throw new Error('셸을 띄우지 못했습니다: C:\\없는\\셸.exe (File not found)')
        return [tabOf('t1', 'pwsh')]
      }
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('셸을 띄우지 못했습니다')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    expect(client.terminal.open).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('TerminalPane — 탭 줄 (FR-1~4·6)', () => {
  it('탭을 누르면 그 탭에 새로 붙는다 — 보이지 않는 탭의 출력은 버리고, 돌아오면 스냅샷이 준다', async () => {
    const { client, emit } = setup({ tabs: [tabOf('t1', 'pwsh'), tabOf('t2', 'cmd', { shellKey: 'cmd' })] })
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(tab('cmd'))
    await waitFor(() => expect(view.written).toEqual(['cmd> ']))
    expect(client.terminal.attach).toHaveBeenLastCalledWith({ workspaceId: 'w1', tabId: 't2' })
    expect(selectedTab()).toHaveTextContent('cmd')
    emit({ tabId: 't1', generation: 10, start: 6, data: 'hidden' })
    expect(view.written.join('')).not.toContain('hidden')
  })

  it('기억한 탭으로 붙는다 — 고른 탭을 기억한다', async () => {
    localStorage.setItem('one-desk.terminal.tab.r1', 't2')
    const { client } = setup({ tabs: [tabOf('t1', 'pwsh'), tabOf('t2', 'cmd')] })
    await waitFor(() => expect(client.terminal.attach).toHaveBeenCalledWith({ workspaceId: 'w1', tabId: 't2' }))
    await userEvent.click(tab('pwsh'))
    expect(localStorage.getItem('one-desk.terminal.tab.r1')).toBe('t1')
  })

  it('←→·Home·End로 탭 사이를 옮긴다 — 보이는 탭만 Tab 순서에 있다', async () => {
    setup({ tabs: [tabOf('t1', 'pwsh'), tabOf('t2', 'cmd'), tabOf('t3', 'pwsh 2')] })
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1])
    fireEvent.keyDown(tab('pwsh'), { key: 'ArrowRight' })
    expect(selectedTab()).toHaveTextContent('cmd')
    expect(tab('cmd')).toHaveFocus()
    fireEvent.keyDown(tab('cmd'), { key: 'End' })
    expect(selectedTab()).toHaveTextContent('pwsh 2')
    fireEvent.keyDown(tab('pwsh 2'), { key: 'ArrowRight' })
    expect(selectedTab()).toHaveTextContent('pwsh')
    fireEvent.keyDown(tab('pwsh'), { key: 'ArrowLeft' })
    expect(selectedTab()).toHaveTextContent('pwsh 2')
    fireEvent.keyDown(tab('pwsh 2'), { key: 'Home' })
    expect(selectedTab()).toHaveTextContent('pwsh')
  })

  it('보이지 않는 탭이 끝나면 탭 줄이 끝남을 보인다 — 이름은 그대로, title이 종료 코드를 말한다 (FR-17)', async () => {
    const { exit } = setup({ tabs: [tabOf('t1', 'pwsh'), tabOf('t2', 'cmd')] })
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    exit({ tabId: 't2', generation: 99, exitCode: 4 })
    expect(tab('cmd')).toHaveAttribute('title', '끝남 (종료 코드 4)')
    // 보이는 탭의 끝남 줄은 서지 않는다 — 보이지 않는 탭이 끝났다
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('TerminalPane — 새 터미널과 셸 고르기 (FR-3·7)', () => {
  it('`새 터미널`은 기본 셸로 만들고 그 탭을 본다 — 마지막으로 잰 크기로 연다', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: '새 터미널' }))
    expect(client.terminal.create).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1', shell: 'default', cols: 100, rows: 30 })
    await waitFor(() => expect(selectedTab()).toHaveTextContent('pwsh 2'))
    expect(client.terminal.attach).toHaveBeenLastCalledWith({ workspaceId: 'w1', tabId: 'n1' })
  })

  it('셸 고르기 메뉴는 열 때마다 core에 묻고, 고른 줄의 키로 만든다 — 경로는 title, 기본 표식은 이름에 섞이지 않는다', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: '셸 고르기' }))
    const menu = await screen.findByRole('menu', { name: '셸 고르기' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['PowerShell 7기본', '명령 프롬프트'])
    expect(within(menu).getByRole('menuitem', { name: 'PowerShell 7' })).toHaveAccessibleDescription('지금 기본 셸')
    expect(within(menu).getByRole('menuitem', { name: '명령 프롬프트' })).toHaveAttribute('title', 'C:\\Windows\\System32\\cmd.exe')
    await userEvent.click(within(menu).getByRole('menuitem', { name: '명령 프롬프트' }))
    expect(client.terminal.create).toHaveBeenCalledWith(expect.objectContaining({ shell: 'cmd' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(selectedTab()).toHaveTextContent('cmd'))

    await userEvent.click(screen.getByRole('button', { name: '셸 고르기' }))
    await screen.findByRole('menu')
    expect(client.terminal.shells).toHaveBeenCalledTimes(2)
  })

  it('메뉴를 닫는 Esc는 메뉴만 닫는다 — 칸 밖(도크 최대화)으로 새지 않는다', async () => {
    const { outer } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: '셸 고르기' }))
    const menu = await screen.findByRole('menu')
    fireEvent.keyDown(within(menu).getAllByRole('menuitem')[0]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(outer).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '셸 고르기' })).toHaveFocus()
  })

  it('바깥을 누르면 메뉴가 닫힌다', async () => {
    setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: '셸 고르기' }))
    await screen.findByRole('menu')
    await userEvent.click(tab('pwsh'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it(`${TERMINAL_TABS_PER_REPO}개면 새 터미널과 셸 고르기가 잠기고 title이 이유를 말한다 — 하나를 닫으면 풀린다`, async () => {
    const many = Array.from({ length: TERMINAL_TABS_PER_REPO }, (_, i) => tabOf(`t${i}`, `pwsh ${i + 1}`, { exited: { exitCode: 0 } }))
    const { client } = setup({ tabs: many })
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(TERMINAL_TABS_PER_REPO))
    const plus = screen.getByRole('button', { name: '새 터미널' })
    const picker = screen.getByRole('button', { name: '셸 고르기' })
    for (const b of [plus, picker]) {
      expect(b).toHaveAttribute('aria-disabled', 'true')
      expect(b).toHaveAttribute('title', `터미널은 repo당 ${TERMINAL_TABS_PER_REPO}개까지입니다 — 하나를 닫으세요`)
    }
    await userEvent.click(plus)
    await userEvent.click(picker)
    expect(client.terminal.create).not.toHaveBeenCalled()
    expect(client.terminal.shells).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'pwsh 8 터미널 닫기' }))
    await waitFor(() => expect(plus).not.toHaveAttribute('aria-disabled'))
  })
})

describe('TerminalPane — 닫기 (FR-2)', () => {
  it('도는 탭은 두 번 눌러야 닫힌다 — 셸이 띄운 dev 서버까지 끝난다', async () => {
    const { client } = setup({ tabs: [tabOf('t1', 'pwsh'), tabOf('t2', 'cmd')] })
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: 'cmd 터미널 닫기' }))
    expect(client.terminal.close).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '정말 닫기' }))
    expect(client.terminal.close).toHaveBeenCalledWith({ workspaceId: 'w1', tabId: 't2' })
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'cmd' })).not.toBeInTheDocument())
  })

  it('끝난 탭은 한 번에 닫힌다', async () => {
    const { client } = setup({ tabs: [tabOf('t1', 'pwsh'), tabOf('t2', 'cmd', { exited: { exitCode: 0 } })] })
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: 'cmd 터미널 닫기' }))
    expect(client.terminal.close).toHaveBeenCalledWith({ workspaceId: 'w1', tabId: 't2' })
  })

  it('보던 탭을 닫으면 그 오른쪽, 오른쪽이 없으면 왼쪽 탭을 본다', async () => {
    const ended = { exited: { exitCode: 0 } }
    setup({ tabs: [tabOf('t1', 'pwsh', ended), tabOf('t2', 'cmd', ended), tabOf('t3', 'pwsh 2', ended)] })
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(tab('cmd'))
    await userEvent.click(screen.getByRole('button', { name: 'cmd 터미널 닫기' }))
    await waitFor(() => expect(selectedTab()).toHaveTextContent('pwsh 2'))
    await userEvent.click(screen.getByRole('button', { name: 'pwsh 2 터미널 닫기' }))
    await waitFor(() => expect(selectedTab()).toHaveTextContent('pwsh'))
  })

  it('마지막 탭을 닫으면 빈 칸에 안내와 새 터미널만 남는다', async () => {
    setup({ tabs: [tabOf('t1', 'pwsh', { exited: { exitCode: 0 } })] })
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: 'pwsh 터미널 닫기' }))
    expect(await screen.findByText('열린 터미널이 없습니다')).toBeInTheDocument()
    expect(screen.queryByTestId('xterm')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '새 터미널' })).not.toHaveAttribute('aria-disabled')
    // 빈 칸 안내는 status가 아니다 — 칸 안의 status는 끝남 줄 하나다(NFR-4)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('TerminalPane — 끝남과 다시 시작 (terminal-spec FR-7·8, terminal-tabs FR-16·17)', () => {
  it('보이는 탭의 셸이 끝나면 종료 코드와 다시 시작을 보이고, 다시 시작하면 화면을 비우고 새 셸에 붙는다', async () => {
    const { client, exit, lastGeneration } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    exit({ tabId: 't1', generation: lastGeneration(), exitCode: 3 })
    expect(screen.getByRole('status')).toHaveTextContent('셸이 끝났습니다 (종료 코드 3)')
    // 끝난 셸에는 끝낼 것이 없다 — 머리의 두 번 누르기 단추는 없고 끝남 줄의 단추 하나다
    expect(screen.getAllByRole('button', { name: '셸 다시 시작' })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: '셸 다시 시작' }))
    expect(client.terminal.restart).toHaveBeenCalledWith({ workspaceId: 'w1', tabId: 't1', cols: 100, rows: 30 })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(view.cleared).toBe(1)
    expect(tab('pwsh')).toHaveAttribute('title', 'C:\\pwsh\\pwsh.exe')
  })

  it('끝남 줄의 다시 시작을 두 번 눌러도 한 번만 보낸다 — 도는 동안 잠기고 거짓 오류가 서지 않는다', async () => {
    const { client, exit, lastGeneration } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    exit({ tabId: 't1', generation: lastGeneration(), exitCode: 0 })
    let finish!: () => void
    vi.mocked(client.terminal.restart).mockImplementationOnce(({ tabId }) => new Promise((resolve) => {
      finish = () => { resolve({ ...tabOf(tabId, 'pwsh'), generation: 99, snapshot: { text: '', end: 0 } }) }
    }))
    const button = screen.getByRole('button', { name: '셸 다시 시작' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(client.terminal.restart).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => { finish() })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('도는 셸의 다시 시작은 두 번 눌러야 한다 — 셸이 띄운 dev 서버까지 끝난다', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: '셸 다시 시작' }))
    expect(client.terminal.restart).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /정말 다시 시작/ }))
    expect(client.terminal.restart).toHaveBeenCalledTimes(1)
  })

  it('다시 시작한 셸의 이름이 바뀌면 탭 이름도 바뀐다 (FR-16)', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    vi.mocked(client.terminal.restart).mockResolvedValueOnce({
      ...tabOf('t1', 'cmd', { shellPath: 'C:\\Windows\\System32\\cmd.exe' }), generation: 50, snapshot: { text: '', end: 0 }
    })
    await userEvent.click(screen.getByRole('button', { name: '셸 다시 시작' }))
    await userEvent.click(screen.getByRole('button', { name: /정말 다시 시작/ }))
    expect(await screen.findByRole('tab', { name: 'cmd' })).toHaveAttribute('aria-selected', 'true')
  })

  it('다른 탭·옛 셸의 끝남은 보이는 탭의 끝남 줄을 세우지 않는다', async () => {
    const { exit } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    exit({ tabId: 't9', generation: 1, exitCode: 1 })
    exit({ tabId: 't1', generation: 0, exitCode: 1 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('이미 끝난 셸에 붙으면 끝남 줄이 바로 선다', async () => {
    setup({ tabs: [tabOf('t1', 'pwsh', { exited: { exitCode: 0 } })] })
    expect(await screen.findByRole('status')).toHaveTextContent('셸이 끝났습니다 (종료 코드 0)')
  })

  it('다시 시작이 실패하면 이유를 보이고 목록을 다시 읽는다 — 셸을 못 띄운 탭은 core에서 사라진다', async () => {
    const { client } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    vi.mocked(client.terminal.restart).mockRejectedValueOnce(new Error('셸을 띄우지 못했습니다: x'))
    await userEvent.click(screen.getByRole('button', { name: '셸 다시 시작' }))
    await userEvent.click(screen.getByRole('button', { name: /정말 다시 시작/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('셸을 띄우지 못했습니다: x')
    await waitFor(() => expect(client.terminal.open).toHaveBeenCalledTimes(2))
  })
})

describe('TerminalPane — 칸', () => {
  it('칸 안의 Esc는 밖(도크 최대화·열린 항목 닫기)으로 새지 않는다 (terminal-spec FR-16)', async () => {
    const { outer } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    fireEvent.keyDown(screen.getByTestId('xterm'), { key: 'Escape' })
    expect(outer).not.toHaveBeenCalled()
  })

  it('코드 칸 닫기는 칸만 닫는다 — 셸은 core에서 계속 돈다', async () => {
    const { client, onClose } = setup()
    await waitFor(() => expect(view.written).toEqual(['pwsh> ']))
    await userEvent.click(screen.getByRole('button', { name: '코드 칸 닫기' }))
    expect(onClose).toHaveBeenCalled()
    expect(client.terminal.restart).not.toHaveBeenCalled()
    expect(client.terminal.close).not.toHaveBeenCalled()
  })

  it('`대화에 붙이기`는 고른 글이 있을 때만 그 글을 넘기고 선택을 푼다', async () => {
    const { onSendSelection } = setup()
    const send = await screen.findByRole('button', { name: '선택 영역을 대화에 붙이기' })
    expect(send).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(send)
    expect(onSendSelection).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '글 고르기' }))
    expect(send).not.toHaveAttribute('aria-disabled')
    await userEvent.click(send)
    expect(onSendSelection).toHaveBeenCalledWith('FAIL a.test.ts')
    expect(view.selection).toBe('')
    expect(send).toHaveAttribute('aria-disabled', 'true')
  })
})
