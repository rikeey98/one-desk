/**
 * 정기 실행의 주기 (`docs/sdlc/scheduled-runs/` spec FR-6) — core가 검증·계산에, 렌더러가 편집·설명에 쓴다.
 *
 * 프리셋도 cron으로 바꿔 한 길로 계산한다(`toCron`). 여기는 **모양만** 본다 — cron 문법·시간대·최소 간격은 croner를
 * 아는 `core/schedules/clock.ts`의 `validateTrigger`가 본다(렌더러는 croner를 모른다).
 */

/** N시간마다의 N. **24의 약수만이다** — `*\/5`는 자정에 끊겨 마지막 간격이 4시간이 되어 "5시간마다"가 거짓이 된다 */
export const HOURLY_STEPS = [1, 2, 3, 4, 6, 8, 12] as const
export type HourlyStep = typeof HOURLY_STEPS[number]

export type ScheduleTrigger =
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  /** 0=일 … 6=토. 하나 이상, 오름차순, 중복 없음 */
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'hourly'; everyHours: HourlyStep; minute: number }
  | { kind: 'cron'; expr: string }

export type TriggerKind = ScheduleTrigger['kind']

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']
/** 화면의 요일 순서 — 월요일 시작 (리포트의 주와 같다) */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function weekdayName(day: number): string {
  return WEEKDAY_NAMES[day] ?? '?'
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function parseTime(time: unknown): { hour: number; minute: number } | null {
  if (typeof time !== 'string') return null
  const m = TIME_PATTERN.exec(time)
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null
}

export type ReadTriggerResult = { ok: true; trigger: ScheduleTrigger } | { ok: false; error: string }

/**
 * IPC·DB에서 온 값을 주기로 읽는다. 모르는 키는 버리고 요일은 정렬한다. 오류는 화면에 그대로 보일 한국어 한 문장이다.
 */
export function readTrigger(value: unknown): ReadTriggerResult {
  const fail = (error: string): ReadTriggerResult => ({ ok: false, error })
  if (typeof value !== 'object' || value === null) return fail('주기를 읽을 수 없습니다')
  const v = value as Record<string, unknown>
  switch (v.kind) {
    case 'daily':
    case 'weekdays': {
      if (!parseTime(v.time)) return fail('시각은 00:00~23:59의 HH:MM이어야 합니다')
      return { ok: true, trigger: { kind: v.kind, time: v.time as string } }
    }
    case 'weekly': {
      if (!parseTime(v.time)) return fail('시각은 00:00~23:59의 HH:MM이어야 합니다')
      const days = v.days
      if (!Array.isArray(days) || days.length === 0) return fail('요일을 하나 이상 고르세요')
      if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return fail('요일을 읽을 수 없습니다')
      if (new Set(days).size !== days.length) return fail('같은 요일이 두 번 들어 있습니다')
      return { ok: true, trigger: { kind: 'weekly', days: [...(days as number[])].sort((a, b) => a - b), time: v.time as string } }
    }
    case 'hourly': {
      if (!(HOURLY_STEPS as readonly unknown[]).includes(v.everyHours)) {
        return fail(`몇 시간마다는 ${HOURLY_STEPS.join('·')} 중 하나여야 합니다`)
      }
      const minute = v.minute
      if (typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return fail('분은 0~59여야 합니다')
      }
      return { ok: true, trigger: { kind: 'hourly', everyHours: v.everyHours as HourlyStep, minute } }
    }
    case 'cron': {
      if (typeof v.expr !== 'string' || v.expr.trim() === '') return fail('cron 식을 입력하세요')
      return { ok: true, trigger: { kind: 'cron', expr: v.expr } }
    }
    default:
      return fail('주기를 읽을 수 없습니다')
  }
}

/** 프리셋을 5필드 cron으로. cron은 공백을 하나로 접는다 */
export function toCron(trigger: ScheduleTrigger): string {
  switch (trigger.kind) {
    case 'daily': {
      const t = parseTime(trigger.time)!
      return `${t.minute} ${t.hour} * * *`
    }
    case 'weekdays': {
      const t = parseTime(trigger.time)!
      return `${t.minute} ${t.hour} * * 1-5`
    }
    case 'weekly': {
      const t = parseTime(trigger.time)!
      return `${t.minute} ${t.hour} * * ${trigger.days.join(',')}`
    }
    case 'hourly':
      return trigger.everyHours === 1
        ? `${trigger.minute} * * * *`
        : `${trigger.minute} */${trigger.everyHours} * * *`
    case 'cron':
      return trigger.expr.trim().split(/\s+/).join(' ')
  }
}

/** 사람 말 — `평일 09:00`, `매주 월·수 09:00`, `3시간마다 :15`. cron은 식 그대로 */
export function describeTrigger(trigger: ScheduleTrigger): string {
  switch (trigger.kind) {
    case 'daily':
      return `매일 ${trigger.time}`
    case 'weekdays':
      return `평일 ${trigger.time}`
    case 'weekly': {
      const names = WEEKDAY_ORDER.filter((d) => trigger.days.includes(d)).map(weekdayName)
      return `매주 ${names.join('·')} ${trigger.time}`
    }
    case 'hourly':
      return `${trigger.everyHours}시간마다 :${String(trigger.minute).padStart(2, '0')}`
    case 'cron':
      return `cron ${toCron(trigger)}`
  }
}
