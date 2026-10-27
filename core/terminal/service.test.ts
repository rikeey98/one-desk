import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TERMINAL_TABS_PER_REPO, type Repo, type TerminalData, type TerminalExit } from '@shared/models'
import { createTerminalService, FLUSH_MS, type PtyProcess, type SpawnPty } from './service'
import type { ShellChoice } from './shell'
import type { TreeKiller } from '../runner/terminate'
import type { GroupKiller } from '../wsl/kill'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  api: { id: 'api', workspaceId: 'w1', name: 'api', path: 'C:\\work\\api', description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0 },
  web: { id: 'web', workspaceId: 'w1', name: 'web', path: 'C:\\work\\web', description: null, sortOrder: 1, agentEnv: 'host', createdAt: 0 },
  wsl: { id: 'wsl', workspaceId: 'w1', name: 'wsl', path: '\\\\wsl$\\Ubuntu\\home\\me\\api', description: null, sortOrder: 2, agentEnv: 'wsl', createdAt: 0 }
}

const PWSH: ShellChoice = { file: 'C:\\pwsh\\pwsh.exe', args: [], name: 'pwsh' }
const CMD: ShellChoice = { file: 'C:\\Windows\\System32\\cmd.exe', args: [], name: 'cmd' }
const WSL_LOGIN: ShellChoice = { file: 'sh', args: ['-c', 'exec "${SHELL:-/bin/bash}" -l'], name: 'wsl · Ubuntu' }

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
  const killSession = vi.fn<GroupKiller>()
  const killSessionSync = vi.fn<GroupKiller>()
  const repoOf = vi.fn((workspaceId: string, repoId: string) => {
    const repo = repos[repoId]
    if (!repo || repo.workspaceId !== workspaceId) throw new Error('그 workspace의 repo가 아닙니다')
    return repo
  })
  /** 설정의 셸 — `default`가 풀리는 곳. 테스트가 바꿔 "설정을 바꿨다"를 흉내낸다 */
  const setting = { current: PWSH }
  // 키 해석의 진짜 규칙은 shell.test가 본다 — 여기서는 "서비스가 키와 repo를 넘기고 결과를 쓴다"만
  const resolveShell = vi.fn(async (key: string, repo: Repo): Promise<ShellChoice> => {
    if (repo.agentEnv === 'wsl') {
      if (key === 'default' || key === 'wsl') return WSL_LOGIN
    } else if (key === 'default') return setting.current
    else if (key === 'cmd') return CMD
    throw new Error(`이 repo에서 쓸 수 없는 셸입니다: ${key}`)
  })
  let ids = 0
  const service = createTerminalService({
    spawnPty,
    resolveShell,
    discover: async () => [{ key: 'pwsh', label: 'PowerShell 7', path: PWSH.file, isDefault: true }],
    newId: () => `tab-${++ids}`,
    repoOf,
    env: () => ({ PATH: 'C:\\bin', TERM: 'xterm-256color' }),
    killTree,
    killTreeSync,
    killSession,
    killSessionSync,
    platform,
    hostCwd: 'C:\\data',
    wslLauncher: async (_distro, tabId) => ({ path: '/mnt/c/app/launcher.sh', pidfile: `/mnt/c/data/wsl/term-${tabId}.pid`, pidfileHost: pidfileHost(tabId) }),
    onData: (d) => { data.push(d) },
    onExit: (e) => { exits.push(e) },
    onError: vi.fn()
  })
  return { service, spawnPty, ptys, data, exits, killTree, killTreeSync, killSession, killSessionSync, repoOf, resolveShell, setting }
}

/** WSL 셸의 pidfile(Windows 쪽) — 테스트가 세션 id를 미리 써 둔다 */
let pidDir = ''
const pidfileHost = (tabId: string) => join(pidDir, `term-${tabId}.pid`)

const open = (repoId = 'api') => ({ workspaceId: 'w1', repoId, cols: 80, rows: 24 })
const create = (shell: string, repoId = 'api') => ({ ...open(repoId), shell: shell as 'default' })
const tab = (tabId: string) => ({ workspaceId: 'w1', tabId })
const restart = (tabId: string) => ({ ...tab(tabId), cols: 80, rows: 24 })

/** 미뤄 둔 셸 해석 — 띄우는 중에 끼어드는 일을 순서대로 재현한다(진짜 타이머를 쓰지 않는다) */
function deferShell(resolveShell: ReturnType<typeof setup>['resolveShell'], choice: ShellChoice = PWSH) {
  let release!: () => void
  resolveShell.mockImplementationOnce(() => new Promise((r) => { release = () => r(choice) }))
  return () => release()
}

beforeEach(() => { vi.useFakeTimers(); pidDir = mkdtempSync(join(tmpdir(), 'one-desk-term-')) })
afterEach(() => { vi.useRealTimers(); rmSync(pidDir, { recursive: true, force: true }) })

describe('셸 서비스 — 열기 (docs/sdlc/terminal-tabs/spec.md FR-5·13, terminal-spec FR-5·6)', () => {
  it('repo에 탭이 없으면 기본 셸 탭 하나를 띄운다 — 작업 디렉토리는 그 repo, 크기와 환경을 넘긴다', async () => {
    const { service, spawnPty, resolveShell } = setup()
    const tabs = await service.open(open())
    expect(resolveShell).toHaveBeenCalledWith('default', repos['api'])
    expect(spawnPty).toHaveBeenCalledTimes(1)
    expect(spawnPty).toHaveBeenCalledWith('C:\\pwsh\\pwsh.exe', [], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: 'C:\\work\\api', env: { PATH: 'C:\\bin', TERM: 'xterm-256color' }
    })
    expect(tabs).toEqual([{ tabId: 'tab-1', repoId: 'api', label: 'pwsh', shellKey: 'default', shellPath: 'C:\\pwsh\\pwsh.exe', exited: null }])
  })

  it('다시 열면 같은 목록이고 띄우지 않는다, 동시에 두 번 열어도 하나다 — 다른 repo는 따로다', async () => {
    const { service, spawnPty } = setup()
    const [a, b] = await Promise.all([service.open(open()), service.open(open())])
    expect(spawnPty).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(await service.open(open())).toEqual(a)
    expect(spawnPty).toHaveBeenCalledTimes(1)
    await service.open(open('web'))
    expect(spawnPty).toHaveBeenCalledTimes(2)
  })

  it('남의 workspace repo는 열 수 없다 — repo는 core가 workspace와 함께 찾는다 (terminal-spec FR-18)', async () => {
    const { service, spawnPty, repoOf } = setup()
    await service.open(open())
    await expect(service.open({ ...open(), workspaceId: 'w2' })).rejects.toThrow('그 workspace의 repo가 아닙니다')
    expect(repoOf).toHaveBeenCalledWith('w2', 'api')
    await expect(service.create({ ...create('cmd'), workspaceId: 'w2' })).rejects.toThrow('그 workspace의 repo가 아닙니다')
    expect(spawnPty).toHaveBeenCalledTimes(1)
  })

  it('셸을 띄우지 못하면 이유를 말하고 아무것도 남기지 않는다', async () => {
    const { service, spawnPty } = setup()
    spawnPty.mockImplementationOnce(() => { throw new Error('File not found') })
    await expect(service.open(open())).rejects.toThrow('셸을 띄우지 못했습니다: C:\\pwsh\\pwsh.exe (File not found)')
    expect(await service.open(open())).toHaveLength(1)
    expect(spawnPty).toHaveBeenCalledTimes(2)
  })

  it('붙으면 그때까지의 출력을 스냅샷으로 준다', async () => {
    const { service, ptys } = setup()
    const [first] = await service.open(open())
    ptys[0]!.emit('PS> ')
    ptys[0]!.emit('echo hi\r\nhi\r\n')
    const session = await service.attach(tab(first!.tabId))
    expect(session).toMatchObject({ tabId: 'tab-1', label: 'pwsh', exited: null })
    expect(session.snapshot).toEqual({ text: 'PS> echo hi\r\nhi\r\n', end: 17 })
  })

  it('셸 목록은 그 workspace의 repo에서만 묻는다', async () => {
    const { service, repoOf } = setup()
    expect(await service.shells({ workspaceId: 'w1', repoId: 'api' })).toHaveLength(1)
    await expect(service.shells({ workspaceId: 'w2', repoId: 'api' })).rejects.toThrow('그 workspace의 repo가 아닙니다')
    expect(repoOf).toHaveBeenCalledWith('w2', 'api')
  })
})

describe('셸 서비스 — 탭 여럿 (FR-3·12·13·15)', () => {
  it('만들기는 같은 repo에 둘째 셸을 띄운다 — 둘은 따로 쓰고 출력·끝남이 탭 id로 갈린다', async () => {
    const { service, ptys, data, exits } = setup()
    const [first] = await service.open(open())
    const second = await service.create(create('cmd'))
    expect(second).toMatchObject({ tabId: 'tab-2', repoId: 'api', label: 'cmd', shellKey: 'cmd', shellPath: CMD.file })
    service.write(first!.tabId, 'a')
    service.write(second.tabId, 'b')
    expect(ptys[0]!.written).toEqual(['a'])
    expect(ptys[1]!.written).toEqual(['b'])

    ptys[0]!.emit('one')
    ptys[1]!.emit('two')
    vi.advanceTimersByTime(FLUSH_MS)
    expect(data.map((d) => [d.tabId, d.data])).toEqual([['tab-1', 'one'], ['tab-2', 'two']])
    ptys[1]!.exit(2)
    expect(exits).toEqual([{ tabId: 'tab-2', generation: second.generation, exitCode: 2 }])
    expect((await service.open(open())).map((t) => [t.tabId, t.exited])).toEqual([['tab-1', null], ['tab-2', { exitCode: 2 }]])
  })

  it('목록에 없는 키는 셸을 띄우기 전에 던진다 (FR-12)', async () => {
    const { service, spawnPty } = setup()
    await expect(service.create(create('git-bash'))).rejects.toThrow('이 repo에서 쓸 수 없는 셸입니다: git-bash')
    await expect(service.create(create('cmd', 'wsl'))).rejects.toThrow('이 repo에서 쓸 수 없는 셸입니다: cmd')
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('이름은 셸 이름 + 비어 있는 가장 작은 번호다', async () => {
    const { service } = setup()
    await service.open(open())
    const b = await service.create(create('default'))
    const c = await service.create(create('default'))
    expect([b.label, c.label]).toEqual(['pwsh 2', 'pwsh 3'])
    await service.close(tab(b.tabId))
    expect((await service.create(create('default'))).label).toBe('pwsh 2')
    expect((await service.create(create('default', 'web'))).label).toBe('pwsh')
  })

  it(`탭은 repo당 ${TERMINAL_TABS_PER_REPO}개까지다 — 끝난 탭도 센다`, async () => {
    const { service, ptys, spawnPty } = setup()
    await service.open(open())
    for (let i = 1; i < TERMINAL_TABS_PER_REPO; i++) await service.create(create('default'))
    ptys[0]!.exit(0)
    await expect(service.create(create('default'))).rejects.toThrow(`터미널은 repo당 ${TERMINAL_TABS_PER_REPO}개까지입니다`)
    expect(spawnPty).toHaveBeenCalledTimes(TERMINAL_TABS_PER_REPO)
    await service.create(create('default', 'web'))
  })

  it(`${TERMINAL_TABS_PER_REPO - 1}개에서 두 번 동시에 만들면 하나는 거부된다 — 띄우는 중인 탭도 센다`, async () => {
    const { service } = setup()
    await service.open(open())
    for (let i = 2; i < TERMINAL_TABS_PER_REPO; i++) await service.create(create('default'))
    const results = await Promise.allSettled([service.create(create('default')), service.create(create('default'))])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await service.open(open())).toHaveLength(TERMINAL_TABS_PER_REPO)
  })
})

describe('셸 서비스 — 출력 (terminal-spec FR-20)', () => {
  it(`출력은 ${FLUSH_MS}ms마다 모아 누적 시작 위치와 함께 낸다`, async () => {
    const { service, ptys, data } = setup()
    const session = await service.create(create('default'))
    ptys[0]!.emit('a')
    ptys[0]!.emit('b')
    expect(data).toEqual([])
    vi.advanceTimersByTime(FLUSH_MS)
    expect(data).toEqual([{ tabId: session.tabId, generation: session.generation, start: 0, data: 'ab' }])
    ptys[0]!.emit('c')
    vi.advanceTimersByTime(FLUSH_MS)
    expect(data[1]).toEqual({ tabId: session.tabId, generation: session.generation, start: 2, data: 'c' })
  })

  it('셸이 끝나면 모아 둔 출력을 먼저 내고 끝남을 알린다 — 탭은 남고 다시 붙으면 끝난 채다 (FR-17)', async () => {
    const { service, ptys, data, exits } = setup()
    const session = await service.create(create('default'))
    ptys[0]!.emit('bye')
    ptys[0]!.exit(3)
    expect(data).toEqual([{ tabId: session.tabId, generation: session.generation, start: 0, data: 'bye' }])
    expect(exits).toEqual([{ tabId: session.tabId, generation: session.generation, exitCode: 3 }])
    const again = await service.attach(tab(session.tabId))
    expect(again.exited).toEqual({ exitCode: 3 })
    expect(again.snapshot.text).toBe('bye')
  })
})

describe('셸 서비스 — 쓰기와 크기 (FR-14)', () => {
  it('키 입력과 크기를 그 탭의 셸에 넘긴다', async () => {
    const { service, ptys } = setup()
    const s = await service.create(create('default'))
    service.write(s.tabId, 'dir\r')
    service.resize(s.tabId, 120, 40)
    expect(ptys[0]!.written).toEqual(['dir\r'])
    expect(ptys[0]!.resized).toEqual([[120, 40]])
  })

  it('모르는 탭이나 끝난 셸에는 쓸 수 없다 — 크기는 조용히 무시한다', async () => {
    const { service, ptys } = setup()
    expect(() => service.write('tab-x', 'x')).toThrow('열린 터미널이 없습니다')
    const s = await service.create(create('default'))
    ptys[0]!.exit(0)
    expect(() => service.write(s.tabId, 'x')).toThrow('셸이 끝났습니다')
    expect(() => service.resize(s.tabId, 10, 10)).not.toThrow()
    expect(() => service.resize('tab-x', 10, 10)).not.toThrow()
    expect(ptys[0]!.resized).toEqual([])
  })

  it('남의 workspace로 붙거나 다시 시작하거나 닫을 수 없다 — 모르는 탭은 열린 터미널이 없다', async () => {
    const { service, spawnPty, killTree } = setup()
    const s = await service.create(create('default'))
    const foreign = { workspaceId: 'w2', tabId: s.tabId }
    await expect(service.attach(foreign)).rejects.toThrow('그 workspace의 repo가 아닙니다')
    await expect(service.restart({ ...foreign, cols: 80, rows: 24 })).rejects.toThrow('그 workspace의 repo가 아닙니다')
    await expect(service.close(foreign)).rejects.toThrow('그 workspace의 repo가 아닙니다')
    await expect(service.attach(tab('tab-x'))).rejects.toThrow('열린 터미널이 없습니다')
    expect(spawnPty).toHaveBeenCalledTimes(1)
    expect(killTree).not.toHaveBeenCalled()
  })
})

describe('셸 서비스 — 다시 시작 (FR-13·16, terminal-spec FR-8·14)', () => {
  it('다시 시작은 도는 셸을 트리째 끝내고 새로 띄운다 — 옛 셸의 늦은 출력·끝남은 버린다', async () => {
    const { service, ptys, data, exits, killTree, spawnPty } = setup()
    const first = await service.create(create('default'))
    ptys[0]!.emit('old')
    const next = await service.restart({ ...tab(first.tabId), cols: 90, rows: 30 })
    expect(killTree).toHaveBeenCalledWith(100, expect.any(Function))
    expect(spawnPty).toHaveBeenCalledTimes(2)
    expect(spawnPty.mock.calls[1]![2]).toMatchObject({ cols: 90, rows: 30 })
    expect(next.generation).toBeGreaterThan(first.generation)
    expect(next.snapshot).toEqual({ text: '', end: 0 })

    ptys[0]!.emit('late')
    ptys[0]!.exit(1)
    vi.advanceTimersByTime(FLUSH_MS)
    expect(data.filter((d) => d.generation === first.generation).map((d) => d.data).join('')).not.toContain('late')
    expect(exits).toEqual([])
  })

  it('다시 시작은 탭 id와 자리를 지킨다', async () => {
    const { service } = setup()
    const [a] = await service.open(open())
    const b = await service.create(create('cmd'))
    await service.create(create('default'))
    const restarted = await service.restart(restart(a!.tabId))
    expect(restarted.tabId).toBe(a!.tabId)
    expect((await service.open(open())).map((t) => t.tabId)).toEqual([a!.tabId, b.tabId, 'tab-3'])
  })

  it('cmd 탭을 다시 시작하면 cmd다 — default 탭은 지금 설정을 다시 읽고, 셸 이름이 바뀌면 이름을 새로 매긴다', async () => {
    const { service, spawnPty, setting } = setup()
    const [a] = await service.open(open())
    const b = await service.create(create('default'))
    const c = await service.create(create('cmd'))
    expect((await service.restart(restart(c.tabId))).label).toBe('cmd')
    expect(spawnPty.mock.calls[3]![0]).toBe(CMD.file)

    setting.current = CMD
    const relabeled = await service.restart(restart(b.tabId))
    expect(spawnPty.mock.calls[4]![0]).toBe(CMD.file)
    expect(relabeled).toMatchObject({ label: 'cmd 2', shellKey: 'default', shellPath: CMD.file })
    setting.current = PWSH
    expect((await service.restart(restart(a!.tabId))).label).toBe('pwsh')
  })

  it('끝난 셸을 다시 시작하면 끝낼 것 없이 새로 띄운다', async () => {
    const { service, ptys, killTree, spawnPty } = setup()
    const s = await service.create(create('default'))
    ptys[0]!.exit(0)
    const next = await service.restart(restart(s.tabId))
    expect(next.exited).toBeNull()
    expect(killTree).not.toHaveBeenCalled()
    expect(spawnPty).toHaveBeenCalledTimes(2)
  })

  it('다시 시작하는 사이 탭을 닫았으면 새 셸을 곧바로 끝내고 되살리지 않는다', async () => {
    const { service, resolveShell, ptys, killTree } = setup()
    const s = await service.create(create('default'))
    const release = deferShell(resolveShell)
    const pending = service.restart(restart(s.tabId))
    await vi.waitFor(() => expect(resolveShell).toHaveBeenCalledTimes(2))
    await service.close(tab(s.tabId))
    release()
    await expect(pending).rejects.toThrow('터미널을 여는 사이 그 탭이 닫혔습니다')
    expect(killTree.mock.calls.map((c) => c[0])).toContain(ptys[1]!.pid)
    const tabs = await service.open(open())
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.tabId).not.toBe(s.tabId)
  })
})

describe('셸 서비스 — 닫기와 끝내기 (FR-2·18~20)', () => {
  it('닫기는 그 셸만 트리째 끝내고 목록에서 뺀다', async () => {
    const { service, killTree } = setup()
    const [a] = await service.open(open())
    const b = await service.create(create('cmd'))
    await service.close(tab(b.tabId))
    expect(killTree.mock.calls.map((c) => c[0])).toEqual([101])
    expect((await service.open(open())).map((t) => t.tabId)).toEqual([a!.tabId])
    await expect(service.attach(tab(b.tabId))).rejects.toThrow('열린 터미널이 없습니다')
  })

  it('끝난 탭을 닫으면 신호를 보내지 않는다', async () => {
    const { service, ptys, killTree } = setup()
    const s = await service.create(create('default'))
    ptys[0]!.exit(0)
    await service.close(tab(s.tabId))
    expect(killTree).not.toHaveBeenCalled()
    expect(ptys[0]!.killed).toBe(0)
  })

  it('트리 종료가 실패하면 셸만이라도 끝낸다', async () => {
    const { service, ptys, killTree } = setup()
    killTree.mockImplementationOnce((_pid, onFail) => { onFail(new Error('taskkill 없음')) })
    await service.open(open())
    service.killRepo('api')
    expect(ptys[0]!.killed).toBe(1)
  })

  it('repo를 끝내면 그 repo의 탭 셋이 다 끝나고 다른 repo는 그대로다 — 다음 열기는 새 셸이다 (FR-19)', async () => {
    const { service, killTree, spawnPty } = setup()
    const [first] = await service.open(open())
    await service.create(create('cmd'))
    await service.create(create('default'))
    await service.open(open('web'))
    service.killRepo('api')
    expect(killTree.mock.calls.map((c) => c[0])).toEqual([100, 101, 102])
    expect(await service.open(open('web'))).toHaveLength(1)
    const next = await service.open(open())
    expect(spawnPty).toHaveBeenCalledTimes(5)
    expect(next).toHaveLength(1)
    expect(next[0]!.tabId).not.toBe(first!.tabId)
  })

  it('띄우는 중에 repo를 끝내면 돌아온 셸은 곧바로 끝나고 목록에 없다 (FR-19)', async () => {
    const { service, resolveShell, spawnPty, ptys, killTree } = setup()
    const release = deferShell(resolveShell)
    const pending = service.create(create('default'))
    await vi.waitFor(() => expect(resolveShell).toHaveBeenCalledTimes(1))
    service.killRepo('api')
    release()
    await expect(pending).rejects.toThrow('터미널을 여는 사이 repo의 셸이 끝났습니다')
    expect(spawnPty).toHaveBeenCalledTimes(1)
    expect(killTree.mock.calls.map((c) => c[0])).toEqual([ptys[0]!.pid])
    // 다시 열면 새 셸 하나 — 끝낸 셸은 목록에 들어가지 않았다
    expect(await service.open(open())).toHaveLength(1)
    expect(spawnPty).toHaveBeenCalledTimes(2)
  })

  it('앱 종료는 모든 탭을 **동기로** 트리째 끝낸다 — 비동기 taskkill은 메인 프로세스와 같이 죽는다 (FR-20)', async () => {
    const { service, killTree, killTreeSync } = setup()
    await service.open(open())
    await service.create(create('cmd'))
    await service.open(open('web'))
    service.killAll()
    expect(killTreeSync.mock.calls.map((c) => c[0])).toEqual([100, 101, 102])
    expect(killTree).not.toHaveBeenCalled()
  })

  it('띄우는 중에 앱을 끄면 돌아온 셸도 동기로 끝낸다', async () => {
    const { service, resolveShell, ptys, killTree, killTreeSync } = setup()
    const release = deferShell(resolveShell)
    const pending = service.create(create('default'))
    await vi.waitFor(() => expect(resolveShell).toHaveBeenCalledTimes(1))
    service.killAll()
    release()
    await expect(pending).rejects.toThrow('터미널을 여는 사이 repo의 셸이 끝났습니다')
    expect(killTreeSync.mock.calls.map((c) => c[0])).toEqual([ptys[0]!.pid])
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

describe('셸 서비스 — WSL repo (docs/sdlc/wsl-support/ FR-29~31, terminal-tabs FR-21)', () => {
  it('그 distro 안의 로그인 셸을 wsl.exe --cd <linux 경로>로 띄운다 — 이름은 wsl · <distro>다', async () => {
    const { service, spawnPty, resolveShell } = setup()
    const [session] = await service.open(open('wsl'))
    expect(resolveShell).toHaveBeenCalledWith('default', repos['wsl'])
    expect(session).toMatchObject({ label: 'wsl · Ubuntu', shellKey: 'default', shellPath: 'wsl.exe' })
    const [file, args, opts] = spawnPty.mock.calls[0]!
    expect(file).toBe('wsl.exe')
    expect(args).toEqual([
      '-d', 'Ubuntu', '--cd', '/home/me/api', '--exec',
      '/bin/sh', '/mnt/c/app/launcher.sh', `/mnt/c/data/wsl/term-${session!.tabId}.pid`,
      'sh', '-c', 'exec "${SHELL:-/bin/bash}" -l'
    ])
    // Windows 쪽 cwd는 UNC가 아니다 — wsl.exe 자신이 UNC에서 뜨려다 실패할 수 있다
    expect(opts.cwd).toBe('C:\\data')
  })

  it('WSL 탭 둘은 서로 다른 pidfile을 겨눈다 — 하나를 닫아도 다른 탭의 세션은 그대로다', async () => {
    const { service, spawnPty, killSession } = setup()
    const [a] = await service.open(open('wsl'))
    const b = await service.create(create('wsl', 'wsl'))
    expect(b.label).toBe('wsl · Ubuntu 2')
    expect(spawnPty.mock.calls[0]![1]).toContain(`/mnt/c/data/wsl/term-${a!.tabId}.pid`)
    expect(spawnPty.mock.calls[1]![1]).toContain(`/mnt/c/data/wsl/term-${b.tabId}.pid`)
    writeFileSync(pidfileHost(a!.tabId), '4242\n')
    writeFileSync(pidfileHost(b.tabId), '4343\n')
    await service.close(tab(b.tabId))
    expect(killSession.mock.calls.map((c) => c.slice(0, 3))).toEqual([['Ubuntu', 4343, 'KILL']])
    expect(existsSync(pidfileHost(a!.tabId))).toBe(true)
  })

  // 그룹이 아니라 세션이다 — 대화형 bash는 작업마다 그룹을 따로 만들어 그룹 KILL은 셸만 맞히고 `cmd &`가 남았다(§4-C 실측)
  it('끝낼 때는 pidfile의 세션을 안에서 먼저 KILL한다 — 다시 시작·닫기는 비동기, 앱 종료는 동기 (FR-30)', async () => {
    const { service, killSession, killSessionSync, ptys } = setup()
    const [s] = await service.open(open('wsl'))
    writeFileSync(pidfileHost(s!.tabId), '4242\n')
    await service.restart(restart(s!.tabId))
    expect(killSession).toHaveBeenCalledTimes(1)
    expect(killSession.mock.calls[0]!.slice(0, 3)).toEqual(['Ubuntu', 4242, 'KILL'])
    expect(ptys[0]!.killed).toBe(1)

    writeFileSync(pidfileHost(s!.tabId), '4343\n')
    service.killAll()
    expect(killSessionSync).toHaveBeenCalledTimes(1)
    expect(killSessionSync.mock.calls[0]!.slice(0, 3)).toEqual(['Ubuntu', 4343, 'KILL'])
    expect(ptys[1]!.killed).toBe(1)
  })

  it('pidfile이 없으면 pty만 끝낸다 — 런처가 쓰기 전', async () => {
    const { service, killSession, ptys } = setup()
    await service.open(open('wsl'))
    service.killRepo('wsl')
    expect(killSession).not.toHaveBeenCalled()
    expect(ptys[0]!.killed).toBe(1)
  })

  it('끝내면 pidfile을 지운다 — 다시 시작한 셸의 런처가 쓰기 전에 또 끝내도 옛 세션을 겨누지 않는다 (terminal-spec FR-19)', async () => {
    const { service, killSession } = setup()
    const [s] = await service.open(open('wsl'))
    writeFileSync(pidfileHost(s!.tabId), '4242\n')
    await service.restart(restart(s!.tabId))
    // 가짜 pty는 런처를 돌리지 않으므로 새 셸의 pidfile은 아직 없다
    await service.restart(restart(s!.tabId))
    expect(killSession).toHaveBeenCalledTimes(1)
    expect(existsSync(pidfileHost(s!.tabId))).toBe(false)
  })

  it('셸이 스스로 끝났어도 pidfile을 지운다 — 신호는 보내지 않는다', async () => {
    const { service, killSessionSync, ptys } = setup()
    const [s] = await service.open(open('wsl'))
    writeFileSync(pidfileHost(s!.tabId), '4242\n')
    ptys[0]!.exit(0)
    service.killAll()
    expect(killSessionSync).not.toHaveBeenCalled()
    expect(existsSync(pidfileHost(s!.tabId))).toBe(false)
  })
})
