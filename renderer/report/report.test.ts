import { describe, expect, it } from 'vitest'
import type { ReportConversation, ReportData, ReportIssue, ReportWorkspace } from '@shared/models'
import { addDays, customRange, dayCount, lastDayOf, parseDateInput, presetRange, startOfWeek, toDateInput } from './period'
import { dayLabel, durationLabel, oneLine, periodLabel } from './format'
import { classify, conversationLine, isEmptyReport, projectReport, projectWorkspace, runSeconds } from './project'
import { countsByDay, daysOf, eventsByDay } from './days'
import { flowOrder, issueTrack, ticksOf } from './track'
import { DEFAULT_INCLUDE, STATE_NOTE, toMarkdown } from './markdown'

/** 로컬 시각 — 리포트는 앱의 시간대로 날을 가른다 */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

// 2026-10-07은 수요일이다
const NOW = at(2026, 10, 7, 15, 30)
const LAST_WEEK = { since: at(2026, 9, 28), until: at(2026, 10, 5) }

function issue(over: Partial<ReportIssue>): ReportIssue {
  return {
    id: 'i', title: '이슈', status: 'open', priority: null,
    createdAt: at(2026, 9, 1), startedAt: null, closedAt: null, updatedAt: at(2026, 9, 29), ...over
  }
}

function conv(over: Partial<ReportConversation>): ReportConversation {
  return {
    id: 'c', title: '대화', status: 'succeeded', needsAnswer: false, closed: false,
    issueId: null, issueTitle: null, turns: [], lastAnswer: null, ...over
  }
}

function ws(over: Partial<ReportWorkspace>): ReportWorkspace {
  return { id: 'w', name: 'one-desk', issues: [], memos: [], conversations: [], ...over }
}

describe('period', () => {
  it('주는 월요일에 시작한다 — 일요일도 그 주의 끝이다', () => {
    expect(startOfWeek(NOW)).toBe(at(2026, 10, 5))
    expect(startOfWeek(at(2026, 10, 11, 23))).toBe(at(2026, 10, 5))
    expect(startOfWeek(at(2026, 10, 5))).toBe(at(2026, 10, 5))
  })

  it('프리셋 넷', () => {
    expect(presetRange('this-week', NOW)).toEqual({ since: at(2026, 10, 5), until: at(2026, 10, 12) })
    expect(presetRange('last-week', NOW)).toEqual(LAST_WEEK)
    expect(presetRange('last-7', NOW)).toEqual({ since: at(2026, 10, 1), until: at(2026, 10, 8) })
    expect(presetRange('last-30', NOW)).toEqual({ since: at(2026, 9, 8), until: at(2026, 10, 8) })
  })

  it('직접 지정은 끝날을 포함하고, 거꾸로거나 못 읽으면 null이다', () => {
    expect(customRange('2026-09-28', '2026-10-04')).toEqual(LAST_WEEK)
    expect(customRange('2026-10-04', '2026-10-04')).toEqual({ since: at(2026, 10, 4), until: at(2026, 10, 5) })
    expect(customRange('2026-10-05', '2026-10-04')).toBeNull()
    expect(customRange('2026-02-30', '2026-03-01')).toBeNull()
    expect(parseDateInput('')).toBeNull()
  })

  it('날짜 칸 값과 끝날', () => {
    expect(toDateInput(LAST_WEEK.since)).toBe('2026-09-28')
    expect(toDateInput(lastDayOf(LAST_WEEK))).toBe('2026-10-04')
    expect(dayCount(LAST_WEEK)).toBe(7)
    expect(addDays(at(2026, 12, 31), 1)).toBe(at(2027, 1, 1))
  })
})

describe('format', () => {
  it('날짜·기간·시간', () => {
    expect(dayLabel(at(2026, 10, 2, 18))).toBe('10-02(금)')
    expect(periodLabel(LAST_WEEK)).toBe('2026-09-28 ~ 10-04')
    expect(periodLabel({ since: at(2026, 12, 28), until: at(2027, 1, 4) })).toBe('2026-12-28 ~ 2027-01-03')
    expect(periodLabel({ since: at(2026, 10, 4), until: at(2026, 10, 5) })).toBe('2026-10-04')
    expect(durationLabel(40)).toBe('40초')
    expect(durationLabel(38 * 60)).toBe('38분')
    expect(durationLabel(3 * 3600 + 42 * 60)).toBe('3시간 42분')
    expect(durationLabel(7200)).toBe('2시간')
    expect(oneLine('첫 줄\n  둘째 줄\n')).toBe('첫 줄 둘째 줄')
  })
})

describe('classify — 한 칸에만, 위에서부터 처음 맞는 칸', () => {
  it('완료 > 시작 > 새로 만듦 > 손댐', () => {
    const all = { createdAt: at(2026, 9, 28), startedAt: at(2026, 9, 29), closedAt: at(2026, 9, 30) }
    expect(classify(issue({ ...all, status: 'done' }), LAST_WEEK)).toBe('done')
    expect(classify(issue({ ...all, status: 'doing' }), LAST_WEEK)).toBe('started')
    expect(classify(issue({ createdAt: at(2026, 9, 28) }), LAST_WEEK)).toBe('created')
    expect(classify(issue({}), LAST_WEEK)).toBe('touched')
  })

  it('기간 안에 끝냈어도 지금 다시 열려 있으면 완료가 아니다 (spec §6의 1)', () => {
    expect(classify(issue({ status: 'open', closedAt: at(2026, 9, 30) }), LAST_WEEK)).toBe('touched')
  })

  it('until은 기간 밖이다', () => {
    expect(classify(issue({ status: 'done', closedAt: LAST_WEEK.until }), LAST_WEEK)).toBe('touched')
  })
})

describe('runSeconds · conversationLine', () => {
  const turns = [
    { createdAt: at(2026, 9, 27, 23), startedAt: at(2026, 9, 27, 23), endedAt: at(2026, 9, 28, 1) }, // 기간 전 시작
    { createdAt: at(2026, 9, 29, 10), startedAt: at(2026, 9, 29, 10), endedAt: at(2026, 9, 29, 10, 38) },
    { createdAt: at(2026, 9, 30, 10), startedAt: at(2026, 9, 30, 10), endedAt: null }, // 도는 중
    { createdAt: at(2026, 9, 30, 11), startedAt: null, endedAt: at(2026, 9, 30, 11) } // 시작 못 함
  ]

  it('기간 안에 시작해 끝난 턴만 더한다', () => {
    expect(runSeconds(turns, LAST_WEEK)).toBe(38 * 60)
  })

  it('턴 수는 기간 안에 보낸 것이다', () => {
    const line = conversationLine(conv({ turns }), LAST_WEEK)
    expect(line.turns).toBe(3)
    expect(line.lastAt).toBe(at(2026, 9, 30, 11))
  })
})

describe('projectWorkspace', () => {
  const done = issue({ id: 'done', status: 'done', createdAt: at(2026, 9, 28), closedAt: at(2026, 10, 2) })
  const doing = issue({ id: 'doing', status: 'doing', startedAt: at(2026, 9, 30) })
  const outside = conv({ id: 'x', issueId: 'gone', issueTitle: '기간 밖 이슈', turns: [{ createdAt: at(2026, 10, 1), startedAt: null, endedAt: null }] })
  const attached = conv({ id: 'a', issueId: 'done', turns: [{ createdAt: at(2026, 10, 1), startedAt: at(2026, 10, 1), endedAt: at(2026, 10, 1, 0, 10) }] })
  const free = conv({ id: 'f', turns: [{ createdAt: at(2026, 9, 29), startedAt: null, endedAt: null }] })
  const view = projectWorkspace(ws({ issues: [done, doing], conversations: [outside, attached, free] }), LAST_WEEK)

  it('대화는 리포트에 있는 이슈 밑에, 나머지는 이슈 없는 대화로', () => {
    expect(view.buckets.done[0]!.conversations.map((l) => l.conversation.id)).toEqual(['a'])
    expect(view.loose.map((l) => l.conversation.id)).toEqual(['x', 'f'])
  })

  it('합계는 칸과 다른 질문이다 — 완료된 새 이슈는 새 이슈로도 센다', () => {
    expect(view.totals).toEqual({ created: 1, done: 1, doing: 1, conversations: 3, seconds: 600 })
    expect(view.buckets.created).toEqual([])
  })

  it('projectReport가 workspace 합계를 더한다', () => {
    const data: ReportData = { ...LAST_WEEK, workspaces: [ws({ issues: [done] }), ws({ id: 'w2', issues: [doing] })] }
    expect(projectReport(data).totals).toMatchObject({ created: 1, done: 1, doing: 1 })
    expect(isEmptyReport({ ...LAST_WEEK, workspaces: [ws({})] })).toBe(true)
    expect(isEmptyReport(data)).toBe(false)
  })
})

describe('days', () => {
  it('날마다 칸, 오늘 표시', () => {
    const days = daysOf(presetRange('this-week', NOW), NOW)
    expect(days).toHaveLength(7)
    expect(days.filter((d) => d.isToday).map((d) => d.start)).toEqual([at(2026, 10, 7)])
  })

  it('한 대화는 턴을 보낸 날마다 한 번씩 나온다', () => {
    const days = daysOf(LAST_WEEK, NOW)
    const events = eventsByDay(ws({
      issues: [issue({ id: 'i', createdAt: at(2026, 9, 28, 9), status: 'done', closedAt: at(2026, 10, 2, 18) })],
      conversations: [conv({ turns: [
        { createdAt: at(2026, 9, 29, 9), startedAt: at(2026, 9, 29, 9), endedAt: at(2026, 9, 29, 9, 5) },
        { createdAt: at(2026, 9, 29, 11), startedAt: null, endedAt: null },
        { createdAt: at(2026, 10, 1, 9), startedAt: null, endedAt: null }
      ] })]
    }), LAST_WEEK, days)
    expect(events.map((list) => list.map((e) => e.kind))).toEqual([
      ['created'], ['conversation'], [], ['conversation'], ['done'], [], []
    ])
    expect(events[1]![0]).toMatchObject({ turns: 2, seconds: 300 })
  })

  it('하루 막대의 세 수', () => {
    const days = daysOf(LAST_WEEK, NOW)
    const counts = countsByDay([ws({ issues: [issue({ createdAt: at(2026, 9, 28) })] })], LAST_WEEK, days)
    expect(counts[0]).toEqual({ created: 1, done: 0, conversations: 0 })
  })
})

describe('track', () => {
  it('14일까지는 날마다, 30일은 월요일마다 눈금', () => {
    expect(ticksOf(LAST_WEEK)).toHaveLength(7)
    const month = presetRange('last-30', NOW)
    const ticks = ticksOf(month)
    expect(ticks.every((t) => new Date(t.at).getDay() === 1)).toBe(true)
    expect(ticks[0]!.at).toBe(at(2026, 9, 14))
  })

  it('기간 전에 시작한 막대는 왼쪽 끝에서 잘린다', () => {
    const t = issueTrack(issue({ status: 'doing', startedAt: at(2026, 9, 20) }), [], LAST_WEEK)
    expect(t.bar).toEqual({ from: 0, to: 1, done: false, clippedStart: true, clippedEnd: true })
    expect(t.started).toBeNull()
  })

  it('완료 막대와 표식, 대화 점', () => {
    const t = issueTrack(
      issue({ status: 'done', createdAt: at(2026, 9, 28), startedAt: at(2026, 9, 29), closedAt: at(2026, 10, 2) }),
      [conv({ turns: [{ createdAt: at(2026, 9, 30), startedAt: null, endedAt: null }, { createdAt: at(2026, 9, 1), startedAt: null, endedAt: null }] })],
      LAST_WEEK
    )
    expect(t.created).toBe(0)
    expect(t.started).toBeCloseTo(1 / 7)
    expect(t.done).toBeCloseTo(4 / 7)
    expect(t.bar).toMatchObject({ from: t.started, to: t.done, done: true, clippedStart: false })
    expect(t.dots).toEqual([2 / 7])
  })

  it('지금이 기간 안이면 끝나지 않은 막대는 지금에서 멈춘다', () => {
    const week = presetRange('this-week', NOW)
    const t = issueTrack(issue({ status: 'doing', startedAt: at(2026, 10, 5) }), [], week, NOW)
    expect(t.bar!.to).toBeCloseTo((NOW - week.since) / (week.until - week.since))
    expect(t.bar!.to).toBeLessThan(1)
  })

  it('기간 전에 끝난 이슈는 막대가 없다', () => {
    const t = issueTrack(issue({ status: 'done', startedAt: at(2026, 9, 1), closedAt: at(2026, 9, 2) }), [], LAST_WEEK)
    expect(t.bar).toBeNull()
  })

  it('줄 순서는 완료 → 진행 중 → 나머지', () => {
    const order = flowOrder([
      issue({ id: 'open' }),
      issue({ id: 'doing', status: 'doing' }),
      issue({ id: 'done', status: 'done', closedAt: at(2026, 10, 1) })
    ], LAST_WEEK)
    expect(order.map((i) => i.id)).toEqual(['done', 'doing', 'open'])
  })
})

describe('toMarkdown', () => {
  const data: ReportData = {
    ...LAST_WEEK,
    workspaces: [
      ws({
        name: 'one-desk',
        issues: [issue({ id: 'd', title: '*굵게* 아님', status: 'done', closedAt: at(2026, 10, 2) })],
        conversations: [
          conv({ id: 'a', title: '저장소\n두 줄', issueId: 'd', lastAnswer: '답의 첫 줄\n둘째', turns: [
            { createdAt: at(2026, 10, 1), startedAt: at(2026, 10, 1), endedAt: at(2026, 10, 1, 0, 38) }
          ] }),
          conv({ id: 'f', title: '혼자', issueId: 'old', issueTitle: '예전 이슈', turns: [{ createdAt: at(2026, 9, 29), startedAt: null, endedAt: null }] })
        ],
        memos: [{ id: 'm', title: '메모', createdAt: 0, updatedAt: at(2026, 9, 30) }]
      }),
      ws({ id: 'empty', name: '빈 곳' })
    ]
  }

  it('문서 보기 순서 — 제목·합계·workspace·칸·대화, 빈 workspace는 빠진다', () => {
    expect(toMarkdown(data)).toBe([
      '# 리포트 2026-09-28 ~ 10-04',
      '',
      'one-desk, 빈 곳',
      '',
      '새 이슈 0 · 완료 1 · 진행 중 0 · 대화 2 · agent 실행 38분',
      '',
      '## one-desk',
      '',
      '새 이슈 0 · 완료 1 · 진행 중 0 · 대화 2 · agent 실행 38분',
      '',
      '### 완료',
      '- *굵게* 아님 — 10-02(금)',
      '  - 대화: 저장소 두 줄 · 1턴 · 38분',
      '    > 답의 첫 줄 둘째',
      '',
      '### 이슈 없는 대화',
      '- 혼자 · 1턴 (이슈: 예전 이슈)',
      '',
      `_${STATE_NOTE}_`,
      ''
    ].join('\n'))
  })

  it('메모를 담고 답을 빼면', () => {
    const md = toMarkdown(data, { ...DEFAULT_INCLUDE, memos: true, answers: false })
    expect(md).toContain('### 메모\n- 메모 — 09-30(수)')
    expect(md).not.toContain('> 답의 첫 줄')
  })

  it('이슈를 빼면 이슈에 붙던 대화가 대화 묶음으로 모인다', () => {
    const md = toMarkdown(data, { ...DEFAULT_INCLUDE, issues: false })
    expect(md).not.toContain('### 완료')
    expect(md).toContain('### 대화')
    expect(md).toContain('- 저장소 두 줄 · 1턴 · 38분')
    expect(md).toContain('대화 2 · agent 실행 38분')
    expect(md).not.toContain('새 이슈')
  })
})
