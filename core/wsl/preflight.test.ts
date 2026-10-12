import { describe, it, expect, vi } from 'vitest'
import { createWslPreflight, type WslRun } from './preflight'

/**
 * WSL 안의 claude 실행 파일 판정 (`docs/sdlc/wsl-support/` spec FR-13). 명시 경로면 `test -x`, 없으면 로그인 셸의
 * `command -v claude`. 결과는 (distro, 설정값)으로 캐시하되 **못 읽은 판정은 캐시하지 않는다.**
 */
function fakeRun(answer: (executable: string, args: string[]) => { code: number | null; stdout?: string; failure?: string }) {
  const calls: { distro: string; executable: string; args: string[] }[] = []
  const run: WslRun = async (env, executable, args) => {
    calls.push({ distro: env.distro, executable, args })
    const out = answer(executable, args)
    return { code: out.code, stdout: out.stdout ?? '', stderr: '', failure: out.failure ?? null }
  }
  return { run, calls }
}

describe('createWslPreflight.claude', () => {
  it('명시 경로는 test -x로 보고 통과하면 그 경로다', async () => {
    const { run, calls } = fakeRun(() => ({ code: 0 }))
    const pre = createWslPreflight({ run })
    await expect(pre.claude('Ubuntu', '/home/me/.local/bin/claude')).resolves.toEqual({ ok: true, executable: '/home/me/.local/bin/claude' })
    expect(calls).toEqual([{ distro: 'Ubuntu', executable: 'test', args: ['-x', '/home/me/.local/bin/claude'] }])
  })

  it('명시 경로가 실행 파일이 아니면 distro와 경로를 말한다', async () => {
    const pre = createWslPreflight({ run: fakeRun(() => ({ code: 1 })).run })
    const out = await pre.claude('Ubuntu', '/home/me/nope')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('(Ubuntu)')
    expect(out.reason).toContain('/home/me/nope')
  })

  it('명시 경로가 없으면 bash -lc "command -v claude"로 찾는다 — 로그인 셸이라 ~/.profile의 PATH가 보인다', async () => {
    const { run, calls } = fakeRun(() => ({ code: 0, stdout: '/home/me/.local/bin/claude\n' }))
    const pre = createWslPreflight({ run })
    await expect(pre.claude('Ubuntu', null)).resolves.toEqual({ ok: true, executable: '/home/me/.local/bin/claude' })
    expect(calls[0]).toEqual({ distro: 'Ubuntu', executable: 'bash', args: ['-lc', 'command -v claude'] })
  })

  it('PATH에 없으면 앱 설정의 WSL claude 경로를 지정하라고 안내한다', async () => {
    const pre = createWslPreflight({ run: fakeRun(() => ({ code: 1 })).run })
    const out = await pre.claude('Ubuntu', null)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/WSL.*claude 경로/)
  })

  it('wsl.exe를 띄우지 못하면(실패·시간 초과) 그 이유다', async () => {
    const pre = createWslPreflight({ run: fakeRun(() => ({ code: null, failure: 'ENOENT' })).run })
    const out = await pre.claude('Ubuntu', '/x')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('ENOENT')
  })

  it('통과한 판정은 (distro, 설정값)으로 캐시한다 — 두 번째는 프로세스를 띄우지 않는다', async () => {
    const { run, calls } = fakeRun(() => ({ code: 0, stdout: '/a\n' }))
    const pre = createWslPreflight({ run })
    await pre.claude('Ubuntu', null)
    await pre.claude('Ubuntu', null)
    await pre.claude('Debian', null)
    await pre.claude('Ubuntu', '/a')
    expect(calls.map((c) => `${c.distro}:${c.executable}`)).toEqual(['Ubuntu:bash', 'Debian:bash', 'Ubuntu:test'])
  })

  it('못 읽은 판정(실패·시간 초과)은 캐시하지 않는다 — 다음 조회가 다시 띄운다', async () => {
    let fail = true
    const { run, calls } = fakeRun(() => fail ? { code: null, failure: '시간 초과' } : { code: 0 })
    const pre = createWslPreflight({ run })
    expect((await pre.claude('Ubuntu', '/a')).ok).toBe(false)
    fail = false
    expect((await pre.claude('Ubuntu', '/a')).ok).toBe(true)
    await pre.claude('Ubuntu', '/a')
    expect(calls).toHaveLength(2)
  })

  it('"없다"는 판정도 캐시하지 않는다 — 설치한 직후 다시 확인하면 잡혀야 한다', async () => {
    let installed = false
    const { run, calls } = fakeRun(() => installed ? { code: 0, stdout: '/a\n' } : { code: 1 })
    const pre = createWslPreflight({ run })
    expect((await pre.claude('Ubuntu', null)).ok).toBe(false)
    installed = true
    expect((await pre.claude('Ubuntu', null)).ok).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('clear()가 캐시를 비운다 — 설정의 "다시 확인"', async () => {
    const { run, calls } = fakeRun(() => ({ code: 0 }))
    const pre = createWslPreflight({ run })
    await pre.claude('Ubuntu', '/a')
    pre.clear()
    await pre.claude('Ubuntu', '/a')
    expect(calls).toHaveLength(2)
  })

  it('동시에 들어온 같은 조회는 프로세스를 한 번만 띄운다', async () => {
    const answer = vi.fn(() => ({ code: 0 }))
    const { run, calls } = fakeRun(answer)
    const pre = createWslPreflight({ run })
    await Promise.all([pre.claude('Ubuntu', '/a'), pre.claude('Ubuntu', '/a')])
    expect(calls).toHaveLength(1)
  })
})
