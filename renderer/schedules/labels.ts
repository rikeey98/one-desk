import type { ScheduleDisabledReason, ScheduleFireCause, ScheduleFireView, ScheduleSkipReason } from '@shared/models'
import { weekdayName } from '@shared/scheduleTrigger'

/** 정기 실행 화면의 말 (`docs/sdlc/scheduled-runs/` spec FR-27·32). 영어 enum이 화면에 나가지 않는다 */

export const CAUSE_LABELS: Record<ScheduleFireCause, string> = {
  on_time: '정시',
  missed: '놓쳐서 실행',
  manual: '지금 실행'
}

export const SKIP_LABELS: Record<ScheduleSkipReason, string> = {
  busy: '앞 실행이 돌고 있어 건너뜀',
  needs_answer: '답변을 기다리고 있어 건너뜀'
}

export const DISABLED_LABELS: Record<ScheduleDisabledReason, string> = {
  failures: '연속 3번 실패해 꺼졌습니다',
  repo_missing: 'repo가 지워져 꺼졌습니다'
}

const DAY = 24 * 60 * 60_000

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** `오늘 18:00` · `내일 09:00` · `어제 23:59` · `11/5(목) 09:00` — 이 장비의 시간대로 적는다 */
export function dayTimeLabel(at: number, now: number): string {
  const d = new Date(at)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY)
  if (days === 0) return `오늘 ${hhmm}`
  if (days === 1) return `내일 ${hhmm}`
  if (days === -1) return `어제 ${hhmm}`
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdayName(d.getDay())}) ${hhmm}`
}

/** 기록의 결과 글. 돈 것은 null — 상태 알약이 말한다 */
export function fireLabel(fire: ScheduleFireView): string | null {
  if (fire.outcome === 'skipped') return fire.skipReason ? SKIP_LABELS[fire.skipReason] : '건너뜀'
  if (fire.outcome === 'error') return fire.message ?? '보내지 못했습니다'
  return null
}
