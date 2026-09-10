import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanRepo, scanDir } from './scan'

let dir: string

function write(rel: string, body: string): void {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'one-desk-scan-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('scanRepo', () => {
  it('세 경로를 전부 훑는다', async () => {
    write('.claude/skills/알파/SKILL.md', '---\nname: 알파\ndescription: 스킬\n---\n')
    write('.claude/agents/베타.md', '---\nname: 베타\ndescription: 클로드 agent\n---\n')
    write('.opencode/agent/감마.md', '---\nname: 감마\ndescription: 오픈코드 agent\n---\n')

    const found = await scanRepo(dir)
    expect(found.map((f) => `${f.kind}:${f.name}`).sort())
      .toEqual(['agent:감마', 'agent:베타', 'skill:알파'])
  })

  it('절대 경로를 돌려준다', async () => {
    write('.claude/skills/알파/SKILL.md', '---\nname: 알파\n---\n')
    const found = await scanRepo(dir)
    expect(found[0]!.filePath).toBe(join(dir, '.claude/skills/알파/SKILL.md'))
  })

  it('frontmatter가 없으면 파일명을 이름으로 쓴다', async () => {
    // skill은 디렉토리 이름, agent는 확장자를 뗀 파일명이다 (설계 §4).
    write('.claude/skills/이름없는스킬/SKILL.md', '# 그냥 본문\n')
    write('.claude/agents/이름없는에이전트.md', '# 그냥 본문\n')

    const found = await scanRepo(dir)
    const byKind = Object.fromEntries(found.map((f) => [f.kind, f]))
    expect(byKind['skill']!.name).toBe('이름없는스킬')
    expect(byKind['skill']!.description).toBeNull()
    expect(byKind['agent']!.name).toBe('이름없는에이전트')
  })

  it('skills 디렉토리의 SKILL.md가 아닌 파일은 무시한다', async () => {
    write('.claude/skills/알파/SKILL.md', '---\nname: 알파\n---\n')
    write('.claude/skills/알파/references/기타.md', '# 참고자료\n')
    const found = await scanRepo(dir)
    expect(found).toHaveLength(1)
  })

  it('디렉토리가 하나도 없으면 빈 배열이다', async () => {
    // repo 대부분이 이 경우다. 던지면 안 된다.
    await expect(scanRepo(dir)).resolves.toEqual([])
  })

  it('repo 경로 자체가 없으면 빈 배열이다', async () => {
    // 사용자가 디렉토리를 옮겼거나 지운 경우. 스캔이 죽으면 앱 부팅이 막힌다.
    await expect(scanRepo(join(dir, '없는곳'))).resolves.toEqual([])
  })
})

describe('scanDir', () => {
  it('하위 디렉토리의 SKILL.md를 skill로 읽는다', async () => {
    // `~/.claude/skills` 모양이다 — 하위 디렉토리마다 SKILL.md가 있다.
    write('roots/skills/알파/SKILL.md', '---\nname: 알파\ndescription: 설명\n---\n')
    const found = await scanDir(join(dir, 'roots/skills'))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: 'skill', name: '알파', description: '설명' })
    expect(found[0]!.filePath).toBe(join(dir, 'roots/skills/알파/SKILL.md'))
  })

  it('최상위 *.md를 agent로 읽는다', async () => {
    // `~/.claude/agents` 모양이다.
    write('roots/agents/베타.md', '---\nname: 베타\n---\n')
    const found = await scanDir(join(dir, 'roots/agents'))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: 'agent', name: '베타' })
  })

  it('한 디렉토리에 둘이 섞여 있어도 각각 읽는다', async () => {
    // 경로 하나를 두 패턴으로 훑으므로 설정에 어떤 디렉토리를 넣든 동작한다.
    write('roots/mixed/알파/SKILL.md', '---\nname: 알파\n---\n')
    write('roots/mixed/베타.md', '---\nname: 베타\n---\n')
    const found = await scanDir(join(dir, 'roots/mixed'))
    expect(found.map((f) => `${f.kind}:${f.name}`).sort()).toEqual(['agent:베타', 'skill:알파'])
  })

  it('SKILL.md가 없는 하위 디렉토리는 건너뛴다', async () => {
    write('roots/skills/알파/README.md', '# 스킬 아님\n')
    await expect(scanDir(join(dir, 'roots/skills'))).resolves.toEqual([])
  })

  it('디렉토리가 없으면 빈 배열이다', async () => {
    // 설정한 경로가 그 장비에 없는 것이 정상인 경우가 있다(opencode 전역 디렉토리).
    await expect(scanDir(join(dir, '없는곳'))).resolves.toEqual([])
  })
})
