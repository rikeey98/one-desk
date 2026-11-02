import { join, posix } from 'node:path'
import { parseWslPath, wslUncOf } from '@shared/wslPath'
import type { ConfigFile, ConfigFileKey, ConfigFileRef, Repo } from '@shared/models'

/**
 * 에이전트 현황 패널의 설정 파일 (`docs/sdlc/agent-status/` FR-6~9).
 *
 * **렌더러는 경로가 아니라 (종류, repo id)를 넘긴다** — 정보 탭의 `reveal`이 이름만 받는 것과 같은 이유다. 렌더러가 경로를
 * 넘길 수 있으면 IPC 한 번으로 디스크의 아무 파일이나 OS 기본 앱으로 연다(실행 파일이면 실행된다). 경로는 여기서만 만든다.
 */

/** 이 장비의 것 — `repoId`가 null이다 */
export const APP_CONFIG_KEYS = ['claude-settings', 'claude-state', 'opencode-config'] as const satisfies readonly ConfigFileKey[]
/** repo 루트의 것 */
export const REPO_CONFIG_KEYS = ['repo-claude-settings', 'repo-claude-local', 'repo-mcp', 'repo-opencode'] as const satisfies readonly ConfigFileKey[]
/** WSL repo가 도는 배포판 홈의 것 — `repoId`는 그 배포판의 WSL repo */
export const WSL_CONFIG_KEYS = ['wsl-claude-settings'] as const satisfies readonly ConfigFileKey[]

const ALL_KEYS: readonly ConfigFileKey[] = [...APP_CONFIG_KEYS, ...REPO_CONFIG_KEYS, ...WSL_CONFIG_KEYS]

/**
 * 종류 → 기준 폴더(홈 또는 repo 루트) 아래의 후보. **있는 첫 후보를 쓰고**, 하나도 없으면 첫째를 "없음"으로 보인다.
 * opencode는 이름을 셋 받는다(`opencode.json` · `opencode.jsonc` · 옛 `config.json`).
 */
const CANDIDATES: Record<ConfigFileKey, readonly (readonly string[])[]> = {
  'claude-settings': [['.claude', 'settings.json']],
  // MCP 서버(user 범위)·프로젝트별 상태가 사는 파일 — claude가 settings.json과 따로 쓴다
  'claude-state': [['.claude.json']],
  'opencode-config': [
    ['.config', 'opencode', 'opencode.json'],
    ['.config', 'opencode', 'opencode.jsonc'],
    ['.config', 'opencode', 'config.json']
  ],
  'repo-claude-settings': [['.claude', 'settings.json']],
  'repo-claude-local': [['.claude', 'settings.local.json']],
  'repo-mcp': [['.mcp.json']],
  'repo-opencode': [['opencode.json'], ['opencode.jsonc']],
  'wsl-claude-settings': [['.claude', 'settings.json']]
}

/** 기준 폴더 — 호스트 경로이거나, 배포판 안의 Linux 홈이다(UNC로 바꿔 Windows가 연다) */
export type ConfigBase =
  | { kind: 'host'; dir: string }
  | { kind: 'wsl'; distro: string; home: string }

/** 후보 경로들. WSL은 Linux 경로로 잇고 UNC로 바꾼다 — 호스트의 `join`을 타면 개발 장비와 Windows가 갈린다 */
export function configCandidates(key: ConfigFileKey, base: ConfigBase): string[] {
  return CANDIDATES[key].map((segments) =>
    base.kind === 'host'
      ? join(base.dir, ...segments)
      : wslUncOf(base.distro, posix.join(base.home, ...segments)))
}

/** 렌더러가 보낸 값을 그대로 믿지 않는다 — 정해진 종류와, 종류에 맞는 `repoId` 모양만 받는다 */
export function parseConfigFileRef(input: unknown): ConfigFileRef {
  if (typeof input !== 'object' || input === null) throw new Error('열 수 없는 설정 파일입니다')
  const { key, repoId } = input as Record<string, unknown>
  if (typeof key !== 'string' || !(ALL_KEYS as readonly string[]).includes(key)) {
    throw new Error(`열 수 없는 설정 파일입니다: ${String(key)}`)
  }
  const appKey = (APP_CONFIG_KEYS as readonly string[]).includes(key)
  if (appKey ? repoId !== null : typeof repoId !== 'string') {
    throw new Error(`열 수 없는 설정 파일입니다: ${key}`)
  }
  return { key: key as ConfigFileKey, repoId: repoId as string | null }
}

/** WSL repo의 배포판. WSL repo가 아니거나 경로를 못 읽으면 null */
function distroOf(repo: Repo): string | null {
  if (repo.agentEnv !== 'wsl') return null
  return parseWslPath(repo.path)?.distro ?? null
}

export interface ConfigFilesDeps {
  /** 이 장비 사용자의 홈 — core가 스스로 알지 않는다(`CoreOptions.homeDir`) */
  homeDir: string
  repos: {
    list(workspaceId: string): Repo[]
    /** 없으면 던진다 */
    get(id: string): Repo
  }
  /** 배포판 홈(Linux 경로). 못 물으면 던진다 */
  wslHome(distro: string): Promise<string>
  /**
   * 파일인가. **비동기여야 한다** — WSL repo의 파일은 `\\wsl$` UNC라, 잠든 VM을 깨우는 동안 동기 stat이 메인 프로세스(MCP
   * 서버가 같이 있다)를 멈춘다(`readLog`가 비동기인 것과 같은 이유).
   */
  isFile(path: string): Promise<boolean>
}

export function createConfigFiles(deps: ConfigFilesDeps) {
  async function pick(candidates: string[]): Promise<{ path: string; exists: boolean }> {
    for (const path of candidates) {
      if (await deps.isFile(path)) return { path, exists: true }
    }
    return { path: candidates[0]!, exists: false }
  }

  async function baseOf(ref: ConfigFileRef): Promise<ConfigBase> {
    if (ref.repoId === null) return { kind: 'host', dir: deps.homeDir }
    const repo = deps.repos.get(ref.repoId)
    if ((WSL_CONFIG_KEYS as readonly string[]).includes(ref.key)) {
      const distro = distroOf(repo)
      if (!distro) throw new Error(`WSL repo가 아닙니다: ${repo.name}`)
      return { kind: 'wsl', distro, home: await deps.wslHome(distro) }
    }
    return { kind: 'host', dir: repo.path }
  }

  return {
    /**
     * 이 장비의 셋 + (workspace를 주면) 그 repo마다 넷 + WSL repo가 도는 배포판마다 하나. 없는 파일도 싣는다 — 어디에 두면
     * 되는지가 보여야 한다. 배포판 홈을 못 물으면 그 배포판의 줄만 빠진다(패널 전체가 실패하지 않는다).
     */
    async list(workspaceId: string | null): Promise<ConfigFile[]> {
      const refs: ConfigFileRef[] = APP_CONFIG_KEYS.map((key) => ({ key, repoId: null }))
      const repos = workspaceId === null ? [] : deps.repos.list(workspaceId)
      for (const repo of repos) {
        for (const key of REPO_CONFIG_KEYS) refs.push({ key, repoId: repo.id })
      }
      // 배포판마다 한 번 — 같은 배포판의 WSL repo가 여럿이어도 홈은 하나다
      const seen = new Set<string>()
      for (const repo of repos) {
        const distro = distroOf(repo)
        if (!distro || seen.has(distro.toLowerCase())) continue
        seen.add(distro.toLowerCase())
        for (const key of WSL_CONFIG_KEYS) refs.push({ key, repoId: repo.id })
      }
      const out = await Promise.all(refs.map(async (ref): Promise<ConfigFile | null> => {
        try {
          return { ...ref, ...(await pick(configCandidates(ref.key, await baseOf(ref)))) }
        } catch {
          return null
        }
      }))
      return out.filter((f): f is ConfigFile => f !== null)
    },

    /** 열 파일의 경로. 모양이 틀렸거나, repo가 없거나, 파일이 없으면 던진다 — 없는 파일을 OS에 넘기면 이유 없는 실패가 된다 */
    async pathOf(input: unknown): Promise<string> {
      const ref = parseConfigFileRef(input)
      const { path, exists } = await pick(configCandidates(ref.key, await baseOf(ref)))
      if (!exists) throw new Error(`파일이 없습니다: ${path}`)
      return path
    }
  }
}
