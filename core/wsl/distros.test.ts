import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { decodeWslList, listDistros } from './distros'

/**
 * `wsl.exe --list --quiet` (`docs/sdlc/wsl-support/` spec FR-4). **출력이 UTF-16LE다** — utf8로 읽으면 글자
 * 사이에 NUL이 끼어 어떤 이름도 맞지 않는다.
 */
function utf16(text: string, bom = true): Buffer {
  const body = Buffer.from(text, 'utf16le')
  return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body
}

describe('decodeWslList', () => {
  it('BOM 있는 UTF-16LE를 이름 목록으로 — CRLF·빈 줄·공백을 걷는다', () => {
    expect(decodeWslList(utf16('Ubuntu\r\nDebian \r\n\r\n'))).toEqual(['Ubuntu', 'Debian'])
  })

  it('BOM 없는 UTF-16LE도 받는다', () => {
    expect(decodeWslList(utf16('Ubuntu-22.04\r\n', false))).toEqual(['Ubuntu-22.04'])
  })

  it('NUL이 없는 바이트는 UTF-8로 읽는다 — 형식이 바뀌어도 이름이 나온다', () => {
    expect(decodeWslList(Buffer.from('Ubuntu\nDebian\n', 'utf8'))).toEqual(['Ubuntu', 'Debian'])
  })
})

/** 가짜 spawn — 한 번의 stdout 조각과 종료 코드로 끝나는 자식 */
function fakeSpawn(stdout: Buffer, code = 0, error?: Error) {
  const calls: { cmd: string; args: string[] }[] = []
  const spawn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn()
    }) as unknown as ChildProcess
    queueMicrotask(() => {
      if (error) { child.emit('error', error); return }
      child.stdout!.emit('data', stdout)
      child.emit('close', code)
    })
    return child
  }
  return { spawn, calls }
}

describe('listDistros', () => {
  it('Windows에서 wsl.exe --list --quiet를 띄워 이름을 돌려준다', async () => {
    const { spawn, calls } = fakeSpawn(utf16('Ubuntu\r\nDebian\r\n'))
    const out = await listDistros({ platform: 'win32', spawn, env: {} })
    expect(out).toEqual({ distros: ['Ubuntu', 'Debian'], reason: null })
    expect(calls).toEqual([{ cmd: 'wsl.exe', args: ['--list', '--quiet'] }])
  })

  it('Windows가 아니면 아무것도 띄우지 않고 빈 목록 + 이유다 (FR-4)', async () => {
    const { spawn, calls } = fakeSpawn(utf16('Ubuntu\r\n'))
    const out = await listDistros({ platform: 'darwin', spawn, env: {} })
    expect(out.distros).toEqual([])
    expect(out.reason).toContain('Windows')
    expect(calls).toEqual([])
  })

  it('wsl.exe가 없거나(ENOENT) 실패하면(exit≠0) 빈 목록 + 이유다', async () => {
    const missing = await listDistros({ platform: 'win32', spawn: fakeSpawn(Buffer.alloc(0), 0, new Error('ENOENT')).spawn, env: {} })
    expect(missing.distros).toEqual([])
    expect(missing.reason).toContain('ENOENT')
    const failed = await listDistros({ platform: 'win32', spawn: fakeSpawn(utf16(''), 1).spawn, env: {} })
    expect(failed.distros).toEqual([])
    expect(failed.reason).toMatch(/종료 코드 1/)
  })

  it('ONE_DESK_WSL_PATH가 있으면 그것을 띄운다', async () => {
    const { spawn, calls } = fakeSpawn(Buffer.from('Ubuntu\n'))
    await listDistros({ platform: 'win32', spawn, env: { ONE_DESK_WSL_PATH: '/tmp/fake-wsl.mjs' } })
    expect(calls[0]?.cmd).toBe('/tmp/fake-wsl.mjs')
  })

  it('가짜 wsl.exe는 ONE_DESK_AGENT_LAUNCHER로 띄운다 — Windows에서 .mjs는 셔뱅으로 뜨지 않는다 (spawn EFTYPE)', async () => {
    const { spawn, calls } = fakeSpawn(Buffer.from('Ubuntu\n'))
    await listDistros({ platform: 'win32', spawn, env: { ONE_DESK_WSL_PATH: '/tmp/fake-wsl.mjs', ONE_DESK_AGENT_LAUNCHER: '/bin/node' } })
    expect(calls[0]).toMatchObject({ cmd: '/bin/node', args: ['/tmp/fake-wsl.mjs', '--list', '--quiet'] })
  })
})
