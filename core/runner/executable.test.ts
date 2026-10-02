import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentCommand, executableCandidates, isBatchShim, unwrapNpmShim } from './executable'

const WIN = { platform: 'win32' as const }
const POSIX = { platform: 'linux' as const }

describe('executableCandidates — Windows', () => {
  it('PATHEXT의 확장자를 붙인 후보를 만든다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: 'C:\\bin', PATHEXT: '.EXE;.CMD' }
    })
    expect(out).toContain('C:\\bin\\claude.EXE')
    expect(out).toContain('C:\\bin\\claude.CMD')
  })

  it('확장자 없는 후보는 만들지 않는다 — access(X_OK)가 Windows에서 존재 여부만 보기 때문', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: 'C:\\bin', PATHEXT: '.EXE' }
    })
    expect(out).not.toContain('C:\\bin\\claude')
  })

  it('PATHEXT가 없으면 기본값을 쓴다', () => {
    const out = executableCandidates('claude', { ...WIN, env: { PATH: 'C:\\bin' } })
    expect(out).toContain('C:\\bin\\claude.EXE')
  })

  it('PATH를 세미콜론으로 쪼갠다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: 'C:\\a;C:\\b', PATHEXT: '.EXE' }
    })
    expect(out).toContain('C:\\a\\claude.EXE')
    expect(out).toContain('C:\\b\\claude.EXE')
  })

  it('USERPROFILE 아래 .local\\bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: '', PATHEXT: '.EXE', USERPROFILE: 'C:\\Users\\me' }
    })
    expect(out).toContain('C:\\Users\\me\\.local\\bin\\claude.EXE')
  })

  it('USERPROFILE 아래 .claude\\local을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', {
      ...WIN,
      env: { PATH: '', PATHEXT: '.EXE', USERPROFILE: 'C:\\Users\\me' }
    })
    expect(out).toContain('C:\\Users\\me\\.claude\\local\\claude.EXE')
  })
})

describe('executableCandidates — POSIX', () => {
  it('확장자를 붙이지 않는다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '/usr/bin' } })
    expect(out).toContain('/usr/bin/claude')
  })

  it('PATH를 콜론으로 쪼갠다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '/a:/b' } })
    expect(out).toContain('/a/claude')
    expect(out).toContain('/b/claude')
  })

  it('HOME 아래 .local/bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '', HOME: '/home/me' } })
    expect(out).toContain('/home/me/.local/bin/claude')
  })

  it('HOME 아래 .claude/local을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '', HOME: '/home/me' } })
    expect(out).toContain('/home/me/.claude/local/claude')
  })

  it('/opt/homebrew/bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '' } })
    expect(out).toContain('/opt/homebrew/bin/claude')
  })

  it('/usr/local/bin을 폴백으로 둔다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '' } })
    expect(out).toContain('/usr/local/bin/claude')
  })

  it('PATH 후보가 폴백보다 앞선다', () => {
    const out = executableCandidates('claude', {
      ...POSIX,
      env: { PATH: '/usr/bin', HOME: '/home/me' }
    })
    expect(out.indexOf('/usr/bin/claude')).toBeLessThan(out.indexOf('/home/me/.local/bin/claude'))
  })

  it('HOME이 없으면 홈 기반 폴백을 만들지 않는다', () => {
    const out = executableCandidates('claude', { ...POSIX, env: { PATH: '' } })
    expect(out.some((p) => p.includes('.local/bin'))).toBe(false)
  })
})

describe('isBatchShim', () => {
  it('.cmd를 배치 shim으로 본다', () => {
    expect(isBatchShim('C:\\bin\\claude.cmd')).toBe(true)
  })

  it('.bat를 배치 shim으로 본다', () => {
    expect(isBatchShim('C:\\bin\\claude.bat')).toBe(true)
  })

  it('대문자 확장자도 잡는다', () => {
    expect(isBatchShim('C:\\bin\\claude.CMD')).toBe(true)
  })

  it('.exe는 아니다', () => {
    expect(isBatchShim('C:\\bin\\claude.exe')).toBe(false)
  })

  it('확장자 없는 POSIX 경로는 아니다', () => {
    expect(isBatchShim('/usr/local/bin/claude')).toBe(false)
  })
})

describe('agentCommand', () => {
  it('런처가 없으면 실행 파일을 그대로 띄운다', () => {
    const out = agentCommand('C:\bin\claude.exe', ['--print'], {})
    expect(out).toEqual({ cmd: 'C:\bin\claude.exe', args: ['--print'] })
  })

  it('런처가 있으면 그것을 앞에 세우고 실행 파일을 첫 인자로 넘긴다', () => {
    const out = agentCommand('/tmp/fake-claude.mjs', ['--print', '--verbose'], {
      ONE_DESK_AGENT_LAUNCHER: '/usr/bin/node'
    })
    expect(out).toEqual({
      cmd: '/usr/bin/node',
      args: ['/tmp/fake-claude.mjs', '--print', '--verbose']
    })
  })

  it('빈 문자열은 런처로 치지 않는다', () => {
    const out = agentCommand('/usr/local/bin/claude', [], { ONE_DESK_AGENT_LAUNCHER: '' })
    expect(out.cmd).toBe('/usr/local/bin/claude')
  })

  it('원본 인자 배열을 건드리지 않는다', () => {
    const args = ['debug', 'config']
    agentCommand('/tmp/fake.mjs', args, { ONE_DESK_AGENT_LAUNCHER: '/usr/bin/node' })
    expect(args).toEqual(['debug', 'config'])
  })
})

/**
 * npm(cmd-shim)이 전역 설치 때 만드는 `.cmd`. `npm i -g opencode-ai`는 대상이 네이티브 `.exe`라
 * node 없이 그것을 부르고, JS 대상(claude의 npm 패키지)은 node로 `.js`를 부른다.
 */
const EXE_SHIM = [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
  '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*', ''
].join('\r\n')
const JS_SHIM = [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', ')',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*', ''
].join('\r\n')

describe('unwrapNpmShim', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  function setup(shim: string, withExe: boolean): string {
    dir = mkdtempSync(join(tmpdir(), 'od-shim-'))
    writeFileSync(join(dir, 'opencode.cmd'), shim)
    if (withExe) {
      mkdirSync(join(dir, 'node_modules', 'opencode-ai', 'bin'), { recursive: true })
      writeFileSync(join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'), '')
    }
    return join(dir, 'opencode.cmd')
  }

  it('node_modules 안의 .exe를 부르는 껍데기면 그 .exe의 절대 경로를 돌려준다', async () => {
    const shim = setup(EXE_SHIM, true)
    await expect(unwrapNpmShim(shim)).resolves.toBe(join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'))
  })

  it('가리키는 .exe가 없으면 null이다 — postinstall이 돌지 않은 설치', async () => {
    await expect(unwrapNpmShim(setup(EXE_SHIM, false))).resolves.toBeNull()
  })

  it('node로 .js를 부르는 껍데기는 풀지 않는다 — 곁의 node.exe를 실행 파일로 고르면 안 된다', async () => {
    await expect(unwrapNpmShim(setup(JS_SHIM, true))).resolves.toBeNull()
  })

  it('못 읽는 파일이면 null이다', async () => {
    await expect(unwrapNpmShim(join(tmpdir(), 'od-없는-파일.cmd'))).resolves.toBeNull()
  })
})
