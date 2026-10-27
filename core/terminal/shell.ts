import { posix, win32 } from 'node:path'
import { isTerminalShellKey, type TerminalShellOption } from '@shared/models'
import type { ProcessEnvSpec } from '../wsl/env'

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
  /** 고정 경로가 있는가 (`docs/sdlc/terminal-tabs/spec.md` FR-8·10) */
  exists: (path: string) => Promise<boolean>
}

/** Windows의 환경 변수 이름은 대소문자를 가리지 않는다 — 테스트·자식 환경의 평범한 객체에서도 그렇게 찾는다 */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(env)) if (key.toLowerCase() === lower && value) return value
  return undefined
}

const systemRoot = (env: NodeJS.ProcessEnv) => envValue(env, 'SystemRoot') ?? 'C:\\Windows'
const windowsPowerShell = (env: NodeJS.ProcessEnv) => win32.join(systemRoot(env), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const posixLoginShell = (env: NodeJS.ProcessEnv) => env['SHELL'] || '/bin/bash'

/**
 * 설정이 비었을 때의 셸 (FR-12). Windows는 PowerShell 7(PATH의 `pwsh`)이 먼저고, 없으면 OS에 늘 있는 Windows PowerShell 5.1이다.
 * macOS·Linux는 사용자의 로그인 셸(`$SHELL`)이고 PATH를 훑지 않는다.
 */
export async function defaultShell(opts: Pick<ShellLookup, 'platform' | 'env' | 'find'>): Promise<string> {
  if (opts.platform === 'win32') return (await opts.find('pwsh')) ?? windowsPowerShell(opts.env)
  return posixLoginShell(opts.env)
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
export async function resolveShell(setting: string | null, opts: Pick<ShellLookup, 'platform' | 'env' | 'find'>): Promise<ShellChoice> {
  const file = setting ?? await defaultShell(opts)
  return { file, args: shellArgs(file, opts.platform), name: shellName(file, opts.platform) }
}

/** `root` 아래인가 — 대소문자 무시, 경로 경계에서 (`C:\Windows2`는 `C:\Windows` 아래가 아니다) */
function isUnderWin(path: string, root: string): boolean {
  const base = root.replace(/[\\/]+$/, '').toLowerCase()
  return path.toLowerCase().startsWith(`${base}\\`)
}

/**
 * Git Bash (terminal-tabs FR-10). **PATH의 `bash`는 보지 않는다** — `C:\Windows\System32`가 Git보다 앞에 오는 PATH가 흔하고 그 자리의
 * `bash.exe`는 WSL을 띄우는 껍데기다. PATH의 `git.exe`에서 Git 루트를 거슬러 오르고(`cmd`·`bin`이면 부모, `mingw64\bin`이면 그 위의
 * 위), 이어 고정 설치 자리를 본다. SystemRoot·WindowsApps 아래는 규칙이 바뀌어도 "Git Bash"로 뜨지 않게 따로 거른다.
 */
export async function findGitBash(lookup: ShellLookup): Promise<string | null> {
  const candidates: string[] = []
  const git = await lookup.find('git')
  if (git) {
    const dir = win32.dirname(git)
    const leaf = win32.basename(dir).toLowerCase()
    const parent = win32.dirname(dir)
    const root = leaf === 'bin' && win32.basename(parent).toLowerCase() === 'mingw64'
      ? win32.dirname(parent)
      : leaf === 'cmd' || leaf === 'bin' ? parent : null
    if (root) candidates.push(win32.join(root, 'bin', 'bash.exe'))
  }
  for (const name of ['ProgramFiles', 'ProgramFiles(x86)']) {
    const base = envValue(lookup.env, name)
    if (base) candidates.push(win32.join(base, 'Git', 'bin', 'bash.exe'))
  }
  const localAppData = envValue(lookup.env, 'LOCALAPPDATA')
  if (localAppData) candidates.push(win32.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))

  const wslPlaces = [systemRoot(lookup.env), ...(localAppData ? [win32.join(localAppData, 'Microsoft', 'WindowsApps')] : [])]
  for (const candidate of candidates) {
    if (wslPlaces.some((place) => isUnderWin(candidate, place))) continue
    if (await lookup.exists(candidate)) return candidate
  }
  return null
}

/** 키 하나 — 찾는 법과 메뉴의 긴 이름. 표의 순서가 메뉴의 순서다 (FR-8) */
interface ShellSpec {
  key: TerminalShellOption['key']
  label: (file: string) => string
  locate: (lookup: ShellLookup) => Promise<string | null>
}

const existing = (lookup: ShellLookup, path: string) => lookup.exists(path).then((ok) => (ok ? path : null))

const WINDOWS_SHELLS: readonly ShellSpec[] = [
  { key: 'pwsh', label: () => 'PowerShell 7', locate: (l) => l.find('pwsh') },
  { key: 'powershell', label: () => 'Windows PowerShell', locate: (l) => existing(l, windowsPowerShell(l.env)) },
  // `%ComSpec%`가 아니다 — 사용자가 바꿀 수 있는 값이라 "cmd"라는 이름이 다른 것을 띄울 수 있다
  { key: 'cmd', label: () => '명령 프롬프트', locate: (l) => existing(l, win32.join(systemRoot(l.env), 'System32', 'cmd.exe')) },
  { key: 'git-bash', label: () => 'Git Bash', locate: findGitBash }
]

// `/etc/shells`는 읽지 않는다 (spec §0-B의 5)
const POSIX_SHELLS: readonly ShellSpec[] = [
  { key: 'login', label: (file) => posix.basename(file), locate: async (l) => posixLoginShell(l.env) }
]

const hostShells = (platform: NodeJS.Platform) => (platform === 'win32' ? WINDOWS_SHELLS : POSIX_SHELLS)

const samePath = (a: string, b: string, platform: NodeJS.Platform) =>
  platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/**
 * 이 장비·이 repo에서 고를 수 있는 셸 (FR-8·9). `defaultFile`은 지금 `default`가 풀린 경로다 — 메뉴의 `기본` 표식이 `+`가 띄울 셸과
 * 갈리지 않게 호출자가 `resolveShellKey('default', …)`의 결과를 넘긴다.
 */
export async function discoverShells(env: ProcessEnvSpec, lookup: ShellLookup, defaultFile: string): Promise<TerminalShellOption[]> {
  if (env.kind === 'wsl') return [{ key: 'wsl', label: `WSL · ${env.distro}`, path: `wsl.exe -d ${env.distro}`, isDefault: true }]
  const found = await Promise.all(hostShells(lookup.platform).map(async (spec) => ({ spec, file: await spec.locate(lookup) })))
  return found.flatMap(({ spec, file }) => (file === null ? [] : [{
    key: spec.key, label: spec.label(file), path: file, isDefault: samePath(file, defaultFile, lookup.platform)
  }]))
}

/** WSL repo의 셸 — 그 distro의 로그인 셸. wsl.exe로 감싸는 것은 서비스다(런처·pidfile이 탭마다라) */
const WSL_LOGIN = { file: 'sh', args: ['-c', 'exec "${SHELL:-/bin/bash}" -l'] }

/**
 * 키 → 띄울 셸 (FR-11·12). 메뉴·만들기·다시 시작이 전부 이것을 탄다. 그 repo·그 장비의 목록에 없는 키는 셸을 띄우기 전에 던진다 —
 * IPC에서 온 문자열이라 키인지부터 본다.
 */
export async function resolveShellKey(
  key: string, env: ProcessEnvSpec, lookup: ShellLookup, setting: string | null
): Promise<ShellChoice> {
  const refuse = () => new Error(`이 repo에서 쓸 수 없는 셸입니다: ${key}`)
  if (!isTerminalShellKey(key)) throw refuse()
  if (env.kind === 'wsl') {
    if (key !== 'default' && key !== 'wsl') throw refuse()
    return { file: WSL_LOGIN.file, args: [...WSL_LOGIN.args], name: `wsl · ${env.distro}` }
  }
  if (key === 'default') return resolveShell(setting, lookup)
  const spec = hostShells(lookup.platform).find((s) => s.key === key)
  const file = spec ? await spec.locate(lookup) : null
  if (!file) throw refuse()
  return { file, args: shellArgs(file, lookup.platform), name: shellName(file, lookup.platform) }
}

/** 탭 이름 (FR-15) — `base`가 비었으면 그것, 아니면 비어 있는 가장 작은 번호 */
export function nextTabLabel(base: string, others: readonly string[]): string {
  if (!others.includes(base)) return base
  let n = 2
  while (others.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** 다시 시작한 셸의 이름 (FR-16) — 셸 이름이 같으면 지키고, 다르면(설정을 바꾼 `default` 탭) 새로 매긴다 */
export function restartLabel(old: { base: string; label: string }, newBase: string, others: readonly string[]): string {
  return newBase === old.base ? old.label : nextTabLabel(newBase, others)
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
