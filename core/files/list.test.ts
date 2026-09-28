import { describe, it, expect, afterEach } from 'vitest'
import { spawn as nodeSpawn, execFileSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listRepoFiles, MAX_LISTED_FILES } from './list'

const dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'one-desk-files-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** 테스트 프로세스의 동기 git은 괜찮다 — 앱 밖이다. */
function gitRepo(): string {
  const dir = makeDir()
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: dir })
  return dir
}

describe('listRepoFiles (FR-5)', () => {
  it('추적 중·추적 안 함은 오고 무시된 파일은 오지 않는다. 구분자는 /다', async () => {
    const dir = gitRepo()
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'tracked.ts'), 'a')
    execFileSync('git', ['add', '.'], { cwd: dir })
    writeFileSync(join(dir, 'untracked.txt'), 'b')
    writeFileSync(join(dir, '.gitignore'), '.env\n')
    writeFileSync(join(dir, '.env'), 'SECRET')

    const result = await listRepoFiles(dir)

    expect(result).toEqual({ ok: true, truncated: false, files: expect.any(Array) })
    const files = (result as { files: string[] }).files
    expect(files.sort()).toEqual(['.gitignore', 'src/tracked.ts', 'untracked.txt'])
  })

  it('한글 파일명이 인용되지 않고 그대로 온다', async () => {
    const dir = gitRepo()
    writeFileSync(join(dir, '메모.txt'), 'x')

    const result = await listRepoFiles(dir)

    expect(result).toMatchObject({ ok: true, files: ['메모.txt'] })
  })

  it('git 저장소가 아니면 이유를 준다', async () => {
    const result = await listRepoFiles(makeDir())

    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/^git 저장소가 아니라/)
  })

  it('git을 못 찾으면 이유를 준다', async () => {
    const result = await listRepoFiles(makeDir(), { findGit: async () => null })

    expect(result).toEqual({ ok: false, reason: 'git 실행 파일을 찾을 수 없습니다' })
  })

  it('시간 안에 끝나지 않으면 프로세스를 죽이고 실패한다', async () => {
    // 끝나지 않는 가짜 자식 — 진짜 프로세스는 부하에 따라 뜨는 시간이 흔들린다.
    let killed = false
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      kill: () => { killed = true; return true }
    })
    const result = await listRepoFiles(makeDir(), {
      findGit: async () => 'git',
      spawn: () => child as unknown as ChildProcess,
      timeoutMs: 50
    })

    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('50ms')
    expect(killed).toBe(true)
  })

  it(`${MAX_LISTED_FILES}개를 넘으면 잘라서 truncated다`, async () => {
    const script = `process.stdout.write(Array.from({ length: ${MAX_LISTED_FILES + 5} }, (_, i) => 'f' + i).join(String.fromCharCode(0)))`
    const result = await listRepoFiles(makeDir(), {
      findGit: async () => process.execPath,
      spawn: (_cmd, _args, opts) => nodeSpawn(process.execPath, ['-e', script], opts)
    })

    expect(result).toMatchObject({ ok: true, truncated: true })
    expect((result as { files: string[] }).files).toHaveLength(MAX_LISTED_FILES)
  })
})
