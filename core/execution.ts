import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from './db/open'
import { issue, memo, repo, asset } from './db/schema'
import { assemblePrompt, type AssetForPrompt } from './context/assemble'
import { readAssetBody } from './assets/body'
import type { FileService, ResolvedMentions } from './files/service'
import type { FinishRunInput, RunRepository } from './db/repositories/run'
import type { RunManager } from './runner/manager'
import type { RunQueue } from './runner/queue'
import type { McpRunConfig, PreflightResult, VerifyRunnableInput } from './runner/types'
import { MCP_SERVER_NAME, type McpHost } from './mcp/host'
import { consoleErrorSink, NotFoundError, type ErrorSink } from './errors'
import type { AgentKind, Asset, ContextItemRef, Permission, ResumeRunInput, Run, StartRunInput } from '@shared/models'
import type { RunEventInit } from '@shared/events'
import { issueToCarry, soleIssueOf } from '@shared/conversationIssue'

/** 맥락에 그 이슈를 더한다 — 이미 있으면 그대로다(같은 항목이 run_context_item에 두 줄 생기면 안 된다, FR-11). */
function withIssue(context: ContextItemRef[], issueId: string | null): ContextItemRef[] {
  if (issueId === null) return context
  if (context.some((c) => c.type === 'issue' && c.id === issueId)) return context
  return [...context, { type: 'issue', id: issueId }]
}

export interface ExecutionOptions {
  db: Database
  runs: RunRepository
  manager: RunManager
  /** 전역 동시 실행 상한과 대기열 */
  queue: RunQueue
  /** MCP 호스트. 없으면 MCP 없이 실행한다 (테스트 통로) */
  mcp?: McpHost
  /** core가 삼킨 오류를 흘려보낼 곳 */
  onError?: ErrorSink
  resolveExecutable: (agentKind: AgentKind, workspaceId: string) => Promise<PreflightResult>
  /**
   * preflight 뒤 마지막 확인. 어댑터가 구현했을 때만 불린다.
   * 실행 파일 탐색과 달리 cwd와 권한이 있어야 하는 검사라 자리가 따로다.
   */
  verifyRunnable?: (
    agentKind: AgentKind,
    input: VerifyRunnableInput
  ) => Promise<PreflightResult>
  /** run 행이 바뀔 때마다 불린다. 시작 이후의 상태 변화는 이 경로로만 알 수 있다. */
  onRunUpdate?: (run: Run) => void
  /** 테스트에서 가짜 CLI를 주입하는 통로 */
  extraArgs?: string[]
  /**
   * 지시문의 `@경로` 해석 (docs/sdlc/input-triggers/ §5-3). 없으면 아무것도 해석하지 않는다 —
   * 멘션은 전부 중화되어 CLI에 간다(펼치지 못한다).
   */
  files?: Pick<FileService, 'resolveMentions'>
}

export function createExecutionService(opts: ExecutionOptions) {
  const onError = opts.onError ?? consoleErrorSink

  /**
   * 행은 만들었지만 아직 큐에 넣지 않은 run → 취소 요청을 받았는가
   * (`docs/sdlc/conversation-fixes/` spec FR-7).
   *
   * launch는 행을 만들어 먼저 알린 뒤 실행 파일 확인·실행 전 확인·MCP 준비를 await한다.
   * 그 틈의 run은 큐에도 manager에도 없어, 표식이 없으면 취소가 아무 데도 닿지 않고
   * 턴은 그대로 돈다. **launch의 모든 출구에서 지운다**(try/finally) — 남으면 실패한
   * run마다 항목이 쌓인다. 동작으로는 드러나지 않으므로(끝난 run의 취소는 어차피 아무것도
   * 하지 않는다) `launchingCount`가 테스트에서 지킨다.
   */
  const launching = new Map<string, boolean>()

  /**
   * 사용자가 **실행 중에** 멈춘 run. 그 프로세스가 끝날 때 뿌리 표시를 다시 판정한다
   * (spec FR-8 — `finish` 참고). 누른 순간의 판정만으로는 두 취소가 겹칠 때 아무도
   * 찍지 않는다. **`finish`가 지운다** — 종료 기록이 도는 유일한 출구다.
   */
  const stopRequested = new Set<string>()

  function notify(run: Run): Run {
    opts.onRunUpdate?.(run)
    return run
  }

  /**
   * 사용자가 취소한 턴이 속한 대화를 인박스에서 내린다 — **그 대화에 취소 대상 말고
   * 활성 턴(running·pending)이 없을 때만** (spec FR-8).
   *
   * 다른 턴이 아직 돌거나 기다리면 그 턴의 결과가 인박스를 정한다. 찍어 버리면 2턴이
   * 도는 중 예약한 3턴을 취소했을 뿐인데 2턴의 답변 필요·실패가 인박스에도 배지에도
   * 뜨지 않는다. **찍는 자리는 여전히 뿌리다**(C-1) — 턴 id에 찍으면 아무 일도 없다.
   */
  function archiveRootIfIdle(target: Run): void {
    const rootId = target.rootRunId ?? target.id
    const busy = opts.runs.activeTurnIds(rootId).some((id) => id !== target.id)
    if (busy) return
    notify(opts.runs.markReviewed(rootId, 'archived'))
  }

  /**
   * 시작하지 못한 run을 사용자의 취소로 끝낸다 — 대기열에서 뺀 run과 launch 중에 취소
   * 요청을 받은 run이 같이 쓴다. 대표 턴 규칙(`shared/inbox.ts`)이 건너뛰는 "시작하지
   * 못하고 취소된 턴"(`startedAt` null)이 여기서 만들어진다.
   *
   * 슬롯을 쥔 적이 없으므로 큐에는 돌려줄 것이 없다. 하지만 prepare()는 enqueue보다
   * 먼저 끝나므로 이 run도 이미 토큰을 쥐고 있을 수 있다 — 반드시 폐기한다.
   */
  function finishUnstarted(runId: string): Run {
    releaseMcp(runId)
    const finished = notify(opts.runs.markFinished(runId, {
      status: 'canceled',
      resultText: null,
      externalSessionId: null,
      needsAnswer: false,
      exitCode: null,
      errorMessage: null,
      // 실패·취소 경로에는 사용량이 없다 — 0이 아니라 null이다.
      usage: null
    }))
    archiveRootIfIdle(finished)
    return finished
  }

  /**
   * 토큰을 폐기하고 설정 파일을 지운다.
   *
   * **prepare()로 토큰을 받은 run을 포기하는 모든 자리에서 부른다.** "슬롯을
   * 돌려주는 모든 자리"가 아니다 — `cancel()`의 대기 중 취소 분기처럼 슬롯을
   * 쥔 적이 없는 자리도 있다. `prepare()`는 `queue.enqueue`보다 먼저 끝나므로
   * (launch 참고) 대기열에서만 머물다 취소된 run도 이미 토큰을 쥐고 있을 수
   * 있다. 규칙을 "슬롯"으로 좁히면 이 경로가 새어나간다. 한 자리라도 빠지면
   * 끝난(혹은 시작도 못한) run의 토큰으로 workspace를 계속 읽고 쓸 수 있다
   * (설계 §3).
   */
  function releaseMcp(runId: string): void {
    try {
      opts.mcp?.release(runId)
    } catch (err) {
      onError(`[execution] MCP 토큰 폐기에 실패했습니다 (runId=${runId})`, err)
    }
  }

  /**
   * 종료를 기록하고 슬롯을 돌려준다.
   *
   * 기록에 실패해도 release는 반드시 부른다 — run 행이 사라진 경우(workspace 삭제)
   * 여기서 던지면 슬롯이 영구히 줄어든다.
   */
  function finish(runId: string, input: FinishRunInput): void {
    const stopped = stopRequested.delete(runId)
    try {
      let finished: Run
      try {
        finished = notify(opts.runs.markFinished(runId, input))
      } catch (err) {
        // 기록할 곳이 없다(유령 run)거나 DB 오류로 기록 자체가 실패했다. 어느
        // 쪽이든 던지지 않고 슬롯만 돌려준다 — 흔적을 안 남기면 이 run이 DB에
        // running으로 남아 다음 재시작의 reapStale이 정리할 때까지 아무도 모른다.
        // core/가 나중에 별도 데몬으로 떨어지면 stderr가 자연스러운 로그
        // 목적지이므로 지금부터 onError로 남긴다.
        onError(`[execution] run 종료 기록 실패 — 이 run은 DB에 running으로 남는다 (runId=${runId})`, err)
        return
      }
      // **사용자가 멈춘 턴이 실제로 멈췄으면 뿌리 표시를 다시 판정한다** (spec FR-8).
      // 누른 순간에는 다른 활성 턴이 있어 찍지 않았어도, 그 사이 그 턴들이 전부 사용자의
      // 취소로 끝났을 수 있다 — 도는 턴을 멈추고 그 프로세스가 내려가기 전에 예약까지
      // 취소하면 두 번의 판정이 서로를 "활성"으로 보고 아무도 찍지 않는다. 멈춘 턴이
      // 끝나는 여기가 마지막 판정 자리다. 멈추지 못하고 제 결과로 끝났으면(취소가 늦었다)
      // 찍지 않는다 — 그 결과가 인박스를 정한다.
      if (stopped && finished.status === 'canceled') {
        try {
          archiveRootIfIdle(finished)
        } catch (err) {
          onError(`[execution] 멈춘 턴의 대화를 인박스에서 내리지 못했다 (runId=${runId})`, err)
        }
      }
    } finally {
      releaseMcp(runId)
      opts.queue.release(runId)
    }
  }

  /** 슬롯을 얻은 run을 실제로 띄운다. 큐가 부른다. */
  function beginRun(runId: string, spec: {
    agentKind: AgentKind
    cwd: string
    model: string | null
    effort: string | null
    permission: Permission
    prompt: string
    executable: string
    mcp: McpRunConfig | null
    /** 이어받을 대화. null이면 새 세션이다 */
    resumeFromRootRunId: string | null
    timeoutMs: number | null
    /** 실행 전에 이미 아는 문제를 사용자에게 보이게 한다 (설계 §5-3) */
    preEvents: RunEventInit[]
  }): void {
    // **세션은 여기서 고른다 — launch 시점이 아니다 (설계 §3-2).**
    // 실행 중에 예약된 턴은 만들어질 때 앞 턴이 아직 안 끝나 세션 id가 없다.
    // 슬롯을 받은 지금이 체인이 확정된 첫 순간이다.
    let resumeSessionId: string | null = null
    if (spec.resumeFromRootRunId) {
      let source: Run | null
      try {
        source = opts.runs.latestSessionRun(spec.resumeFromRootRunId)
      } catch (err) {
        // 이 조회는 원래 resume()의 호출 시점에 있었다 — 그때는 run 행도 MCP
        // 토큰도 큐 슬롯도 없어 던져도 부작용이 없었다. beginRun으로 옮기며
        // 셋 다 이미 존재하는 자리가 됐다. 여기서 삼키지 않으면 MCP 토큰이
        // 영원히 폐기되지 않고, run 행은 running도 failed도 아닌 채로 남아
        // 다음 재시작의 reapStale이 치울 때까지 아무도 모른다.
        onError(`[execution] 이어받을 세션 조회 실패 — 슬롯만 돌려주고 건너뛴다 (runId=${runId})`, err)
        releaseMcp(runId)
        opts.queue.release(runId)
        return
      }
      if (!source?.externalSessionId) {
        // 조용히 새 세션으로 시작하지 않는다 — agent는 이전 대화를 모르는 채로
        // 돌고, 사용자는 답이 이상해진 이유를 알 방법이 없다.
        finish(runId, {
          status: 'failed',
          resultText: null,
          externalSessionId: null,
          needsAnswer: false,
          exitCode: null,
          errorMessage: '이어받을 세션이 없습니다. 앞 턴이 세션을 남기지 못했습니다.',
          // 실패·취소 경로에는 사용량이 없다 — 0이 아니라 null이다.
          usage: null
        })
        return
      }
      resumeSessionId = source.externalSessionId
    }

    // DB 쓰기와 알림을 한 try에 묶지 않는다. 리스너가 던진 것뿐인데(종료 중 파괴된
    // webContents 등) "시작 기록 실패"라고 로그가 말하면 조사가 DB 쪽으로 헛돈다.
    let started: Run
    try {
      started = opts.runs.markStarted(runId)
    } catch (err) {
      // 유령 run(대기 중에 workspace가 지워져 행이 cascade로 사라진 경우)이거나
      // DB 오류로 시작 기록 자체가 실패했다. 던지면 큐가 그대로 멈추므로 슬롯만
      // 돌려주고 다음으로 넘어간다 — 이 run은 DB에 pending으로 멈춘 채 다음
      // 재시작의 reapStale이 canceled로 정리할 때까지 아무 일도 일어나지 않는다.
      // core/가 나중에 별도 데몬으로 떨어지면 stderr가 자연스러운 로그
      // 목적지이므로 지금부터 onError로 남긴다.
      onError(`[execution] run 시작 기록 실패 — manager를 못 띄우고 건너뛴다 (runId=${runId})`, err)
      releaseMcp(runId)
      opts.queue.release(runId)
      return
    }
    // markStarted는 이미 성공했다 — run은 실제로 시작해야 한다. 이 notify가
    // try 밖에 있으면(종료 중 파괴된 webContents 등으로) 리스너가 던지는 순간
    // beginRun을 그대로 빠져나가 아래 manager.start를 영영 못 부른다. 큐의
    // 방어적 catch는 슬롯만 돌려줄 뿐이라 DB에는 running인데 프로세스가 없는
    // run이 남고, 다음 재시작의 reapStale이 interrupted로 정리할 때까지 아무도
    // 모른다. 알림 실패는 화면 갱신의 문제이지 실행의 문제가 아니므로 여기서
    // 삼키고 계속 진행한다.
    try {
      notify(started)
    } catch (err) {
      onError(`[execution] 시작 알림 실패 — 화면 갱신만 놓치고 실행은 계속한다 (runId=${runId})`, err)
    }

    // 여기서 await하지 않는다. 종료 처리는 아래 체인이 맡는다.
    void opts.manager.start({
      runId,
      agentKind: spec.agentKind,
      cwd: spec.cwd,
      model: spec.model,
      effort: spec.effort,
      permission: spec.permission,
      prompt: spec.prompt,
      resumeSessionId,
      executable: spec.executable,
      // 이 한 줄이 빠지면 MCP가 통째로 꺼진다.
      mcp: spec.mcp,
      timeoutMs: spec.timeoutMs,
      // 세션 id를 도는 중에 남긴다 (spec FR-16). 종료 기록만 기다리면 첫 턴이 도는 중
      // 앱이 꺼졌을 때 그 대화를 이을 수 없다 — reapStale은 이 값을 건드리지 않는다.
      // 던지는 것은 manager가 삼켜 onError로 보낸다(스트림 핸들러 안이라 새면 앱이 죽는다).
      onSession: (id, sessionId) => opts.runs.saveExternalSessionId(id, sessionId),
      ...(spec.preEvents.length > 0 ? { preEvents: spec.preEvents } : {}),
      ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {})
    }).then(
      (outcome) => finish(runId, {
        status: outcome.status,
        resultText: outcome.resultText,
        externalSessionId: outcome.externalSessionId,
        needsAnswer: outcome.needsAnswer,
        exitCode: outcome.exitCode,
        errorMessage: outcome.errorMessage,
        // 모델·토큰·컨텍스트 (docs/sdlc/run-info/). 이 한 줄이 빠지면 화면이
        // 영영 비는데 어디도 실패하지 않는다.
        usage: outcome.usage
      }),
      // spawn 거부를 여기서 잡지 않으면 run이 영원히 running으로 남는다.
      (err: unknown) => finish(runId, {
        status: 'failed',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: err instanceof Error ? err.message : String(err),
        // 실패·취소 경로에는 사용량이 없다 — 0이 아니라 null이다.
        usage: null
      })
    )
  }

  /** start와 resume이 공유하는 경로. 다른 것은 채우는 값뿐이다. */
  interface LaunchSpec {
    workspaceId: string
    agentKind: AgentKind
    model: string | null
    /** claude면 --effort, opencode면 --variant. 모델과 같은 규칙으로 흐른다 */
    effort: string | null
    cwd: string
    permission: Permission
    userPrompt: string
    context: ContextItemRef[]
    parentRunId: string | null
    /** 이어받을 대화. null이면 새 세션이다 */
    resumeFromRootRunId: string | null
    timeoutMs: number | null
    /** 새 대화에 할당할 이슈. 이어 가는 턴은 늘 null이다 (conversation-issue FR-5) */
    issueId: string | null
  }

  /**
   * 작업 디렉토리의 repo에서 멘션을 해석한다. 작업 디렉토리가 등록된 repo가 아니면 해석하지
   * 않는다 — 멘션은 전부 중화된다(spec §5-3의 3).
   */
  async function resolveFileMentions(spec: LaunchSpec): Promise<ResolvedMentions> {
    if (!opts.files) return { files: [], resolvedStarts: [] }
    const cwdRepo = opts.db.select().from(repo)
      .where(and(eq(repo.workspaceId, spec.workspaceId), eq(repo.path, spec.cwd))).get() ?? null
    return opts.files.resolveMentions(cwdRepo, spec.userPrompt)
  }

  async function launch(spec: LaunchSpec): Promise<Run> {
    const { repos, issues, memos, assets } = collectContext(opts.db, spec)
    const { resolved, missing } = await resolveAssets(assets)
    // 지시문의 `@경로` (spec §5-3). 읽기·상한에 걸리면 여기서 던진다 — run 행을 만들기 전이다.
    const mentions = await resolveFileMentions(spec)

    const assembled = assemblePrompt({
      repos, issues, memos, assets: resolved, userPrompt: spec.userPrompt,
      files: mentions.files.map((f) => ({ repoName: f.repoName, path: f.path, content: f.content })),
      resolvedMentions: mentions.resolvedStarts
    })
    // 기록은 멘션마다 한 행이다 (FR-15). 요청의 맥락에는 file이 올 수 없다(collectContext가 막는다).
    const context: ContextItemRef[] = [
      ...spec.context,
      ...mentions.files.map((f) => ({ type: 'file' as const, id: `${f.repoId}:${f.path}` }))
    ]

    // 로그 경로가 run id를 포함하므로 id를 먼저 정한다.
    // 경로 계산은 manager가 단일 출처다 — 여기서 따로 조립하면 어긋난다.
    const runId = randomUUID()
    const logPath = opts.manager.logPathFor(runId)

    const created = opts.runs.create({
      id: runId,
      workspaceId: spec.workspaceId,
      agentKind: spec.agentKind,
      model: spec.model,
      effort: spec.effort,
      cwd: spec.cwd,
      permission: spec.permission,
      userPrompt: spec.userPrompt,
      assembledPrompt: assembled,
      logPath,
      context,
      ...(spec.parentRunId ? { parentRunId: spec.parentRunId } : {}),
      timeoutMs: spec.timeoutMs,
      issueId: spec.issueId
    })
    notify(created)

    // 여기서부터 enqueue까지는 큐에도 manager에도 없다 — 취소는 표식으로만 닿는다 (FR-7).
    launching.set(created.id, false)
    try {
      return await prepareAndEnqueue(spec, created, assembled, missing)
    } finally {
      launching.delete(created.id)
    }
  }

  /**
   * launch의 뒷부분 — 행을 만든 뒤 실행 파일 확인·실행 전 확인·MCP 준비를 거쳐 큐에 넣는다.
   *
   * **await 뒤마다(그리고 enqueue 직전에) 취소 요청을 먼저 본다** (spec FR-7). 요청이
   * 있으면 그 단계의 결과가 실패여도 취소로 끝낸다 — 사용자가 멈추라고 한 턴이
   * 읽을 필요 없는 오류 문구로 인박스·배지에 오르면 안 된다.
   */
  async function prepareAndEnqueue(
    spec: LaunchSpec, created: Run, assembled: string, missing: Asset[]
  ): Promise<Run> {
    const cancelRequested = () => launching.get(created.id) === true

    // preflight는 큐에 넣기 전에 본다. 실행 파일이 없는 run이 슬롯을 잡았다
    // 놓는 낭비가 없고, "preflight 실패는 startedAt이 null"이라는 성질도 남는다.
    const preflight = await opts.resolveExecutable(spec.agentKind, spec.workspaceId)
    if (cancelRequested()) return finishUnstarted(created.id)
    if (!preflight.ok || !preflight.executable) {
      return notify(opts.runs.markFinished(created.id, {
        status: 'failed',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: preflight.reason ?? '실행 파일을 찾을 수 없습니다.',
        // 실패·취소 경로에는 사용량이 없다 — 0이 아니라 null이다.
        usage: null
      }))
    }

    const executable = preflight.executable

    // preflight와 같은 자리에 두는 이유도 같다 — 확인되지 않은 run이 포트를
    // 열거나 슬롯을 잡았다 놓는 낭비를 만들지 않고, startedAt이 null인 실패로 남는다.
    if (opts.verifyRunnable) {
      const verified = await opts.verifyRunnable(spec.agentKind, {
        executable,
        cwd: spec.cwd,
        permission: spec.permission
      })
      if (cancelRequested()) return finishUnstarted(created.id)
      if (!verified.ok) {
        return notify(opts.runs.markFinished(created.id, {
          status: 'failed',
          resultText: null,
          externalSessionId: null,
          needsAnswer: false,
          exitCode: null,
          errorMessage: verified.reason ?? '실행 전 확인에 실패했습니다.',
          // 실패·취소 경로에는 사용량이 없다 — 0이 아니라 null이다.
          usage: null
        }))
      }
    }

    // MCP 준비는 preflight 뒤, enqueue 앞이다. 실행 파일조차 없는 run이 포트를
    // 열게 하지 않고, 실패해도 슬롯을 잡았다 놓는 낭비 없이 startedAt이 null인
    // 실패로 끝난다 (설계 §4·§8).
    let mcp: McpRunConfig | null = null
    if (opts.mcp) {
      try {
        const prepared = await opts.mcp.prepare({
          runId: created.id,
          workspaceId: spec.workspaceId,
          permission: spec.permission,
          agentKind: spec.agentKind
        })
        mcp = { serverName: MCP_SERVER_NAME, ...prepared }
      } catch (err) {
        // 취소 요청이 먼저다. finishUnstarted도 토큰을 폐기한다.
        if (cancelRequested()) return finishUnstarted(created.id)
        // MCP 없이 조용히 진행하지 않는다 — agent는 이슈를 못 고치는 채로
        // "성공"으로 끝나고, 그 실패는 아무 데도 남지 않는다.
        // prepare()가 토큰을 등록한 뒤(예: 설정 파일 쓰기)에서 실패했을 수
        // 있다 — 등록됐는지 여기서는 알 수 없으니 방어적으로 폐기를 시도한다.
        // 등록된 적이 없으면 release()는 아무 일도 하지 않는다.
        releaseMcp(created.id)
        return notify(opts.runs.markFinished(created.id, {
          status: 'failed',
          resultText: null,
          externalSessionId: null,
          needsAnswer: false,
          exitCode: null,
          errorMessage: `MCP 서버를 준비하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
          // 실패·취소 경로에는 사용량이 없다 — 0이 아니라 null이다.
          usage: null
        }))
      }
    }

    // MCP 준비(await) 뒤이자 enqueue 직전의 확인이다. prepare()가 토큰을 이미
    // 등록했으므로 finishUnstarted가 폐기까지 맡는다.
    if (cancelRequested()) return finishUnstarted(created.id)

    opts.queue.enqueue(created.id, () => beginRun(created.id, {
      agentKind: spec.agentKind,
      cwd: spec.cwd,
      model: spec.model,
      effort: spec.effort,
      permission: spec.permission,
      prompt: assembled,
      executable,
      mcp,
      resumeFromRootRunId: spec.resumeFromRootRunId,
      timeoutMs: spec.timeoutMs,
      // 맥락에 담았는데 파일을 읽지 못한 asset을 사용자에게 알린다. 조용히 빼면
      // agent가 읽고도 무시했다고 오해한다 (설계 §5-3). run은 실패시키지 않는다.
      preEvents: missing.map((a) => ({
        type: 'error' as const,
        runId: created.id,
        at: Date.now(),
        message:
          `맥락에 담은 ${a.kind} '${a.name}'의 파일을 읽을 수 없어 프롬프트에서 빠졌습니다: ${a.filePath ?? ''}`
      }))
    // 같은 대화의 두 턴이 동시에 뜨면 --resume이 깨진다 (설계 §3-2).
    }), created.rootRunId ?? created.id)

    // 슬롯이 있었으면 beginRun이 동기로 끝나 running이고, 없었으면 pending이다.
    return opts.runs.get(created.id)
  }

  /**
   * 실행을 등록하고 **완료를 기다리지 않고** 돌아온다.
   *
   * 슬롯이 있으면 running run을, 상한에 걸리면 pending run을 돌려준다.
   * 어느 쪽이든 종료까지 기다리지 않는다 — 기다리면 IPC 한 번이 몇 분씩 막히고,
   * 그동안 렌더러는 run의 id를 모르므로 도크에 탭을 만들 수도 취소 버튼을
   * 붙일 수도 없다(설계 §9). 완료는 onRunUpdate로 알린다.
   */
  async function start(input: StartRunInput): Promise<Run> {
    if (input.parentRunId && input.issueId) {
      throw new Error('이슈는 새 대화에만 할당할 수 있습니다')
    }
    // 할당 (conversation-issue FR-5·FR-27): 요청한 이슈, 없으면 새 대화의 첫 턴에 담은 이슈가 정확히 하나일 때
    // 그것. 이어 가는 턴(parentRunId)에는 자동 할당을 하지 않는다. 할당한 이슈는 첫 턴에 실린다 — 맥락에 더하면
    // collectContext가 workspace 소속까지 검증한다(FR-11).
    const issueId = input.parentRunId ? null : (input.issueId ?? soleIssueOf(input.context))
    return launch({
      workspaceId: input.workspaceId,
      agentKind: input.agentKind,
      model: input.model ?? null,
      effort: input.effort ?? null,
      cwd: input.cwd,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: withIssue(input.context, issueId),
      parentRunId: input.parentRunId ?? null,
      resumeFromRootRunId: null,
      timeoutMs: input.timeoutMs ?? null,
      issueId
    })
  }

  /**
   * 대화를 이어받아 새 run을 만든다 (설계 §3-1).
   *
   * **세션 자체는 여기서 고르지 않는다.** 실행 중인 턴에 이어 예약한 턴은 지금
   * 앞 턴의 세션 id가 없을 수 있다 — 그 확인은 beginRun이 실행 직전에 한다
   * (설계 §3-2). 여기서 `latestSessionRun`을 부르는 것은 잠긴 값(workspaceId·
   * agentKind·cwd·timeoutMs)의 출처를 정하기 위해서다. 아직 세션을 가진 run이
   * 하나도 없으면 뿌리(`root`)로 폴백한다.
   *
   * **agentKind와 cwd는 잠긴다** — 세션은 특정 CLI가 특정 디렉토리에서 만든
   * 것이라 다른 조합으로 이어받을 수 없다. 그 규칙이 여기 있어야 나중에
   * core를 별도 데몬으로 뗄 때 따라간다.
   */
  async function resume(input: ResumeRunInput): Promise<Run> {
    let root: Run
    try {
      root = opts.runs.get(input.conversationId)
    } catch (err) {
      // 없는 것과 못 읽는 것을 가른다. 전부 뭉개면 DB 장애가 "대화가 없다"로
      // 둔갑해 조사가 엉뚱한 데로 간다.
      if (err instanceof NotFoundError) {
        throw new Error('이어서 실행할 대화가 없습니다. workspace가 지워졌을 수 있습니다.')
      }
      throw err
    }

    // 잠긴 값의 출처로만 쓴다. 세션 자체는 beginRun이 실행 직전에 다시 고른다
    // — 예약된 턴은 지금 세션이 없을 수 있다 (설계 §3-2).
    const rootId = root.rootRunId ?? root.id
    const source = opts.runs.latestSessionRun(rootId) ?? root
    // 아직 실린 적 없는 할당 이슈는 이 턴에 싣는다 (conversation-issue FR-9). 할당은 뿌리 행에만 있다.
    const assigned = (root.id === rootId ? root : opts.runs.get(rootId)).issue?.id ?? null
    const carry = issueToCarry(assigned, opts.runs.turnsOf(rootId))

    return launch({
      // 잠긴 값 — 세션을 준 run(또는 아직 없으면 뿌리)에서 가져온다
      workspaceId: source.workspaceId,
      agentKind: source.agentKind,
      cwd: source.cwd,
      resumeFromRootRunId: root.rootRunId ?? root.id,
      parentRunId: source.id,
      // 바꿀 수 있는 값
      model: input.model ?? null,
      // agentKind·cwd와 달리 **잠기지 않는다.** 세션에 묶인 값이 아니라 매 턴
      // 고르는 것이다 — 모델과 같은 규칙이고, 이어받으면 앞 턴의 effort가
      // 화면에 없는 채로 따라와 무엇으로 도는지 모르게 된다.
      effort: input.effort ?? null,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: withIssue(input.context, carry),
      // timeoutMs는 원본의 성질을 따른다 (설계 §6의 목록에 빠져 있던 자리다).
      timeoutMs: source.timeoutMs,
      issueId: null
    })
  }

  /**
   * **누른 그 턴을 멈춘다.** 셋 중 어디에 있느냐로 갈린다:
   *
   * - **launch 중**(행은 있고 큐에는 아직 없다) — 요청만 기록하고 돌아온다. launch가
   *   다음 확인 자리에서 보고 큐에 넣지 않은 채 canceled로 끝낸다 (spec FR-7).
   * - **대기 중** — 큐에서 빼고 canceled로 끝낸다. manager는 프로세스가 있는 run만
   *   알아서, 대기 중인 run을 manager.cancel에 넘기면 아무 일도 일어나지 않는다.
   * - **실행 중** — 프로세스를 죽인다. 같은 대화의 예약은 건드리지 않는다 — 사용자가
   *   따로 보낸 지시라 앞 턴이 끝나면 이어서 뜬다 (FR-9).
   * - **이미 끝났다**(프로세스가 없다) — 아무것도 하지 않는다. 턴이 실패·답변 필요로
   *   끝나는 순간과 누른 순간이 겹치면 렌더러가 종료 push를 받기 전에 취소가 온다.
   *   멈출 것이 없는 취소가 뿌리에 찍으면 방금 생긴 결과가 인박스에서 조용히 빠진다.
   *   DB에는 아직 running이어도(manager가 결과를 돌려주고 기록하기 전의 틈) 마찬가지다.
   *
   * 어느 쪽이든 **사용자가 스스로 한 일이므로 확인 표시를 찍는다** — 단, **그 대화에
   * 다른 활성 턴이 없을 때만**이다(FR-8, `archiveRootIfIdle`). 다른 턴이 남아 있으면
   * 그 턴의 결과가 인박스를 정한다. 실행 중 턴은 **그 프로세스가 취소로 끝날 때 한 번 더**
   * 판정한다(`finish`) — 그 사이 남은 턴까지 취소됐을 수 있다.
   *
   * **확인 표시는 취소하는 그 턴이 아니라 뿌리에 찍는다.** 인박스 소속
   * 판정이 뿌리의 reviewedAt 기준이기 때문이다(`run.ts`의 `inbox()`, 설계
   * §5). 턴 id에 찍으면 두 방향으로 깨진다: 예약된 뒤 턴을 취소하면 뿌리는
   * 미확인인 채로 남아 그 대화가 그대로 인박스에 남고, 뿌리(=첫 턴)를
   * 실행 중에 취소하면 반대로 세션은 살아 있는데 그 대화의 이후 어떤 턴도
   * 인박스에 나타나지 않게 된다(C-1). 뿌리가 이미 확인돼 있어도 그 대화를
   * 이어가면 `create()`가 다시 풀어준다(설계 §5 재개 규칙).
   */
  function cancel(runId: string): void {
    if (launching.has(runId)) {
      launching.set(runId, true)
      return
    }

    if (opts.queue.remove(runId)) {
      finishUnstarted(runId)
      return
    }

    // 멈출 프로세스가 없다 — 이미 끝났거나 끝나는 중이다. 그 턴의 결과가 인박스를 정한다.
    if (!opts.manager.isRunning(runId)) return

    // 실행 중이다. 종료 기록은 manager의 결과가 오면 finish가 쓴다. 프로세스를 먼저
    // 멈춘다 — 아래 DB 조회가 던져도 사용자가 멈춘 턴은 멈춰야 한다.
    stopRequested.add(runId)
    opts.manager.cancel(runId)
    // 확인 표시는 지금 찍는다 — markFinished는 reviewedAt을 건드리지 않으므로 살아남는다.
    // 지금 찍지 못했으면(다른 활성 턴이 있다) 끝날 때 finish가 다시 판정한다.
    archiveRootIfIdle(opts.runs.get(runId))
  }

  /**
   * 행은 만들었지만 아직 큐에 넣지 않은 run의 수. **진단·테스트용이다** — launch의
   * 모든 출구가 표식을 치우는지(spec FR-7) 밖에서 볼 수 있는 유일한 자리다. 표식이 새면
   * 동작은 같아 보이고(끝난 run의 취소는 어차피 아무것도 하지 않는다) 실패한 run마다
   * 항목만 쌓인다.
   */
  function launchingCount(): number {
    return launching.size
  }

  return { start, resume, cancel, launchingCount }
}

/** 맥락 항목이 이 workspace 소속인지 확인하며 실제 데이터를 모은다. */
function collectContext(db: Database, input: { workspaceId: string; context: ContextItemRef[] }) {
  // 파일은 지시문의 `@`에서만 온다 (docs/sdlc/input-triggers/ FR-9). 요청으로도 받으면 두 통로가
  // 생겨 글자와 담긴 것이 어긋난다 — "다시 보내기"가 file 항목을 거르는 이유다.
  if (input.context.some((c) => c.type === 'file')) {
    throw new Error('파일은 지시문의 @로만 담을 수 있습니다')
  }
  const ids = (type: string) =>
    input.context.filter((c) => c.type === type).map((c) => c.id)

  const repoIds = ids('repo')
  const issueIds = ids('issue')
  const memoIds = ids('memo')
  const assetIds = ids('asset')

  const repos = repoIds.length === 0 ? [] : db.select().from(repo)
    .where(and(eq(repo.workspaceId, input.workspaceId), inArray(repo.id, repoIds))).all()
  const issueRows = issueIds.length === 0 ? [] : db.select().from(issue)
    .where(and(eq(issue.workspaceId, input.workspaceId), inArray(issue.id, issueIds))).all()
  const memoRows = memoIds.length === 0 ? [] : db.select().from(memo)
    .where(and(eq(memo.workspaceId, input.workspaceId), inArray(memo.id, memoIds))).all()
  const assetRows = assetIds.length === 0 ? [] : db.select().from(asset)
    .where(and(eq(asset.workspaceId, input.workspaceId), inArray(asset.id, assetIds))).all()

  // 4단계에서 MCP를 통해 agent가 임의 id를 넘길 수 있다. workspace 밖 항목은 거부한다.
  assertFound(repoIds, repos.map((r) => r.id), 'repo')
  assertFound(issueIds, issueRows.map((r) => r.id), 'issue')
  assertFound(memoIds, memoRows.map((r) => r.id), 'memo')
  assertFound(assetIds, assetRows.map((r) => r.id), 'asset')

  // 지시 파일은 CLI가 실행할 때 알아서 싣는다. 담으면 같은 본문이 두 번 들어가므로
  // 조용히 빼지 않고 거부한다 (docs/sdlc/repo-instructions/ FR-9). 화면에는 담기
  // 버튼이 없지만, IPC로 밀어 넣는 경로까지 여기서 막는다.
  const instructions = assetRows.filter((r) => r.kind === 'instructions')
  if (instructions.length > 0) {
    throw new Error(
      `지시 파일은 맥락에 담을 수 없습니다 — CLI가 알아서 읽습니다: ${instructions.map((r) => r.name).join(', ')}`
    )
  }

  return {
    repos,
    issues: issueRows.map((r) => ({ ...r, repoIds: [] })),
    memos: memoRows.map((r) => ({ ...r, repoIds: [] })),
    assets: assetRows as Asset[]
  }
}

/**
 * 프롬프트에 실을 asset 본문을 채운다.
 *
 * authored는 DB에 본문이 있고, discovered는 **실행 시점에 디스크에서 읽는다**
 * (설계 §2-2) — 파일이 수정돼도 항상 최신이 반영된다.
 *
 * 읽지 못한 것은 빼되 **조용히 빼지 않는다.** 호출자가 preEvents로 알린다 (설계 §5-3).
 */
async function resolveAssets(
  rows: Asset[]
): Promise<{ resolved: AssetForPrompt[]; missing: Asset[] }> {
  const resolved: AssetForPrompt[] = []
  const missing: Asset[] = []
  for (const row of rows) {
    // 읽기는 상세 보기와 같은 함수다 — 두 자리가 따로 읽으면 처리가 갈린다.
    const body = await readAssetBody(row)
    if (!body.ok) { missing.push(row); continue }
    resolved.push({
      kind: row.kind, name: row.name, description: row.description, content: body.content
    })
  }
  return { resolved, missing }
}

function assertFound(requested: string[], found: string[], label: string): void {
  const known = new Set(found)
  const missing = requested.filter((id) => !known.has(id))
  if (missing.length > 0) {
    throw new Error(`이 workspace에서 찾을 수 없는 ${label}입니다: ${missing.join(', ')}`)
  }
}

export type ExecutionService = ReturnType<typeof createExecutionService>
