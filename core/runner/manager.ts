import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { AgentKind, Permission, RunStatus } from '@shared/models'
import type { RunEvent, RunEventInit } from '@shared/events'
import type { AgentAdapter, McpRunConfig } from './types'
import { createLineSplitter } from './stream'
import { createLogWriter } from './logWriter'
import type { ErrorSink } from '../errors'

/** SIGTERM 후 SIGKILL까지의 유예 */
const KILL_GRACE_MS = 3000

export interface RunManagerOptions {
  adapters: Record<AgentKind, AgentAdapter>
  /** 로그 루트. 실제 파일은 <logDir>/<runId>/stream.jsonl */
  logDir: string
  onEvent: (event: RunEvent) => void
  /**
   * 로그 파일을 열지 못했을 때처럼, 삼킬 수밖에 없는 오류가 나가는 곳.
   *
   * **선택 인자가 아닌 이유:** 기본값을 두면 core/index.ts가 이 값을 넘기는
   * 배선 한 줄을 지워도 조용히 컴파일된다. 오류가 앱의 sink 대신 stderr로
   * 새는데 어떤 테스트도 빨개지지 않는다. 필수로 두면 typecheck가 막는다.
   */
  onError: ErrorSink
}

export interface StartSpec {
  runId: string
  agentKind: AgentKind
  cwd: string
  model: string | null
  permission: Permission
  prompt: string
  resumeSessionId: string | null
  executable: string
  /** MCP 접속 정보. 없으면 어댑터가 MCP 인자를 통째로 건너뛴다 */
  mcp?: McpRunConfig | null
  timeoutMs?: number | null
  /** 테스트에서 가짜 CLI를 주입하는 통로. 실제 실행에서는 비어 있다. */
  extraArgs?: string[]
}

export interface RunOutcome {
  status: RunStatus
  resultText: string | null
  externalSessionId: string | null
  needsAnswer: boolean
  exitCode: number | null
  errorMessage: string | null
  logPath: string
}

export function createRunManager(opts: RunManagerOptions) {
  const active = new Map<string, ChildProcess>()
  const cancels = new Map<string, () => void>()

  /**
   * run의 로그 파일 경로. 이 함수가 경로의 단일 출처다.
   * 호출자(실행 서비스)가 같은 계산을 따로 하면 DB의 log_path와 실제 파일이
   * 어긋나 재시작 후 로그 재현이 조용히 깨진다.
   */
  function logPathFor(runId: string): string {
    return join(opts.logDir, runId, 'stream.jsonl')
  }

  function isRunning(runId: string): boolean {
    return active.has(runId)
  }

  async function start(spec: StartSpec): Promise<RunOutcome> {
    // 동시 실행 상한은 RunQueue가 본다. 여기 남은 것은 같은 run을 두 번 띄우지
    // 않는다는 방어선뿐이다 — 두 번 띄우면 로그 파일 하나에 두 프로세스가 쓴다.
    if (active.has(spec.runId)) {
      throw new Error(`이미 실행 중인 run입니다: ${spec.runId}`)
    }

    const adapter = opts.adapters[spec.agentKind]
    const built = adapter.buildCommand({
      runId: spec.runId,
      cwd: spec.cwd,
      model: spec.model,
      permission: spec.permission,
      prompt: spec.prompt,
      resumeSessionId: spec.resumeSessionId,
      executable: spec.executable,
      // 이 한 줄이 빠지면 MCP가 통째로 꺼진다. 각 계층의 단위 테스트는 전부 초록이다.
      mcp: spec.mcp ?? null
    })

    // extraArgs가 있으면 그것을 앞에 붙인다 (테스트에서 가짜 CLI 주입)
    const args = spec.extraArgs ? [...spec.extraArgs, ...built.args] : built.args

    const logPath = logPathFor(spec.runId)
    const log = createLogWriter(logPath, opts.onError)

    let seq = 0
    let sessionId: string | null = null
    let resultText: string | null = null
    let needsAnswer = false
    let reportedStatus: RunStatus | null = null
    let canceled = false
    let timedOut = false

    function emit(raw: RunEventInit) {
      const event = { ...raw, seq: seq++ } as RunEvent
      log.write(event)
      opts.onEvent(event)

      if (event.type === 'session') sessionId = event.sessionId
      if (event.type === 'result') {
        reportedStatus = event.status
        resultText = event.resultText
        needsAnswer = event.needsAnswer
        if (event.sessionId) sessionId = event.sessionId
      }
    }

    const child = spawn(built.cmd, args, {
      cwd: built.cwd,
      env: built.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    active.set(spec.runId, child)
    // 등록은 spawn 직후여야 한다. 종료를 기다린 뒤에 등록하면 영원히 등록되지 않는다.
    cancels.set(spec.runId, () => {
      canceled = true
      terminate(child)
    })

    // 프롬프트는 stdin으로 넘긴다 (인자 길이 제한 회피).
    // 닫지 않으면 Claude Code가 3초를 기다린 뒤에야 진행한다.
    child.stdin?.write(spec.prompt)
    child.stdin?.end()

    const splitter = createLineSplitter((line) => {
      for (const raw of adapter.parseLine(line, spec.runId)) emit(raw)
    })
    child.stdout?.on('data', (chunk: Buffer) => splitter(chunk))

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    let timer: NodeJS.Timeout | null = null
    if (spec.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        terminate(child)
      }, spec.timeoutMs)
    }

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code))
      child.on('error', (err) => {
        emit({ type: 'error', runId: spec.runId, at: Date.now(), message: err.message })
        resolve(null)
      })
    })

    if (timer) clearTimeout(timer)
    splitter.flush()
    active.delete(spec.runId)
    // 등록을 지우지 않으면 이미 끝난 run의 클로저가 계속 쌓인다.
    cancels.delete(spec.runId)
    await log.close()

    const status: RunStatus =
      timedOut || canceled ? 'canceled'
      : reportedStatus ?? (exitCode === 0 ? 'succeeded' : 'failed')

    const errorMessage =
      timedOut ? '실행 시간이 초과되어 중단했습니다.'
      : canceled ? null
      : status === 'failed' && stderr ? stderr.slice(0, 2000)
      : null

    return { status, resultText, externalSessionId: sessionId, needsAnswer, exitCode, errorMessage, logPath }
  }

  function cancel(runId: string): void {
    cancels.get(runId)?.()
  }

  function cancelAll(): void {
    for (const fn of cancels.values()) fn()
  }

  return { start, cancel, cancelAll, isRunning, logPathFor }
}

export type RunManager = ReturnType<typeof createRunManager>

/** SIGTERM을 보내고, 유예 후에도 살아 있으면 SIGKILL. */
function terminate(child: ChildProcess): void {
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS).unref()
}
