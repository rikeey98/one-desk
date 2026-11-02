import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createScheduleRepository, SCHEDULE_FIRE_KEEP } from './schedule'
import { schedule } from '../schema'
import type { Database } from '../open'
import type { ScheduleInput } from '@shared/models'
import type { ErrorSink } from '../../errors'
import { eq } from 'drizzle-orm'

const T0 = Date.parse('2026-11-02T00:00:00Z')

describe('ScheduleRepository (spec FR-1~5·12)', () => {
  let db: Database
  let workspaceId: string
  let repoId: string
  let onError: ReturnType<typeof vi.fn<ErrorSink>>
  let schedules: ReturnType<typeof createScheduleRepository>
  let input: ScheduleInput

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    onError = vi.fn<ErrorSink>()
    schedules = createScheduleRepository(db, onError)
    input = {
      workspaceId, repoId, name: '아침', trigger: { kind: 'weekdays', time: '09:00' }, timeZone: 'Asia/Seoul',
      conversationMode: 'continue', agentKind: 'claude-code', model: null, effort: null, permission: 'read_only',
      prompt: '훑어 줘', context: [{ type: 'issue', id: 'i1' }]
    }
  })

  afterEach(() => { db.$client.close() })

  it('만들면 켜진 채 그 순간을 anchor로 선다', () => {
    const s = schedules.create(input, T0)
    expect(s).toMatchObject({
      ...input, enabled: true, disabledReason: null, conversationId: null, anchorAt: T0, consecutiveFailures: 0,
      createdAt: T0, updatedAt: T0
    })
    expect(schedules.list()).toEqual([s])
    expect(schedules.get(s.id)).toEqual(s)
  })

  it('없는 id는 NotFoundError', () => {
    expect(() => schedules.get('nope')).toThrow(/찾을 수 없습니다/)
  })

  it('주기·시간대를 고치면 anchor가 그 순간이다 — 고치기 전 주기의 지난 회차가 돌지 않게 (FR-12)', () => {
    const s = schedules.create(input, T0)
    schedules.markHandled(s.id, T0 + 1000)
    expect(schedules.update(s.id, { ...input, trigger: { kind: 'daily', time: '09:00' } }, T0 + 5000).anchorAt).toBe(T0 + 5000)
    schedules.markHandled(s.id, T0 + 6000)
    expect(schedules.update(s.id, { ...input, trigger: { kind: 'daily', time: '09:00' }, timeZone: 'UTC' }, T0 + 9000).anchorAt)
      .toBe(T0 + 9000)
  })

  it('이름·지시·맥락·조건만 고치면 anchor는 그대로다', () => {
    const s = schedules.create(input, T0)
    schedules.markHandled(s.id, T0 + 1000)
    const updated = schedules.update(s.id, { ...input, name: '저녁', prompt: '다시', model: 'opus', permission: 'edit', context: [] }, T0 + 5000)
    expect(updated.anchorAt).toBe(T0 + 1000)
    expect(updated.updatedAt).toBe(T0 + 5000)
  })

  it('이어 감에서 agent·repo를 바꾸거나 새 대화로 바꾸면 이어 가던 대화가 끊긴다 (FR-30)', () => {
    const s = schedules.create(input, T0)
    const otherRepo = createRepoRepository(db).create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    const cases: Partial<ScheduleInput>[] = [{ agentKind: 'opencode' }, { repoId: otherRepo }, { conversationMode: 'new' }]
    for (const over of cases) {
      schedules.setConversation(s.id, 'root-1')
      expect(schedules.update(s.id, { ...input, ...over }, T0).conversationId).toBeNull()
      schedules.update(s.id, input, T0)
    }
    schedules.setConversation(s.id, 'root-1')
    expect(schedules.update(s.id, { ...input, model: 'opus', prompt: '다른 지시' }, T0).conversationId).toBe('root-1')
  })

  it('update는 스케줄러의 컬럼을 덮지 않는다 — 사람이 저장하는 순간 회차를 처리해도 (FR-4)', () => {
    const s = schedules.create(input, T0)
    schedules.markHandled(s.id, T0 + 1000)
    schedules.setFailures(s.id, 2)
    schedules.setConversation(s.id, 'root-1')
    const updated = schedules.update(s.id, { ...input, name: '바뀜' }, T0 + 2000)
    expect(updated).toMatchObject({ anchorAt: T0 + 1000, consecutiveFailures: 2, conversationId: 'root-1', enabled: true })
    schedules.disable(s.id, 'failures')
    expect(schedules.update(s.id, { ...input, name: '또' }, T0 + 3000)).toMatchObject({ enabled: false, disabledReason: 'failures' })
  })

  it('workspace는 바꿀 수 없다', () => {
    const s = schedules.create(input, T0)
    const other = createWorkspaceRepository(db).create({ name: 'other' }).id
    expect(() => schedules.update(s.id, { ...input, workspaceId: other }, T0)).toThrow(/workspace/)
  })

  it('켜면 anchor가 그 순간이고 실패 수와 꺼진 이유가 지워진다 — 꺼 둔 동안의 회차가 켜자마자 돌지 않게', () => {
    const s = schedules.create(input, T0)
    schedules.setFailures(s.id, 3)
    schedules.disable(s.id, 'failures')
    expect(schedules.get(s.id)).toMatchObject({ enabled: false, disabledReason: 'failures' })
    expect(schedules.setEnabled(s.id, true, T0 + 7000)).toMatchObject({
      enabled: true, disabledReason: null, consecutiveFailures: 0, anchorAt: T0 + 7000
    })
    // 사람이 끄면 이유가 없다
    expect(schedules.setEnabled(s.id, false, T0 + 8000)).toMatchObject({ enabled: false, disabledReason: null, anchorAt: T0 + 7000 })
  })

  it('repo를 지우면 repo_id가 null이 되고(외래키 set null), disableMissingRepo가 켜진 것만 끈다 (FR-2·21)', () => {
    const s = schedules.create(input, T0)
    const off = schedules.create({ ...input, name: '꺼 둔 것' }, T0)
    schedules.setEnabled(off.id, false, T0)
    createRepoRepository(db).remove(repoId)
    expect(schedules.get(s.id).repoId).toBeNull()
    expect(schedules.disableMissingRepo(workspaceId)).toEqual([s.id])
    expect(schedules.get(s.id)).toMatchObject({ enabled: false, disabledReason: 'repo_missing' })
    expect(schedules.get(off.id)).toMatchObject({ enabled: false, disabledReason: null })
  })

  it('workspace를 지우면 정기 실행과 기록이 같이 사라진다', () => {
    const s = schedules.create(input, T0)
    schedules.recordFire({ scheduleId: s.id, cause: 'manual', slotAt: null, firedAt: T0, outcome: 'started', skipReason: null, message: null, runId: 'r1', droppedContext: 0 })
    createWorkspaceRepository(db).remove(workspaceId)
    expect(schedules.list()).toEqual([])
    expect(schedules.fireByRun('r1')).toBeNull()
  })

  it('기록은 최신 순이고, 정기 실행마다 50줄만 남는다 (FR-5)', () => {
    expect(SCHEDULE_FIRE_KEEP).toBe(50)
    const s = schedules.create(input, T0)
    const other = schedules.create({ ...input, name: '다른 것' }, T0)
    schedules.recordFire({ scheduleId: other.id, cause: 'on_time', slotAt: T0, firedAt: T0, outcome: 'skipped', skipReason: 'busy', message: null, runId: null, droppedContext: 0 })
    for (let i = 0; i < 53; i++) {
      schedules.recordFire({ scheduleId: s.id, cause: 'on_time', slotAt: T0 + i, firedAt: T0 + i, outcome: 'started', skipReason: null, message: null, runId: `r${i}`, droppedContext: 0 })
    }
    const fires = schedules.fires(s.id)
    expect(fires).toHaveLength(50)
    expect(fires[0]!.runId).toBe('r52')
    expect(fires.at(-1)!.runId).toBe('r3')
    // 다른 정기 실행의 기록은 지우지 않는다
    expect(schedules.fires(other.id)).toHaveLength(1)
    expect(schedules.lastFire(s.id)!.runId).toBe('r52')
  })

  it('lastStarted는 건너뛴 기록을 넘어 마지막으로 돈 것이고, fireByRun은 run으로 찾는다', () => {
    const s = schedules.create(input, T0)
    expect(schedules.lastStarted(s.id)).toBeNull()
    schedules.recordFire({ scheduleId: s.id, cause: 'on_time', slotAt: T0, firedAt: T0, outcome: 'started', skipReason: null, message: null, runId: 'r1', droppedContext: 1 })
    schedules.recordFire({ scheduleId: s.id, cause: 'on_time', slotAt: T0 + 1, firedAt: T0 + 1, outcome: 'skipped', skipReason: 'busy', message: null, runId: null, droppedContext: 0 })
    expect(schedules.lastStarted(s.id)!.runId).toBe('r1')
    expect(schedules.lastFire(s.id)!.outcome).toBe('skipped')
    expect(schedules.fireByRun('r1')).toMatchObject({ scheduleId: s.id, droppedContext: 1 })
    expect(schedules.fireByRun('nope')).toBeNull()
  })

  it('지우면 기록도 사라진다', () => {
    const s = schedules.create(input, T0)
    schedules.recordFire({ scheduleId: s.id, cause: 'manual', slotAt: null, firedAt: T0, outcome: 'error', skipReason: null, message: 'x', runId: null, droppedContext: 0 })
    schedules.remove(s.id)
    expect(schedules.list()).toEqual([])
    expect(schedules.fires(s.id)).toEqual([])
  })

  it('깨진 JSON 행은 목록에서 빠지고 onError로 알린다', () => {
    const good = schedules.create(input, T0)
    const bad = schedules.create({ ...input, name: '깨짐' }, T0)
    db.update(schedule).set({ trigger: '{not json' }).where(eq(schedule.id, bad.id)).run()
    expect(schedules.list().map((s) => s.id)).toEqual([good.id])
    expect(onError).toHaveBeenCalled()
    expect(() => schedules.get(bad.id)).toThrow()
  })
})
