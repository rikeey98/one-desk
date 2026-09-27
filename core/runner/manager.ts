import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { AgentKind, Permission, RunStatus } from '@shared/models'
import type { RunEvent, RunEventInit, RunUsage } from '@shared/events'
import type { AgentAdapter, McpRunConfig } from './types'
import { createLineSplitter } from './stream'
import { createLogWriter } from './logWriter'
import { taskkillTreeSync, terminate, type TreeKiller } from './terminate'
import { agentCommand } from './executable'
import type { ErrorSink } from '../errors'

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
  /** claude면 --effort, opencode면 --variant. **나르기만 한다 — 판단은 없다** */
  effort: string | null
  permission: Permission
  prompt: string
  resumeSessionId: string | null
  executable: string
  /** MCP 접속 정보. 없으면 어댑터가 MCP 인자를 통째로 건너뛴다 */
  mcp?: McpRunConfig | null
  timeoutMs?: number | null
  /** 테스트에서 가짜 CLI를 주입하는 통로. 실제 실행에서는 비어 있다. */
  extraArgs?: string[]
  /**
   * 프로세스를 띄우기 전에 먼저 흘려보낼 이벤트. 실행 전에 이미 알고 있는
   * 문제(예: 맥락에 담은 파일이 사라졌다)를 사용자에게 보이게 하는 통로다.
   * 조용히 넘기면 사용자는 agent가 읽고도 무시했다고 오해한다.
   */
  preEvents?: RunEventInit[]
  /**
   * 세션 id를 **알게 되는 즉시** 부른다 (`docs/sdlc/conversation-fixes/` spec FR-16).
   * 같은 id를 거듭 받으면 다시 부르지 않는다.
   *
   * 종료 때의 `RunOutcome.externalSessionId`만으로는 늦다 — 첫 턴이 도는 중 앱이 꺼지면
   * 행은 interrupted가 되는데 세션 id가 없어 그 대화를 이을 수 없다. 저장은 부르는
   * 쪽(실행 서비스)이 한다. manager는 DB를 모른다.
   *
   * **run마다 넘긴다 — manager 옵션이 아니다.** manager는 실행 서비스보다 먼저 만들어지고,
   * 저장할 run을 아는 것은 run을 띄우는 쪽이다.
   */
  onSession?: (runId: string, sessionId: string) => void
}

/**
 * 두 사용량을 겹친다 (`docs/sdlc/run-info/spec.md` §3-3).
 *
 * **필드마다 규칙이 다르다.** 토큰과 비용은 더하고(opencode는 스텝마다, claude는 턴에
 * 한 번 온다 — 하나를 더하면 그 하나가 되므로 한 규칙이 둘을 모두 맞춘다), 모델과
 * 컨텍스트 둘은 마지막 non-null이 이긴다(합이 아니라 상태다 — 컨텍스트를 더하면
 * 도구를 쓴 턴에서 창을 넘는다).
 *
 * null은 어느 쪽도 덮지 않는다. 모르는 값이 아는 값을 지우면 안 된다.
 */
export function mergeUsage(prev: RunUsage | null, next: RunUsage | null): RunUsage | null {
  if (!prev) return next
  if (!next) return prev

  const add = (a: number | null, b: number | null): number | null =>
    a === null ? b : b === null ? a : a + b
  const latest = <T>(a: T | null, b: T | null): T | null => (b === null ? a : b)

  return {
    model: latest(prev.model, next.model),
    inputTokens: add(prev.inputTokens, next.inputTokens),
    outputTokens: add(prev.outputTokens, next.outputTokens),
    cacheReadTokens: add(prev.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: add(prev.cacheWriteTokens, next.cacheWriteTokens),
    reasoningTokens: add(prev.reasoningTokens, next.reasoningTokens),
    costUsd: add(prev.costUsd, next.costUsd),
    contextTokens: latest(prev.contextTokens, next.contextTokens),
    contextWindow: latest(prev.contextWindow, next.contextWindow)
  }
}

/**
 * run의 최종 상태 (`docs/sdlc/conversation-fixes/` spec FR-12). **순서가 곧 규칙이다** —
 * 취소 → 타임아웃 → 비정상 종료 → 어댑터의 보고.
 *
 * **어댑터가 보고한 succeeded는 비정상 종료를 이기지 못한다.** opencode에는 종료
 * 이벤트가 없어 어댑터가 text 줄마다 succeeded를 합성한다(설계 2026-09-06 §7). 보고를
 * 종료 코드보다 먼저 보면 중간 텍스트를 낸 뒤 exit 1로 죽은 run이 성공이 된다 — 같은
 * 설계 §6의 "실제 판정은 종료 코드를 보는 runner가 한다"가 이 순서다. 종료 코드
 * null은 신호로 죽었거나 spawn조차 못 한 것이라 역시 실패다.
 *
 * 반대 방향은 보고가 이긴다: claude는 `is_error: true`를 exit 0으로 낼 수 있다.
 *
 * **타임아웃은 failed다 — 사용자가 누른 취소가 아니다** (spec FR-10). canceled로
 * 끝내면 인박스에서 "대기 중 취소됨"과 섞이고 배지에서도 빠진다. 둘이 겹치면(시간이
 * 다 된 뒤 사용자가 눌렀다) 사용자의 취소가 이긴다.
 */
export function judgeStatus(input: {
  canceled: boolean
  timedOut: boolean
  exitCode: number | null
  reportedStatus: RunStatus | null
}): RunStatus {
  if (input.canceled) return 'canceled'
  if (input.timedOut) return 'failed'
  if (input.exitCode !== 0) return 'failed'
  return input.reportedStatus ?? 'succeeded'
}

export interface RunOutcome {
  status: RunStatus
  resultText: string | null
  /** 모델·토큰·컨텍스트. 스트림이 알려주지 않았으면 null이다 */
  usage: RunUsage | null
  externalSessionId: string | null
  needsAnswer: boolean
  exitCode: number | null
  errorMessage: string | null
  logPath: string
}

export function createRunManager(opts: RunManagerOptions) {
  const active = new Map<string, ChildProcess>()
  /** 실행 중인 run의 멈추기. 트리 종료를 바꿔 끼울 수 있다 — 앱 종료 경로는 동기로 죽인다 */
  const cancels = new Map<string, (killTree?: TreeKiller) => void>()

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
      // model과 같은 성격이다 — 빠뜨려도 타입이 막아주지 않는 자리였다면
      // effort가 화면에는 남고 CLI에는 안 가는 상태가 조용히 생긴다.
      effort: spec.effort,
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
    let usage: RunUsage | null = null
    let needsAnswer = false
    let reportedStatus: RunStatus | null = null
    let canceled = false
    let timedOut = false
    /** 프로세스가 낸 마지막 오류. 실패했을 때 stderr보다 먼저 실패 이유가 된다 (FR-13) */
    let lastError: string | null = null

    /**
     * 세션 id를 기억하고, 새 값이면 곧바로 알린다 (spec FR-16).
     *
     * **알림 실패를 삼킨다.** 스트림의 data 핸들러 안에서 불리므로 새면 처리되지 않은
     * 예외가 되어 메인 프로세스가 통째로 내려간다. 저장에 실패해도 이 run은 끝까지
     * 돌고, 종료 기록(`externalSessionId`)이 한 번 더 남긴다 — 잃는 것은 "도는 중에
     * 앱이 꺼졌을 때 이어가기"뿐이다.
     */
    function learnSession(next: string | null) {
      // claude 어댑터는 session_id가 없으면 빈 문자열을 싣는다 — 세션이 아니다.
      if (!next || next === sessionId) return
      sessionId = next
      if (!spec.onSession) return
      try {
        spec.onSession(spec.runId, next)
      } catch (err) {
        opts.onError(`[manager] 세션 id를 저장하지 못했습니다 — 도는 중에 끊기면 이어갈 수 없다 (runId=${spec.runId})`, err)
      }
    }

    function emit(raw: RunEventInit) {
      const event = { ...raw, seq: seq++ } as RunEvent
      log.write(event)
      opts.onEvent(event)

      if (event.type === 'session') learnSession(event.sessionId)
      if (event.type === 'usage') usage = mergeUsage(usage, event.usage)
      if (event.type === 'result') {
        reportedStatus = event.status
        resultText = event.resultText
        needsAnswer = event.needsAnswer
        learnSession(event.sessionId)
      }
    }

    /**
     * 프로세스 쪽(스트림·spawn 오류)에서 온 이벤트. **실패 이유는 여기서만 집는다** —
     * `preEvents`의 error는 run을 실패시키지 않는 실행 전 알림이라(맥락 파일을 못
     * 읽었다), 그것이 실패 이유 자리를 차지하면 진짜 원인이 가려진다.
     *
     * 스트림 줄의 error는 **어댑터가 실패 이유라고 한 것만** 집는다
     * (`errorEventsAreFailureReasons`). claude의 error는 MCP 연결 경고라, 집으면 사내
     * 프록시 환경에서 실패한 run이 전부 "MCP에 연결하지 못했습니다"로 기록된다.
     * spawn 오류는 manager가 직접 내는 것이라 늘 실패 이유다.
     */
    function emitFromProcess(raw: RunEventInit, failureReason: boolean) {
      emit(raw)
      if (failureReason && raw.type === 'error' && raw.message) lastError = raw.message
    }

    // 프로세스보다 먼저 흘린다. seq가 0부터라 로그의 맨 앞에 온다.
    for (const raw of spec.preEvents ?? []) emit(raw)

    // Windows는 셔뱅을 모른다 — 가짜 CLI(.mjs)는 런처를 거쳐야 뜬다.
    const launch = agentCommand(built.cmd, args)
    const child = spawn(launch.cmd, launch.args, {
      cwd: built.cwd,
      env: built.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    active.set(spec.runId, child)
    // 등록은 spawn 직후여야 한다. 종료를 기다린 뒤에 등록하면 영원히 등록되지 않는다.
    cancels.set(spec.runId, (killTree) => {
      canceled = true
      terminate(child, killTree ? { killTree } : {})
    })

    // 프롬프트는 stdin으로 넘긴다 (인자 길이 제한 회피).
    // 닫지 않으면 Claude Code가 3초를 기다린 뒤에야 진행한다.
    child.stdin?.write(spec.prompt)
    child.stdin?.end()

    const splitter = createLineSplitter((line) => {
      for (const raw of adapter.parseLine(line, spec.runId)) {
        emitFromProcess(raw, adapter.errorEventsAreFailureReasons === true)
      }
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
        emitFromProcess({ type: 'error', runId: spec.runId, at: Date.now(), message: err.message }, true)
        resolve(null)
      })
    })

    if (timer) clearTimeout(timer)
    splitter.flush()
    active.delete(spec.runId)
    // 등록을 지우지 않으면 이미 끝난 run의 클로저가 계속 쌓인다.
    cancels.delete(spec.runId)
    await log.close()

    const status = judgeStatus({ canceled, timedOut, exitCode, reportedStatus })

    // 실패 이유는 **마지막 error 이벤트 → stderr** 순이다 (spec FR-13). json 모드의
    // opencode는 오류를 stderr에 쓰지 않고 stdout의 error 줄로만 낸다 — stderr만 보면
    // 이유 없는 실패가 된다. error 이벤트는 실패 이유로 인정된 것만 모인다
    // (emitFromProcess) — claude의 MCP 연결 경고는 실패한 run에서도 싣지 않는다.
    const errorMessage =
      canceled ? null
      : timedOut ? '실행 시간이 초과되어 중단했습니다.'
      : status !== 'failed' ? null
      : lastError ?? (stderr ? stderr.slice(0, 2000) : null)

    return {
      status, resultText, usage,
      externalSessionId: sessionId, needsAnswer, exitCode, errorMessage, logPath
    }
  }

  function cancel(runId: string): void {
    cancels.get(runId)?.()
  }

  /**
   * 도는 run을 전부 멈춘다. **앱 종료 경로 전용이다**(`core.shutdown`, will-quit).
   *
   * Windows에서는 트리 종료를 **기다린다**(`taskkillTreeSync`). 비동기 taskkill은 메인
   * 프로세스가 끝나며 함께 죽어, agent가 띄운 손자 프로세스가 주인 없이 남는다
   * (`docs/sdlc/conversation-fixes/` spec FR-18). POSIX는 지금대로다.
   */
  function cancelAll(): void {
    for (const fn of cancels.values()) fn(taskkillTreeSync)
  }

  return { start, cancel, cancelAll, isRunning, logPathFor }
}

export type RunManager = ReturnType<typeof createRunManager>
