import { describe, it, expect } from 'vitest'
import { envOfRepo, HOST_ENV } from './env'

const base = { id: 'r1', workspaceId: 'w1', name: 'api', description: null, sortOrder: 0, createdAt: 0 }

describe('envOfRepo (wsl-support FR-8)', () => {
  it('host repo는 경로가 무엇이든 host다 — WSL 폴더를 Windows claude로 쓰는 것도 허용된다 (FR-2)', () => {
    expect(envOfRepo({ ...base, path: 'C:\\work\\api', agentEnv: 'host' })).toEqual(HOST_ENV)
    expect(envOfRepo({ ...base, path: '\\\\wsl$\\Ubuntu\\home\\me\\api', agentEnv: 'host' })).toEqual(HOST_ENV)
  })

  it('wsl repo는 경로에서 distro를 판다', () => {
    expect(envOfRepo({ ...base, path: '\\\\wsl.localhost\\Ubuntu-22.04\\home\\me\\api', agentEnv: 'wsl' }))
      .toEqual({ kind: 'wsl', distro: 'Ubuntu-22.04' })
  })

  it('wsl인데 경로가 WSL 모양이 아니면 던진다 — 저장 때 막았으므로 여기 오면 데이터가 깨진 것이다', () => {
    expect(() => envOfRepo({ ...base, path: 'C:\\work\\api', agentEnv: 'wsl' })).toThrow('WSL repo의 경로')
  })
})
