import { describe, it, expect, vi } from 'vitest'
import { defaultShell, resolveShell, shellArgs, shellEnv, shellName } from './shell'

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
