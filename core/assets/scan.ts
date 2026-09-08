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
 * repo 하나를 훑어 발견한 skill/agent 파일을 돌려준다.
 *
 * **DB를 모른다.** 디스크에 무엇이 있는지만 답하고, 그것을 어떻게 저장할지는
 * 저장소와 서비스의 몫이다.
 *
 * **어떤 경우에도 던지지 않는다.** 대부분의 repo에는 이 디렉토리들이 없고,
 * 사용자가 디렉토리를 옮겨 경로가 통째로 사라져 있을 수도 있다. 부팅 스캔이
 * 그런 repo 하나 때문에 죽으면 앱이 열리지 않는다.
 */
export async function scanRepo(repoPath: string): Promise<FoundAsset[]> {
  const found: FoundAsset[] = []

  // skill: .claude/skills/<이름>/SKILL.md — 이름은 디렉토리에서 온다
  const skillRoot = join(repoPath, '.claude', 'skills')
  for (const entry of await dirs(skillRoot)) {
    const file = join(skillRoot, entry, 'SKILL.md')
    const meta = await readMeta(file)
    if (!meta) continue
    found.push({
      kind: 'skill', name: meta.name ?? entry, description: meta.description, filePath: file
    })
  }

  // agent: .claude/agents/*.md 와 .opencode/agent/*.md — 이름은 파일명에서 온다
  for (const base of [join(repoPath, '.claude', 'agents'), join(repoPath, '.opencode', 'agent')]) {
    for (const entry of await markdownFiles(base)) {
      const file = join(base, entry)
      const meta = await readMeta(file)
      if (!meta) continue
      found.push({
        kind: 'agent',
        name: meta.name ?? basename(entry, '.md'),
        description: meta.description,
        filePath: file
      })
    }
  }

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
