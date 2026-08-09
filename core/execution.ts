import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from './db/open'
import { issue, memo, repo } from './db/schema'
import { assemblePrompt } from './context/assemble'
import type { RunRepository } from './db/repositories/run'
import type { RunManager } from './runner/manager'
import type { PreflightResult } from './runner/types'
import type { AgentKind, Run, StartRunInput } from '@shared/models'

export interface ExecutionOptions {
  db: Database
  runs: RunRepository
  manager: RunManager
  resolveExecutable: (agentKind: AgentKind, workspaceId: string) => Promise<PreflightResult>
  /** run 행이 바뀔 때마다 불린다. 시작 이후의 상태 변화는 이 경로로만 알 수 있다. */
  onRunUpdate?: (run: Run) => void
  /** 테스트에서 가짜 CLI를 주입하는 통로 */
  extraArgs?: string[]
}

export function createExecutionService(opts: ExecutionOptions) {
  function notify(run: Run): Run {
    opts.onRunUpdate?.(run)
    return run
  }

  /**
   * 실행을 시작하고 **완료를 기다리지 않고** 돌아온다.
   *
   * 종료까지 await하면 IPC 한 번이 몇 분씩 막히고, 그동안 렌더러는 run의 id를
   * 모르므로 도크에 탭을 만들 수도 취소 버튼을 붙일 수도 없다(설계 §9).
   * 완료는 onRunUpdate로 알린다.
   */
  async function start(input: StartRunInput): Promise<Run> {
    const { repos, issues, memos } = collectContext(opts.db, input)

    const assembled = assemblePrompt({
      repos, issues, memos, userPrompt: input.userPrompt
    })

    // 로그 경로가 run id를 포함하므로 id를 먼저 정한다.
    // 경로 계산은 manager가 단일 출처다 — 여기서 따로 조립하면 어긋난다.
    const runId = randomUUID()
    const logPath = opts.manager.logPathFor(runId)

    const created = opts.runs.create({
      id: runId,
      workspaceId: input.workspaceId,
      agentKind: input.agentKind,
      model: input.model ?? null,
      cwd: input.cwd,
      permission: input.permission,
      userPrompt: input.userPrompt,
      assembledPrompt: assembled,
      logPath,
      context: input.context,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      timeoutMs: input.timeoutMs ?? null
    })
    notify(created)

    const preflight = await opts.resolveExecutable(input.agentKind, input.workspaceId)
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

    const started = notify(opts.runs.markStarted(created.id))

    // 여기서 await하지 않는다. 종료 처리는 아래 체인이 맡는다.
    void opts.manager.start({
      runId: created.id,
      agentKind: input.agentKind,
      cwd: input.cwd,
      model: input.model ?? null,
      permission: input.permission,
      prompt: assembled,
      resumeSessionId: null,
      executable: preflight.executable,
      timeoutMs: input.timeoutMs ?? null,
      ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {})
    }).then(
      (outcome) => notify(opts.runs.markFinished(created.id, {
        status: outcome.status,
        resultText: outcome.resultText,
        externalSessionId: outcome.externalSessionId,
        needsAnswer: outcome.needsAnswer,
        exitCode: outcome.exitCode,
        errorMessage: outcome.errorMessage
      })),
      // spawn 거부(동시 실행 상한 등)를 여기서 잡지 않으면 run이 영원히
      // running으로 남아 재시작 전까지 정리되지 않는다.
      (err: unknown) => notify(opts.runs.markFinished(created.id, {
        status: 'failed',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: err instanceof Error ? err.message : String(err)
      }))
    )

    return started
  }

  return { start, cancel: opts.manager.cancel }
}

/** 맥락 항목이 이 workspace 소속인지 확인하며 실제 데이터를 모은다. */
function collectContext(db: Database, input: StartRunInput) {
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
