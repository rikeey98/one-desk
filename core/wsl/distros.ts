import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { WSL_EXE_ENV } from './launch'

export type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess

export interface DistroList {
  distros: string[]
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
 * 설치된 WSL 배포판 (FR-4). 캐시 없음 — 설정 화면을 열 때마다 묻는다. **던지지 않는다** — 못 얻으면 빈 목록과 이유다.
 * Windows가 아니면 프로세스를 띄우지도 않는다.
 */
export function listDistros(opts: {
  platform: NodeJS.Platform
  spawn?: Spawn
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}): Promise<DistroList> {
  if (opts.platform !== 'win32') {
    return Promise.resolve({ distros: [], reason: 'WSL은 Windows에서만 쓸 수 있습니다' })
  }
  const spawn = opts.spawn ?? nodeSpawn
  const env = opts.env ?? process.env
  const exe = env[WSL_EXE_ENV] || 'wsl.exe'
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(exe, ['--list', '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ distros: [], reason: `wsl.exe를 띄우지 못했습니다: ${message(err)}` })
      return
    }
    const chunks: Buffer[] = []
    let settled = false
    const settle = (out: DistroList) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(out)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle({ distros: [], reason: `wsl.exe가 ${timeoutMs}ms 안에 목록을 주지 않았습니다` })
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => { chunks.push(c) })
    child.on('error', (err) => settle({ distros: [], reason: `wsl.exe를 띄우지 못했습니다: ${err.message}` }))
    child.on('close', (code) => {
      if (code !== 0) { settle({ distros: [], reason: `wsl.exe --list가 실패했습니다 (종료 코드 ${code})` }); return }
      settle({ distros: decodeWslList(Buffer.concat(chunks)), reason: null })
    })
  })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
