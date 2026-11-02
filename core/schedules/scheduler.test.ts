import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeTestDb } from '../db/repositories/testing'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createRunRepository, type RunRepository } from '../db/repositories/run'
import { createScheduleRepository } from '../db/repositories/schedule'
import { presentContext } from './input'
import { createScheduler, SCHEDULE_TIMEOUT_MS, MAX_CONSECUTIVE_FAILURES, type SchedulerExecution } from './scheduler'
import type { Database } from '../db/open'
import type { ErrorSink } from '../errors'
import type { ResumeRunInput, Run, ScheduleInput, StartRunInput } from '@shared/models'
import type { InternalRunOptions } from '../execution'

const MON_9 = Date.parse('2026-11-02T00:00:00Z') // 월 09:00 KST
const MIN = 60_000
const DAY = 24 * 60 * MIN

interface Call {
  kind: 'start' | 'resume'
  input: StartRunInput | ResumeRunInput
  internal: InternalRunOptions | undefined
}

/** 실제 run 행을 만드는 가짜 실행 서비스 — 상태는 테스트가 runs로 바꾼다 */
function fakeExecution(runs: RunRepository) {
  const calls: Call[] = []
  let failure: Error | null = null
  let hold: Promise<void> | null = null
  const execution: SchedulerExecution = {
    async start(input, internal) {
      calls.push({ kind: 'start', input, internal })
      if (hold) await hold
      if (failure) throw failure
      return runs.create({
        workspaceId: input.workspaceId, agentKind: input.agentKind, model: input.model ?? null, effort: input.effort ?? null,
        cwd: input.cwd, permission: input.permission, userPrompt: input.userPrompt, assembledPrompt: input.userPrompt,
        logPath: '/tmp/x', context: input.context, timeoutMs: input.timeoutMs ?? null, title: internal?.title ?? null
      })
    },
    async resume(input, internal) {
      calls.push({ kind: 'resume', input, internal })
      if (failure) throw failure
      const root = runs.get(input.conversationId)
      return runs.create({
        workspaceId: root.workspaceId, agentKind: root.agentKind, model: input.model ?? null, effort: input.effort ?? null,
        cwd: root.cwd, permission: input.permission, userPrompt: input.userPrompt, assembledPrompt: input.userPrompt,
        logPath: '/tmp/x', context: input.context, parentRunId: root.id
      })
    }
  }
  return {
    calls, execution,
    failWith(err: Error | null) { failure = err },
    holdWith(p: Promise<void> | null) { hold = p }
  }
}

describe('scheduler (spec FR-11~23)', () => {
  let db: Database
  let workspaceId: string
  let repoId: string
  let runs: RunRepository
  let schedules: ReturnType<typeof createScheduleRepository>
  let exec: ReturnType<typeof fakeExecution>
  let now: number
  let onError: ReturnType<typeof vi.fn<ErrorSink>>
  let input: ScheduleInput

  function make(over: { turnsOf?: RunRepository['turnsOf'] } = {}) {
    const repos = createRepoRepository(db)
    return createScheduler({
      schedules,
      runs: { get: (id) => runs.get(id), turnsOf: over.turnsOf ?? ((id) => runs.turnsOf(id)) },
      execution: exec.execution,
      repos: { get: (id) => repos.get(id) },
      presentContext: (ws, ctx) => presentContext(db, ws, ctx),
      now: () => now, tickMs: 30_000, onError
    })
  }

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    runs = createRunRepository(db)
    schedules = createScheduleRepository(db, () => {})
    exec = fakeExecution(runs)
    onError = vi.fn<ErrorSink>()
    now = MON_9 - 10 * MIN
    input = {
      workspaceId, repoId, name: '아침', trigger: { kind: 'weekdays', time: '09:00' }, timeZone: 'Asia/Seoul',
      conversationMode: 'new', agentKind: 'claude-code', model: 'opus', effort: 'high', permission: 'read_only',
      prompt: '훑어 줘', context: []
    }
  })

  afterEach(() => { db.$client.close() })

  const finish = (id: string, status: 'succeeded' | 'failed' | 'canceled' | 'interrupted', needsAnswer = false) =>
    runs.markFinished(id, {
      status, resultText: null, externalSessionId: null, needsAnswer, exitCode: status === 'succeeded' ? 0 : 1,
      errorMessage: null, usage: null
    } as Parameters<RunRepository['markFinished']>[1])

  it('정시가 되면 정의 그대로 보내고 기록한다 — cwd는 그 순간의 repo 경로, 60분 상한, 제목, 안내 없음 (FR-15·16·18·19·22)', async () => {
    const s = schedules.create(input, now)
    const scheduler = make()
    await scheduler.tick()
    expect(exec.calls).toHaveLength(0)

    now = MON_9 + 20_000
    await scheduler.tick()
    expect(exec.calls).toEqual([{
      kind: 'start',
      input: {
        workspaceId, agentKind: 'claude-code', model: 'opus', effort: 'high', cwd: '/tmp/api', permission: 'read_only',
        userPrompt: '훑어 줘', context: [], timeoutMs: SCHEDULE_TIMEOUT_MS
      },
      internal: { title: '아침 · 11/2 09:00', fromSchedule: true }
    }])
    expect(SCHEDULE_TIMEOUT_MS).toBe(60 * MIN)
    const [fire] = schedules.fires(s.id)
    expect(fire).toMatchObject({ cause: 'on_time', slotAt: MON_9, firedAt: MON_9 + 20_000, outcome: 'started', droppedContext: 0 })
    expect(runs.get(fire!.runId!).title).toBe('아침 · 11/2 09:00')
    expect(schedules.get(s.id).anchorAt).toBe(MON_9)
  })

  it('이틀 꺼 두었다 켜도 한 번이고 놓친 것으로 남는다 (FR-11)', async () => {
    const s = schedules.create(input, MON_9 - 2 * DAY)
    now = MON_9 + 3 * 60 * MIN
    const scheduler = make()
    await scheduler.tick()
    await scheduler.tick()
    expect(exec.calls).toHaveLength(1)
    expect(schedules.fires(s.id)).toMatchObject([{ cause: 'missed', slotAt: MON_9 }])
  })

  it('start가 던져도 같은 회차를 다시 돌리지 않는다 — anchor를 start 전에 쓴다 (FR-12)', async () => {
    const s = schedules.create(input, now)
    now = MON_9
    exec.failWith(new Error('preflight 실패'))
    const scheduler = make()
    await scheduler.tick()
    await scheduler.tick()
    expect(exec.calls).toHaveLength(1)
    expect(schedules.fires(s.id)).toMatchObject([{ outcome: 'error', message: 'preflight 실패', runId: null }])
    expect(schedules.get(s.id).consecutiveFailures).toBe(1)
  })

  it('앞 실행이 아직 돌면 건너뛴다 — 쌓지 않는다 (FR-15-3)', async () => {
    const s = schedules.create({ ...input, trigger: { kind: 'hourly', everyHours: 1, minute: 0 } }, now)
    now = MON_9
    const scheduler = make()
    await scheduler.tick()
    const first = schedules.lastStarted(s.id)!.runId!
    runs.markStarted(first)
    now = MON_9 + 60 * MIN
    await scheduler.tick()
    expect(exec.calls).toHaveLength(1)
    expect(schedules.lastFire(s.id)).toMatchObject({ outcome: 'skipped', skipReason: 'busy', slotAt: MON_9 + 60 * MIN })
    // 끝나면 다음 회차는 돈다
    finish(first, 'succeeded')
    now = MON_9 + 120 * MIN
    await scheduler.tick()
    expect(exec.calls).toHaveLength(2)
  })

  it('이어 감: 첫 실행이 대화를 만들고 다음은 그 대화를 잇는다 (FR-15-6)', async () => {
    const s = schedules.create({ ...input, conversationMode: 'continue' }, now)
    now = MON_9
    const scheduler = make()
    await scheduler.tick()
    const root = schedules.get(s.id).conversationId!
    expect(root).toBe(schedules.lastStarted(s.id)!.runId)
    expect(exec.calls[0]!.internal).toEqual({ title: '아침', fromSchedule: true })
    finish(root, 'succeeded')

    now = MON_9 + DAY
    await scheduler.tick()
    expect(exec.calls[1]).toEqual({
      kind: 'resume',
      input: { conversationId: root, model: 'opus', effort: 'high', permission: 'read_only', userPrompt: '훑어 줘', context: [] },
      internal: { fromSchedule: true }
    })
  })

  it('이어 감: 사람이 그 대화에 보낸 턴이 돌고 있어도 건너뛴다', async () => {
    const s = schedules.create({ ...input, conversationMode: 'continue' }, now)
    now = MON_9
    const scheduler = make()
    await scheduler.tick()
    const root = schedules.get(s.id).conversationId!
    finish(root, 'succeeded')
    const human = runs.create({
      workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp/api', permission: 'edit',
      userPrompt: '사람', assembledPrompt: '사람', logPath: '/tmp/x', context: [], parentRunId: root
    })
    runs.markStarted(human.id)
    now = MON_9 + DAY
    await scheduler.tick()
    expect(exec.calls).toHaveLength(1)
    expect(schedules.lastFire(s.id)).toMatchObject({ outcome: 'skipped', skipReason: 'busy' })
  })

  it('이어 감: 대화가 답을 기다리면 건너뛴다 — 사람의 답을 기다리는 대화에 끼어들지 않는다 (FR-15-4)', async () => {
    const s = schedules.create({ ...input, conversationMode: 'continue' }, now)
    now = MON_9
    const scheduler = make()
    await scheduler.tick()
    finish(schedules.get(s.id).conversationId!, 'succeeded', true)
    now = MON_9 + DAY
    await scheduler.tick()
    expect(exec.calls).toHaveLength(1)
    expect(schedules.lastFire(s.id)).toMatchObject({ outcome: 'skipped', skipReason: 'needs_answer' })
  })

  it('지워진 맥락은 빼고 보내며 그 수를 남긴다 — 정의는 고치지 않는다 (FR-17)', async () => {
    const issues = createIssueRepository(db)
    const kept = issues.create({ workspaceId, title: '남은 이슈' }).id
    const gone = issues.create({ workspaceId, title: '지울 이슈' }).id
    const s = schedules.create({ ...input, context: [{ type: 'issue', id: kept }, { type: 'issue', id: gone }] }, now)
    issues.remove(gone)
    now = MON_9
    await make().tick()
    expect((exec.calls[0]!.input as StartRunInput).context).toEqual([{ type: 'issue', id: kept }])
    expect(schedules.lastFire(s.id)!.droppedContext).toBe(1)
    expect(schedules.get(s.id).context).toHaveLength(2)
  })

  it('repo가 지워졌으면 끄고 기록한다 (FR-15-2·21)', async () => {
    const s = schedules.create(input, now)
    createRepoRepository(db).remove(repoId)
    now = MON_9
    await make().tick()
    expect(exec.calls).toHaveLength(0)
    expect(schedules.get(s.id)).toMatchObject({ enabled: false, disabledReason: 'repo_missing' })
    expect(schedules.lastFire(s.id)).toMatchObject({ outcome: 'error', message: 'repo가 지워졌습니다' })
  })

  it('연속 실패 3번에 끈다 — failed와 error만 세고, 성공은 0으로, 취소·중단은 그대로 (FR-20)', async () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(3)
    const s = schedules.create({ ...input, trigger: { kind: 'hourly', everyHours: 1, minute: 0 } }, now)
    const scheduler = make()
    const fireAt = async (t: number) => {
      now = t
      await scheduler.tick()
      return schedules.lastStarted(s.id)!.runId!
    }
    const done = (id: string, status: Parameters<typeof finish>[1]) => scheduler.onRunFinished(finish(id, status))

    done(await fireAt(MON_9), 'failed')
    expect(schedules.get(s.id).consecutiveFailures).toBe(1)
    done(await fireAt(MON_9 + 60 * MIN), 'canceled')
    done(await fireAt(MON_9 + 120 * MIN), 'interrupted')
    expect(schedules.get(s.id).consecutiveFailures).toBe(1)
    done(await fireAt(MON_9 + 180 * MIN), 'succeeded')
    expect(schedules.get(s.id).consecutiveFailures).toBe(0)

    done(await fireAt(MON_9 + 240 * MIN), 'failed')
    done(await fireAt(MON_9 + 300 * MIN), 'failed')
    expect(schedules.get(s.id).enabled).toBe(true)
    done(await fireAt(MON_9 + 360 * MIN), 'failed')
    expect(schedules.get(s.id)).toMatchObject({ enabled: false, disabledReason: 'failures', consecutiveFailures: 3 })
  })

  it('한 run은 한 번만 센다 — 확인함·보관 같은 후속 갱신도 끝난 run으로 온다 (FR-20)', async () => {
    const s = schedules.create(input, now)
    const scheduler = make()
    const run = await scheduler.runNow(s.id)
    const failed = finish(run.id, 'failed')
    scheduler.onRunFinished(failed)
    scheduler.onRunFinished(runs.markReviewed(run.id, 'confirmed'))
    scheduler.onRunFinished(failed)
    expect(schedules.get(s.id).consecutiveFailures).toBe(1)
  })

  it('start가 돌아오기 전에 끝난 run도 센다 — 시작 전 실패는 기록보다 먼저 끝난다 (FR-20)', async () => {
    const s = schedules.create(input, now)
    const scheduler = make()
    const original = exec.execution.start
    exec.execution.start = async (i, internal) => {
      const run = await original(i, internal)
      // core의 onRunUpdate가 이 순간 부른다 — 아직 기록이 없어 아무것도 못 한다
      const failed = finish(run.id, 'failed')
      scheduler.onRunFinished(failed)
      return failed
    }
    await scheduler.runNow(s.id)
    expect(schedules.get(s.id).consecutiveFailures).toBe(1)
    now = MON_9
    await scheduler.tick()
    expect(schedules.get(s.id).consecutiveFailures).toBe(2)
  })

  it('정기 실행이 낸 run이 아니면 아무것도 하지 않는다', () => {
    const other = runs.create({
      workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp', permission: 'edit',
      userPrompt: 'x', assembledPrompt: 'x', logPath: '/tmp/x', context: []
    })
    expect(() => make().onRunFinished(finish(other.id, 'failed'))).not.toThrow()
  })

  it('tick은 재진입하지 않는다 — 앞 tick이 start를 기다리는 동안의 tick은 건너뛴다', async () => {
    schedules.create(input, now)
    now = MON_9
    let release!: () => void
    exec.holdWith(new Promise<void>((r) => { release = r }))
    const scheduler = make()
    const first = scheduler.tick()
    await scheduler.tick()
    release()
    await first
    expect(exec.calls).toHaveLength(1)
  })

  it('하나가 던져도 나머지는 돈다 — 보내기 전의 오류는 onError로', async () => {
    const broken = schedules.create({ ...input, conversationMode: 'continue' }, now)
    schedules.setConversation(broken.id, 'root-x')
    schedules.create({ ...input, name: '저녁' }, now)
    now = MON_9
    const scheduler = make({ turnsOf: (id) => { if (id === 'root-x') throw new Error('DB 장애'); return runs.turnsOf(id) } })
    await scheduler.tick()
    expect(exec.calls).toHaveLength(1)
    expect((exec.calls[0]!.internal as InternalRunOptions).title).toBe('저녁 · 11/2 09:00')
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('아침'), expect.any(Error))
  })

  it('보내다 던진 오류는 그 회차의 기록이 된다 — 다음 정기 실행은 돈다', async () => {
    const s = schedules.create(input, now)
    schedules.create({ ...input, name: '저녁' }, now)
    now = MON_9
    let first = true
    exec.failWith(null)
    const original = exec.execution.start
    exec.execution.start = async (i, internal) => {
      if (first) { first = false; throw new Error('읽기 실패') }
      return original(i, internal)
    }
    await make().tick()
    expect(schedules.lastFire(s.id)).toMatchObject({ outcome: 'error', message: '읽기 실패' })
    expect(exec.calls).toHaveLength(1)
  })

  it('지금 실행: anchor를 건드리지 않고 꺼져 있어도 돈다, 기록은 manual (FR-23)', async () => {
    const s = schedules.create(input, now - DAY)
    schedules.setEnabled(s.id, false, now)
    const run = await make().runNow(s.id)
    expect(run.title).toBe('아침 · 11/2 08:50')
    // 만들 때의 anchor 그대로다 — 지금 실행이 회차를 처리한 것으로 치면 다음 정해진 회차가 밀린다
    expect(schedules.get(s.id).anchorAt).toBe(now - DAY)
    expect(schedules.fires(s.id)).toMatchObject([{ cause: 'manual', slotAt: null, outcome: 'started', runId: run.id }])
  })

  it('지금 실행: 앞 실행이 돌면 던지고 기록하지 않는다', async () => {
    const s = schedules.create(input, now)
    const scheduler = make()
    const first = await scheduler.runNow(s.id)
    runs.markStarted(first.id)
    await expect(scheduler.runNow(s.id)).rejects.toThrow('앞 실행이 아직 돌고 있습니다')
    expect(schedules.fires(s.id)).toHaveLength(1)
  })

  it('start는 곧바로 한 번, 그 뒤 tickMs마다 돈다 — stop 뒤에는 없다', async () => {
    vi.useFakeTimers()
    try {
      schedules.create({ ...input, trigger: { kind: 'hourly', everyHours: 1, minute: 0 } }, now)
      now = MON_9
      const scheduler = make()
      scheduler.start()
      await vi.waitFor(() => expect(exec.calls).toHaveLength(1))
      await vi.waitFor(() => expect(schedules.lastStarted(schedules.list()[0]!.id)).not.toBeNull())
      finish(schedules.lastStarted(schedules.list()[0]!.id)!.runId!, 'succeeded')
      now = MON_9 + 60 * MIN
      await vi.advanceTimersByTimeAsync(30_000)
      expect(exec.calls).toHaveLength(2)
      scheduler.stop()
      now = MON_9 + 120 * MIN
      await vi.advanceTimersByTimeAsync(60_000)
      await scheduler.tick()
      expect(exec.calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
