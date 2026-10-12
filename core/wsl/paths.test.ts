import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { createWslPaths } from './paths'

/**
 * Windows 경로 → WSL 안 경로 (`docs/sdlc/wsl-support/` spec FR-11). `wslpath`에게 묻는다 — 드라이브 문자로
 * 결정적으로 바꾸지 않는다(automount 루트는 설정값이다). distro마다 `userData`를 한 번 묻고 그 아래는 접두사로 만든다.
 */
function fakeWslpath(answer: (path: string) => string | Error) {
  const calls: string[][] = []
  const spawn = (_cmd: string, args: string[]) => {
    calls.push(args)
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn()
    }) as unknown as ChildProcess
    const path = args[args.length - 1]!
    const out = answer(path)
    setTimeout(() => {
      if (out instanceof Error) { child.stderr!.emit('data', Buffer.from(out.message)); child.emit('close', 1); return }
      child.stdout!.emit('data', Buffer.from(out + '\n'))
      child.emit('close', 0)
    }, 0)
    return child
  }
  return { spawn, calls }
}

const USER_DATA = 'C:\\Users\\me\\AppData\\Roaming\\one-desk'

describe('createWslPaths.toLinux', () => {
  it('wslpath -a -u로 묻고 끝 줄바꿈을 걷는다 — wsl.exe -d <distro> -- wslpath …', async () => {
    const { spawn, calls } = fakeWslpath(() => '/mnt/c/Program Files/one-desk/one-desk.exe')
    const paths = createWslPaths({ spawn, env: {}, userDataDir: USER_DATA })
    await expect(paths.toLinux('Ubuntu', 'C:\\Program Files\\one-desk\\one-desk.exe'))
      .resolves.toBe('/mnt/c/Program Files/one-desk/one-desk.exe')
    expect(calls).toEqual([['-d', 'Ubuntu', '--', 'wslpath', '-a', '-u', 'C:\\Program Files\\one-desk\\one-desk.exe']])
  })

  it('userData 아래 경로는 userData를 한 번만 묻고 접두사로 만든다 — 대소문자·구분자 무시', async () => {
    const { spawn, calls } = fakeWslpath((p) => p.toLowerCase().includes('one-desk') ? '/mnt/c/Users/me/AppData/Roaming/one-desk' : new Error('x'))
    const paths = createWslPaths({ spawn, env: {}, userDataDir: USER_DATA })
    const [a, b] = await Promise.all([
      paths.toLinux('Ubuntu', `${USER_DATA}\\mcp\\r1.json`),
      paths.toLinux('Ubuntu', 'c:/users/ME/appdata/roaming/one-desk/wsl/r1.pid')
    ])
    expect(a).toBe('/mnt/c/Users/me/AppData/Roaming/one-desk/mcp/r1.json')
    expect(b).toBe('/mnt/c/Users/me/AppData/Roaming/one-desk/wsl/r1.pid')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['-d', 'Ubuntu', '--', 'wslpath', '-a', '-u', USER_DATA])
  })

  it('이름이 userData로 시작하기만 하는 형제 폴더는 접두사로 치지 않는다', async () => {
    const { spawn, calls } = fakeWslpath((p) => p.endsWith('one-desk') ? '/mnt/c/ud' : '/mnt/c/ud2')
    const paths = createWslPaths({ spawn, env: {}, userDataDir: USER_DATA })
    await expect(paths.toLinux('Ubuntu', `${USER_DATA}2\\x`)).resolves.toBe('/mnt/c/ud2')
    expect(calls).toHaveLength(1)
  })

  it('distro마다 따로 캐시한다 — 다른 distro의 automount 루트가 다를 수 있다', async () => {
    const { spawn, calls } = fakeWslpath(() => '/mnt/c/ud')
    const paths = createWslPaths({ spawn, env: {}, userDataDir: USER_DATA })
    await paths.toLinux('Ubuntu', `${USER_DATA}\\a`)
    await paths.toLinux('Debian', `${USER_DATA}\\b`)
    await paths.toLinux('Ubuntu', `${USER_DATA}\\c`)
    expect(calls.map((c) => c[1])).toEqual(['Ubuntu', 'Debian'])
  })

  it('동시에 들어온 조회는 프로세스를 한 번만 띄운다 — 프로미스째 캐시', async () => {
    const { spawn, calls } = fakeWslpath(() => '/mnt/c/ud')
    const paths = createWslPaths({ spawn, env: {}, userDataDir: USER_DATA })
    await Promise.all([paths.toLinux('Ubuntu', `${USER_DATA}\\a`), paths.toLinux('Ubuntu', `${USER_DATA}\\b`)])
    expect(calls).toHaveLength(1)
  })

  it('실패는 던지고 캐시하지 않는다 — 다음 run이 다시 묻는다', async () => {
    let fail = true
    const { spawn, calls } = fakeWslpath(() => fail ? new Error('wslpath: 없음') : '/mnt/c/ud')
    const paths = createWslPaths({ spawn, env: {}, userDataDir: USER_DATA })
    await expect(paths.toLinux('Ubuntu', `${USER_DATA}\\a`)).rejects.toThrow('WSL 경로를 변환하지 못했습니다')
    fail = false
    await expect(paths.toLinux('Ubuntu', `${USER_DATA}\\a`)).resolves.toBe('/mnt/c/ud/a')
    expect(calls).toHaveLength(2)
  })
})
