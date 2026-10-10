import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Repo, TerminalData, TerminalExit } from '@shared/models'
import { createTerminalService, FLUSH_MS, type PtyProcess, type SpawnPty } from './service'
import type { TreeKiller } from '../runner/terminate'

interface FakePty extends PtyProcess {
  written: string[]
  resized: Array<[number, number]>
  killed: number
  emit(data: string): void
  exit(code: number): void
}

function fakePty(pid: number): FakePty {
  const dataCbs: Array<(d: string) => void> = []
  const exitCbs: Array<(e: { exitCode: number }) => void> = []
  return {
    pid, written: [], resized: [], killed: 0,
    onData(cb) { dataCbs.push(cb); return { dispose() {} } },
    onExit(cb) { exitCbs.push(cb); return { dispose() {} } },
    write(d) { this.written.push(d) },
    resize(c, r) { this.resized.push([c, r]) },
    kill() { this.killed++ },
    emit(d) { for (const cb of dataCbs) cb(d) },
    exit(code) { for (const cb of exitCbs) cb({ exitCode: code }) }
  }
}

const repos: Record<string, Repo> = {
  api: { id: 'api', workspaceId: 'w1', name: 'api', path: 'C:\\work\\api', description: null, sortOrder: 0, createdAt: 0 },
  web: { id: 'web', workspaceId: 'w1', name: 'web', path: 'C:\\work\\web', description: null, sortOrder: 1, createdAt: 0 }
}

function setup(platform: NodeJS.Platform = 'win32') {
  const ptys: FakePty[] = []
  const spawnPty = vi.fn<SpawnPty>(() => {
    const p = fakePty(100 + ptys.length)
    ptys.push(p)
    return p
  })
  const data: TerminalData[] = []
  const exits: TerminalExit[] = []
  const killTree = vi.fn<TreeKiller>()
  const killTreeSync = vi.fn<TreeKiller>()
  const repoOf = vi.fn((workspaceId: string, repoId: string) => {
    const repo = repos[repoId]
    if (!repo || repo.workspaceId !== workspaceId) throw new Error('그 workspace의 repo가 아닙니다')
    return repo
  })
  const service = createTerminalService({
    spawnPty,
    resolveShell: async () => ({ file: 'C:\\pwsh\\pwsh.exe', args: [], name: 'pwsh' }),
    repoOf,
    env: () => ({ PATH: 'C:\\bin', TERM: 'xterm-256color' }),
    killTree,
    killTreeSync,
    platform,
    onData: (d) => { data.push(d) },
    onExit: (e) => { exits.push(e) },
    onError: vi.fn()
  })
  return { service, spawnPty, ptys, data, exits, killTree, killTreeSync, repoOf }
}

const open = (repoId = 'api') => ({ workspaceId: 'w1', repoId, cols: 80, rows: 24 })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('셸 서비스 — 수명 (docs/sdlc/code-editor/terminal-spec.md FR-5·6)', () => {
  it('repo의 셸을 처음 열 때 띄운다 — 작업 디렉토리는 그 repo, 크기와 환경을 넘긴다', async () => {
    const { service, spawnPty } = setup()
    const session = await service.open(open())
    expect(spawnPty).toHaveBeenCalledTimes(1)
    expect(spawnPty).toHaveBeenCalledWith('C:\\pwsh\\pwsh.exe', [], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: 'C:\\work\\api', env: { PATH: 'C:\\bin', TERM: 'xterm-256color' }
    })
    expect(session).toMatchObject({ repoId: 'api', shell: 'pwsh', shellPath: 'C:\\pwsh\\pwsh.exe', exited: null })
    expect(session.snapshot).toEqual({ text: '', end: 0 })
  })

  it('repo당 하나다 — 다시 열면 같은 셸이고, 다른 repo는 따로다', async () => {
    const { service, spawnPty } = setup()
    const first = await service.open(open())
    const again = await service.open(open())
    expect(spawnPty).toHaveBeenCalledTimes(1)
    expect(again.generation).toBe(first.generation)
    await service.open(open('web'))
    expect(spawnPty).toHaveBeenCalledTimes(2)
  })

  it('동시에 두 번 열어도 셸은 하나다', async () => {
    const { service, spawnPty } = setup()
    const [a, b] = await Promise.all([service.open(open()), service.open(open())])
    expect(spawnPty).toHaveBeenCalledTimes(1)
    expect(a.generation).toBe(b.generation)
  })

  it('남의 workspace repo는 열 수 없다 — repo는 core가 workspace와 함께 찾는다 (FR-18)', async () => {
    const { service, spawnPty, repoOf } = setup()
    await expect(service.open({ ...open(), workspaceId: 'w2' })).rejects.toThrow('그 workspace의 repo가 아닙니다')
    expect(repoOf).toHaveBeenCalledWith('w2', 'api')
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('셸을 띄우지 못하면 이유를 말하고 아무것도 남기지 않는다', async () => {
    const { service, spawnPty } = setup()
    spawnPty.mockImplementationOnce(() => { throw new Error('File not found') })
    await expect(service.open(open())).rejects.toThrow('셸을 띄우지 못했습니다: C:\\pwsh\\pwsh.exe (File not found)')
    await service.open(open())
    expect(spawnPty).toHaveBeenCalledTimes(2)
  })

  it('다시 붙으면 그때까지의 출력을 스냅샷으로 준다', async () => {
    const { service, ptys } = setup()
    await service.open(open())
    ptys[0]!.emit('PS> ')
    ptys[0]!.emit('echo hi\r\nhi\r\n')
    const again = await service.open(open())
    expect(again.snapshot).toEqual({ text: 'PS> echo hi\r\nhi\r\n', end: 17 })
  })
})

describe('셸 서비스 — 출력 (FR-20)', () => {
  it(`출력은 ${FLUSH_MS}ms마다 모아 누적 시작 위치와 함께 낸다`, async () => {
    const { service, ptys, data } = setup()
    const session = await service.open(open())
    ptys[0]!.emit('a')
    ptys[0]!.emit('b')
    expect(data).toEqual([])
    vi.advanceTimersByTime(FLUSH_MS)
    expect(data).toEqual([{ repoId: 'api', generation: session.generation, start: 0, data: 'ab' }])
    ptys[0]!.emit('c')
    vi.advanceTimersByTime(FLUSH_MS)
    expect(data[1]).toEqual({ repoId: 'api', generation: session.generation, start: 2, data: 'c' })
  })

  it('셸이 끝나면 모아 둔 출력을 먼저 내고 끝남을 알린다 — 다시 붙으면 끝난 채다 (FR-7)', async () => {
    const { service, ptys, data, exits } = setup()
    const session = await service.open(open())
    ptys[0]!.emit('bye')
    ptys[0]!.exit(3)
    expect(data).toEqual([{ repoId: 'api', generation: session.generation, start: 0, data: 'bye' }])
    expect(exits).toEqual([{ repoId: 'api', generation: session.generation, exitCode: 3 }])
    const again = await service.open(open())
    expect(again.exited).toEqual({ exitCode: 3 })
    expect(again.snapshot.text).toBe('bye')
  })
})

describe('셸 서비스 — 쓰기와 크기 (FR-18)', () => {
  it('키 입력과 크기를 그 repo의 셸에 넘긴다', async () => {
    const { service, ptys } = setup()
    await service.open(open())
    service.write('api', 'dir\r')
    service.resize('api', 120, 40)
    expect(ptys[0]!.written).toEqual(['dir\r'])
    expect(ptys[0]!.resized).toEqual([[120, 40]])
  })

  it('띄운 적 없는 셸이나 끝난 셸에는 쓸 수 없다 — 크기는 조용히 무시한다', async () => {
    const { service, ptys } = setup()
    expect(() => service.write('api', 'x')).toThrow('열린 셸이 없습니다')
    await service.open(open())
    ptys[0]!.exit(0)
    expect(() => service.write('api', 'x')).toThrow('셸이 끝났습니다')
    expect(() => service.resize('api', 10, 10)).not.toThrow()
    expect(ptys[0]!.resized).toEqual([])
  })
})

describe('셸 서비스 — 다시 시작과 끝내기 (FR-8~10)', () => {
  it('다시 시작은 도는 셸을 트리째 끝내고 새로 띄운다 — 옛 셸의 늦은 출력·끝남은 버린다', async () => {
    const { service, ptys, data, exits, killTree, spawnPty } = setup()
    const first = await service.open(open())
    ptys[0]!.emit('old')
    const next = await service.restart({ workspaceId: 'w1', repoId: 'api', cols: 90, rows: 30 })
    expect(killTree).toHaveBeenCalledWith(100, expect.any(Function))
    expect(spawnPty).toHaveBeenCalledTimes(2)
    expect(next.generation).toBeGreaterThan(first.generation)
    expect(next.snapshot).toEqual({ text: '', end: 0 })

    ptys[0]!.emit('late')
    ptys[0]!.exit(1)
    vi.advanceTimersByTime(FLUSH_MS)
    expect(data.filter((d) => d.generation === first.generation).map((d) => d.data).join('')).not.toContain('late')
    expect(exits).toEqual([])
  })

  it('끝난 셸을 다시 시작하면 끝낼 것 없이 새로 띄운다', async () => {
    const { service, ptys, killTree, spawnPty } = setup()
    await service.open(open())
    ptys[0]!.exit(0)
    await service.restart({ workspaceId: 'w1', repoId: 'api', cols: 80, rows: 24 })
    expect(killTree).not.toHaveBeenCalled()
    expect(spawnPty).toHaveBeenCalledTimes(2)
  })

  it('트리 종료가 실패하면 셸만이라도 끝낸다', async () => {
    const { service, ptys, killTree } = setup()
    killTree.mockImplementationOnce((_pid, onFail) => { onFail(new Error('taskkill 없음')) })
    await service.open(open())
    service.killRepo('api')
    expect(ptys[0]!.killed).toBe(1)
  })

  it('repo의 셸을 끝내면 다음 열기는 새 셸이다 (FR-10)', async () => {
    const { service, killTree, spawnPty } = setup()
    const first = await service.open(open())
    service.killRepo('api')
    expect(killTree).toHaveBeenCalledWith(100, expect.any(Function))
    const next = await service.open(open())
    expect(spawnPty).toHaveBeenCalledTimes(2)
    expect(next.generation).not.toBe(first.generation)
  })

  it('앱 종료는 모든 셸을 **동기로** 트리째 끝낸다 — 비동기 taskkill은 메인 프로세스와 같이 죽는다 (FR-9)', async () => {
    const { service, killTree, killTreeSync } = setup()
    await service.open(open())
    await service.open(open('web'))
    service.killAll()
    expect(killTreeSync.mock.calls.map((c) => c[0])).toEqual([100, 101])
    expect(killTree).not.toHaveBeenCalled()
  })

  it('macOS·Linux는 taskkill이 없다 — pty의 kill로 끝낸다(셸이 죽으면 그 세션이 SIGHUP을 받는다)', async () => {
    const { service, ptys, killTree, killTreeSync } = setup('darwin')
    await service.open(open())
    service.killRepo('api')
    await service.open(open('web'))
    service.killAll()
    expect(ptys.map((p) => p.killed)).toEqual([1, 1])
    expect(killTree).not.toHaveBeenCalled()
    expect(killTreeSync).not.toHaveBeenCalled()
  })
})
