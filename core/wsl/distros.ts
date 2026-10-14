import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { wslExeLaunch } from './launch'

export type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess

export interface DistroList {
  distros: string[]
  /** 기본 배포판 (`docs/sdlc/wsl-repo-setup/` FR-12). 하나뿐이면 그것, 못 정하면 null */
  defaultDistro: string | null
  /** 목록을 못 얻은 이유. 얻었으면 null */
  reason: string | null
}

const DEFAULT_TIMEOUT_MS = 5_000

/**
 * `wsl.exe --list --quiet`의 출력을 이름 목록으로 (`docs/sdlc/wsl-support/` spec FR-4).
 *
 * **출력은 UTF-16LE다**(BOM이 있을 수도 없을 수도) — utf8로 읽으면 글자 사이에 NUL이 끼어 어떤 이름과도 맞지
 * 않는다. NUL이 하나도 없으면 UTF-8로 본다 — 형식이 바뀐 날에도 이름은 나온다.
 */
export function decodeWslList(buf: Buffer): string[] {
  const hasNul = buf.includes(0)
  let text: string
  if (hasNul) {
    const body = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2) : buf
    text = body.toString('utf16le')
  } else {
    text = buf.toString('utf8')
  }
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
}

/**
 * `wsl.exe --list --verbose`의 출력에서 기본 배포판 (`docs/sdlc/wsl-repo-setup/` FR-12). 머리 줄(`NAME STATE VERSION`)은
 * 로캘을 탈 수 있으므로 읽지 않고 **`*`로 시작하는 줄만** 본다. 그 이름이 `--quiet` 목록(`names`)에 없으면 null이다 — 형식이
 * 바뀐 날 엉뚱한 글자를 배포판으로 집어 `wsl.exe -d`에 넘기지 않는다(배포판 이름에는 공백이 없다).
 */
export function parseDefaultDistro(buf: Buffer, names: readonly string[]): string | null {
  for (const line of decodeWslList(buf)) {
    if (!line.startsWith('*')) continue
    const name = line.slice(1).trim().split(/\s+/)[0] ?? ''
    return names.includes(name) ? name : null
  }
  return null
}

/**
 * 설치된 WSL 배포판 (FR-4). 캐시 없음 — 설정 화면을 열 때마다 묻는다. **던지지 않는다** — 못 얻으면 빈 목록과 이유다.
 * Windows가 아니면 프로세스를 띄우지도 않는다.
 *
 * 배포판이 여럿이면 `--verbose`를 한 번 더 띄워 기본 배포판을 찾는다(wsl-repo-setup FR-12 — 등록 폼의 `WSL` 버튼이 그 홈에서
 * 연다). Docker Desktop이 `docker-desktop`을 따로 깔아 여럿인 장비가 흔하다. 그 조회의 실패는 오류가 아니다 — 기본만 null이다.
 */
export async function listDistros(opts: {
  platform: NodeJS.Platform
  spawn?: Spawn
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}): Promise<DistroList> {
  if (opts.platform !== 'win32') {
    return { distros: [], defaultDistro: null, reason: 'WSL은 Windows에서만 쓸 수 있습니다' }
  }
  const quiet = await runList(['--list', '--quiet'], opts)
  if (!quiet.ok) return { distros: [], defaultDistro: null, reason: quiet.reason }
  const distros = decodeWslList(quiet.stdout)
  if (distros.length <= 1) return { distros, defaultDistro: distros[0] ?? null, reason: null }
  const verbose = await runList(['--list', '--verbose'], opts)
  return { distros, defaultDistro: verbose.ok ? parseDefaultDistro(verbose.stdout, distros) : null, reason: null }
}

type ListRun = { ok: true; stdout: Buffer } | { ok: false; reason: string }

/** `wsl.exe <args>`를 띄워 stdout 전체를 받는다. 던지지 않는다 */
function runList(args: string[], opts: { spawn?: Spawn; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<ListRun> {
  const spawn = opts.spawn ?? nodeSpawn
  const launch = wslExeLaunch(args, opts.env ?? process.env)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(launch.cmd, launch.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ ok: false, reason: `wsl.exe를 띄우지 못했습니다: ${message(err)}` })
      return
    }
    const chunks: Buffer[] = []
    let settled = false
    const settle = (out: ListRun) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(out)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle({ ok: false, reason: `wsl.exe가 ${timeoutMs}ms 안에 목록을 주지 않았습니다` })
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => { chunks.push(c) })
    child.on('error', (err) => settle({ ok: false, reason: `wsl.exe를 띄우지 못했습니다: ${err.message}` }))
    child.on('close', (code) => {
      if (code !== 0) { settle({ ok: false, reason: `wsl.exe --list가 실패했습니다 (종료 코드 ${code})` }); return }
      settle({ ok: true, stdout: Buffer.concat(chunks) })
    })
  })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
