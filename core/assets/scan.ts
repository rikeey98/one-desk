import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseFrontmatter } from './frontmatter'

export interface FoundAsset {
  kind: 'skill' | 'agent'
  name: string
  description: string | null
  /** 절대 경로 */
  filePath: string
}

/**
 * 디렉토리 하나를 **두 패턴으로** 훑는다.
 *
 * - 하위 디렉토리의 `SKILL.md` → `skill` (이름은 디렉토리에서)
 * - 최상위 `*.md` → `agent` (이름은 파일명에서)
 *
 * 두 패턴을 한 함수로 묶은 이유: 사용자가 설정에 어떤 디렉토리를 넣든 동작해야 한다.
 * `~/.claude/skills`는 앞 모양이고 `~/.claude/agents`는 뒤 모양인데, 어느 쪽인지
 * 설정에 따로 적게 하면 사용자가 그 구분을 알아야 한다.
 *
 * **어떤 경우에도 던지지 않는다.** 설정한 경로가 그 장비에 없는 것이 정상인 경우가
 * 있고(opencode 전역 디렉토리), 부팅 스캔이 그것 때문에 죽으면 앱이 열리지 않는다.
 */
export async function scanDir(path: string): Promise<FoundAsset[]> {
  const found: FoundAsset[] = []

  for (const entry of await dirs(path)) {
    const file = join(path, entry, 'SKILL.md')
    const meta = await readMeta(file)
    if (!meta) continue
    found.push({
      kind: 'skill', name: meta.name ?? entry, description: meta.description, filePath: file
    })
  }

  for (const entry of await markdownFiles(path)) {
    const file = join(path, entry)
    const meta = await readMeta(file)
    if (!meta) continue
    found.push({
      kind: 'agent',
      name: meta.name ?? basename(entry, '.md'),
      description: meta.description,
      filePath: file
    })
  }

  return found
}

/**
 * repo 하나를 훑어 발견한 skill/agent 파일을 돌려준다.
 *
 * **DB를 모른다.** 디스크에 무엇이 있는지만 답하고, 그것을 어떻게 저장할지는
 * 저장소와 서비스의 몫이다.
 *
 * repo 안의 세 자리를 `scanDir`로 훑는다. `.claude/skills`는 하위 디렉토리 패턴이,
 * 나머지 둘은 최상위 `*.md` 패턴이 걸린다.
 */
export async function scanRepo(repoPath: string): Promise<FoundAsset[]> {
  const roots = [
    join(repoPath, '.claude', 'skills'),
    join(repoPath, '.claude', 'agents'),
    join(repoPath, '.opencode', 'agent')
  ]
  const found: FoundAsset[] = []
  for (const root of roots) found.push(...await scanDir(root))
  return found
}

async function dirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function markdownFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
  } catch {
    return []
  }
}

async function readMeta(
  file: string
): Promise<{ name: string | null; description: string | null } | null> {
  try {
    return parseFrontmatter(await readFile(file, 'utf8'))
  } catch {
    // SKILL.md가 없는 디렉토리이거나 읽을 수 없는 파일이다. 조용히 건너뛴다.
    return null
  }
}
