import { describe, it, expect } from 'vitest'
import { dayTimeLabel, fireLabel, CAUSE_LABELS, DISABLED_LABELS } from './labels'
import type { ScheduleFireView } from '@shared/models'

// 로컬 시각으로 만든다 — 화면은 장비의 시간대로 적는다
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 11, 2, 10, 0) // 월

describe('dayTimeLabel — 다음 실행·기록의 시각 (spec FR-27·32)', () => {
  it('오늘·내일·어제는 말로, 그 밖은 날짜와 요일', () => {
    expect(dayTimeLabel(at(2026, 11, 2, 18, 0), NOW)).toBe('오늘 18:00')
    expect(dayTimeLabel(at(2026, 11, 3, 9, 5), NOW)).toBe('내일 09:05')
    expect(dayTimeLabel(at(2026, 11, 1, 23, 59), NOW)).toBe('어제 23:59')
    expect(dayTimeLabel(at(2026, 11, 5, 9, 0), NOW)).toBe('11/5(목) 09:00')
  })
})

describe('fireLabel — 기록의 결과 글', () => {
  const base: ScheduleFireView = {
    id: 'f', scheduleId: 's', cause: 'on_time', slotAt: 1, firedAt: 1, outcome: 'started', skipReason: null,
    message: null, runId: 'r', droppedContext: 0, runStatus: 'succeeded', needsAnswer: false, conversationId: 'r'
  }

  it('건너뛴 이유와 오류를 말한다', () => {
    expect(fireLabel({ ...base, outcome: 'skipped', skipReason: 'busy', runId: null })).toBe('앞 실행이 돌고 있어 건너뜀')
    expect(fireLabel({ ...base, outcome: 'skipped', skipReason: 'needs_answer', runId: null })).toBe('답변을 기다리고 있어 건너뜀')
    expect(fireLabel({ ...base, outcome: 'error', message: 'repo가 지워졌습니다', runId: null })).toBe('repo가 지워졌습니다')
  })

  it('돈 것은 글이 없다 — 상태 알약이 말한다', () => {
    expect(fireLabel(base)).toBeNull()
  })

  it('사유·꺼진 이유의 표', () => {
    expect(CAUSE_LABELS).toEqual({ on_time: '정시', missed: '놓쳐서 실행', manual: '지금 실행' })
    expect(DISABLED_LABELS.failures).toMatch(/연속 3번 실패/)
    expect(DISABLED_LABELS.repo_missing).toMatch(/repo가 지워져/)
  })
})
