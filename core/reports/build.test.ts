import { describe, expect, it } from 'vitest'
import { buildReport, type ReportSources } from './build'
import type { Issue, Memo, Run, Workspace } from '@shared/models'

const ws = (id: string, name = id) => ({ id, name } as Workspace)

function issue(over: Partial<Issue>): Issue {
  return {
    id: 'i', workspaceId: 'w1', title: '이슈', body: '본문은 싣지 않는다', status: 'open', repoIds: [],
    createdAt: 0, updatedAt: 0, closedAt: null, source: null, kind: null, priority: null,
    triagedAt: null, seenAt: null, startedAt: null, ...over
  }
}

function memo(over: Partial<Memo>): Memo {
  return { id: 'm', workspaceId: 'w1', title: '메모', body: '', repoIds: [], createdAt: 0, updatedAt: 0, ...over }
}

function run(over: Partial<Run>): Run {
  return {
    id: 'r', rootRunId: null, workspaceId: 'w1', userPrompt: '지시', status: 'succeeded', needsAnswer: false,
    createdAt: 0, startedAt: null, endedAt: null, title: null, closedAt: null, issue: null,
    resultText: null, contextItems: [], ...over
  } as Run
}

function sources(data: {
  workspaces: Workspace[]
  issues?: Issue[]
  memos?: Memo[]
  runs?: Run[]
}): ReportSources & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    workspaces: () => data.workspaces,
    issues: (id) => { calls.push(`issues:${id}`); return (data.issues ?? []).filter((i) => i.workspaceId === id) },
    memos: (id) => { calls.push(`memos:${id}`); return (data.memos ?? []).filter((m) => m.workspaceId === id) },
    runs: (id) => { calls.push(`runs:${id}`); return (data.runs ?? []).filter((r) => r.workspaceId === id) }
  }
}

const RANGE = { since: 100, until: 200 }

describe('buildReport', () => {
  it('workspace를 넘어 고르고, 요청한 순서를 지키며, 없는 id는 건너뛴다', () => {
    const src = sources({
      workspaces: [ws('w1', '회사'), ws('w2', '개인')],
      issues: [
        issue({ id: 'a', workspaceId: 'w1', createdAt: 150 }),
        issue({ id: 'b', workspaceId: 'w2', closedAt: 120, status: 'done' })
      ]
    })
    const report = buildReport(src, { workspaceIds: ['w2', 'gone', 'w1'], ...RANGE })
    expect(report.workspaces.map((w) => [w.id, w.name])).toEqual([['w2', '개인'], ['w1', '회사']])
    expect(report.workspaces[0]!.issues.map((i) => i.id)).toEqual(['b'])
    expect(report.workspaces[1]!.issues.map((i) => i.id)).toEqual(['a'])
    expect(src.calls.some((c) => c.endsWith(':gone'))).toBe(false)
    expect(report.since).toBe(100)
    expect(report.until).toBe(200)
  })

  it('빈 workspaceIds는 빈 리포트다 — 전체를 뜻하지 않는다', () => {
    const src = sources({ workspaces: [ws('w1')], issues: [issue({ createdAt: 150 })] })
    expect(buildReport(src, { workspaceIds: [], ...RANGE }).workspaces).toEqual([])
    expect(src.calls).toEqual([])
  })

  it('기간 밖 이슈·메모는 빼고, until은 들지 않는다. 이슈 본문은 싣지 않는다', () => {
    const src = sources({
      workspaces: [ws('w1')],
      issues: [
        issue({ id: 'in', updatedAt: 199 }),
        issue({ id: 'edge', createdAt: 200, updatedAt: 200 }),
        issue({ id: 'before', createdAt: 50, updatedAt: 99 })
      ],
      memos: [memo({ id: 'm-in', createdAt: 100, updatedAt: 100 }), memo({ id: 'm-out', updatedAt: 300 })]
    })
    const [w] = buildReport(src, { workspaceIds: ['w1'], ...RANGE }).workspaces
    expect(w!.issues.map((i) => i.id)).toEqual(['in'])
    expect(w!.issues[0]).not.toHaveProperty('body')
    expect(w!.memos).toEqual([{ id: 'm-in', title: '메모', createdAt: 100, updatedAt: 100 }])
  })

  it('대화는 기간과 겹치면 들고, 턴은 기간 밖 것까지 오래된 순으로 싣는다', () => {
    const src = sources({
      workspaces: [ws('w1')],
      runs: [
        run({ id: 'c2', rootRunId: 'c', createdAt: 150, startedAt: 151, endedAt: 160 }),
        run({ id: 'c', createdAt: 50, startedAt: 51, endedAt: 60 }),
        run({ id: 'old', createdAt: 10, startedAt: 11, endedAt: 20 })
      ]
    })
    const [w] = buildReport(src, { workspaceIds: ['w1'], ...RANGE }).workspaces
    expect(w!.conversations.map((c) => c.id)).toEqual(['c'])
    expect(w!.conversations[0]!.turns).toEqual([
      { createdAt: 50, startedAt: 51, endedAt: 60 },
      { createdAt: 150, startedAt: 151, endedAt: 160 }
    ])
  })

  it('대화의 제목·상태·할당 이슈는 도크와 같은 규칙이고, 답은 300자로 자른다', () => {
    const src = sources({
      workspaces: [ws('w1')],
      runs: [
        run({
          id: 'c', createdAt: 150, issue: { id: 'iss', title: '할당된 이슈' }, closedAt: 170,
          status: 'failed', resultText: null
        }),
        run({ id: 'c2', rootRunId: 'c', createdAt: 160, status: 'canceled', startedAt: null }),
        run({ id: 'd', createdAt: 150, title: '  붙인 이름 ', needsAnswer: true, resultText: 'x'.repeat(400) })
      ]
    })
    const [w] = buildReport(src, { workspaceIds: ['w1'], ...RANGE }).workspaces
    const c = w!.conversations.find((x) => x.id === 'c')!
    // 시작하지 못하고 취소된 턴은 대표가 아니다 — 실패가 보인다
    expect(c).toMatchObject({ title: '할당된 이슈', status: 'failed', closed: true, issueId: 'iss', issueTitle: '할당된 이슈' })
    const d = w!.conversations.find((x) => x.id === 'd')!
    expect(d).toMatchObject({ title: '붙인 이름', needsAnswer: true, issueId: null, issueTitle: null })
    expect(d.lastAnswer).toBe(`${'x'.repeat(300)}…`)
  })

  it('다른 workspace의 run은 섞이지 않는다', () => {
    const src = sources({
      workspaces: [ws('w1'), ws('w2')],
      runs: [run({ id: 'x', workspaceId: 'w2', createdAt: 150 })]
    })
    const [w] = buildReport(src, { workspaceIds: ['w1'], ...RANGE }).workspaces
    expect(w!.conversations).toEqual([])
  })
})
