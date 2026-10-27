import { describe, it, expect, vi } from 'vitest'
import {
  defaultShell, discoverShells, findGitBash, nextTabLabel, resolveShell, resolveShellKey, restartLabel, shellArgs, shellEnv, shellName,
  type ShellLookup
} from './shell'

/** Windows 장비를 흉내낸다 — PATH 탐색(`find`)과 고정 경로(`exists`)를 표로 준다 */
function winLookup(opts: { path?: Record<string, string>; files?: string[]; env?: NodeJS.ProcessEnv } = {}) {
  const files = new Set((opts.files ?? []).map((f) => f.toLowerCase()))
  const lookup: ShellLookup = {
    platform: 'win32',
    env: opts.env ?? {
      SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local'
    },
    find: vi.fn(async (name: string) => opts.path?.[name] ?? null),
    exists: vi.fn(async (p: string) => files.has(p.toLowerCase()))
  }
  return lookup
}

const WIN_PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const WIN_CMD = 'C:\\Windows\\System32\\cmd.exe'
const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

describe('Git Bash 찾기 (docs/sdlc/terminal-tabs/spec.md FR-10)', () => {
  it.each([
    ['Git for Windows의 기본 PATH(cmd)', 'C:\\Program Files\\Git\\cmd\\git.exe', GIT_BASH],
    ['bin', 'C:\\Program Files\\Git\\bin\\git.exe', GIT_BASH],
    ['mingw64\\bin', 'C:\\Program Files\\Git\\mingw64\\bin\\git.exe', GIT_BASH],
    ['scoop', 'C:\\Users\\me\\scoop\\apps\\git\\current\\cmd\\git.exe', 'C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe']
  ])('PATH의 git(%s)에서 Git 루트를 거슬러 올라간다', async (_label, git, bash) => {
    // 고정 자리를 비운 env — 루트 거슬러 오르기만 답할 수 있게
    expect(await findGitBash(winLookup({ path: { git }, files: [bash], env: { SystemRoot: 'C:\\Windows' } }))).toBe(bash)
  })

  it.each([
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'
  ])('git이 PATH에 없어도 고정 설치 자리 %s를 본다', async (bash) => {
    expect(await findGitBash(winLookup({ files: [bash] }))).toBe(bash)
  })

  it('PATH의 bash는 보지 않는다 — System32의 bash.exe(WSL 껍데기)만 있는 장비에는 Git Bash가 없다', async () => {
    const lookup = winLookup({ path: { bash: 'C:\\Windows\\System32\\bash.exe' }, files: ['C:\\Windows\\System32\\bash.exe'] })
    expect(await findGitBash(lookup)).toBeNull()
    expect(lookup.find).not.toHaveBeenCalledWith('bash')
  })

  it('SystemRoot 아래·WindowsApps 아래의 bash.exe는 Git Bash가 아니다 — 둘 다 WSL의 껍데기다', async () => {
    const sys = 'C:\\Windows\\System32\\bin\\bash.exe'
    expect(await findGitBash(winLookup({ path: { git: 'C:\\Windows\\System32\\cmd\\git.exe' }, files: [sys] }))).toBeNull()
    const apps = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bin\\bash.exe'
    expect(await findGitBash(winLookup({
      path: { git: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\cmd\\git.exe' }, files: [apps]
    }))).toBeNull()
  })

  it('있지 않은 자리는 고르지 않는다', async () => {
    expect(await findGitBash(winLookup({ path: { git: 'C:\\Program Files\\Git\\cmd\\git.exe' } }))).toBeNull()
  })
})

describe('셸 선택지 (FR-8·9)', () => {
  it('Windows host: PowerShell 7 · Windows PowerShell · 명령 프롬프트 · Git Bash 순이고, 있는 것만이다', async () => {
    const lookup = winLookup({ path: { pwsh: PWSH, git: 'C:\\Program Files\\Git\\cmd\\git.exe' }, files: [WIN_PS, WIN_CMD, GIT_BASH] })
    expect(await discoverShells({ kind: 'host' }, lookup, PWSH)).toEqual([
      { key: 'pwsh', label: 'PowerShell 7', path: PWSH, isDefault: true },
      { key: 'powershell', label: 'Windows PowerShell', path: WIN_PS, isDefault: false },
      { key: 'cmd', label: '명령 프롬프트', path: WIN_CMD, isDefault: false },
      { key: 'git-bash', label: 'Git Bash', path: GIT_BASH, isDefault: false }
    ])
  })

  it('pwsh·Git Bash가 없는 장비에서는 줄이 없다 — 고정 경로도 있을 때만 오른다', async () => {
    expect((await discoverShells({ kind: 'host' }, winLookup({ files: [WIN_CMD] }), WIN_PS)).map((o) => o.key)).toEqual(['cmd'])
  })

  it('SystemRoot를 따른다 — 없으면 C:\\Windows다', async () => {
    const d = winLookup({ env: { SystemRoot: 'D:\\WIN' }, files: ['D:\\WIN\\System32\\cmd.exe'] })
    expect((await discoverShells({ kind: 'host' }, d, '')).map((o) => o.path)).toEqual(['D:\\WIN\\System32\\cmd.exe'])
    const none = winLookup({ env: {}, files: [WIN_CMD] })
    expect((await discoverShells({ kind: 'host' }, none, '')).map((o) => o.path)).toEqual([WIN_CMD])
  })

  it('cmd는 ComSpec을 따르지 않는다 — 사용자가 바꿀 수 있는 값이라 "cmd"가 다른 것을 띄울 수 있다', async () => {
    const lookup = winLookup({
      env: { SystemRoot: 'C:\\Windows', ComSpec: 'C:\\tools\\evil.exe' }, files: [WIN_CMD, 'C:\\tools\\evil.exe']
    })
    expect((await discoverShells({ kind: 'host' }, lookup, '')).find((o) => o.key === 'cmd')?.path).toBe(WIN_CMD)
  })

  it('`기본` 표식은 설정이 풀린 셸을 따른다 — 첫 줄이 아니다, 경로는 대소문자를 가리지 않는다', async () => {
    const lookup = winLookup({ path: { pwsh: PWSH }, files: [WIN_PS, WIN_CMD] })
    const options = await discoverShells({ kind: 'host' }, lookup, 'c:\\windows\\system32\\CMD.EXE')
    expect(options.filter((o) => o.isDefault).map((o) => o.key)).toEqual(['cmd'])
  })

  it('macOS·Linux는 $SHELL 하나다', async () => {
    const lookup: ShellLookup = { platform: 'linux', env: { SHELL: '/bin/zsh' }, find: async () => null, exists: async () => true }
    expect(await discoverShells({ kind: 'host' }, lookup, '/bin/zsh')).toEqual([
      { key: 'login', label: 'zsh', path: '/bin/zsh', isDefault: true }
    ])
    expect((await discoverShells({ kind: 'host' }, { ...lookup, env: {} }, '/bin/bash'))[0]).toMatchObject({ label: 'bash', path: '/bin/bash' })
  })

  it('WSL repo는 그 distro의 셸 하나다 — 설정의 셸과 Windows 셸은 없다', async () => {
    const lookup = winLookup({ path: { pwsh: PWSH }, files: [WIN_PS, WIN_CMD] })
    expect(await discoverShells({ kind: 'wsl', distro: 'Ubuntu' }, lookup, PWSH)).toEqual([
      { key: 'wsl', label: 'WSL · Ubuntu', path: 'wsl.exe -d Ubuntu', isDefault: true }
    ])
  })
})

describe('resolveShellKey (FR-11·12)', () => {
  const lookup = () => winLookup({ path: { pwsh: PWSH }, files: [WIN_PS, WIN_CMD] })

  it('default는 설정의 셸이고, 없으면 기본값이다', async () => {
    expect(await resolveShellKey('default', { kind: 'host' }, lookup(), 'C:\\tools\\nu.exe')).toEqual({ file: 'C:\\tools\\nu.exe', args: [], name: 'nu' })
    expect(await resolveShellKey('default', { kind: 'host' }, lookup(), null)).toEqual({ file: PWSH, args: [], name: 'pwsh' })
  })

  it('목록의 키는 그 셸이다 — cmd는 인자가 없다', async () => {
    expect(await resolveShellKey('cmd', { kind: 'host' }, lookup(), null)).toEqual({ file: WIN_CMD, args: [], name: 'cmd' })
    const gb = winLookup({ path: { git: 'C:\\Program Files\\Git\\cmd\\git.exe' }, files: [GIT_BASH] })
    expect(await resolveShellKey('git-bash', { kind: 'host' }, gb, null)).toEqual({ file: GIT_BASH, args: ['--login', '-i'], name: 'bash' })
  })

  it('WSL repo의 default·wsl은 그 distro의 로그인 셸 명령이다 — 감싸기는 서비스가 한다', async () => {
    const wsl = { kind: 'wsl', distro: 'Ubuntu' } as const
    const expected = { file: 'sh', args: ['-c', 'exec "${SHELL:-/bin/bash}" -l'], name: 'wsl · Ubuntu' }
    expect(await resolveShellKey('default', wsl, lookup(), 'C:\\tools\\nu.exe')).toEqual(expected)
    expect(await resolveShellKey('wsl', wsl, lookup(), null)).toEqual(expected)
  })

  it.each([
    ['WSL repo의 cmd', 'cmd', { kind: 'wsl', distro: 'Ubuntu' }],
    ['없는 git-bash', 'git-bash', { kind: 'host' }],
    ['Windows의 login', 'login', { kind: 'host' }],
    ['host의 wsl', 'wsl', { kind: 'host' }],
    ['키가 아닌 경로', 'C:\\Windows\\System32\\cmd.exe', { kind: 'host' }]
  ] as const)('%s는 셸을 띄우기 전에 던진다', async (_label, key, env) => {
    await expect(resolveShellKey(key as string, env, lookup(), null)).rejects.toThrow(`이 repo에서 쓸 수 없는 셸입니다: ${key}`)
  })

  it('posix의 cmd도 던진다', async () => {
    const posixLookup: ShellLookup = { platform: 'darwin', env: { SHELL: '/bin/zsh' }, find: async () => null, exists: async () => true }
    await expect(resolveShellKey('cmd', { kind: 'host' }, posixLookup, null)).rejects.toThrow('이 repo에서 쓸 수 없는 셸입니다: cmd')
    expect(await resolveShellKey('login', { kind: 'host' }, posixLookup, null)).toEqual({ file: '/bin/zsh', args: ['-l'], name: 'zsh' })
  })
})

describe('탭 이름 (FR-15·16)', () => {
  it('비어 있으면 그대로, 아니면 비어 있는 가장 작은 번호다', () => {
    expect(nextTabLabel('pwsh', [])).toBe('pwsh')
    expect(nextTabLabel('pwsh', ['pwsh'])).toBe('pwsh 2')
    expect(nextTabLabel('pwsh', ['pwsh', 'pwsh 2', 'cmd'])).toBe('pwsh 3')
    expect(nextTabLabel('pwsh', ['pwsh', 'pwsh 3'])).toBe('pwsh 2')
    expect(nextTabLabel('pwsh', ['pwsh 2'])).toBe('pwsh')
  })

  it('다시 시작한 셸의 이름이 같으면 이름을 지키고, 다르면 새로 매긴다', () => {
    expect(restartLabel({ base: 'pwsh', label: 'pwsh 2' }, 'pwsh', ['pwsh'])).toBe('pwsh 2')
    expect(restartLabel({ base: 'pwsh', label: 'pwsh 2' }, 'cmd', ['pwsh', 'cmd'])).toBe('cmd 2')
  })
})

describe('기본 셸 (docs/sdlc/code-editor/terminal-spec.md FR-12)', () => {
  it('Windows는 PATH의 pwsh(PowerShell 7)가 먼저다', async () => {
    const find = vi.fn(async (name: string) => (name === 'pwsh' ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' : null))
    expect(await defaultShell({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, find }))
      .toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
  })

  it('Windows에 pwsh가 없으면 시스템의 Windows PowerShell이다', async () => {
    const find = vi.fn(async () => null)
    expect(await defaultShell({ platform: 'win32', env: { SystemRoot: 'D:\\WIN' }, find }))
      .toBe('D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    // SystemRoot가 없으면 C:\Windows로 본다
    expect(await defaultShell({ platform: 'win32', env: {}, find }))
      .toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })

  it('macOS·Linux는 $SHELL, 없으면 /bin/bash다 — PATH를 훑지 않는다', async () => {
    const find = vi.fn(async () => '/never')
    expect(await defaultShell({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, find })).toBe('/bin/zsh')
    expect(await defaultShell({ platform: 'linux', env: {}, find })).toBe('/bin/bash')
    expect(find).not.toHaveBeenCalled()
  })
})

describe('셸 인자와 이름 (FR-13)', () => {
  it('bash·sh는 로그인 셸이다 — Windows(Git Bash)는 --login -i, posix는 -l', () => {
    expect(shellArgs('C:\\Program Files\\Git\\bin\\bash.exe', 'win32')).toEqual(['--login', '-i'])
    expect(shellArgs('C:\\Program Files\\Git\\usr\\bin\\SH.EXE', 'win32')).toEqual(['--login', '-i'])
    expect(shellArgs('/bin/bash', 'linux')).toEqual(['-l'])
    expect(shellArgs('/usr/local/bin/fish', 'darwin')).toEqual(['-l'])
    expect(shellArgs('/bin/zsh', 'darwin')).toEqual(['-l'])
  })

  it('PowerShell·cmd에는 인자가 없다', () => {
    expect(shellArgs('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32')).toEqual([])
    expect(shellArgs('C:\\Windows\\System32\\cmd.exe', 'win32')).toEqual([])
  })

  it('이름은 경로의 끝 조각에서 .exe를 뗀 것이다 — 플랫폼의 구분자로 자른다', () => {
    expect(shellName('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32')).toBe('pwsh')
    expect(shellName('/bin/zsh', 'darwin')).toBe('zsh')
  })
})

describe('resolveShell (FR-11·12)', () => {
  const opts = { platform: 'win32' as const, env: { SystemRoot: 'C:\\Windows' }, find: async () => null }

  it('설정한 경로가 있으면 그것이고, 없으면 기본값이다', async () => {
    expect(await resolveShell('C:\\Program Files\\Git\\bin\\bash.exe', opts)).toEqual({
      file: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], name: 'bash'
    })
    expect(await resolveShell(null, opts)).toEqual({
      file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: [], name: 'powershell'
    })
  })
})

describe('셸 환경 (FR-19)', () => {
  it('앱 내부 변수(ONE_DESK_*·ELECTRON_*)를 빼고 TERM을 더한다 — 나머지는 그대로다', () => {
    const env = shellEnv({
      PATH: 'C:\\bin', ONE_DESK_AGENT_PATH: 'x', one_desk_user_data: 'y', ELECTRON_RUN_AS_NODE: '1',
      Electron_Enable_Logging: '1', HOME: '/home/me', EMPTY: undefined
    })
    expect(env).toEqual({ PATH: 'C:\\bin', HOME: '/home/me', TERM: 'xterm-256color' })
  })
})
