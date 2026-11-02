import { latestSlot } from './clock'
import type { ScheduleTrigger } from '@shared/scheduleTrigger'
import type { ScheduleFireCause } from '@shared/models'

/** 정시와 놓침을 가르는 여유 — 타이머 간격 30초 + 실행 지연 (spec FR-10, §8의 1). 동작은 같고 기록의 말만 다르다 */
export const MISSED_GRACE_MS = 2 * 60_000

export interface DueInput {
  enabled: boolean
  trigger: ScheduleTrigger
  timeZone: string
  /** 이 시각까지의 회차는 이미 처리했다 */
  anchorAt: number
}

/**
 * 지금 돌 차례인가 (spec FR-10·11). **놓친 회차는 몇 개든 한 번이다** — 가장 늦은 것 하나만 주고, 처리하면 anchor가 그
 * 회차가 되어 앞의 회차는 다시 오지 않는다. 앱을 켠 순간·절전에서 깬 뒤·평소의 타이머가 이 함수 하나를 탄다.
 */
export function dueOf(schedule: DueInput, now: number): { slotAt: number; cause: Exclude<ScheduleFireCause, 'manual'> } | null {
  if (!schedule.enabled) return null
  const slotAt = latestSlot(schedule.trigger, schedule.timeZone, schedule.anchorAt, now)
  if (slotAt === null) return null
  return { slotAt, cause: now - slotAt > MISSED_GRACE_MS ? 'missed' : 'on_time' }
}
