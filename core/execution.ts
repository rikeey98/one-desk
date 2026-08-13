import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from './db/open'
import { issue, memo, repo } from './db/schema'
import { assemblePrompt } from './context/assemble'
import type { FinishRunInput, RunRepository } from './db/repositories/run'
import type { RunManager } from './runner/manager'
import type { RunQueue } from './runner/queue'
import type { McpRunConfig, PreflightResult } from './runner/types'
import { MCP_SERVER_NAME, type McpHost } from './mcp/host'
import { consoleErrorSink, type ErrorSink } from './errors'
import type { AgentKind, ContextItemRef, Permission, ResumeRunInput, Run, StartRunInput } from '@shared/models'

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
  /** run 행이 바뀔 때마다 불린다. 시작 이후의 상태 변화는 이 경로로만 알 수 있다. */
  onRunUpdate?: (run: Run) => void
  /** 테스트에서 가짜 CLI를 주입하는 통로 */
  extraArgs?: string[]
}

export function createExecutionService(opts: ExecutionOptions) {
  const onError = opts.onError ?? consoleErrorSink

  function notify(run: Run): Run {
    opts.onRunUpdate?.(run)
    return run
  }

  /**
   * 토큰을 폐기하고 설정 파일을 지운다.
   *
   * **슬롯을 돌려주는 모든 자리에서 부른다.** 한 자리라도 빠지면 끝난 run의
   * 토큰으로 workspace를 계속 읽고 쓸 수 있다 (설계 §3).
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
    try {
      notify(opts.runs.markFinished(runId, input))
    } catch (err) {
      // 기록할 곳이 없다(유령 run)거나 DB 오류로 기록 자체가 실패했다. 어느
      // 쪽이든 던지지 않고 슬롯만 돌려준다 — 흔적을 안 남기면 이 run이 DB에
      // running으로 남아 다음 재시작의 reapStale이 정리할 때까지 아무도 모른다.
      // core/가 나중에 별도 데몬으로 떨어지면 stderr가 자연스러운 로그
      // 목적지이므로 지금부터 onError로 남긴다.
      onError(`[execution] run 종료 기록 실패 — 이 run은 DB에 running으로 남는다 (runId=${runId})`, err)
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
    permission: Permission
    prompt: string
    executable: string
    mcp: McpRunConfig | null
    resumeSessionId: string | null
    timeoutMs: number | null
  }): void {
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
      permission: spec.permission,
      prompt: spec.prompt,
      resumeSessionId: spec.resumeSessionId,
      executable: spec.executable,
      // 이 한 줄이 빠지면 MCP가 통째로 꺼진다.
      mcp: spec.mcp,
      timeoutMs: spec.timeoutMs,
      ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {})
    }).then(
      (outcome) => finish(runId, {
        status: outcome.status,
        resultText: outcome.resultText,
        externalSessionId: outcome.externalSessionId,
        needsAnswer: outcome.needsAnswer,
        exitCode: outcome.exitCode,
        errorMessage: outcome.errorMessage
      }),
      // spawn 거부를 여기서 잡지 않으면 run이 영원히 running으로 남는다.
      (err: unknown) => finish(runId, {
        status: 'failed',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    )
  }

  /** start와 resume이 공유하는 경로. 다른 것은 채우는 값뿐이다. */
  interface LaunchSpec {
    workspaceId: string
    agentKind: AgentKind
    model: string | null
    cwd: string
    permission: Permission
    userPrompt: string
    context: ContextItemRef[]
    parentRunId: string | null
    resumeSessionId: string | null
    timeoutMs: number | null
  }

  async function launch(spec: LaunchSpec): Promise<Run> {
    const { repos, issues, memos } = collectContext(opts.db, spec)

    const assembled = assemblePrompt({
      repos, issues, memos, userPrompt: spec.userPrompt
    })

    // 로그 경로가 run id를 포함하므로 id를 먼저 정한다.
    // 경로 계산은 manager가 단일 출처다 — 여기서 따로 조립하면 어긋난다.
    const runId = randomUUID()
    const logPath = opts.manager.logPathFor(runId)

    const created = opts.runs.create({
      id: runId,
      workspaceId: spec.workspaceId,
      agentKind: spec.agentKind,
      model: spec.model,
      cwd: spec.cwd,
      permission: spec.permission,
      userPrompt: spec.userPrompt,
      assembledPrompt: assembled,
      logPath,
      context: spec.context,
      ...(spec.parentRunId ? { parentRunId: spec.parentRunId } : {}),
      timeoutMs: spec.timeoutMs
    })
    notify(created)

    // preflight는 큐에 넣기 전에 본다. 실행 파일이 없는 run이 슬롯을 잡았다
    // 놓는 낭비가 없고, "preflight 실패는 startedAt이 null"이라는 성질도 남는다.
    const preflight = await opts.resolveExecutable(spec.agentKind, spec.workspaceId)
    if (!preflight.ok || !preflight.executable) {
      return notify(opts.runs.markFinished(created.id, {
        status: 'failed',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: preflight.reason ?? '실행 파일을 찾을 수 없습니다.'
      }))
    }

    const executable = preflight.executable

    // MCP 준비는 preflight 뒤, enqueue 앞이다. 실행 파일조차 없는 run이 포트를
    // 열게 하지 않고, 실패해도 슬롯을 잡았다 놓는 낭비 없이 startedAt이 null인
    // 실패로 끝난다 (설계 §4·§8).
    let mcp: McpRunConfig | null = null
    if (opts.mcp) {
      try {
        const prepared = await opts.mcp.prepare({
          runId: created.id,
          workspaceId: spec.workspaceId,
          permission: spec.permission
        })
        mcp = { serverName: MCP_SERVER_NAME, ...prepared }
      } catch (err) {
        // MCP 없이 조용히 진행하지 않는다 — agent는 이슈를 못 고치는 채로
        // "성공"으로 끝나고, 그 실패는 아무 데도 남지 않는다.
        return notify(opts.runs.markFinished(created.id, {
          status: 'failed',
          resultText: null,
          externalSessionId: null,
          needsAnswer: false,
          exitCode: null,
          errorMessage: `MCP 서버를 준비하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`
        }))
      }
    }

    opts.queue.enqueue(created.id, () => beginRun(created.id, {
      agentKind: spec.agentKind,
      cwd: spec.cwd,
      model: spec.model,
      permission: spec.permission,
      prompt: assembled,
      executable,
      mcp,
      resumeSessionId: spec.resumeSessionId,
      timeoutMs: spec.timeoutMs
    }))

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
    return launch({
      workspaceId: input.workspaceId,
      agentKind: input.agentKind,
      model: input.model ?? null,
      cwd: input.cwd,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: input.context,
      parentRunId: input.parentRunId ?? null,
      resumeSessionId: null,
      timeoutMs: input.timeoutMs ?? null
    })
  }

  /**
   * 원본 run의 세션을 이어받아 새 run을 만든다 (설계 §6).
   *
   * **agentKind와 cwd는 잠긴다** — 세션은 특정 CLI가 특정 디렉토리에서 만든
   * 것이라 다른 조합으로 이어받을 수 없다. 그 규칙이 여기 있어야 나중에
   * core를 별도 데몬으로 뗄 때 따라간다. 호출자는 바꿀 수 있는 것만 넘긴다.
   */
  async function resume(input: ResumeRunInput): Promise<Run> {
    let parent: Run
    try {
      parent = opts.runs.get(input.parentRunId)
    } catch {
      throw new Error('이어서 실행할 원본 run이 없습니다. workspace가 지워졌을 수 있습니다.')
    }

    if (!parent.externalSessionId) {
      throw new Error('이어받을 세션이 없습니다. 새 실행으로 시작하세요.')
    }

    return launch({
      // 잠긴 값
      workspaceId: parent.workspaceId,
      agentKind: parent.agentKind,
      cwd: parent.cwd,
      resumeSessionId: parent.externalSessionId,
      parentRunId: parent.id,
      // 바꿀 수 있는 값
      model: input.model ?? null,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: input.context,
      // timeoutMs는 잠긴 값도 바꿀 수 있는 값도 아니다 — 설계 §6이 열거한
      // 목록에 빠져 있던 자리다. 원본이 타임아웃을 걸고 돌던 run이면 그
      // 제한이 이어받는 run에서도 유효해야 자연스럽다는 판단으로, 원본의
      // 성질을 따르기로 한다.
      timeoutMs: parent.timeoutMs
    })
  }

  /**
   * 대기 중이면 큐에서 빼고 canceled로 끝낸다. 실행 중이면 프로세스를 죽인다.
   *
   * manager는 프로세스가 있는 run만 안다 — 대기 중인 run을 manager.cancel에
   * 넘기면 아무 일도 일어나지 않고 사용자는 취소가 안 된다고 느낀다.
   *
   * 어느 쪽이든 **사용자가 스스로 한 일이므로 그 자리에서 확인 표시를 찍는다.**
   * 그래야 인박스에 남는 canceled가 앱이 재시작하며 취소한 것만 남고,
   * "대기 중 취소됨"이라는 이름이 정확해진다 (설계 §5).
   */
  function cancel(runId: string): void {
    if (opts.queue.remove(runId)) {
      // 슬롯을 쥔 적이 없으므로 돌려줄 것도 없다.
      notify(opts.runs.markFinished(runId, {
        status: 'canceled',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: null
      }))
      notify(opts.runs.markReviewed(runId, 'archived'))
      return
    }

    // 실행 중이다. 종료 기록은 manager의 결과가 오면 finish가 쓴다.
    // 확인 표시는 지금 찍는다 — markFinished는 reviewedAt을 건드리지 않으므로 살아남는다.
    notify(opts.runs.markReviewed(runId, 'archived'))
    opts.manager.cancel(runId)
  }

  return { start, resume, cancel }
}

/** 맥락 항목이 이 workspace 소속인지 확인하며 실제 데이터를 모은다. */
function collectContext(db: Database, input: { workspaceId: string; context: ContextItemRef[] }) {
  const ids = (type: string) =>
    input.context.filter((c) => c.type === type).map((c) => c.id)

  const repoIds = ids('repo')
  const issueIds = ids('issue')
  const memoIds = ids('memo')

  const repos = repoIds.length === 0 ? [] : db.select().from(repo)
    .where(and(eq(repo.workspaceId, input.workspaceId), inArray(repo.id, repoIds))).all()
  const issueRows = issueIds.length === 0 ? [] : db.select().from(issue)
    .where(and(eq(issue.workspaceId, input.workspaceId), inArray(issue.id, issueIds))).all()
  const memoRows = memoIds.length === 0 ? [] : db.select().from(memo)
    .where(and(eq(memo.workspaceId, input.workspaceId), inArray(memo.id, memoIds))).all()

  // 4단계에서 MCP를 통해 agent가 임의 id를 넘길 수 있다. workspace 밖 항목은 거부한다.
  assertFound(repoIds, repos.map((r) => r.id), 'repo')
  assertFound(issueIds, issueRows.map((r) => r.id), 'issue')
  assertFound(memoIds, memoRows.map((r) => r.id), 'memo')

  return {
    repos,
    issues: issueRows.map((r) => ({ ...r, repoIds: [] })),
    memos: memoRows.map((r) => ({ ...r, repoIds: [] }))
  }
}

function assertFound(requested: string[], found: string[], label: string): void {
  const known = new Set(found)
  const missing = requested.filter((id) => !known.has(id))
  if (missing.length > 0) {
    throw new Error(`이 workspace에서 찾을 수 없는 ${label}입니다: ${missing.join(', ')}`)
  }
}

export type ExecutionService = ReturnType<typeof createExecutionService>
