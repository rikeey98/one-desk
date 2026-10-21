import { describe, it, expect } from 'vitest'
import type { Issue, Repo, Run, Workspace } from '@shared/models'
import { STALE_MS } from '@shared/issueRules'
import { representativeTurn } from '@shared/inbox'
import { buildHomeSummary, homeCount, type HomeSources } from './summary'
import type { LiveSnapshot } from './live'

const DAY = 24 * 60 * 60 * 1000
const DAY_START = 1_800_000_000_000
const NOW = DAY_START + 10 * 60 * 60 * 1000 // 오전 10시

function ws(id: string, name = id): Workspace {
  return {
    id, name, description: null, defaultAgentKind: 'claude-code', defaultModelClaude: null, defaultModelOpencode: null,
    defaultEffortClaude: null, defaultVariantOpencode: null, defaultPermission: 'edit', claudePath: null, opencodePath: null,
    createdAt: 1, updatedAt: 1
  }
}
function repo(id: string, workspaceId: string, path: string): Repo {
  return { id, workspaceId, name: id, path, description: null, sortOrder: 0, agentEnv: 'host', createdAt: 1 }
}
function issue(id: string, workspaceId: string, over: Partial<Issue> = {}): Issue {
  return {
    id, workspaceId, title: `이슈 ${id}`, body: '', status: 'open', repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: NOW, seenAt: NOW, startedAt: null, ...over
  }
}
function run(id: string, workspaceId: string, over: Partial<Run> = {}): Run {
  return {
    id, workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: '/w/api', permission: 'edit',
    userPrompt: `지시 ${id}`, assembledPrompt: '', status: 'succeeded', externalSessionId: null, parentRunId: null,
    rootRunId: null, title: null, closedAt: null, issue: null, resultText: '끝', needsAnswer: false, timeoutMs: null,
    exitCode: 0, errorMessage: null, logPath: '', reviewedAt: null, reviewedKind: null,
    startedAt: NOW - 60_000, endedAt: NOW - 30_000, createdAt: NOW - 61_000, contextItems: [], usage: null, ...over
  }
}

interface Seed {
  workspaces?: Workspace[]
  repos?: Repo[]
  issues?: Issue[]
  /** workspace마다 최신순으로 넣는다 */
  runs?: Run[]
  live?: Record<string, LiveSnapshot>
  queue?: { running: number; limit: number; waiting: number }
}

/** 인박스는 저장소처럼 "미확인 뿌리의 대표 턴, 끝난 시각 최신 먼저"를 흉내낸다 */
function sources(seed: Seed): HomeSources {
  const runs = seed.runs ?? []
  const byRoot = new Map<string, Run[]>()
  for (const r of runs) {
    const key = r.rootRunId ?? r.id
    byRoot.set(key, [...(byRoot.get(key) ?? []), r])
  }
  const inbox: Run[] = []
  for (const [rootId, turns] of byRoot) {
    const root = turns.find((t) => t.id === rootId)!
    if (root.reviewedAt !== null) continue
    const latestFirst = [...turns].sort((a, b) => b.createdAt - a.createdAt)
    inbox.push(representativeTurn(latestFirst)!)
  }
  inbox.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return {
    workspaces: () => seed.workspaces ?? [],
    repos: (id) => (seed.repos ?? []).filter((r) => r.workspaceId === id),
    issues: (id) => (seed.issues ?? []).filter((i) => i.workspaceId === id),
    runs: (id) => runs.filter((r) => r.workspaceId === id).sort((a, b) => b.createdAt - a.createdAt),
    inbox: () => inbox,
    live: (id) => seed.live?.[id] ?? null,
    queue: () => seed.queue ?? { running: 0, limit: 2, waiting: 0 }
  }
}

const input = { now: NOW, dayStart: DAY_START }

describe('buildHomeSummary — 할 일 (FR-3)', () => {
  it('네 종류가 답변 필요 → 실패·중단 → 정리 안 됨 → 오래 안 본 순이고, 1·2는 인박스 순(끝난 시각 최신 먼저)이다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a'), ws('b')],
      runs: [
        run('f1', 'a', { status: 'failed', errorMessage: 'exit 1', endedAt: NOW - 5_000 }),
        run('q1', 'a', { needsAnswer: true, resultText: '어느 브랜치?', endedAt: NOW - 9_000 }),
        run('q2', 'b', { needsAnswer: true, resultText: '토큰?', endedAt: NOW - 1_000 }),
        run('i1', 'b', { status: 'interrupted', endedAt: NOW - 7_000 })
      ],
      issues: [
        issue('u1', 'b', { triagedAt: null }),
        issue('s1', 'a', { seenAt: NOW - STALE_MS - 1 })
      ]
    }), input)
    expect(s.todos.map((t) => 'runId' in t ? `${t.kind}:${t.runId}` : `${t.kind}:${t.workspaceId}`))
      .toEqual(['needs-answer:q2', 'needs-answer:q1', 'failed:f1', 'interrupted:i1', 'untriaged:b', 'stale:a'])
  })

  it('답변 필요 줄의 detail은 질문 앞 160자, 실패 줄은 실패 이유다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a')],
      runs: [
        run('q', 'a', { needsAnswer: true, resultText: '가'.repeat(200) }),
        run('f', 'a', { status: 'failed', errorMessage: 'ENOENT' })
      ]
    }), input)
    expect(s.todos[0]).toMatchObject({ kind: 'needs-answer', detail: `${'가'.repeat(160)}…`, title: '지시 q', workspaceName: 'a' })
    expect(s.todos[1]).toMatchObject({ kind: 'failed', detail: 'ENOENT' })
  })

  it('인박스에서 내려간 대화는 할 일이 아니다 — reviewedAt이 찍힌 뿌리', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a')],
      runs: [run('q', 'a', { needsAnswer: true, reviewedAt: NOW, reviewedKind: 'confirmed' })]
    }), input)
    expect(s.todos).toEqual([])
  })

  it('완료·미확인 대화는 배지에 세지 않으므로 할 일도 아니다 (INBOX_RULES.badge)', () => {
    const s = buildHomeSummary(sources({ workspaces: [ws('a')], runs: [run('d', 'a')] }), input)
    expect(s.todos).toEqual([])
  })

  it('정리 안 됨·오래 안 본은 workspace마다 한 줄이고 앞 세 제목을 싣는다 — 0이면 줄이 없다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a'), ws('b')],
      issues: [
        issue('1', 'a', { triagedAt: null }), issue('2', 'a', { triagedAt: null }),
        issue('3', 'a', { triagedAt: null }), issue('4', 'a', { triagedAt: null })
      ]
    }), input)
    expect(s.todos).toEqual([{ kind: 'untriaged', workspaceId: 'a', workspaceName: 'a', count: 4, titles: ['이슈 1', '이슈 2', '이슈 3'] }])
  })

  it('done 이슈는 오래 안 본 것이 아니고, seenAt이 없으면 createdAt으로 잰다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a')],
      issues: [
        issue('done', 'a', { status: 'done', closedAt: NOW - 20 * DAY, seenAt: NOW - STALE_MS - 1 }),
        issue('never', 'a', { seenAt: null, createdAt: NOW - STALE_MS - 1 }),
        issue('fresh', 'a', { seenAt: null, createdAt: NOW - 1 })
      ]
    }), input)
    expect(s.todos).toEqual([{ kind: 'stale', workspaceId: 'a', workspaceName: 'a', count: 1, titles: ['이슈 never'] }])
  })

  it('지워진 workspace의 인박스 항목은 세지 않는다', () => {
    const s = buildHomeSummary(sources({ workspaces: [ws('a')], runs: [run('q', 'gone', { needsAnswer: true })] }), input)
    expect(s.todos).toEqual([])
  })
})

describe('homeCount (FR-4·FR-17)', () => {
  it('count는 summary.todos.length다 — 한 함수에서 나온다', () => {
    const src = sources({
      workspaces: [ws('a'), ws('b')],
      runs: [
        run('q', 'a', { needsAnswer: true }), run('f', 'b', { status: 'failed' }),
        run('d', 'a'), run('r', 'a', { needsAnswer: true, reviewedAt: NOW }), run('x', 'gone', { needsAnswer: true })
      ],
      issues: [issue('u', 'a', { triagedAt: null }), issue('s', 'b', { seenAt: NOW - STALE_MS - 1 }), issue('ok', 'b')]
    })
    const s = buildHomeSummary(src, input)
    expect(s.todos).toHaveLength(4)
    expect(homeCount(src, { now: NOW })).toBe(4)
  })
})

describe('buildHomeSummary — 돌고 있는 것 (FR-10)', () => {
  it('대화마다 running 턴 하나, 스냅샷은 live에서, 예약·대기는 queued로 센다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a')],
      repos: [repo('api', 'a', '/w/api')],
      runs: [
        run('c1', 'a', { status: 'succeeded', createdAt: NOW - 100_000, endedAt: NOW - 90_000, cwd: '/w/api/' }),
        run('c1-2', 'a', { rootRunId: 'c1', parentRunId: 'c1', status: 'running', startedAt: NOW - 20_000, endedAt: null, createdAt: NOW - 21_000 }),
        run('c1-3', 'a', { rootRunId: 'c1', parentRunId: 'c1-2', status: 'pending', startedAt: null, endedAt: null, createdAt: NOW - 1_000 }),
        run('n', 'a', { status: 'pending', startedAt: null, endedAt: null })
      ],
      live: { 'c1-2': { currentTool: 'Edit', lastText: '파일을 고치는 중' } },
      queue: { running: 1, limit: 2, waiting: 1 }
    }), input)
    expect(s.running).toEqual([{
      workspaceId: 'a', workspaceName: 'a', repoId: 'api', repoName: 'api', conversationId: 'c1', runId: 'c1-2',
      title: '지시 c1', turns: 3, startedAt: NOW - 20_000, currentTool: 'Edit', lastText: '파일을 고치는 중'
    }])
    expect(s.queued).toBe(2)
    expect(s.slots).toEqual({ used: 1, limit: 2 })
  })

  it('앱을 다시 켜 스냅샷이 없으면 도구·텍스트가 null이다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a')], runs: [run('r', 'a', { status: 'running', endedAt: null })]
    }), input)
    expect(s.running[0]).toMatchObject({ currentTool: null, lastText: null })
  })
})

describe('buildHomeSummary — 오늘 타임라인 (FR-5)', () => {
  it('어제 시작해 오늘 끝난 대화의 막대는 자정에서 시작하고, 오늘 시작해 도는 대화는 지금까지다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a')],
      runs: [
        run('old', 'a', { createdAt: DAY_START - 2 * 60 * 60 * 1000, startedAt: DAY_START - 60 * 60 * 1000, endedAt: DAY_START + 60 * 60 * 1000 }),
        run('live', 'a', { createdAt: DAY_START + 2 * 60 * 60 * 1000, startedAt: DAY_START + 2 * 60 * 60 * 1000 + 1, endedAt: null, status: 'running' }),
        run('yesterday', 'a', { createdAt: DAY_START - 3 * DAY, startedAt: DAY_START - 3 * DAY, endedAt: DAY_START - 2 * DAY })
      ]
    }), input)
    expect(s.timeline).toEqual([{
      workspaceId: 'a', name: 'a',
      bars: [
        { conversationId: 'old', title: '지시 old', from: DAY_START, to: DAY_START + 60 * 60 * 1000, status: 'succeeded', needsAnswer: false },
        { conversationId: 'live', title: '지시 live', from: DAY_START + 2 * 60 * 60 * 1000, to: NOW, status: 'running', needsAnswer: false }
      ]
    }])
  })

  it('어제 시작해 아직 도는 대화도 오늘 줄에 있다 — 마지막 활동이 아니라 지금이 끝이다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a')],
      runs: [run('r', 'a', { createdAt: DAY_START - DAY, startedAt: DAY_START - DAY, endedAt: null, status: 'running' })]
    }), input)
    expect(s.timeline[0]?.bars).toEqual([expect.objectContaining({ conversationId: 'r', from: DAY_START, to: NOW, status: 'running' })])
  })
})

describe('buildHomeSummary — workspace 카드 (FR-6)', () => {
  it('열림·진행 중·오늘 완료·정리 안 됨과 repo별 열린 이슈·대화 수를 센다', () => {
    const s = buildHomeSummary(sources({
      workspaces: [ws('a', '회사')],
      repos: [repo('api', 'a', '/w/api'), repo('web', 'a', '/w/web')],
      issues: [
        issue('1', 'a', { status: 'open', repoIds: ['api'] }),
        issue('2', 'a', { status: 'doing', repoIds: ['api', 'web'] }),
        issue('3', 'a', { status: 'done', closedAt: NOW - 1000 }),
        issue('4', 'a', { status: 'done', closedAt: DAY_START - 1 }),
        issue('5', 'a', { status: 'open', triagedAt: null })
      ],
      runs: [
        run('c1', 'a', { cwd: '/w/api' }),
        run('c2', 'a', { cwd: '/w/api', closedAt: NOW }),
        run('c3', 'a', { cwd: '/elsewhere' })
      ]
    }), input)
    expect(s.workspaces).toEqual([{
      workspaceId: 'a', name: '회사', open: 2, doing: 1, doneToday: 1, untriaged: 1,
      repos: [
        { repoId: 'api', name: 'api', path: '/w/api', agentEnv: 'host', open: 2, conversations: 1, state: 'done' },
        { repoId: 'web', name: 'web', path: '/w/web', agentEnv: 'host', open: 1, conversations: 0, state: 'none' }
      ]
    }])
    expect(s.doneToday).toEqual([{ workspaceId: 'a', workspaceName: '회사', issueId: '3', title: '이슈 3', closedAt: NOW - 1000 }])
  })

  it('repo 상태는 running > needs-answer > failed·interrupted > done > none이다', () => {
    const state = (runs: Run[]) => buildHomeSummary(sources({
      workspaces: [ws('a')], repos: [repo('api', 'a', '/w/api')], runs
    }), input).workspaces[0]!.repos[0]!.state
    expect(state([run('d', 'a')])).toBe('done')
    expect(state([run('d', 'a'), run('f', 'a', { status: 'interrupted' })])).toBe('failed')
    expect(state([run('f', 'a', { status: 'failed' }), run('q', 'a', { needsAnswer: true })])).toBe('needs-answer')
    expect(state([run('q', 'a', { needsAnswer: true }), run('r', 'a', { status: 'running', endedAt: null })])).toBe('running')
    expect(state([])).toBe('none')
  })
})

describe('buildHomeSummary — 준비 단계 (FR-14)', () => {
  it('workspace · repo · 첫 대화의 세 조건이다', () => {
    expect(buildHomeSummary(sources({}), input).setup).toEqual({ workspace: false, repo: false, firstRun: false })
    expect(buildHomeSummary(sources({ workspaces: [ws('a')] }), input).setup).toEqual({ workspace: true, repo: false, firstRun: false })
    expect(buildHomeSummary(sources({ workspaces: [ws('a')], repos: [repo('r', 'a', '/w')] }), input).setup)
      .toEqual({ workspace: true, repo: true, firstRun: false })
    expect(buildHomeSummary(sources({ workspaces: [ws('a')], repos: [repo('r', 'a', '/w')], runs: [run('x', 'a')] }), input).setup)
      .toEqual({ workspace: true, repo: true, firstRun: true })
  })
})

describe('NFR-1', () => {
  it('workspace 3 · 이슈 300 · run 2,000에서 요약 한 번이 빠르다', () => {
    const workspaces = [ws('a'), ws('b'), ws('c')]
    const repos = workspaces.map((w) => repo(`${w.id}-repo`, w.id, `/w/${w.id}`))
    const issues: Issue[] = []
    const runs: Run[] = []
    for (const w of workspaces) {
      for (let i = 0; i < 100; i++) issues.push(issue(`${w.id}-i${i}`, w.id, { triagedAt: i % 7 === 0 ? null : NOW, seenAt: i % 5 === 0 ? NOW - STALE_MS - 1 : NOW }))
      for (let i = 0; i < 666; i++) {
        const root = i % 3 === 0 ? null : `${w.id}-r${i - (i % 3)}`
        runs.push(run(`${w.id}-r${i}`, w.id, {
          rootRunId: root, cwd: `/w/${w.id}`, createdAt: NOW - i * 60_000, endedAt: NOW - i * 60_000 + 30_000,
          needsAnswer: i % 11 === 0, status: i % 13 === 0 ? 'failed' : 'succeeded'
        }))
      }
    }
    const src = sources({ workspaces, repos, issues, runs })
    buildHomeSummary(src, input) // 워밍업(JIT)
    const t0 = performance.now()
    const s = buildHomeSummary(src, input)
    const summaryMs = performance.now() - t0
    const t1 = performance.now()
    homeCount(src, { now: NOW })
    const countMs = performance.now() - t1
    expect(s.workspaces).toHaveLength(3)
    // spec은 50ms다. CI 러너의 흔들림을 감안해 상한은 넉넉히 두고, 실측값은 plan의 완료 증명에 적는다.
    expect(summaryMs).toBeLessThan(150)
    expect(countMs).toBeLessThan(75)
  })
})
