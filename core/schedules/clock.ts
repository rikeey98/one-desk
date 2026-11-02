import { Cron } from 'croner'
import { readTrigger, toCron, type ScheduleTrigger } from '@shared/scheduleTrigger'

/**
 * 정기 실행의 시각 계산 (`docs/sdlc/scheduled-runs/` spec FR-7·8). **croner를 import하는 유일한 파일이다** — 판정이 두 곳이면
 * 화면이 받는 cron과 core가 받는 cron이 갈린다(렌더러는 IPC `schedules.preview`로 묻는다).
 */

/** 다음 20회차의 간격이 하나라도 이보다 짧으면 거부한다 (spec FR-7, §8의 4) */
export const MIN_INTERVAL_MS = 10 * 60_000
const INTERVAL_SAMPLES = 20

/** croner는 잘못된 시간대를 만들 때가 아니라 계산할 때 던진다 — 먼저 본다 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

function cronOf(trigger: ScheduleTrigger, timeZone: string): Cron {
  // domAndDow: false — 일과 요일을 둘 다 주면 OR(vixie). 10.0.1의 기본값이지만 판이 바뀌어도 뜻이 같게 명시한다.
  return new Cron(toCron(trigger), { timezone: timeZone, paused: true, domAndDow: false })
}

export type ValidateTriggerResult =
  | { ok: true; trigger: ScheduleTrigger; cron: string }
  | { ok: false; error: string }

export function validateTrigger(value: unknown, timeZone: unknown, now: number): ValidateTriggerResult {
  const read = readTrigger(value)
  if (!read.ok) return read
  const trigger = read.trigger
  if (!isValidTimeZone(timeZone)) return { ok: false, error: '시간대를 읽을 수 없습니다' }
  const cron = toCron(trigger)
  // croner는 초 필드 6개와 @daily도 받는다 — 화면이 그것을 말하지 않으므로 막는다
  if (cron.split(' ').length !== 5) {
    return { ok: false, error: 'cron 식은 필드가 정확히 5개(분 시 일 월 요일)여야 합니다' }
  }
  let slots: number[]
  try {
    slots = cronOf(trigger, timeZone).nextRuns(INTERVAL_SAMPLES + 1, new Date(now)).map((d) => d.getTime())
  } catch (err) {
    return { ok: false, error: `cron 식을 읽을 수 없습니다 (${err instanceof Error ? err.message : String(err)})` }
  }
  if (slots.length === 0) return { ok: false, error: '이 주기는 앞으로 실행되지 않습니다' }
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]! - slots[i - 1]! < MIN_INTERVAL_MS) {
      return { ok: false, error: '정기 실행은 10분보다 자주 돌 수 없습니다' }
    }
  }
  return { ok: true, trigger, cron }
}

/** `after` **초과**의 회차 `count`개 (epoch ms) */
export function nextSlots(trigger: ScheduleTrigger, timeZone: string, after: number, count: number): number[] {
  return cronOf(trigger, timeZone).nextRuns(count, new Date(after)).map((d) => d.getTime())
}

/**
 * `after < s ≤ until`인 가장 늦은 회차, 없으면 null (spec FR-8). croner의 `previousRuns`는 기준 시각 **미만**을 주고 **초
 * 단위로** 본다(`until + 1ms`로 물으면 until과 같은 회차가 빠진다 — 실측). 그래서 1초 뒤로 두 개를 묻고 until 이하의 첫
 * 것을 고른다. 차례로 넘기지 않으므로 얼마나 오래 꺼 두었든 한 번의 계산이다.
 */
export function latestSlot(trigger: ScheduleTrigger, timeZone: string, after: number, until: number): number | null {
  if (until <= after) return null
  const prev = cronOf(trigger, timeZone).previousRuns(2, new Date(until + 1000))
    .map((d) => d.getTime())
    .find((at) => at <= until)
  return prev !== undefined && prev > after ? prev : null
}
