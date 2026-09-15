import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeCommands } from './describe'

let dir: string
let cwd: string
let homeDir: string

function write(rel: string, body: string): void {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'one-desk-commands-'))
  cwd = join(dir, 'repo')
  homeDir = join(dir, 'home')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('describeCommands', () => {
  it('repo의 커맨드를 파일명으로 잡는다', async () => {
    write('repo/.claude/commands/리뷰.md', '---\ndescription: 변경을 훑는다\n---\n# 본문\n')

    const found = await describeCommands({ cwd, homeDir, plugins: [] })
    expect(found.get('리뷰')).toEqual({ description: '변경을 훑는다', usesArguments: false })
  })

  it('홈의 커맨드도 잡는다', async () => {
    write('home/.claude/commands/정리.md', '---\ndescription: 홈 커맨드\n---\n')

    const found = await describeCommands({ cwd, homeDir, plugins: [] })
    expect(found.get('정리')).toEqual({ description: '홈 커맨드', usesArguments: false })
  })

  it('스킬은 repo와 홈 양쪽에서 frontmatter의 name을 쓴다', async () => {
    write('repo/.claude/skills/알파디렉토리/SKILL.md', '---\nname: 알파\ndescription: repo 스킬\n---\n')
    write('home/.claude/skills/베타디렉토리/SKILL.md', '---\nname: 베타\ndescription: 홈 스킬\n---\n')

    const found = await describeCommands({ cwd, homeDir, plugins: [] })
    expect(found.get('알파')).toEqual({ description: 'repo 스킬', usesArguments: false })
    expect(found.get('베타')).toEqual({ description: '홈 스킬', usesArguments: false })
  })

  it('스킬에 name이 없으면 디렉토리명을 쓴다', async () => {
    write('repo/.claude/skills/이름없는스킬/SKILL.md', '---\ndescription: 이름이 없다\n---\n')

    const found = await describeCommands({ cwd, homeDir, plugins: [] })
    expect(found.get('이름없는스킬')).toEqual({ description: '이름이 없다', usesArguments: false })
  })

  it('플러그인의 커맨드와 스킬은 <플러그인>:<이름>이다', async () => {
    write('plugins/초능력/commands/구상.md', '---\ndescription: 플러그인 커맨드\n---\n')
    write('plugins/초능력/skills/디버깅/SKILL.md', '---\nname: 체계적디버깅\n---\n')

    const found = await describeCommands({
      cwd, homeDir, plugins: [{ name: '초능력', path: join(dir, 'plugins/초능력') }]
    })
    expect(found.get('초능력:구상')?.description).toBe('플러그인 커맨드')
    expect(found.has('초능력:체계적디버깅')).toBe(true)
  })

  it('같은 이름이면 repo가 홈을 이긴다', async () => {
    // CLI의 우선순위와 같다 — 프로젝트 커맨드가 개인 커맨드를 가린다.
    write('home/.claude/commands/리뷰.md', '---\ndescription: 홈 것\n---\n')
    write('repo/.claude/commands/리뷰.md', '---\ndescription: repo 것\n---\n')

    const found = await describeCommands({ cwd, homeDir, plugins: [] })
    expect(found.get('리뷰')?.description).toBe('repo 것')
  })

  describe('인자 placeholder', () => {
    it('$ARGUMENTS·$1·${CLAUDE_ 를 쓰면 usesArguments가 true다', async () => {
      write('repo/.claude/commands/전체인자.md', '# 본문\n$ARGUMENTS 를 처리한다\n')
      write('repo/.claude/commands/자리인자.md', '# 본문\n첫 인자는 $1 이다\n')
      write('repo/.claude/commands/환경변수.md', '# 본문\n${CLAUDE_PROJECT_DIR}/bin/x\n')

      const found = await describeCommands({ cwd, homeDir, plugins: [] })
      expect(found.get('전체인자')?.usesArguments).toBe(true)
      expect(found.get('자리인자')?.usesArguments).toBe(true)
      expect(found.get('환경변수')?.usesArguments).toBe(true)
    })

    it('placeholder가 없으면 false다', async () => {
      // 이 장비의 41개 중 39개가 이쪽이다 — 경고를 띄우지 않는 쪽이 기본이다.
      write('repo/.claude/commands/평범.md', '# 본문\n달러 표시가 없다\n')
      write('repo/.claude/skills/스킬/SKILL.md', '---\nname: 스킬\n---\n비용은 $100 이다\n')

      const found = await describeCommands({ cwd, homeDir, plugins: [] })
      expect(found.get('평범')?.usesArguments).toBe(false)
      expect(found.get('스킬')?.usesArguments).toBe(false)
    })
  })

  describe('망가진 입력', () => {
    it('경로가 하나도 없으면 빈 지도다', async () => {
      // 커맨드를 하나도 쓰지 않는 repo가 대부분이다. 던지면 피커가 통째로 죽는다.
      const found = await describeCommands({
        cwd, homeDir, plugins: [{ name: '없는플러그인', path: join(dir, '없는곳') }]
      })
      expect(found.size).toBe(0)
    })

    it('frontmatter가 깨진 커맨드는 설명만 null이고 항목은 남는다', async () => {
      // 설명을 못 찾아도 목록에서 빠지지 않는다(FR-3). 인자 판정은 그래도 해야 한다.
      write('repo/.claude/commands/반쪽.md', '---\ndescription: 닫히지 않았다\n$ARGUMENTS\n')

      const found = await describeCommands({ cwd, homeDir, plugins: [] })
      expect(found.get('반쪽')).toEqual({ description: null, usesArguments: true })
    })

    it('읽을 수 없는 자리는 조용히 건너뛴다', async () => {
      // 디렉토리인 `*.md`와 SKILL.md가 없는 스킬 디렉토리. 둘 다 던지면 안 된다.
      mkdirSync(join(cwd, '.claude/commands/디렉토리인.md'), { recursive: true })
      mkdirSync(join(cwd, '.claude/skills/스킬아님'), { recursive: true })
      write('repo/.claude/commands/멀쩡.md', '---\ndescription: 멀쩡하다\n---\n')

      const found = await describeCommands({ cwd, homeDir, plugins: [] })
      expect([...found.keys()]).toEqual(['멀쩡'])
    })
  })
})
