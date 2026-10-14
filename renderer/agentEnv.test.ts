import { describe, it, expect } from 'vitest'
import { isKnownDistro, registerEnvOf, repoTitleOf, wslPickerOf, wslRepoRowsOf } from './agentEnv'
import type { Repo, WslDistros } from '@shared/models'

const WSL: WslDistros = { supported: true, distros: ['Ubuntu-24.04', 'docker-desktop'], defaultDistro: 'Ubuntu-24.04', reason: null }
const NO_WSL: WslDistros = { supported: false, distros: [], defaultDistro: null, reason: 'WSL은 Windows에서만 쓸 수 있습니다' }
const UNC = '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\api'

function repo(over: Partial<Repo>): Repo {
  return { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0, ...over }
}

describe('registerEnvOf — 등록 폼의 실행 환경 (docs/sdlc/wsl-repo-setup/ FR-3·4·5)', () => {
  it('WSL 경로면 체크를 켜진 채 내놓고, 배포판과 Linux 경로를 판다', () => {
    expect(registerEnvOf(UNC, WSL, false)).toEqual({
      offered: true, agentEnv: 'wsl', distro: 'Ubuntu-24.04', linuxPath: '/home/me/api', unknownDistro: false
    })
  })

  it('사람이 끄면 host다 — 체크는 그대로 보인다', () => {
    expect(registerEnvOf(UNC, WSL, true)).toMatchObject({ offered: true, agentEnv: 'host' })
  })

  it('앞뒤 공백은 걷고, \\\\wsl$ 표기도 같다', () => {
    expect(registerEnvOf(`  ${'\\\\wsl$\\Ubuntu-24.04\\srv'}  `, WSL, false)).toMatchObject({ offered: true, linuxPath: '/srv' })
  })

  it('WSL 경로가 아니거나 WSL을 쓸 수 없으면 체크가 없고 host다', () => {
    expect(registerEnvOf('C:\\work\\api', WSL, false)).toEqual({ offered: false, agentEnv: 'host' })
    expect(registerEnvOf(UNC, NO_WSL, false)).toEqual({ offered: false, agentEnv: 'host' })
    expect(registerEnvOf(UNC, null, false)).toEqual({ offered: false, agentEnv: 'host' })
    expect(registerEnvOf('\\\\wsl$\\', WSL, false)).toEqual({ offered: false, agentEnv: 'host' })
  })

  it('목록에 없는 배포판이면 표시한다 — 막지는 않는다', () => {
    expect(registerEnvOf('\\\\wsl$\\Arch\\home\\me', WSL, false)).toMatchObject({ offered: true, agentEnv: 'wsl', unknownDistro: true })
  })
})

describe('isKnownDistro', () => {
  it('대소문자를 가리지 않는다 — wsl.exe가 그렇다', () => {
    expect(isKnownDistro(['Ubuntu-24.04'], 'ubuntu-24.04')).toBe(true)
    expect(isKnownDistro(['Ubuntu-24.04'], 'Debian')).toBe(false)
  })
})

describe('wslPickerOf — WSL 버튼 (FR-1)', () => {
  it('기본 배포판, 없으면 첫 배포판', () => {
    expect(wslPickerOf(WSL)).toEqual({ distro: 'Ubuntu-24.04' })
    expect(wslPickerOf({ ...WSL, defaultDistro: null, distros: ['Debian', 'Ubuntu'] })).toEqual({ distro: 'Debian' })
  })

  it('WSL을 쓸 수 없거나 배포판이 없으면 버튼이 없다', () => {
    expect(wslPickerOf(null)).toBeNull()
    expect(wslPickerOf(NO_WSL)).toBeNull()
    expect(wslPickerOf({ ...WSL, distros: [], defaultDistro: null })).toBeNull()
  })
})

describe('wslRepoRowsOf — WSL 탭의 repo 목록 (FR-8의 3)', () => {
  it('실행 환경이 WSL이거나 경로가 WSL 폴더인 repo만, 순서 그대로', () => {
    const rows = wslRepoRowsOf([
      repo({ id: 'a', name: 'web', path: 'D:\\work\\web' }),
      repo({ id: 'b', name: 'api', path: UNC, agentEnv: 'wsl' }),
      repo({ id: 'c', name: 'legacy', path: '\\\\wsl$\\Debian\\srv\\old' })
    ])
    expect(rows.map((r) => [r.repo.id, r.distro, r.linuxPath, r.agentEnv])).toEqual([
      ['b', 'Ubuntu-24.04', '/home/me/api', 'wsl'],
      ['c', 'Debian', '/srv/old', 'host']
    ])
  })
})

describe('repoTitleOf — 사이드바 repo 카드의 풍선 (FR-6)', () => {
  it('WSL repo는 배포판과 Linux 경로, 그 밖에는 경로 그대로', () => {
    expect(repoTitleOf(repo({ path: UNC, agentEnv: 'wsl' }))).toBe('WSL · Ubuntu-24.04 · /home/me/api')
    expect(repoTitleOf(repo({ path: UNC }))).toBe(UNC)
    expect(repoTitleOf(repo({}))).toBe('/tmp/api')
  })
})
