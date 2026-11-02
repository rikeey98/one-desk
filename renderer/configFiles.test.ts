import { describe, it, expect } from 'vitest'
import { groupConfigFiles } from './configFiles'
import type { ConfigFile, Repo } from '@shared/models'

function repo(id: string, name: string, path: string, over: Partial<Repo> = {}): Repo {
  return { id, workspaceId: 'w1', name, path, description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0, ...over }
}

const api = repo('r1', 'api', '/w/api')
const web = repo('r2', 'web', 'C:\\w\\web\\')

const files: ConfigFile[] = [
  { key: 'claude-settings', repoId: null, path: '/home/me/.claude/settings.json', exists: true },
  { key: 'opencode-config', repoId: null, path: '/home/me/.config/opencode/opencode.json', exists: false },
  { key: 'repo-claude-settings', repoId: 'r1', path: '/w/api/.claude/settings.json', exists: true },
  { key: 'repo-mcp', repoId: 'r1', path: '/w/api/.mcp.json', exists: false },
  { key: 'repo-mcp', repoId: 'r2', path: 'C:\\w\\web\\.mcp.json', exists: false },
  { key: 'wsl-claude-settings', repoId: 'r3', path: '\\\\wsl$\\Ubuntu\\home\\me\\.claude\\settings.json', exists: true }
]

describe('groupConfigFiles (docs/sdlc/agent-status/ FR-6)', () => {
  it('이 장비가 먼저이고 없는 파일도 보이며, WSL은 배포판 이름이 붙어 이 장비에 선다', () => {
    const [app] = groupConfigFiles(files, [api, web])
    expect(app!.title).toBe('이 장비')
    expect(app!.rows.map((r) => [r.label, r.file.exists])).toEqual([
      ['Claude Code 사용자 설정', true],
      ['OpenCode 전역 설정', false],
      ['Claude Code 사용자 설정 (WSL · Ubuntu)', true]
    ])
    expect(app!.rows[0]!.shown).toBe('/home/me/.claude/settings.json')
  })

  it('repo 묶음은 repo 목록 순서이고, 있는 파일만 repo 루트의 상대 경로로 보인다', () => {
    const groups = groupConfigFiles(files, [web, api])
    expect(groups.map((g) => g.title)).toEqual(['이 장비', 'web', 'api'])
    const apiGroup = groups[2]!
    expect(apiGroup.rows.map((r) => r.shown)).toEqual(['.claude/settings.json'])
    expect(apiGroup.missing).toBe(1)
    expect(groups[1]!.rows).toEqual([])
    expect(groups[1]!.missing).toBe(1)
  })

  it('Windows 경로도 상대 경로를 `/`로 보인다', () => {
    const groups = groupConfigFiles(
      [{ key: 'repo-mcp', repoId: 'r2', path: 'C:\\w\\web\\.mcp.json', exists: true }], [web]
    )
    expect(groups[1]!.rows[0]!.shown).toBe('.mcp.json')
  })

  it('목록에 없는 repo의 파일은 버린다 — 그 사이 지워진 repo', () => {
    const groups = groupConfigFiles(files, [api])
    expect(groups.map((g) => g.title)).toEqual(['이 장비', 'api'])
  })
})
