import { describe, it, expect } from 'vitest'
import { timesView } from './times'

const NOW = new Date(2026, 8, 29, 15, 0).getTime()
const at = (y: number, m: number, d: number, h = 9, min = 5) => new Date(y, m - 1, d, h, min).getTime()

describe('timesView (docs/sdlc/timestamps/ FR-8)', () => {
  it('있는 시각만 날짜로 잇고, title에 날짜·시·분을 싣는다', () => {
    const view = timesView([['만듦', at(2026, 9, 28)], ['시작', null], ['완료', at(2026, 9, 29, 14, 3)]], NOW)
    expect(view.text).toBe('만듦 9월 28일 · 완료 9월 29일')
    expect(view.title).toBe('만듦 2026년 9월 28일 09:05\n완료 2026년 9월 29일 14:03')
  })

  it('올해가 아니면 연도를 붙인다', () => {
    expect(timesView([['만듦', at(2025, 12, 31)]], NOW).text).toBe('만듦 2025년 12월 31일')
  })

  it('아는 시각이 없으면 빈 글자다', () => {
    expect(timesView([['시작', null]], NOW).text).toBe('')
  })
})
