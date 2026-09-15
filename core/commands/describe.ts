import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseFrontmatter } from '../assets/frontmatter'
import type { CommandDescription, CommandPlugin } from './types'

/**
 * 인자 placeholder. 하나라도 있으면 뒤에 붙는 맥락이 인자 자리에 치환된다(FR-9).
 *
 * 없는 커맨드는 CLI가 맥락을 본문 끝에 `ARGUMENTS: ...`로 붙여 온전히 전달한다 —
 * 그래서 경고는 placeholder를 쓰는 소수에게만 뜬다(실측 41개 중 2개).
 */
const ARGUMENT_PLACEHOLDER = /\$ARGUMENTS|\$\d\b|\$\{CLAUDE_/

/**
 * 커맨드 이름 → 설명·인자 사용 여부 지도를 만든다.
 *
 * init은 이름만 주므로 설명은 디스크에서 채운다. 훑는 자리는 설계 › 개요의 표 그대로다 —
 * repo와 홈의 `.claude/commands` 아래 `*.md`와 `.claude/skills` 아래 `SKILL.md`, 그리고 init이
 * 알려준 플러그인 경로 아래의 같은 두 모양(이름에 `<플러그인>:`이 붙는다).
 *
 * **어떤 경우에도 던지지 않는다**(`scanDir`과 같은 규칙). 없는 경로·권한 오류·읽을 수 없는
 * 파일은 조용히 건너뛴다. 여기서 던지면 설명 하나 때문에 피커가 통째로 죽는다.
 *
 * 홈 디렉토리는 인자로 받는다 — `core/`에서 `os.homedir()`를 부르지 않는다(NFR-4).
 */
export async function describeCommands(input: {
  cwd: string
  homeDir: string
  plugins: CommandPlugin[]
}): Promise<Map<string, CommandDescription>> {
  const found = new Map<string, CommandDescription>()

  // 홈을 먼저, repo를 나중에 훑는다 — 이름이 같으면 뒤에 쓴 repo 쪽이 이긴다(CLI와 같다).
  for (const root of [input.homeDir, input.cwd]) {
    await addCommands(found, join(root, '.claude', 'commands'), '')
    await addSkills(found, join(root, '.claude', 'skills'), '')
  }
  for (const plugin of input.plugins) {
    await addCommands(found, join(plugin.path, 'commands'), `${plugin.name}:`)
    await addSkills(found, join(plugin.path, 'skills'), `${plugin.name}:`)
  }

  return found
}

/** 최상위 `*.md` — 이름은 확장자를 뗀 파일명이다. */
async function addCommands(
  found: Map<string, CommandDescription>, path: string, prefix: string
): Promise<void> {
  for (const entry of await markdownFiles(path)) {
    const text = await readText(join(path, entry))
    if (text === null) continue
    const { description, usesArguments } = describeFile(text)
    found.set(prefix + basename(entry, '.md'), { description, usesArguments })
  }
}

/** 하위 디렉토리의 `SKILL.md` — 이름은 frontmatter의 `name`, 없으면 디렉토리명이다. */
async function addSkills(
  found: Map<string, CommandDescription>, path: string, prefix: string
): Promise<void> {
  for (const entry of await dirs(path)) {
    const text = await readText(join(path, entry, 'SKILL.md'))
    if (text === null) continue
    const { name, description, usesArguments } = describeFile(text)
    found.set(prefix + (name ?? entry), { description, usesArguments })
  }
}

/**
 * 파일 하나를 읽는다. 이름·설명은 frontmatter에서, 인자 사용 여부는 파일 전체에서 본다.
 *
 * frontmatter가 없거나 깨져도 항목은 남는다 — 설명 없는 커맨드도 목록에서 빠지지 않는다(FR-3).
 * 이름은 스킬만 쓴다(커맨드는 파일명이다).
 */
function describeFile(text: string): CommandDescription & { name: string | null } {
  const meta = parseFrontmatter(text)
  return {
    name: meta.name,
    description: meta.description,
    usesArguments: ARGUMENT_PLACEHOLDER.test(text)
  }
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

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    // SKILL.md가 없는 디렉토리이거나 읽을 수 없는 파일이다. 조용히 건너뛴다.
    return null
  }
}
