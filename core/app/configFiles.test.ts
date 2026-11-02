import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configCandidates, createConfigFiles, parseConfigFileRef, type ConfigFilesDeps } from './configFiles'
import type { Repo } from '@shared/models'

let root: string
let home: string
let repoDir: string

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 'r1', workspaceId: 'w1', name: 'api', path: repoDir, description: null, sortOrder: 0,
    agentEnv: 'host', createdAt: 0, ...over
  }
}

function deps(repos: Repo[], over: Partial<ConfigFilesDeps> = {}): ConfigFilesDeps {
  return {
    homeDir: home,
    repos: {
      list: (workspaceId) => repos.filter((r) => r.workspaceId === workspaceId),
      get: (id) => {
        const found = repos.find((r) => r.id === id)
        if (!found) throw new Error(`repo를 찾을 수 없습니다: ${id}`)
        return found
      }
    },
    wslHome: async () => '/home/me',
    isFile: async (path) => {
      try { return statSync(path).isFile() } catch { return false }
    },
    ...over
  }
}

function touch(path: string, body = '{}') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'one-desk-config-'))
  home = join(root, 'home')
  repoDir = join(root, 'api')
  mkdirSync(home, { recursive: true })
  mkdirSync(repoDir, { recursive: true })
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('parseConfigFileRef', () => {
  it('정해진 종류와 종류에 맞는 repoId만 받는다', () => {
    expect(parseConfigFileRef({ key: 'claude-settings', repoId: null })).toEqual({ key: 'claude-settings', repoId: null })
    expect(parseConfigFileRef({ key: 'repo-mcp', repoId: 'r1' })).toEqual({ key: 'repo-mcp', repoId: 'r1' })
  })

  it('경로·모르는 종류·어긋난 repoId는 던진다', () => {
    // 렌더러가 임의의 파일을 OS 기본 앱으로 열 수 없어야 한다(FR-7)
    expect(() => parseConfigFileRef('/etc/passwd')).toThrow('열 수 없는 설정 파일')
    expect(() => parseConfigFileRef({ key: '/etc/passwd', repoId: null })).toThrow('열 수 없는 설정 파일')
    expect(() => parseConfigFileRef({ key: 'claude-settings', repoId: 'r1' })).toThrow('열 수 없는 설정 파일')
    expect(() => parseConfigFileRef({ key: 'repo-mcp', repoId: null })).toThrow('열 수 없는 설정 파일')
    expect(() => parseConfigFileRef({ key: 'wsl-claude-settings' })).toThrow('열 수 없는 설정 파일')
    expect(() => parseConfigFileRef(null)).toThrow('열 수 없는 설정 파일')
  })
})

describe('configCandidates', () => {
  it('WSL은 Linux 경로로 잇고 UNC로 바꾼다 — 호스트의 구분자를 타지 않는다', () => {
    expect(configCandidates('wsl-claude-settings', { kind: 'wsl', distro: 'Ubuntu', home: '/home/me' }))
      .toEqual(['\\\\wsl$\\Ubuntu\\home\\me\\.claude\\settings.json'])
  })

  it('opencode는 이름 셋을 순서대로 본다', () => {
    expect(configCandidates('opencode-config', { kind: 'host', dir: home })).toEqual([
      join(home, '.config', 'opencode', 'opencode.json'),
      join(home, '.config', 'opencode', 'opencode.jsonc'),
      join(home, '.config', 'opencode', 'config.json')
    ])
  })
})

describe('createConfigFiles', () => {
  it('workspace가 없으면 이 장비의 셋만, 없는 파일도 자리와 함께 싣는다', async () => {
    touch(join(home, '.claude', 'settings.json'))
    const files = await createConfigFiles(deps([repo()])).list(null)
    expect(files).toEqual([
      { key: 'claude-settings', repoId: null, path: join(home, '.claude', 'settings.json'), exists: true },
      { key: 'claude-state', repoId: null, path: join(home, '.claude.json'), exists: false },
      { key: 'opencode-config', repoId: null, path: join(home, '.config', 'opencode', 'opencode.json'), exists: false }
    ])
  })

  it('있는 첫 후보를 고른다', async () => {
    touch(join(home, '.config', 'opencode', 'opencode.jsonc'))
    touch(join(repoDir, 'opencode.jsonc'))
    const files = await createConfigFiles(deps([repo()])).list('w1')
    expect(files.find((f) => f.key === 'opencode-config')?.path).toBe(join(home, '.config', 'opencode', 'opencode.jsonc'))
    expect(files.find((f) => f.key === 'repo-opencode')).toEqual({
      key: 'repo-opencode', repoId: 'r1', path: join(repoDir, 'opencode.jsonc'), exists: true
    })
  })

  it('workspace의 repo마다 넷을 싣고, 다른 workspace의 repo는 싣지 않는다', async () => {
    touch(join(repoDir, '.mcp.json'))
    const other = repo({ id: 'r2', workspaceId: 'w2', path: join(root, 'other') })
    const files = await createConfigFiles(deps([repo(), other])).list('w1')
    expect(files.filter((f) => f.repoId === 'r1').map((f) => [f.key, f.exists])).toEqual([
      ['repo-claude-settings', false],
      ['repo-claude-local', false],
      ['repo-mcp', true],
      ['repo-opencode', false]
    ])
    expect(files.some((f) => f.repoId === 'r2')).toBe(false)
  })

  it('폴더는 파일이 아니다', async () => {
    mkdirSync(join(home, '.claude.json'), { recursive: true })
    const files = await createConfigFiles(deps([])).list(null)
    expect(files.find((f) => f.key === 'claude-state')?.exists).toBe(false)
  })

  it('WSL repo가 도는 배포판마다 한 줄 — 같은 배포판의 repo가 여럿이어도 하나다', async () => {
    const asked: string[] = []
    const wsl = (id: string, distro: string) => repo({ id, agentEnv: 'wsl', path: `\\\\wsl$\\${distro}\\home\\me\\${id}` })
    const files = await createConfigFiles(deps(
      [wsl('a', 'Ubuntu'), wsl('b', 'ubuntu'), wsl('c', 'Debian')],
      { wslHome: async (distro) => { asked.push(distro); return '/home/me' }, isFile: async () => false }
    )).list('w1')
    expect(files.filter((f) => f.key === 'wsl-claude-settings')).toEqual([
      { key: 'wsl-claude-settings', repoId: 'a', path: '\\\\wsl$\\Ubuntu\\home\\me\\.claude\\settings.json', exists: false },
      { key: 'wsl-claude-settings', repoId: 'c', path: '\\\\wsl$\\Debian\\home\\me\\.claude\\settings.json', exists: false }
    ])
    expect(asked).toEqual(['Ubuntu', 'Debian'])
  })

  it('배포판 홈을 못 물으면 그 줄만 빠진다', async () => {
    const files = await createConfigFiles(deps(
      [repo({ agentEnv: 'wsl', path: '\\\\wsl$\\Ubuntu\\home\\me\\api' })],
      { wslHome: async () => { throw new Error('꺼져 있다') }, isFile: async () => false }
    )).list('w1')
    expect(files.some((f) => f.key === 'wsl-claude-settings')).toBe(false)
    expect(files.filter((f) => f.repoId === 'r1')).toHaveLength(4)
  })

  it('WSL repo가 없으면 배포판 홈을 묻지 않는다 — VM을 깨우지 않는다', async () => {
    let asked = 0
    await createConfigFiles(deps([repo()], { wslHome: async () => { asked++; return '/home/me' } })).list('w1')
    expect(asked).toBe(0)
  })

  it('pathOf는 있는 파일의 경로만 돌려준다', async () => {
    touch(join(repoDir, '.claude', 'settings.local.json'))
    const files = createConfigFiles(deps([repo()]))
    expect(await files.pathOf({ key: 'repo-claude-local', repoId: 'r1' })).toBe(join(repoDir, '.claude', 'settings.local.json'))
    await expect(files.pathOf({ key: 'repo-mcp', repoId: 'r1' })).rejects.toThrow('파일이 없습니다')
    await expect(files.pathOf({ key: 'repo-mcp', repoId: 'nope' })).rejects.toThrow('repo를 찾을 수 없습니다')
    await expect(files.pathOf({ key: 'claude-settings', repoId: 'r1' })).rejects.toThrow('열 수 없는 설정 파일')
  })

  it('WSL 종류는 WSL repo에만 열린다', async () => {
    const files = createConfigFiles(deps([repo()], { isFile: async () => true }))
    await expect(files.pathOf({ key: 'wsl-claude-settings', repoId: 'r1' })).rejects.toThrow('WSL repo가 아닙니다')
  })
})
