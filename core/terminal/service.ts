import { rmSync } from 'node:fs'
import {
  TERMINAL_TABS_PER_REPO,
  type Repo, type TerminalCreateInput, type TerminalData, type TerminalExit, type TerminalOpenInput, type TerminalSession,
  type TerminalShellKey, type TerminalShellOption, type TerminalTab, type TerminalTabInput, type TerminalTabRef
} from '@shared/models'
import type { ErrorSink } from '../errors'
import { readPgid, type TreeKiller } from '../runner/terminate'
import { envOfRepo } from '../wsl/env'
import { wrapForEnv } from '../wsl/launch'
import type { GroupKiller } from '../wsl/kill'
import { createOutputBuffer, type OutputBuffer } from './buffer'
import { nextTabLabel, restartLabel, type ShellChoice } from './shell'

/**
 * 코드 칸의 터미널 — repo마다 탭 여럿, 탭마다 셸 하나 (`docs/sdlc/terminal-tabs/spec.md`, `docs/sdlc/code-editor/terminal-spec.md`).
 *
 * **pty는 주입받는다**(terminal-spec FR-21). 진짜 `node-pty`는 네이티브 모듈이라 electron 메인이 넘기고, 단위 테스트는 가짜로 돈다.
 * 셸 경로와 repo 경로는 여기서 정한다 — 렌더러는 repo id·탭 id·셸 키만 넘긴다(FR-18). 탭은 평평한 `Map<tabId, Shell>`이다
 * (terminal-tabs §2-3의 A) — 거의 모든 호출이 탭 하나를 겨누고, `Map.set`은 있던 키의 자리를 지켜 다시 시작이 자리를 공짜로 지킨다.
 */

/** `node-pty`의 `IPty` 중 쓰는 것만 */
export interface PtyProcess {
  readonly pid: number
  onData(cb: (data: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export type SpawnPty = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }
) => PtyProcess

/** 출력을 모아 보내는 간격 — 빌드 로그가 쏟아져도 IPC가 줄마다 밀리지 않게 */
export const FLUSH_MS = 16

export interface TerminalServiceDeps {
  spawnPty: SpawnPty
  /**
   * 키 → 셸 (terminal-tabs FR-11·12, `resolveShellKey`). 셸을 띄울 때마다 푼다 — `default`는 그때의 설정이다(terminal-spec FR-14).
   * WSL repo면 그 distro 안의 명령을 돌려주고 감싸기는 여기서 한다. 그 repo에서 쓸 수 없는 키면 던진다
   */
  resolveShell: (key: string, repo: Repo) => Promise<ShellChoice>
  /** 그 repo의 `셸 고르기` 메뉴 (FR-7~9) */
  discover: (repo: Repo) => Promise<TerminalShellOption[]>
  /** 새 탭 id — 실제는 `randomUUID` */
  newId: () => string
  /** 그 workspace의 repo. 아니면 던진다 */
  repoOf: (workspaceId: string, repoId: string) => Repo
  /** 셸의 환경(`shellEnv(process.env)`) */
  env: () => Record<string, string>
  /** Windows 트리 종료 — 다시 시작·닫기·repo 종료에 쓴다(비동기) */
  killTree: TreeKiller
  /** Windows 트리 종료의 동기판 — **앱 종료 경로 전용**(terminal-spec FR-9, `taskkillTreeSync`) */
  killTreeSync: TreeKiller
  /**
   * WSL 안의 **세션** 종료 — 비동기(다시 시작·닫기·repo 종료)·동기(앱 종료) (wsl-support FR-30). 그룹이 아니다: 대화형 bash는 작업마다
   * 그룹을 따로 만들어 그룹 KILL은 셸만 맞힌다. `kill.ts`의 `killSession`·`killSessionSync`다
   */
  killSession: GroupKiller
  killSessionSync: GroupKiller
  /** WSL 셸의 런처(Linux 경로 둘 + pidfile의 Windows 경로). pidfile은 **탭마다**다(FR-21) */
  wslLauncher: (distro: string, tabId: string) => Promise<{ path: string; pidfile: string; pidfileHost: string }>
  /** WSL 셸의 Windows 쪽 cwd — wsl.exe 자신이 UNC에서 뜨려다 실패하지 않게 늘 있는 디렉토리(userData) */
  hostCwd: string
  platform: NodeJS.Platform
  onData: (data: TerminalData) => void
  onExit: (exit: TerminalExit) => void
  onError: ErrorSink
}

interface Shell {
  tabId: string
  repoId: string
  key: TerminalShellKey
  /** 셸 이름(`pwsh`) — 탭 이름의 번호를 매기는 바탕 */
  base: string
  label: string
  generation: number
  /** 띄운 실행 파일 — WSL이면 wsl.exe */
  file: string
  pty: PtyProcess
  buffer: OutputBuffer
  exited: { exitCode: number } | null
  /** 끝냈다 — 다시 끝내지 않고(pid는 재사용됐을 수 있다), 늦은 출력·끝남을 버린다 */
  ended: boolean
  /** WSL 셸이면 안에서 끝낼 세션의 pidfile (wsl-support FR-30) */
  wsl: { distro: string; pidfileHost: string } | null
  /** 아직 내보내지 않은 출력 — 시작 위치와 글 */
  pending: { start: number; data: string } | null
  timer: ReturnType<typeof setTimeout> | null
}

type Size = { cols: number; rows: number }

export function createTerminalService(deps: TerminalServiceDeps) {
  const shells = new Map<string, Shell>()
  /** 탭이 없는 repo의 첫 탭을 띄우는 중 — 동시에 두 번 열어도 하나만 (FR-5) */
  const starting = new Map<string, Promise<unknown>>()
  /** repo마다 띄우는 중인 탭 수 — 상한이 그것도 센다 (FR-3) */
  const launching = new Map<string, number>()
  /**
   * 끝내기의 세대 — `killRepo`가 repo의 것을, `killAll`이 전체의 것을 올린다. 띄우는 중에 세대가 바뀌었으면 돌아온 셸을 곧바로 끝낸다
   * (FR-19): 안 그러면 지운 repo의 셸이 목록에 들어가 앱을 끌 때까지 돈다
   */
  const repoEpoch = new Map<string, number>()
  let allEpoch = 0
  /** 서비스 전체에서 오르는 번호 — 끝낸 탭을 다시 열어도 옛 번호와 겹치지 않는다 */
  let nextGeneration = 1

  const tabsOf = (repoId: string) => [...shells.values()].filter((s) => s.repoId === repoId)

  function flush(shell: Shell): void {
    if (shell.timer) { clearTimeout(shell.timer); shell.timer = null }
    const pending = shell.pending
    if (!pending) return
    shell.pending = null
    deps.onData({ tabId: shell.tabId, generation: shell.generation, start: pending.start, data: pending.data })
  }

  /** 지금 이 탭의 셸인가 — 다시 시작·끝낸 뒤 옛 pty의 늦은 출력·끝남을 버린다 */
  function isCurrent(shell: Shell): boolean {
    return !shell.ended && shells.get(shell.tabId) === shell
  }

  /**
   * 셸 하나를 띄운다. `replacing`이 있으면 다시 시작이다 — 그 탭이 그 사이 닫혔으면(목록의 셸이 바뀌었으면) 새 셸을 끝내고 던진다.
   * 아니면 새 탭이다 — 그 사이 repo·전체를 끝냈으면 같다.
   */
  async function launch(repo: Repo, key: TerminalShellKey, size: Size, tabId: string, replacing: Shell | null): Promise<Shell> {
    const startRepo = repoEpoch.get(repo.id) ?? 0
    const startAll = allEpoch
    const choice = await deps.resolveShell(key, repo)
    const env = envOfRepo(repo)
    let file = choice.file
    let args = choice.args
    let cwd = repo.path
    let wsl: Shell['wsl'] = null
    if (env.kind === 'wsl') {
      // WSL repo는 그 distro 안의 셸이다 (wsl-support FR-29) — 런처가 세션 id를 탭마다의 pidfile에 적어 안에서 끝낼 수 있게
      const launcher = await deps.wslLauncher(env.distro, tabId)
      const wrapped = wrapForEnv(env, choice.file, choice.args, { cwd: repo.path, launcher }, deps.env())
      file = wrapped.cmd
      args = wrapped.args
      cwd = deps.hostCwd
      wsl = { distro: env.distro, pidfileHost: launcher.pidfileHost }
    }
    let pty: PtyProcess
    try {
      pty = deps.spawnPty(file, args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd, env: deps.env() })
    } catch (err) {
      throw new Error(`셸을 띄우지 못했습니다: ${file} (${err instanceof Error ? err.message : String(err)})`)
    }
    const others = tabsOf(repo.id).filter((s) => s.tabId !== tabId).map((s) => s.label)
    const shell: Shell = {
      tabId, repoId: repo.id, key, base: choice.name,
      label: replacing ? restartLabel(replacing, choice.name, others) : nextTabLabel(choice.name, others),
      generation: nextGeneration++, file, pty, buffer: createOutputBuffer(), exited: null, ended: false, wsl, pending: null, timer: null
    }
    const allEnded = allEpoch !== startAll
    const interrupted = replacing
      ? (shells.get(tabId) !== replacing ? '터미널을 여는 사이 그 탭이 닫혔습니다' : null)
      : (allEnded || (repoEpoch.get(repo.id) ?? 0) !== startRepo ? '터미널을 여는 사이 repo의 셸이 끝났습니다' : null)
    if (interrupted) {
      end(shell, allEnded)
      throw new Error(interrupted)
    }
    pty.onData((data) => {
      if (!isCurrent(shell)) return
      const start = shell.buffer.append(data)
      if (shell.pending) shell.pending.data += data
      else shell.pending = { start, data }
      shell.timer ??= setTimeout(() => { shell.timer = null; flush(shell) }, FLUSH_MS)
    })
    pty.onExit(({ exitCode }) => {
      if (!isCurrent(shell)) return
      flush(shell)
      shell.exited = { exitCode }
      deps.onExit({ tabId: shell.tabId, generation: shell.generation, exitCode })
    })
    shells.set(tabId, shell)
    return shell
  }

  /** 새 탭 — 상한을 띄우는 중인 것까지 세어 본다 (FR-3) */
  async function launchTab(repo: Repo, key: TerminalShellKey, size: Size): Promise<Shell> {
    const busy = launching.get(repo.id) ?? 0
    if (tabsOf(repo.id).length + busy >= TERMINAL_TABS_PER_REPO) {
      throw new Error(`터미널은 repo당 ${TERMINAL_TABS_PER_REPO}개까지입니다 — 하나를 닫으세요`)
    }
    launching.set(repo.id, busy + 1)
    try {
      return await launch(repo, key, size, deps.newId(), null)
    } finally {
      const left = (launching.get(repo.id) ?? 1) - 1
      if (left === 0) launching.delete(repo.id)
      else launching.set(repo.id, left)
    }
  }

  function tab(shell: Shell): TerminalTab {
    return { tabId: shell.tabId, repoId: shell.repoId, label: shell.label, shellKey: shell.key, shellPath: shell.file, exited: shell.exited }
  }

  function session(shell: Shell): TerminalSession {
    return { ...tab(shell), generation: shell.generation, snapshot: shell.buffer.snapshot() }
  }

  /**
   * 셸을 트리째 끝낸다 (FR-18). Windows는 셸이 띄운 자식(dev 서버)까지 `taskkill /T /F`로 — 실패하면 셸만이라도. macOS·Linux는 pty의
   * kill이다(셸이 끝나면 그 세션의 프로세스가 SIGHUP을 받는다). 두 번 부르면 아무것도 하지 않는다.
   */
  function end(shell: Shell, sync: boolean): void {
    if (shell.ended) return
    shell.ended = true
    if (shell.timer) { clearTimeout(shell.timer); shell.timer = null }
    shell.pending = null
    // WSL 셸의 pidfile은 읽고 곧바로 지운다(terminal-spec FR-19) — 셸이 스스로 끝났어도. 남겨 두면 다시 시작한 셸의 런처가 쓰기 전에
    // 또 끝낼 때 옛 세션을 겨눈다.
    const sid = shell.wsl ? readPgid(shell.wsl.pidfileHost) : null
    if (shell.wsl) {
      try { rmSync(shell.wsl.pidfileHost, { force: true }) } catch (err) { deps.onError('WSL 셸의 pidfile을 지우지 못했습니다', err) }
    }
    if (shell.exited) return
    const killPty = () => {
      try { shell.pty.kill() } catch (err) { deps.onError('셸을 끝내지 못했습니다', err) }
    }
    // WSL 셸은 **세션**을 안에서 먼저 끝낸다 (wsl-support FR-30) — 대화형 bash는 작업마다 그룹을 따로 만들어 그룹 KILL은 셸만
    // 맞히고 `npm run dev &`가 남았다(실측). wsl.exe의 `--exec`가 명령을 세션 리더로 띄우므로 pidfile의 수가 곧 sid다. pidfile이
    // 아직 없으면(런처가 쓰기 전) pty만. 플랫폼과 무관하다.
    if (shell.wsl) {
      if (sid !== null) {
        (sync ? deps.killSessionSync : deps.killSession)(shell.wsl.distro, sid, 'KILL', (err) => {
          deps.onError('WSL 셸의 세션을 끝내지 못했습니다 — wsl.exe만 끝냅니다', err)
        })
      }
      killPty()
      return
    }
    if (deps.platform !== 'win32') { killPty(); return }
    const kill = sync ? deps.killTreeSync : deps.killTree
    kill(shell.pty.pid, (err) => {
      deps.onError('셸 트리를 끝내지 못했습니다 — 셸만 끝냅니다', err)
      killPty()
    })
  }

  /** 탭을 받는 호출은 그 탭의 repo가 넘긴 workspace의 것인지 매번 본다 (FR-14) */
  function owned(ref: TerminalTabRef): { shell: Shell; repo: Repo } {
    const shell = shells.get(ref.tabId)
    if (!shell) throw new Error('열린 터미널이 없습니다')
    return { shell, repo: deps.repoOf(ref.workspaceId, shell.repoId) }
  }

  return {
    /** 그 repo의 탭 목록(만든 순) — 없으면 기본 셸 탭 하나를 띄운 뒤 준다 (FR-5) */
    async open(input: TerminalOpenInput): Promise<TerminalTab[]> {
      const repo = deps.repoOf(input.workspaceId, input.repoId)
      if (tabsOf(repo.id).length === 0) {
        let pending = starting.get(repo.id)
        if (!pending) {
          // 끝내기가 이 자리를 비우고 새 띄우기가 들어섰을 수 있다 — 제 것일 때만 지운다
          const mine: Promise<unknown> = launchTab(repo, 'default', input).finally(() => {
            if (starting.get(repo.id) === mine) starting.delete(repo.id)
          })
          pending = mine
          starting.set(repo.id, mine)
        }
        await pending
      }
      return tabsOf(repo.id).map(tab)
    },

    /** `셸 고르기` 메뉴 — 열 때마다 새로 묻는다 (FR-7) */
    async shells(input: { workspaceId: string; repoId: string }): Promise<TerminalShellOption[]> {
      return deps.discover(deps.repoOf(input.workspaceId, input.repoId))
    },

    /** `+`·메뉴 — 그 키로 새 탭 (FR-3·12) */
    async create(input: TerminalCreateInput): Promise<TerminalSession> {
      const repo = deps.repoOf(input.workspaceId, input.repoId)
      return session(await launchTab(repo, input.shell, input))
    },

    /** 탭에 붙는다 — 스냅샷을 준다. 셸을 띄우지 않는다 */
    async attach(ref: TerminalTabRef): Promise<TerminalSession> {
      return session(owned(ref).shell)
    },

    write(tabId: string, data: string): void {
      const shell = shells.get(tabId)
      if (!shell) throw new Error('열린 터미널이 없습니다')
      if (shell.exited || shell.ended) throw new Error('셸이 끝났습니다')
      shell.pty.write(data)
    },

    /** 칸의 크기가 바뀌었다. 끝났거나 없는 셸이면 무시한다 — 칸이 닫히는 중에 올 수 있다 */
    resize(tabId: string, cols: number, rows: number): void {
      const shell = shells.get(tabId)
      if (!shell || shell.exited || shell.ended) return
      try { shell.pty.resize(cols, rows) } catch (err) { deps.onError('셸 크기를 바꾸지 못했습니다', err) }
    },

    /**
     * `셸 다시 시작` (terminal-spec FR-8) — 도는 셸을 트리째 끝내고 같은 탭에 새로 띄운다. 같은 키를 **지금** 다시 푼다(FR-14 — `default`
     * 탭은 바꾼 설정을 따른다). 띄우지 못하면 탭이 사라진다 — 끝낸 셸을 도는 것처럼 남기지 않는다
     */
    async restart(input: TerminalTabInput): Promise<TerminalSession> {
      const { shell: old, repo } = owned(input)
      end(old, false)
      try {
        return session(await launch(repo, old.key, input, old.tabId, old))
      } catch (err) {
        if (shells.get(old.tabId) === old) shells.delete(old.tabId)
        throw err
      }
    },

    /** 탭의 닫기 (FR-2·18) — 그 셸만 트리째 */
    async close(ref: TerminalTabRef): Promise<void> {
      const { shell } = owned(ref)
      shells.delete(shell.tabId)
      end(shell, false)
    },

    /** repo를 지우거나 경로·실행 환경을 바꿨다 (FR-19) — 그 repo의 탭 전부, 띄우는 중인 것까지 */
    killRepo(repoId: string): void {
      repoEpoch.set(repoId, (repoEpoch.get(repoId) ?? 0) + 1)
      // 띄우는 중인 첫 탭은 곧 던진다 — 그동안 온 열기가 그것을 기다리지 않고 새로 띄우게
      starting.delete(repoId)
      for (const shell of tabsOf(repoId)) {
        shells.delete(shell.tabId)
        end(shell, false)
      }
    },

    /** 앱 종료 (FR-20) — 모든 탭을 **동기로** 트리째 끝낸다 */
    killAll(): void {
      allEpoch++
      starting.clear()
      for (const shell of shells.values()) end(shell, true)
      shells.clear()
    }
  }
}

export type TerminalService = ReturnType<typeof createTerminalService>
