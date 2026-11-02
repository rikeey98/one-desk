import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type { Database } from '../open'
import { schedule, scheduleFire } from '../schema'
import { NotFoundError, type ErrorSink } from '../../errors'
import { readTrigger, toCron } from '@shared/scheduleTrigger'
import { readScheduleContext } from '../../schedules/input'
import type { Schedule, ScheduleDisabledReason, ScheduleFire, ScheduleInput } from '@shared/models'

type Row = typeof schedule.$inferSelect

/** 최신 순 — 같은 밀리초의 두 기록은 넣은 순서(rowid)로 가른다 */
const NEWEST_FIRST = [desc(scheduleFire.firedAt), sql`rowid DESC`] as const

/** 정기 실행마다 남기는 기록 수 (spec FR-5) */
export const SCHEDULE_FIRE_KEEP = 50

/**
 * 정기 실행 저장소 (`docs/sdlc/scheduled-runs/` spec FR-1~5). 입력 검증은 여기가 아니라 `core/schedules/input.ts`의
 * `validateScheduleInput` 한 자리다 — 여기는 검증된 값을 받는다.
 *
 * **정의를 고치는 `update`와 스케줄러의 상태 쓰기는 서로의 컬럼을 쓰지 않는다**(FR-4) — 사람이 저장하는 순간 스케줄러가 회차를
 * 처리해도 한쪽이 다른 쪽을 덮지 않는다. 예외는 정의가 바뀐 결과로 정해지는 둘(`anchor_at`·`conversation_id`의 초기화, FR-12·30)이다.
 */
export function createScheduleRepository(db: Database, onError: ErrorSink) {
  function hydrate(row: Row): Schedule | null {
    let trigger: unknown
    let context: unknown
    try {
      trigger = JSON.parse(row.trigger)
      context = JSON.parse(row.context)
    } catch {
      return null
    }
    const t = readTrigger(trigger)
    const c = readScheduleContext(context)
    if (!t.ok || !c) return null
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      repoId: row.repoId,
      name: row.name,
      enabled: row.enabled,
      disabledReason: row.disabledReason,
      trigger: t.trigger,
      timeZone: row.timeZone,
      conversationMode: row.conversationMode,
      conversationId: row.conversationId,
      agentKind: row.agentKind,
      model: row.model,
      effort: row.effort,
      permission: row.permission,
      prompt: row.prompt,
      context: c,
      anchorAt: row.anchorAt,
      consecutiveFailures: row.consecutiveFailures,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }

  function get(id: string): Schedule {
    const row = db.select().from(schedule).where(eq(schedule.id, id)).get()
    if (!row) throw new NotFoundError(`정기 실행을 찾을 수 없습니다: ${id}`)
    const s = hydrate(row)
    if (!s) throw new Error(`정기 실행을 읽지 못했습니다: ${id}`)
    return s
  }

  function definitionColumns(input: ScheduleInput) {
    return {
      repoId: input.repoId,
      name: input.name,
      trigger: JSON.stringify(input.trigger),
      timeZone: input.timeZone,
      conversationMode: input.conversationMode,
      agentKind: input.agentKind,
      model: input.model,
      effort: input.effort,
      permission: input.permission,
      prompt: input.prompt,
      context: JSON.stringify(input.context)
    }
  }

  return {
    /** 모든 workspace — 화면 전용이다(MCP `deps`에 넘기지 않는다, FR-25). 깨진 행은 빼고 알린다 */
    list(): Schedule[] {
      return db.select().from(schedule).orderBy(asc(schedule.createdAt)).all().flatMap((row) => {
        const s = hydrate(row)
        if (!s) {
          onError('정기 실행을 읽지 못했습니다', new Error(`schedule ${row.id}`))
          return []
        }
        return [s]
      })
    },

    get,

    create(input: ScheduleInput, now: number): Schedule {
      const id = randomUUID()
      db.insert(schedule).values({
        id, workspaceId: input.workspaceId, ...definitionColumns(input),
        enabled: true, anchorAt: now, consecutiveFailures: 0, createdAt: now, updatedAt: now
      }).run()
      return get(id)
    },

    /**
     * 정의 전부를 받는다 — 부분 갱신 없음(FR-4). 주기·시간대가 바뀌면 anchor를 그 순간으로(FR-12 — 고치기 전 주기의 지난 회차가 돌지
     * 않게), 이어 가는 대화를 이을 수 없게 바뀌면(agent·repo·새 대화로) 대화를 끊는다(FR-30).
     */
    update(id: string, input: ScheduleInput, now: number): Schedule {
      db.transaction((tx) => {
        const row = tx.select().from(schedule).where(eq(schedule.id, id)).get()
        if (!row) throw new NotFoundError(`정기 실행을 찾을 수 없습니다: ${id}`)
        if (row.workspaceId !== input.workspaceId) throw new Error('정기 실행의 workspace는 바꿀 수 없습니다')
        const next = definitionColumns(input)
        const oldTrigger = readTrigger((() => { try { return JSON.parse(row.trigger) } catch { return null } })())
        const timingChanged = row.timeZone !== input.timeZone ||
          !oldTrigger.ok || toCron(oldTrigger.trigger) !== toCron(input.trigger)
        const conversationBroken = input.conversationMode === 'new' ||
          row.agentKind !== input.agentKind || row.repoId !== input.repoId
        tx.update(schedule).set({
          ...next,
          updatedAt: now,
          ...(timingChanged ? { anchorAt: now } : {}),
          ...(conversationBroken ? { conversationId: null } : {})
        }).where(eq(schedule.id, id)).run()
      })
      return get(id)
    },

    /** 켜면 anchor가 그 순간이고 실패 수·꺼진 이유가 지워진다 — 꺼 둔 동안의 회차가 켜자마자 돌지 않게(FR-12·20). 사람이 끄면 이유가 없다 */
    setEnabled(id: string, enabled: boolean, now: number): Schedule {
      get(id)
      db.update(schedule).set(enabled
        ? { enabled: true, disabledReason: null, consecutiveFailures: 0, anchorAt: now }
        : { enabled: false, disabledReason: null }
      ).where(eq(schedule.id, id)).run()
      return get(id)
    },

    remove(id: string): void {
      db.delete(schedule).where(eq(schedule.id, id)).run()
    },

    // ---- 스케줄러의 상태 쓰기 ----

    /** 이 회차까지 처리했다 (FR-12) — `start`를 부르기 **전에** 부른다 */
    markHandled(id: string, slotAt: number): void {
      db.update(schedule).set({ anchorAt: slotAt }).where(eq(schedule.id, id)).run()
    },

    setConversation(id: string, rootRunId: string): void {
      db.update(schedule).set({ conversationId: rootRunId }).where(eq(schedule.id, id)).run()
    },

    setFailures(id: string, count: number): void {
      db.update(schedule).set({ consecutiveFailures: count }).where(eq(schedule.id, id)).run()
    },

    disable(id: string, reason: ScheduleDisabledReason): void {
      db.update(schedule).set({ enabled: false, disabledReason: reason }).where(eq(schedule.id, id)).run()
    },

    /** repo가 지워져 `repo_id`가 null이 된 켜진 정기 실행을 끈다 (FR-21). 끈 id들 */
    disableMissingRepo(workspaceId: string): string[] {
      const ids = db.select({ id: schedule.id }).from(schedule)
        .where(and(eq(schedule.workspaceId, workspaceId), isNull(schedule.repoId), eq(schedule.enabled, true)))
        .all().map((r) => r.id)
      if (ids.length > 0) {
        db.update(schedule).set({ enabled: false, disabledReason: 'repo_missing' }).where(inArray(schedule.id, ids)).run()
      }
      return ids
    },

    /** 기록 한 줄 — 같은 트랜잭션에서 그 정기 실행의 오래된 기록을 50줄까지 지운다 (FR-5) */
    recordFire(fire: Omit<ScheduleFire, 'id'>): ScheduleFire {
      const id = randomUUID()
      db.transaction((tx) => {
        tx.insert(scheduleFire).values({ id, ...fire }).run()
        const keep = tx.select({ id: scheduleFire.id }).from(scheduleFire)
          .where(eq(scheduleFire.scheduleId, fire.scheduleId))
          .orderBy(...NEWEST_FIRST)
          .limit(SCHEDULE_FIRE_KEEP).all().map((r) => r.id)
        tx.delete(scheduleFire)
          .where(and(eq(scheduleFire.scheduleId, fire.scheduleId), notInArray(scheduleFire.id, keep))).run()
      })
      return { id, ...fire }
    },

    /** 최신 순 */
    fires(scheduleId: string): ScheduleFire[] {
      return db.select().from(scheduleFire).where(eq(scheduleFire.scheduleId, scheduleId))
        .orderBy(...NEWEST_FIRST).all().map(toFire)
    },

    lastFire(scheduleId: string): ScheduleFire | null {
      const row = db.select().from(scheduleFire).where(eq(scheduleFire.scheduleId, scheduleId))
        .orderBy(...NEWEST_FIRST).limit(1).get()
      return row ? toFire(row) : null
    },

    /** 마지막으로 돈 기록 — 겹침 판정이 본다 (FR-15-3) */
    lastStarted(scheduleId: string): ScheduleFire | null {
      const row = db.select().from(scheduleFire)
        .where(and(eq(scheduleFire.scheduleId, scheduleId), eq(scheduleFire.outcome, 'started')))
        .orderBy(...NEWEST_FIRST).limit(1).get()
      return row ? toFire(row) : null
    },

    /**
     * 그 기록의 run을 판정했다고 찍는다 — 처음이면 true (FR-20). **한 run은 한 번만 센다**: 확인함·보관 같은 후속 갱신도 끝난 run으로
     * 오므로, 찍힌 적 있는지를 같은 UPDATE의 조건으로 본다.
     */
    markJudged(fireId: string, now: number): boolean {
      return db.update(scheduleFire).set({ judgedAt: now })
        .where(and(eq(scheduleFire.id, fireId), isNull(scheduleFire.judgedAt))).run().changes === 1
    },

    /** 그 run을 낸 기록 — run이 끝날 때 연속 실패를 판정한다 (FR-20) */
    fireByRun(runId: string): ScheduleFire | null {
      const row = db.select().from(scheduleFire).where(eq(scheduleFire.runId, runId)).limit(1).get()
      return row ? toFire(row) : null
    }
  }
}

function toFire(row: typeof scheduleFire.$inferSelect): ScheduleFire {
  return {
    id: row.id, scheduleId: row.scheduleId, cause: row.cause, slotAt: row.slotAt, firedAt: row.firedAt,
    outcome: row.outcome, skipReason: row.skipReason, message: row.message, runId: row.runId,
    droppedContext: row.droppedContext
  }
}

export type ScheduleRepository = ReturnType<typeof createScheduleRepository>
