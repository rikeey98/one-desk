import { describe, it, expect, afterEach, vi } from 'vitest'
import { spawn as nodeSpawn, execFileSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listRepoFiles, MAX_LISTED_FILES } from './list'
import { HOST_ENV } from '../wsl/env'
import { ORIGINAL_LD_LIBRARY_PATH } from '../runner/userEnv'
import { asLinuxPackage, USER_LD_LIBRARY_PATH } from '../runner/fixtures/linuxPackageEnv'

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

describe('listRepoFiles — WSL repo (docs/sdlc/wsl-support/ FR-25)', () => {
  it('wsl.exe -d <distro> --cd <linux> --exec git ls-files … 를 띄우고 Windows의 git은 찾지 않는다', async () => {
    const calls: { cmd: string; args: string[]; cwd: string | undefined }[] = []
    const findGit = vi.fn(async () => '/windows/git.exe')
    const spawn = (cmd: string, args: string[], opts: SpawnOptions) => {
      calls.push({ cmd, args, cwd: opts.cwd as string | undefined })
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true
      }) as unknown as ChildProcess
      queueMicrotask(() => { child.stdout!.emit('data', Buffer.from('a.ts\0dir/b.ts\0')); child.emit('close', 0) })
      return child
    }
    const result = await listRepoFiles('\\\\wsl$\\Ubuntu\\home\\me\\api', { env: { kind: 'wsl', distro: 'Ubuntu' }, findGit, spawn })
    expect(result).toEqual({ ok: true, truncated: false, files: ['a.ts', 'dir/b.ts'] })
    expect(findGit).not.toHaveBeenCalled()
    expect(calls).toEqual([{
      cmd: 'wsl.exe',
      args: ['-d', 'Ubuntu', '--cd', '/home/me/api', '--exec', 'git', 'ls-files', '-co', '--exclude-standard', '-z'],
      cwd: undefined
    }])
  })

  it('리눅스 패키지에서는 git을 사용자의 LD_LIBRARY_PATH로 띄운다 — 표식은 넘기지 않는다 (linux-launch-env)', async () => {
    const envs: NodeJS.ProcessEnv[] = []
    const spawn = (_cmd: string, _args: string[], opts: SpawnOptions) => {
      envs.push(opts.env ?? {})
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true
      }) as unknown as ChildProcess
      queueMicrotask(() => { child.emit('close', 0) })
      return child
    }
    await asLinuxPackage(() => listRepoFiles('/work/api', { env: HOST_ENV, findGit: async () => '/usr/bin/git', spawn }))
    expect(envs).toHaveLength(1)
    expect(envs[0]!['LD_LIBRARY_PATH']).toBe(USER_LD_LIBRARY_PATH)
    expect(envs[0]![ORIGINAL_LD_LIBRARY_PATH]).toBeUndefined()
  })

  it('host env면 지금처럼 Windows의 git을 찾아 cwd에서 띄운다', async () => {
    const calls: { cmd: string; cwd: string | undefined }[] = []
    const spawn = (cmd: string, _args: string[], opts: SpawnOptions) => {
      calls.push({ cmd, cwd: opts.cwd as string | undefined })
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true
      }) as unknown as ChildProcess
      queueMicrotask(() => { child.emit('close', 0) })
      return child
    }
    await listRepoFiles('/work/api', { env: HOST_ENV, findGit: async () => '/usr/bin/git', spawn })
    expect(calls).toEqual([{ cmd: '/usr/bin/git', cwd: '/work/api' }])
  })
})
