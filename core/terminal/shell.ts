import { posix, win32 } from 'node:path'

/**
 * 터미널이 띄울 셸 (`docs/sdlc/code-editor/terminal-spec.md` FR-11~13·19). 파일시스템을 직접 건드리지 않는다 — PATH 탐색은
 * `find`로 주입받는다(`core/runner/executable.ts`의 `findExecutable`). `platform`을 인자로 받는 것은 Windows 규칙을 개발 장비에서
 * 검증하기 위해서다(`node:path`의 기본 join은 실행 중인 OS를 따른다 — CLAUDE.md).
 */

export interface ShellChoice {
  /** 띄울 실행 파일 */
  file: string
  args: string[]
  /** 칸 머리에 보일 이름(`pwsh`) */
  name: string
}

export interface ShellLookup {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** 이름으로 PATH에서 찾는다. 없으면 null */
  find: (name: string) => Promise<string | null>
}

/**
 * 설정이 비었을 때의 셸 (FR-12). Windows는 PowerShell 7(PATH의 `pwsh`)이 먼저고, 없으면 OS에 늘 있는 Windows PowerShell 5.1이다.
 * macOS·Linux는 사용자의 로그인 셸(`$SHELL`)이고 PATH를 훑지 않는다.
 */
export async function defaultShell(opts: ShellLookup): Promise<string> {
  if (opts.platform === 'win32') {
    const pwsh = await opts.find('pwsh')
    if (pwsh) return pwsh
    const root = opts.env['SystemRoot'] ?? opts.env['SYSTEMROOT'] ?? 'C:\\Windows'
    return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }
  return opts.env['SHELL'] || '/bin/bash'
}

/** 경로의 끝 조각에서 `.exe`를 뗀 이름 — 칸 머리와 인자 규칙이 쓴다 */
export function shellName(file: string, platform: NodeJS.Platform): string {
  const base = (platform === 'win32' ? win32 : posix).basename(file)
  return base.replace(/\.exe$/i, '')
}

/**
 * 셸에 붙일 인자 (FR-13) — 이름으로 정한다. bash 계열은 로그인 셸이어야 사용자의 프로필(PATH·nvm 등)이 읽힌다. Windows의
 * bash·sh(Git Bash)는 `--login -i`, posix는 `-l`. PowerShell·cmd는 인자가 없다. 칸에서 인자를 넣는 길은 없다.
 */
export function shellArgs(file: string, platform: NodeJS.Platform): string[] {
  const name = shellName(file, platform).toLowerCase()
  if (platform === 'win32') return name === 'bash' || name === 'sh' ? ['--login', '-i'] : []
  return ['bash', 'zsh', 'sh', 'fish'].includes(name) ? ['-l'] : []
}

/** 설정한 경로(없으면 기본값)와 그 인자·이름 (FR-11·12) */
export async function resolveShell(setting: string | null, opts: ShellLookup): Promise<ShellChoice> {
  const file = setting ?? await defaultShell(opts)
  return { file, args: shellArgs(file, opts.platform), name: shellName(file, opts.platform) }
}

/**
 * 셸의 환경 (FR-19) — 앱이 물려받은 사용자 환경 그대로에 `TERM`을 더한다. 앱 내부 변수(`ONE_DESK_*`·`ELECTRON_*`)는 뺀다 — 셸에서
 * 띄운 `electron`·`claude`가 그것을 받아 엉뚱하게 돈다(`ELECTRON_RUN_AS_NODE`면 electron이 창 없이 node로 뜬다). Windows의 환경
 * 변수 이름은 대소문자를 가리지 않으므로 접두사도 대소문자 없이 본다.
 */
export function shellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (upper.startsWith('ONE_DESK_') || upper.startsWith('ELECTRON_')) continue
    out[key] = value
  }
  out['TERM'] = 'xterm-256color'
  return out
}
