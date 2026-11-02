import { parseWslPath } from '@shared/wslPath'
import type { ConfigFile, ConfigFileKey, Repo } from '@shared/models'

/**
 * 설정 파일의 화면 이름 (`docs/sdlc/agent-status/` FR-6). core는 종류(key)만 주고 이름은 여기 한 표다 — agent·권한 이름표와
 * 같은 이유다(`agents.ts`·`permission.ts`).
 */
export const CONFIG_FILE_LABELS: Record<ConfigFileKey, string> = {
  'claude-settings': 'Claude Code 사용자 설정',
  'claude-state': 'Claude Code 전역 상태 · MCP 서버',
  'opencode-config': 'OpenCode 전역 설정',
  'repo-claude-settings': 'Claude Code 프로젝트 설정',
  'repo-claude-local': 'Claude Code 로컬 설정',
  'repo-mcp': '프로젝트 MCP 서버',
  'repo-opencode': 'OpenCode 프로젝트 설정',
  'wsl-claude-settings': 'Claude Code 사용자 설정 (WSL)'
}

export interface ConfigFileRow {
  file: ConfigFile
  /** 줄의 이름 — WSL은 배포판까지 */
  label: string
  /** 줄에 보이는 경로 — repo의 것은 repo 루트에서의 상대 경로, 나머지는 전체 경로 */
  shown: string
}

export interface ConfigFileGroup {
  /** `app` 또는 repo id */
  id: string
  title: string
  rows: ConfigFileRow[]
  /** repo 묶음에서 숨긴 없는 파일 수 — 묶음이 비어 보일 때 "없다"를 말하려고 센다 */
  missing: number
}

function labelOf(file: ConfigFile): string {
  if (file.key === 'wsl-claude-settings') {
    const distro = parseWslPath(file.path)?.distro
    return distro ? `Claude Code 사용자 설정 (WSL · ${distro})` : CONFIG_FILE_LABELS[file.key]
  }
  return CONFIG_FILE_LABELS[file.key]
}

/** repo 루트에서의 상대 경로. 루트 밖이면(그럴 일은 없다) 전체 경로 */
function relativeTo(root: string, path: string): string {
  const trimmed = root.replace(/[\\/]+$/, '')
  if (!path.startsWith(trimmed) || !/[\\/]/.test(path.charAt(trimmed.length))) return path
  return path.slice(trimmed.length + 1).replace(/\\/g, '/')
}

/**
 * 묶음 — 첫째가 `이 장비`(사용자 설정 셋과 WSL 배포판의 것), 이어 repo마다 하나(repo 목록 순서). **이 장비의 것은 없는 파일도
 * 보인다** — 어디에 두면 되는지가 쓸모다. **repo의 것은 있는 것만** 보인다 — repo마다 넷씩 "없음"이 서면 목록이 묻힌다.
 * 목록에 없는 repo의 파일은 버린다(그 사이 지워진 repo).
 */
export function groupConfigFiles(files: ConfigFile[], repos: Repo[]): ConfigFileGroup[] {
  const app: ConfigFileRow[] = []
  const byRepo = new Map<string, { rows: ConfigFileRow[]; missing: number }>()
  for (const file of files) {
    if (file.repoId === null || file.key === 'wsl-claude-settings') {
      app.push({ file, label: labelOf(file), shown: file.path })
      continue
    }
    const repo = repos.find((r) => r.id === file.repoId)
    if (!repo) continue
    const entry = byRepo.get(repo.id) ?? { rows: [], missing: 0 }
    if (file.exists) entry.rows.push({ file, label: labelOf(file), shown: relativeTo(repo.path, file.path) })
    else entry.missing += 1
    byRepo.set(repo.id, entry)
  }
  const groups: ConfigFileGroup[] = [{ id: 'app', title: '이 장비', rows: app, missing: 0 }]
  for (const repo of repos) {
    const entry = byRepo.get(repo.id)
    if (entry) groups.push({ id: repo.id, title: repo.name, rows: entry.rows, missing: entry.missing })
  }
  return groups
}
