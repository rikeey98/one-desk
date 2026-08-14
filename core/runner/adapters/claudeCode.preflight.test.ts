import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeAdapter } from './claudeCode'

/**
 * 이 파일의 테스트는 진짜 파일을 만들어 탐색시킨다. 그래서 platform을 넘기지
 * 않고 호스트 것을 그대로 쓴다 — 실제 경로에 다른 플랫폼의 규칙을 씌우면
 * (예: Windows 임시 경로를 posix로 쪼개면 'C:'의 콜론에서 두 동강 난다)
 * 검증하려던 것과 다른 것을 보게 된다.
 *
 * 플랫폼별 후보 생성 규칙 자체는 executable.test.ts가 가짜 경로로 덮는다.
 */
const IS_WIN = process.platform === 'win32'

/** 호스트에서 실제로 실행 파일로 인정되는 이름. Windows는 PATHEXT 확장자가 필요하다. */
const EXE_NAME = IS_WIN ? 'claude.exe' : 'claude'

/** 홈 디렉토리를 담는 환경변수 이름. */
const HOME_VAR = IS_WIN ? 'USERPROFILE' : 'HOME'

let dir: string

/** 실행 비트가 선 파일을 만든다. POSIX 탐색이 X_OK를 보기 때문에 0o755여야 한다. */
async function makeExecutable(path: string): Promise<string> {
  await writeFile(path, '#!/bin/sh\n', { mode: 0o755 })
  return path
}

/**
 * Windows는 PATHEXT의 대문자 확장자를 붙인 후보를 그대로 돌려주고
 * 파일시스템은 대소문자를 구분하지 않는다 — claude.exe를 만들어도
 * 'claude.EXE'가 돌아온다. 대소문자를 접어 비교한다.
 */
function expectSamePath(actual: string | undefined, expected: string): void {
  expect(actual?.toLowerCase()).toBe(expected.toLowerCase())
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'one-desk-preflight-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('preflight — 명시 경로', () => {
  it('실행 가능한 명시 경로를 그대로 쓴다', async () => {
    const exe = await makeExecutable(join(dir, EXE_NAME))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out).toEqual({ ok: true, executable: exe })
  })

  it('없는 명시 경로는 사유와 함께 거부한다', async () => {
    const out = await claudeCodeAdapter.preflight(join(dir, 'nope'))
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('설정된 경로')
  })

  it('명시 경로가 .cmd면 거부한다 — shell 없이 spawn하면 EINVAL이다', async () => {
    const exe = await makeExecutable(join(dir, 'claude.cmd'))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out.ok).toBe(false)
    expect(out.executable).toBeUndefined()
    expect(out.reason).toContain('claude.exe')
  })

  it('명시 경로가 .bat여도 거부한다', async () => {
    const exe = await makeExecutable(join(dir, 'claude.bat'))
    const out = await claudeCodeAdapter.preflight(exe)
    expect(out.ok).toBe(false)
    expect(out.executable).toBeUndefined()
  })
})

describe('preflight — 탐색', () => {
  it('PATH에서 찾은 실행 파일을 쓴다', async () => {
    const exe = await makeExecutable(join(dir, EXE_NAME))
    const out = await claudeCodeAdapter.preflight(null, { env: { PATH: dir } })
    expect(out.ok).toBe(true)
    expectSamePath(out.executable, exe)
  })

  it('PATH가 비어도 홈 폴백에서 찾는다', async () => {
    const bin = join(dir, '.local', 'bin')
    await mkdir(bin, { recursive: true })
    const exe = await makeExecutable(join(bin, EXE_NAME))
    const out = await claudeCodeAdapter.preflight(null, {
      env: { PATH: '', [HOME_VAR]: dir }
    })
    expect(out.ok).toBe(true)
    expectSamePath(out.executable, exe)
  })

  it('못 찾으면 workspace 설정을 가리키는 사유를 준다', async () => {
    const out = await claudeCodeAdapter.preflight(null, {
      env: { PATH: dir, [HOME_VAR]: dir }
    })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('workspace 설정')
  })

  it('PATH가 폴백보다 앞선다 — 둘 다 있으면 PATH 쪽을 쓴다', async () => {
    const onPath = await makeExecutable(join(dir, EXE_NAME))
    const bin = join(dir, '.local', 'bin')
    await mkdir(bin, { recursive: true })
    await makeExecutable(join(bin, EXE_NAME))
    const out = await claudeCodeAdapter.preflight(null, {
      env: { PATH: dir, [HOME_VAR]: dir }
    })
    expectSamePath(out.executable, onPath)
  })
})
