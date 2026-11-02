import { representativeTurn } from '@shared/inbox'
import type { ContextItemRef, ResumeRunInput, Run, Schedule, ScheduleFire, StartRunInput } from '@shared/models'
import type { ScheduleRepository } from '../db/repositories/schedule'
import type { RunRepository } from '../db/repositories/run'
import type { InternalRunOptions } from '../execution'
import { NotFoundError, type ErrorSink } from '../errors'
import { dueOf } from './due'

/**
 * 정기 실행의 타이머 (`docs/sdlc/scheduled-runs/` spec FR-11~23). 시각이 된 정기 실행을 사람의 실행과 **같은 길**
 * (`execution.start`·`resume`)로 보낸다 — 큐 상한·권한·MCP 경계가 그대로다(NFR-2).
 */

/** 사람 없이 매달린 run이 실행 슬롯을 영영 쥐지 않게 (FR-19, §8의 5) */
export const SCHEDULE_TIMEOUT_MS = 60 * 60_000
/** 이만큼 연속 실패하면 저절로 끈다 (FR-20, §8의 6) */
export const MAX_CONSECUTIVE_FAILURES = 3
export const DEFAULT_TICK_MS = 30_000

/**
 * e2e가 간격을 늘리는 통로 (FR-13) — main이 `ONE_DESK_SCHEDULE_TICK_MS`를 읽는다. 1초 미만·숫자가 아니면 무시한다(기본 30초).
 * main에는 단위 테스트가 없어 판정을 여기 둔다(`core/app/reveal.ts`와 같은 구조).
 */
export function scheduleTickMsFromEnv(env: Record<string, string | undefined>): number | undefined {
  const raw = env['ONE_DESK_SCHEDULE_TICK_MS']
  if (raw === undefined || raw.trim() === '') return undefined
  const ms = Number(raw)
  return Number.isInteger(ms) && ms >= 1000 ? ms : undefined
}
/** 기록에 남기는 오류 글의 상한 */
const MESSAGE_MAX = 2000

export interface SchedulerExecution {
  start(input: StartRunInput, internal?: InternalRunOptions): Promise<Run>
  resume(input: ResumeRunInput, internal?: Pick<InternalRunOptions, 'fromSchedule'>): Promise<Run>
}

export interface SchedulerOptions {
  /** 알림을 내는 감싼 저장소 — 스케줄러가 쓰는 기록·끄기도 화면에 닿아야 한다 */
  schedules: ScheduleRepository
  runs: Pick<RunRepository, 'get' | 'turnsOf'>
  repos: { get(id: string): { path: string } }
  /** 맥락 중 지금 그 workspace에 있는 것만 (FR-17, `core/schedules/input.ts`) */
  presentContext: (workspaceId: string, context: ContextItemRef[]) => ContextItemRef[]
  execution: SchedulerExecution
  now: () => number
  /** 기본 30초. e2e는 main이 `ONE_DESK_SCHEDULE_TICK_MS`로 늘려 부팅 tick만 돌게 한다(FR-13) */
  tickMs?: number
  onError: ErrorSink
}

/** 그 대화에 도는 턴(running·pending)이 있는가 — 사람이 보낸 턴도 센다 (FR-15-3) */
function conversationBusy(turns: readonly Run[]): boolean {
  return turns.some((t) => t.status === 'running' || t.status === 'pending')
}

/** 대화의 제목 — `<이름> · M/D HH:mm`, 그 정기 실행의 시간대로 (FR-18) */
function stampOf(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(at))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`
}

type Blocked = { reason: 'busy' | 'needs_answer' } | null

export function createScheduler(opts: SchedulerOptions) {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS
  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false
  let stopped = false

  /** 겹침·답 기다림 (FR-15-3·4). 순서가 곧 규칙이다 */
  function blockedBy(s: Schedule): Blocked {
    const last = opts.schedules.lastStarted(s.id)
    if (last?.runId) {
      try {
        const run = opts.runs.get(last.runId)
        if (run.status === 'running' || run.status === 'pending') return { reason: 'busy' }
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err
      }
    }
    if (s.conversationMode === 'continue' && s.conversationId) {
      const turns = [...opts.runs.turnsOf(s.conversationId)].sort((a, b) => b.createdAt - a.createdAt)
      if (conversationBusy(turns)) return { reason: 'busy' }
      if (representativeTurn(turns)?.needsAnswer) return { reason: 'needs_answer' }
    }
    return null
  }

  function countFailure(s: Schedule): void {
    const n = opts.schedules.get(s.id).consecutiveFailures + 1
    opts.schedules.setFailures(s.id, n)
    if (n >= MAX_CONSECUTIVE_FAILURES) opts.schedules.disable(s.id, 'failures')
  }

  /** 보낸다 (FR-15-5·6, FR-16~19). 이어 감의 첫 실행이면 대화를 기억한다 */
  async function send(s: Schedule & { repoId: string }, at: number): Promise<{ run: Run; dropped: number }> {
    const cwd = opts.repos.get(s.repoId).path
    const context = opts.presentContext(s.workspaceId, s.context)
    const dropped = s.context.length - context.length
    if (s.conversationMode === 'continue' && s.conversationId) {
      const run = await opts.execution.resume({
        conversationId: s.conversationId, model: s.model, effort: s.effort, permission: s.permission,
        userPrompt: s.prompt, context
      }, { fromSchedule: true })
      return { run, dropped }
    }
    const title = s.conversationMode === 'continue' ? s.name : `${s.name} · ${stampOf(at, s.timeZone)}`
    const run = await opts.execution.start({
      workspaceId: s.workspaceId, agentKind: s.agentKind, model: s.model, effort: s.effort, cwd,
      permission: s.permission, userPrompt: s.prompt, context, timeoutMs: SCHEDULE_TIMEOUT_MS
    }, { title, fromSchedule: true })
    if (s.conversationMode === 'continue') opts.schedules.setConversation(s.id, run.rootRunId ?? run.id)
    return { run, dropped }
  }

  /** 회차 하나 (FR-15). 순서가 곧 규칙이다 */
  async function fire(s: Schedule, cause: 'on_time' | 'missed', slotAt: number): Promise<void> {
    // 1. 처리했다고 먼저 쓴다 — 실행 도중 앱이 죽거나 start가 던져도 같은 회차를 다시 돌리지 않는다(많아야 한 번, FR-12)
    opts.schedules.markHandled(s.id, slotAt)
    const firedAt = opts.now()
    const base = { scheduleId: s.id, cause, slotAt, firedAt }
    const record = (fire: Omit<ScheduleFire, 'id' | 'scheduleId' | 'cause' | 'slotAt' | 'firedAt'>) =>
      opts.schedules.recordFire({ ...base, ...fire })

    // 2. repo가 지워졌다 (FR-21)
    if (s.repoId === null) {
      opts.schedules.disable(s.id, 'repo_missing')
      record({ outcome: 'error', skipReason: null, message: 'repo가 지워졌습니다', runId: null, droppedContext: 0 })
      return
    }
    // 3·4. 겹침·답 기다림
    const blocked = blockedBy(s)
    if (blocked) {
      record({ outcome: 'skipped', skipReason: blocked.reason, message: null, runId: null, droppedContext: 0 })
      return
    }
    // 5~7. 보낸다
    try {
      const { run, dropped } = await send({ ...s, repoId: s.repoId }, slotAt)
      record({ outcome: 'started', skipReason: null, message: null, runId: run.id, droppedContext: dropped })
      judgeIfEnded(run.id)
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, MESSAGE_MAX)
      record({ outcome: 'error', skipReason: null, message, runId: null, droppedContext: 0 })
      countFailure(s)
    }
  }

  /**
   * 끝난 run의 판정 (FR-20) — failed는 +1, succeeded(답변 필요 포함)는 0, 취소·중단은 그대로(사람이 멈췄거나 앱이 꺼졌다). 정기 실행이
   * 낸 run이 아니면 아무것도 하지 않는다. **한 run은 한 번만 센다**(`markJudged`) — core는 확인함·보관 같은 후속 갱신에도 부른다.
   */
  function onRunFinished(run: Run): void {
    if (run.endedAt === null) return
    if (run.status !== 'failed' && run.status !== 'succeeded') return
    const fired = opts.schedules.fireByRun(run.id)
    if (!fired) return
    let s: Schedule
    try {
      s = opts.schedules.get(fired.scheduleId)
    } catch (err) {
      if (err instanceof NotFoundError) return
      throw err
    }
    if (!opts.schedules.markJudged(fired.id, opts.now())) return
    if (run.status === 'failed') countFailure(s)
    else if (s.consecutiveFailures !== 0) opts.schedules.setFailures(s.id, 0)
  }

  /**
   * 기록 직후 — 시작 전에 실패한 run(실행 파일 없음 등)은 `start`가 돌아오기 **전에** 끝나, 그때의 `onRunFinished`는 기록을 못 찾았다.
   * 여기서 다시 본다. 같은 run을 두 번 세지 않는 것은 `markJudged`가 지킨다.
   */
  function judgeIfEnded(runId: string): void {
    const latest = opts.runs.get(runId)
    if (latest.endedAt !== null) onRunFinished(latest)
  }

  async function tick(): Promise<void> {
    if (ticking || stopped) return
    ticking = true
    try {
      for (const s of opts.schedules.list()) {
        if (stopped) return
        try {
          const due = dueOf(s, opts.now())
          if (due) await fire(s, due.cause, due.slotAt)
        } catch (err) {
          opts.onError(`정기 실행 '${s.name}'을(를) 처리하지 못했습니다`, err)
        }
      }
    } finally {
      ticking = false
    }
  }

  return {
    /** 30초 간격 타이머를 걸고 곧바로 한 번 확인한다 (FR-13) */
    start(): void {
      stopped = false
      timer = setInterval(() => { void tick() }, tickMs)
      timer.unref?.()
      void tick()
    },

    /** 종료 때 맨 먼저 — 종료 중에 새 run을 띄우지 않는다 (FR-14) */
    stop(): void {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },

    tick,

    /** 절전에서 깼다 (FR-14) — 평소의 tick과 같은 판정이다 */
    wake(): Promise<void> {
      return tick()
    },

    /**
     * 지금 실행 (FR-23). anchor를 건드리지 않고(다음 정해진 회차는 그대로 돈다) 꺼져 있어도 돈다. 겹침·답 기다림이면 건너뛰는 대신
     * 던진다 — 사람이 누른 버튼이 말없이 아무것도 안 하면 안 된다. 그때는 기록하지 않는다.
     */
    async runNow(id: string): Promise<Run> {
      const s = opts.schedules.get(id)
      if (s.repoId === null) throw new Error('repo가 지워졌습니다 — 작업 디렉토리를 다시 고르세요')
      const blocked = blockedBy(s)
      if (blocked?.reason === 'busy') throw new Error('앞 실행이 아직 돌고 있습니다')
      if (blocked?.reason === 'needs_answer') throw new Error('이어 가는 대화가 답변을 기다리고 있습니다')
      const firedAt = opts.now()
      const { run, dropped } = await send({ ...s, repoId: s.repoId }, firedAt)
      opts.schedules.recordFire({
        scheduleId: s.id, cause: 'manual', slotAt: null, firedAt, outcome: 'started', skipReason: null, message: null,
        runId: run.id, droppedContext: dropped
      })
      judgeIfEnded(run.id)
      return opts.runs.get(run.id)
    },

    /**
     * 끝난 run마다 core가 부른다 (FR-20). 정기 실행이 낸 run이면 연속 실패를 판정한다 — failed는 +1, succeeded(답변 필요 포함)는 0,
     * 취소·중단은 그대로(사람이 멈췄거나 앱이 꺼졌다).
     */
    onRunFinished
  }
}

export type Scheduler = ReturnType<typeof createScheduler>
