import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { Spawn } from './distros'
import { wrapForEnv } from './launch'

const DEFAULT_TIMEOUT_MS = 15_000

export interface WslPaths {
  /** Windows 경로(`C:\…`) → 그 distro 안의 경로(`/mnt/c/…`). 못 바꾸면 던진다 */
  toLinux(distro: string, windowsPath: string): Promise<string>
}

/**
 * Windows 경로 → WSL 안 경로 (`docs/sdlc/wsl-support/` spec FR-11).
 *
 * **`wslpath`에게 묻는다** — 드라이브 문자로 결정적으로 바꾸지 않는다(automount 루트 `/mnt`는 `wsl.conf`의 설정값이다).
 * distro마다 `userDataDir` 하나를 한 번만 묻고(프로미스째 캐시 — 동시에 온 조회가 프로세스를 한 번만 띄운다) 그 아래
 * 경로는 접두사로 만든다. 그 밖(`execPath`·브리지 — 설치 폴더)은 (distro, 경로)로 따로 캐시한다. **실패는 캐시하지
 * 않는다** — 꺼져 있던 distro가 첫 호출에서 느려 시간을 넘긴 한 번이 앱이 사는 동안 굳으면 안 된다(opencode 버전
 * 게이트와 같은 규칙).
 */
export function createWslPaths(deps: {
  userDataDir: string
  spawn?: Spawn
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}): WslPaths {
  const spawn = deps.spawn ?? nodeSpawn
  const env = deps.env ?? process.env
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cache = new Map<string, Promise<string>>()
  const userDataKey = normalize(deps.userDataDir)

  function ask(distro: string, windowsPath: string): Promise<string> {
    const launch = wrapForEnv({ kind: 'wsl', distro }, 'wslpath', ['-a', '-u', windowsPath], {}, env)
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(launch.cmd, launch.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      } catch (err) {
        reject(new Error(`WSL 경로를 변환하지 못했습니다 (${distro}): ${message(err)}`))
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const fail = (why: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`WSL 경로를 변환하지 못했습니다 (${distro}): ${why}`))
      }
      const timer = setTimeout(() => { child.kill('SIGKILL'); fail(`${timeoutMs}ms 안에 답하지 않았습니다`) }, timeoutMs)
      child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf8') })
      child.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf8') })
      child.on('error', (err) => fail(err.message))
      child.on('close', (code) => {
        if (settled) return
        const out = stdout.trim()
        if (code !== 0 || out === '') { fail(stderr.trim() || `종료 코드 ${code}`); return }
        settled = true
        clearTimeout(timer)
        resolve(out)
      })
    })
  }

  function cached(distro: string, windowsPath: string): Promise<string> {
    const key = `${distro.toLowerCase()}\0${normalize(windowsPath)}`
    const hit = cache.get(key)
    if (hit) return hit
    const started = ask(distro, windowsPath)
    cache.set(key, started)
    started.catch(() => { cache.delete(key) })
    return started
  }

  return {
    async toLinux(distro, windowsPath) {
      const key = normalize(windowsPath)
      if (key === userDataKey || key.startsWith(userDataKey + '\\')) {
        const root = await cached(distro, deps.userDataDir)
        const rest = windowsPath.replace(/[\\/]+$/, '').slice(deps.userDataDir.replace(/[\\/]+$/, '').length)
        return root + rest.replace(/\\/g, '/')
      }
      return cached(distro, windowsPath)
    }
  }
}

/** Windows 경로 비교용 — 구분자를 `\`로, 대소문자 무시, 끝 구분자 제거 */
function normalize(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
