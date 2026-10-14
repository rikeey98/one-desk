import { describe, it, expect, vi } from 'vitest'
import { folderStartOf } from './folderStart'
import type { DistroList } from './distros'

function list(out: Partial<DistroList>) {
  return async (): Promise<DistroList> => ({ distros: [], defaultDistro: null, reason: null, ...out })
}

describe('folderStartOf (docs/sdlc/wsl-repo-setup/ FR-11)', () => {
  it('기본 배포판의 홈 UNC다', async () => {
    const home = vi.fn(async () => '/home/rikeey')
    const start = await folderStartOf({ list: list({ distros: ['docker-desktop', 'Ubuntu-24.04'], defaultDistro: 'Ubuntu-24.04' }), home })
    expect(start).toBe('\\\\wsl$\\Ubuntu-24.04\\home\\rikeey')
    expect(home).toHaveBeenCalledWith('Ubuntu-24.04')
  })

  it('기본을 못 정했으면 목록의 첫 배포판이다', async () => {
    const start = await folderStartOf({ list: list({ distros: ['Ubuntu', 'Debian'] }), home: async () => '/home/me' })
    expect(start).toBe('\\\\wsl$\\Ubuntu\\home\\me')
  })

  it('홈을 못 물으면 그 배포판의 루트다 — 열리기만 하면 사람이 찾아간다', async () => {
    const start = await folderStartOf({
      list: list({ distros: ['Ubuntu'], defaultDistro: 'Ubuntu' }),
      home: async () => { throw new Error('시간 초과') }
    })
    expect(start).toBe('\\\\wsl$\\Ubuntu')
  })

  it('배포판이 없으면 null이다 — 대화상자는 OS 기본 위치에서 열린다', async () => {
    const home = vi.fn(async () => '/home/me')
    expect(await folderStartOf({ list: list({ reason: 'WSL은 Windows에서만 쓸 수 있습니다' }), home })).toBeNull()
    expect(home).not.toHaveBeenCalled()
  })

  it('`-`로 시작하는 이름은 wsl.exe에 넘기지 않는다 (wsl-support FR-33)', async () => {
    const home = vi.fn(async () => '/home/me')
    expect(await folderStartOf({ list: list({ distros: ['--list'], defaultDistro: '--list' }), home })).toBeNull()
    expect(home).not.toHaveBeenCalled()
  })
})
