import { describe, it, expect } from 'vitest'
import { createWslHome, expandWslRoots } from './home'
import type { WslRun } from './preflight'

/**
 * WSL 글로벌 skill 경로 (`docs/sdlc/wsl-support/` spec FR-27). 설정은 Linux 경로(`~/.claude/skills`)이고 distro마다 `~`를 그
 * distro의 홈으로 풀어 UNC로 바꾼다. 홈은 distro마다 한 번 묻고, 못 물은 것은 캐시하지 않는다.
 */
describe('expandWslRoots', () => {
  it('~를 홈으로 풀어 \\\\wsl$\\<distro>\\… UNC로 바꾼다', () => {
    expect(expandWslRoots(['~/.claude/skills', '/opt/skills', '~'], 'Ubuntu', '/home/me')).toEqual([
      '\\\\wsl$\\Ubuntu\\home\\me\\.claude\\skills',
      '\\\\wsl$\\Ubuntu\\opt\\skills',
      '\\\\wsl$\\Ubuntu\\home\\me'
    ])
  })

  it('상대 경로는 홈 기준이다', () => {
    expect(expandWslRoots(['skills'], 'Ubuntu', '/home/me')).toEqual(['\\\\wsl$\\Ubuntu\\home\\me\\skills'])
  })
})

describe('createWslHome', () => {
  function fakeRun(answer: () => { code: number | null; stdout?: string; failure?: string }) {
    const calls: string[] = []
    const run: WslRun = async (env, executable, args) => {
      calls.push(`${env.distro}:${executable} ${args.join(' ')}`)
      const out = answer()
      return { code: out.code, stdout: out.stdout ?? '', stderr: '', failure: out.failure ?? null }
    }
    return { run, calls }
  }

  it("sh -c 'echo $HOME'으로 묻고 distro마다 한 번 캐시한다", async () => {
    const { run, calls } = fakeRun(() => ({ code: 0, stdout: '/home/me\n' }))
    const home = createWslHome({ run })
    expect(await home.of('Ubuntu')).toBe('/home/me')
    expect(await home.of('Ubuntu')).toBe('/home/me')
    expect(await home.of('Debian')).toBe('/home/me')
    expect(calls).toEqual(["Ubuntu:sh -c echo $HOME", "Debian:sh -c echo $HOME"])
  })

  it('못 물으면 던지고 캐시하지 않는다', async () => {
    let fail = true
    const { run, calls } = fakeRun(() => fail ? { code: null, failure: '시간 초과' } : { code: 0, stdout: '/home/me\n' })
    const home = createWslHome({ run })
    await expect(home.of('Ubuntu')).rejects.toThrow('홈')
    fail = false
    expect(await home.of('Ubuntu')).toBe('/home/me')
    expect(calls).toHaveLength(2)
  })

  it('빈 답은 실패다 — 루트를 홈으로 삼으면 안 된다', async () => {
    const home = createWslHome({ run: fakeRun(() => ({ code: 0, stdout: '\n' })).run })
    await expect(home.of('Ubuntu')).rejects.toThrow()
  })
})
