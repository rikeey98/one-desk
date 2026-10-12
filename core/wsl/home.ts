import { wslUncOf } from '@shared/wslPath'
import type { WslRun } from './preflight'

export interface WslHome {
  /** 그 distro 기본 사용자의 홈(`/home/me`). 못 물으면 던진다 */
  of(distro: string): Promise<string>
}

/**
 * distro의 홈 (`docs/sdlc/wsl-support/` spec FR-27). `sh -c 'echo $HOME'` — `wsl.exe`가 띄우는 기본 사용자의 것이다.
 * distro마다 한 번 묻고 프로미스째 캐시한다. **못 물은 것은 캐시하지 않는다**(꺼져 있던 distro의 첫 시간 초과가 굳으면
 * 그 distro의 글로벌 skill이 앱이 사는 동안 비어 보인다).
 */
export function createWslHome(deps: { run: WslRun }): WslHome {
  const cache = new Map<string, Promise<string>>()

  async function ask(distro: string): Promise<string> {
    const out = await deps.run({ kind: 'wsl', distro }, 'sh', ['-c', 'echo $HOME'])
    const home = out.stdout.trim().split('\n').pop()?.trim() ?? ''
    if (out.failure || out.code !== 0 || !home.startsWith('/')) {
      throw new Error(`WSL(${distro})의 홈 디렉토리를 알 수 없습니다${out.failure ? `: ${out.failure}` : ''}`)
    }
    return home
  }

  return {
    of(distro) {
      const key = distro.toLowerCase()
      const hit = cache.get(key)
      if (hit) return hit
      const started = ask(distro)
      cache.set(key, started)
      started.catch(() => { cache.delete(key) })
      return started
    }
  }
}

/**
 * 설정의 Linux 경로들(`~/.claude/skills`)을 그 distro의 UNC로 (FR-27). `~`는 홈, 상대 경로는 홈 기준이다. 결과는 asset 행의
 * `file_path` 접두사가 된다 — 동일성 키에 distro가 들어 있어 두 distro의 같은 skill이 두 행이 되는 것이 맞다.
 */
export function expandWslRoots(configured: readonly string[], distro: string, home: string): string[] {
  return configured.map((raw) => {
    const p = raw.trim()
    const linux = p === '~' ? home
      : p.startsWith('~/') ? `${home}/${p.slice(2)}`
      : p.startsWith('/') ? p
      : `${home}/${p}`
    return wslUncOf(distro, linux)
  })
}
