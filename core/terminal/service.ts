import type { Repo, TerminalData, TerminalExit, TerminalOpenInput, TerminalSession } from '@shared/models'
import type { ErrorSink } from '../errors'
import type { TreeKiller } from '../runner/terminate'
import { createOutputBuffer, type OutputBuffer } from './buffer'
import type { ShellChoice } from './shell'

/**
 * 코드 칸의 터미널 — repo마다 셸 하나 (`docs/sdlc/code-editor/terminal-spec.md` FR-5~10·18·20).
 *
 * **pty는 주입받는다**(FR-21). 진짜 `node-pty`는 네이티브 모듈이라 electron 메인이 넘기고, 단위 테스트는 가짜로 돈다. 셸 경로와
 * repo 경로는 여기서 정한다 — 렌더러는 repo id만 넘긴다(FR-18).
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
  /** 지금 설정의 셸(비면 기본값) — 셸을 띄울 때마다 읽는다(FR-14: 바꾼 셸은 다음에 뜨는 셸부터) */
  resolveShell: () => Promise<ShellChoice>
  /** 그 workspace의 repo. 아니면 던진다 */
  repoOf: (workspaceId: string, repoId: string) => Repo
  /** 셸의 환경(`shellEnv(process.env)`) */
  env: () => Record<string, string>
  /** Windows 트리 종료 — 다시 시작·repo 종료에 쓴다(비동기) */
  killTree: TreeKiller
  /** Windows 트리 종료의 동기판 — **앱 종료 경로 전용**(FR-9, `taskkillTreeSync`) */
  killTreeSync: TreeKiller
  platform: NodeJS.Platform
  onData: (data: TerminalData) => void
  onExit: (exit: TerminalExit) => void
  onError: ErrorSink
}

interface Shell {
  repoId: string
  generation: number
  shell: ShellChoice
  pty: PtyProcess
  buffer: OutputBuffer
  exited: { exitCode: number } | null
  /** 아직 내보내지 않은 출력 — 시작 위치와 글 */
  pending: { start: number; data: string } | null
  timer: ReturnType<typeof setTimeout> | null
}

export function createTerminalService(deps: TerminalServiceDeps) {
  const shells = new Map<string, Shell>()
  /** 띄우는 중인 셸 — 동시에 두 번 열어도 하나만 띄운다 */
  const starting = new Map<string, Promise<Shell>>()
  /** 서비스 전체에서 오르는 번호 — 끝낸 repo를 다시 열어도 옛 번호와 겹치지 않는다 */
  let nextGeneration = 1

  function flush(shell: Shell): void {
    if (shell.timer) { clearTimeout(shell.timer); shell.timer = null }
    const pending = shell.pending
    if (!pending) return
    shell.pending = null
    deps.onData({ repoId: shell.repoId, generation: shell.generation, start: pending.start, data: pending.data })
  }

  /** 지금 이 repo의 셸인가 — 다시 시작·끝낸 뒤 옛 pty의 늦은 출력·끝남을 버린다 */
  function isCurrent(shell: Shell): boolean {
    return shells.get(shell.repoId) === shell
  }

  async function launch(input: TerminalOpenInput): Promise<Shell> {
    const repo = deps.repoOf(input.workspaceId, input.repoId)
    const choice = await deps.resolveShell()
    let pty: PtyProcess
    try {
      pty = deps.spawnPty(choice.file, choice.args, {
        name: 'xterm-256color', cols: input.cols, rows: input.rows, cwd: repo.path, env: deps.env()
      })
    } catch (err) {
      throw new Error(`셸을 띄우지 못했습니다: ${choice.file} (${err instanceof Error ? err.message : String(err)})`)
    }
    const shell: Shell = {
      repoId: repo.id, generation: nextGeneration++, shell: choice, pty, buffer: createOutputBuffer(),
      exited: null, pending: null, timer: null
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
      deps.onExit({ repoId: shell.repoId, generation: shell.generation, exitCode })
    })
    shells.set(repo.id, shell)
    return shell
  }

  function session(shell: Shell): TerminalSession {
    return {
      repoId: shell.repoId,
      generation: shell.generation,
      shell: shell.shell.name,
      shellPath: shell.shell.file,
      snapshot: shell.buffer.snapshot(),
      exited: shell.exited
    }
  }

  /**
   * 셸을 트리째 끝낸다. Windows는 셸이 띄운 자식(dev 서버)까지 `taskkill /T /F`로 — 실패하면 셸만이라도. macOS·Linux는 pty의
   * kill이다(셸이 끝나면 그 세션의 프로세스가 SIGHUP을 받는다).
   */
  function end(shell: Shell, sync: boolean): void {
    if (shell.timer) { clearTimeout(shell.timer); shell.timer = null }
    shell.pending = null
    if (shell.exited) return
    const killPty = () => {
      try { shell.pty.kill() } catch (err) { deps.onError('셸을 끝내지 못했습니다', err) }
    }
    if (deps.platform !== 'win32') { killPty(); return }
    const kill = sync ? deps.killTreeSync : deps.killTree
    kill(shell.pty.pid, (err) => {
      deps.onError('셸 트리를 끝내지 못했습니다 — 셸만 끝냅니다', err)
      killPty()
    })
  }

  function running(repoId: string): Shell {
    const shell = shells.get(repoId)
    if (!shell) throw new Error('열린 셸이 없습니다')
    return shell
  }

  return {
    /** 그 repo의 셸에 붙는다 — 없으면 띄운다(FR-5) */
    async open(input: TerminalOpenInput): Promise<TerminalSession> {
      const existing = shells.get(input.repoId)
      if (existing) {
        // 남의 workspace에서 같은 repo id로 붙을 수 없게 매번 확인한다(FR-18)
        deps.repoOf(input.workspaceId, input.repoId)
        return session(existing)
      }
      let pending = starting.get(input.repoId)
      if (!pending) {
        pending = launch(input).finally(() => { starting.delete(input.repoId) })
        starting.set(input.repoId, pending)
      }
      return session(await pending)
    },

    write(repoId: string, data: string): void {
      const shell = running(repoId)
      if (shell.exited) throw new Error('셸이 끝났습니다')
      shell.pty.write(data)
    },

    /** 칸의 크기가 바뀌었다. 끝났거나 없는 셸이면 무시한다 — 칸이 닫히는 중에 올 수 있다 */
    resize(repoId: string, cols: number, rows: number): void {
      const shell = shells.get(repoId)
      if (!shell || shell.exited) return
      try { shell.pty.resize(cols, rows) } catch (err) { deps.onError('셸 크기를 바꾸지 못했습니다', err) }
    },

    /** `셸 다시 시작` (FR-8) — 도는 셸을 트리째 끝내고 새로 띄운다. 새 셸은 지금 설정의 셸이다(FR-14) */
    async restart(input: TerminalOpenInput): Promise<TerminalSession> {
      deps.repoOf(input.workspaceId, input.repoId)
      const old = shells.get(input.repoId)
      if (old) {
        shells.delete(input.repoId)
        end(old, false)
      }
      return session(await launch(input))
    },

    /** repo를 지우거나 경로를 바꿨다 (FR-10) */
    killRepo(repoId: string): void {
      const shell = shells.get(repoId)
      if (!shell) return
      shells.delete(repoId)
      end(shell, false)
    },

    /** 앱 종료 (FR-9) — **동기로** 트리째 끝낸다 */
    killAll(): void {
      for (const shell of shells.values()) end(shell, true)
      shells.clear()
    }
  }
}

export type TerminalService = ReturnType<typeof createTerminalService>
