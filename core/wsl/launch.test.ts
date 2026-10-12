import { describe, it, expect } from 'vitest'
import { wrapForEnv, WSL_EXE_ENV } from './launch'
import { HOST_ENV, type ProcessEnvSpec } from './env'

/**
 * spawn 직전의 마지막 변환 (`docs/sdlc/wsl-support/` spec FR-8·FR-33).
 *
 * 인자는 **배열 원소 그대로** 간다 — 셸 문자열에 끼워 넣지 않는다. 프롬프트·경로에 `"`·`$`·`;`가 있어도
 * 뜻이 바뀌지 않아야 한다.
 */
const WSL: ProcessEnvSpec = { kind: 'wsl', distro: 'Ubuntu' }
const REPO = '\\\\wsl$\\Ubuntu\\home\\me\\내 프로젝트'

describe('wrapForEnv — host', () => {
  it('그대로 돌려준다 — cwd도 그대로, 런처 옵션은 무시한다', () => {
    const out = wrapForEnv(HOST_ENV, 'C:\\bin\\claude.exe', ['-p', 'x'], {
      cwd: 'C:\\work\\api', launcher: { path: '/mnt/c/l.sh', pidfile: '/mnt/c/p.pid' }
    }, {})
    expect(out).toEqual({ cmd: 'C:\\bin\\claude.exe', args: ['-p', 'x'], cwd: 'C:\\work\\api' })
  })

  it('원본 인자 배열을 건드리지 않는다', () => {
    const args = ['a']
    const out = wrapForEnv(HOST_ENV, 'x', args, {}, {})
    out.args.push('b')
    expect(args).toEqual(['a'])
  })
})

describe('wrapForEnv — wsl', () => {
  it('wsl.exe -d <distro> --cd <linux cwd> -- <cmd> <args…>이고 Windows 쪽 cwd는 없다', () => {
    const out = wrapForEnv(WSL, '/home/me/.local/bin/claude', ['-p', 'hello "world" $HOME; rm'], { cwd: REPO }, {})
    expect(out).toEqual({
      cmd: 'wsl.exe',
      args: ['-d', 'Ubuntu', '--cd', '/home/me/내 프로젝트', '--', '/home/me/.local/bin/claude', '-p', 'hello "world" $HOME; rm'],
      cwd: undefined
    })
  })

  it('런처가 있으면 /bin/sh <launcher> <pidfile>이 명령 앞에 선다 (FR-10)', () => {
    const out = wrapForEnv(WSL, 'claude', ['--version'], {
      cwd: REPO, launcher: { path: '/mnt/c/app/launcher.sh', pidfile: '/mnt/c/data/wsl/r1.pid' }
    }, {})
    expect(out.args).toEqual([
      '-d', 'Ubuntu', '--cd', '/home/me/내 프로젝트', '--',
      '/bin/sh', '/mnt/c/app/launcher.sh', '/mnt/c/data/wsl/r1.pid', 'claude', '--version'
    ])
  })

  it('cwd가 없으면 --cd가 없다 — wslpath·distro 홈 조회 같은 질의', () => {
    const out = wrapForEnv(WSL, 'wslpath', ['-a', '-u', 'C:\\x'], {}, {})
    expect(out.args).toEqual(['-d', 'Ubuntu', '--', 'wslpath', '-a', '-u', 'C:\\x'])
  })

  it('cwd가 WSL UNC가 아니면 던진다 — Windows 경로를 --cd에 넘기면 wsl.exe가 알아서 옮기지만, 그것은 호출자가 모르고 보낸 것이다', () => {
    expect(() => wrapForEnv(WSL, 'git', [], { cwd: 'C:\\work\\api' }, {})).toThrow('WSL 안의 경로가 아닙니다')
  })

  it('cwd의 distro가 env의 distro와 다르면 던진다 — 두 distro가 섞이면 어느 쪽 파일인지 모른다', () => {
    expect(() => wrapForEnv(WSL, 'git', [], { cwd: '\\\\wsl$\\Debian\\home\\me' }, {})).toThrow('배포판')
  })

  it(`${WSL_EXE_ENV}가 있으면 그것이 wsl.exe 자리에 선다 — e2e의 가짜 wsl.exe 통로`, () => {
    const out = wrapForEnv(WSL, 'claude', [], {}, { [WSL_EXE_ENV]: '/tmp/fake-wsl.mjs' })
    expect(out.cmd).toBe('/tmp/fake-wsl.mjs')
  })

  it('ONE_DESK_AGENT_LAUNCHER는 안쪽 명령에 붙지 않는다 — 진짜 wsl.exe 앞에도', () => {
    const out = wrapForEnv(WSL, 'claude', [], {}, { ONE_DESK_AGENT_LAUNCHER: '/usr/bin/node' })
    expect(out.cmd).toBe('wsl.exe')
    expect(out.args).not.toContain('/usr/bin/node')
  })

  it('가짜 wsl.exe(.mjs)를 물렸을 때만 런처가 그 픽스처를 띄운다 — 안쪽 명령은 그대로다', () => {
    const out = wrapForEnv(WSL, 'claude', ['-p'], {}, { [WSL_EXE_ENV]: '/tmp/fake-wsl.mjs', ONE_DESK_AGENT_LAUNCHER: '/usr/bin/node' })
    expect(out.cmd).toBe('/usr/bin/node')
    expect(out.args).toEqual(['/tmp/fake-wsl.mjs', '-d', 'Ubuntu', '--', 'claude', '-p'])
  })

  it('distro가 -로 시작하면 던진다 (FR-33)', () => {
    expect(() => wrapForEnv({ kind: 'wsl', distro: '--list' }, 'x', [], {}, {})).toThrow('배포판 이름')
  })
})
