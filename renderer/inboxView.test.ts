import { describe, it, expect, afterEach, vi } from 'vitest'
import { CATEGORIES } from '@shared/inbox'
import type { Repo, Run, Workspace } from '@shared/models'
import {
  DEFAULT_INBOX_VIEW, groupByStatus, groupByWorkspace, readInboxCollapsed, readInboxView, repoOfItem, sortInbox, sourceLabel,
  STATUS_ORDER, writeInboxCollapsed, writeInboxView, type ReposByWorkspace
} from './inboxView'

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'w1', agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    title: null, closedAt: null,
    needsAnswer: false, timeoutMs: null, exitCode: 0, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: 1,
    endedAt: 0, createdAt: 0, contextItems: [], issue: null, usage: null, ...over
  }
}

function makeWorkspace(id: string, name: string): Workspace {
  return {
    id, name, description: null, defaultAgentKind: 'claude-code', defaultModelClaude: null, defaultModelOpencode: null,
    defaultEffortClaude: null, defaultVariantOpencode: null, defaultPermission: 'edit', claudePath: null, opencodePath: null,
    createdAt: 0, updatedAt: 0
  }
}

function makeRepo(id: string, workspaceId: string, name: string, path: string): Repo {
  return { id, workspaceId, name, path, description: null, sortOrder: 0, createdAt: 0 }
}

const ids = (runs: readonly Run[]) => runs.map((r) => r.id)

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('sortInbox (docs/sdlc/inbox-views/ FR-2)', () => {
  // core가 준 순서: 끝난 시각 최신순, 같은 시각은 만든 순서의 역순
  const items = [
    makeRun({ id: 'b', endedAt: 30 }),
    makeRun({ id: 'c1', endedAt: 20 }),
    makeRun({ id: 'c2', endedAt: 20 }),
    makeRun({ id: 'a', endedAt: 10 })
  ]

  it('최신 먼저는 끝난 시각 최신순이고, 같은 시각은 받은 순서 그대로다', () => {
    expect(ids(sortInbox([...items].reverse(), 'desc'))).toEqual(['b', 'c2', 'c1', 'a'])
    expect(ids(sortInbox(items, 'desc'))).toEqual(['b', 'c1', 'c2', 'a'])
  })

  it('오래된 먼저는 최신 먼저를 정확히 뒤집은 것이다 — 같은 시각끼리의 순서까지 뒤집혀 두 번 누르면 제자리다', () => {
    expect(ids(sortInbox(items, 'asc'))).toEqual(['a', 'c2', 'c1', 'b'])
  })

  it('받은 배열을 고치지 않는다', () => {
    const before = ids(items)
    sortInbox(items, 'asc')
    expect(ids(items)).toEqual(before)
  })
})

describe('항목의 repo와 소속 (FR-5·6)', () => {
  const workspaces = [makeWorkspace('w1', 'one-desk'), makeWorkspace('w2', 'side')]
  const repos: ReposByWorkspace = {
    w1: [makeRepo('r-api', 'w1', 'api', '/work/api')],
    w2: [makeRepo('r-web', 'w2', 'web', 'C:\\work\\Web')]
  }

  it('그 workspace의 repo에서 경로로 찾는다 — 끝 구분자와 Windows 대소문자는 도크와 같은 규칙이다', () => {
    expect(repoOfItem(makeRun({ id: 'x', cwd: '/work/api/' }), repos)?.id).toBe('r-api')
    expect(repoOfItem(makeRun({ id: 'y', workspaceId: 'w2', cwd: 'c:/WORK/web' }), repos)?.id).toBe('r-web')
  })

  it('다른 workspace의 같은 경로 repo는 잡지 않는다', () => {
    // w2의 run이 w1에 등록된 경로에서 돌았다 — w1의 repo로 묶이면 workspace 묶음과 repo 묶음이 어긋난다
    expect(repoOfItem(makeRun({ id: 'z', workspaceId: 'w2', cwd: '/work/api' }), repos)).toBeNull()
  })

  it('소속은 workspace · repo이고, repo를 모르면 workspace만, workspace가 없으면 사라진 workspace다', () => {
    expect(sourceLabel(makeRun({ id: 'a', cwd: '/work/api' }), workspaces, repos)).toBe('one-desk · api')
    expect(sourceLabel(makeRun({ id: 'b', cwd: '/elsewhere' }), workspaces, repos)).toBe('one-desk')
    expect(sourceLabel(makeRun({ id: 'c', cwd: '/work/api' }), workspaces, {})).toBe('one-desk')
    expect(sourceLabel(makeRun({ id: 'd', workspaceId: 'gone' }), workspaces, repos)).toBe('(사라진 workspace)')
  })
})

describe('groupByWorkspace (FR-6·7)', () => {
  const workspaces = [makeWorkspace('w1', 'alpha'), makeWorkspace('w2', 'beta')]
  const repos: ReposByWorkspace = {
    w1: [makeRepo('r-api', 'w1', 'api', '/w1/api'), makeRepo('r-web', 'w1', 'web', '/w1/web')],
    w2: [makeRepo('r-cli', 'w2', 'cli', '/w2/cli')]
  }
  // 최신 먼저로 받은 순서
  const items = [
    makeRun({ id: 'b-cli', workspaceId: 'w2', cwd: '/w2/cli', endedAt: 90 }),
    makeRun({ id: 'a-other', workspaceId: 'w1', cwd: '/nowhere', endedAt: 80 }),
    makeRun({ id: 'a-web', workspaceId: 'w1', cwd: '/w1/web', endedAt: 70, needsAnswer: true }),
    makeRun({ id: 'gone-1', workspaceId: 'w9', cwd: '/w9', endedAt: 60 }),
    makeRun({ id: 'a-api', workspaceId: 'w1', cwd: '/w1/api', endedAt: 50 }),
    makeRun({ id: 'a-web2', workspaceId: 'w1', cwd: '/w1/web', endedAt: 40 })
  ]

  it('workspace → repo 두 단으로 묶고, 묶음 순서는 첫 항목이 정렬에서 앞선 순이다 — 기타와 사라진 workspace는 맨 아래', () => {
    const groups = groupByWorkspace(items, 'desc', workspaces, repos)
    expect(groups.map((g) => [g.key, g.label, g.count])).toEqual([
      ['ws:w2', 'beta', 1],
      ['ws:w1', 'alpha', 4],
      ['ws:w9', '(사라진 workspace)', 1]
    ])
    const alpha = groups[1]!
    expect(alpha.repos.map((r) => [r.key, r.label, ids(r.items)])).toEqual([
      ['repo:r-web', 'web', ['a-web', 'a-web2']],
      ['repo:r-api', 'api', ['a-api']],
      // 기타는 가장 최근 항목이 있어도 그 workspace 안에서 맨 아래다
      ['other:w1', '기타', ['a-other']]
    ])
    expect(groups[2]!.repos.map((r) => r.key)).toEqual(['other:w9'])
  })

  it('오래된 먼저면 가장 오래 기다린 대화가 있는 묶음이 위이고, 묶음 안도 오래된 순이다', () => {
    const groups = groupByWorkspace(items, 'asc', workspaces, repos)
    expect(groups.map((g) => g.key)).toEqual(['ws:w1', 'ws:w2', 'ws:w9'])
    expect(groups[0]!.repos.map((r) => [r.key, ids(r.items)])).toEqual([
      ['repo:r-web', ['a-web2', 'a-web']],
      ['repo:r-api', ['a-api']],
      ['other:w1', ['a-other']]
    ])
  })

  it('묶음마다 그 안에 답변 필요가 있는지 안다 (FR-13)', () => {
    const groups = groupByWorkspace(items, 'desc', workspaces, repos)
    const alpha = groups.find((g) => g.key === 'ws:w1')!
    expect(alpha.needsAnswer).toBe(true)
    expect(alpha.repos.map((r) => r.needsAnswer)).toEqual([true, false, false])
    expect(groups.find((g) => g.key === 'ws:w2')!.needsAnswer).toBe(false)
  })

  it('비면 묶음이 없다', () => {
    expect(groupByWorkspace([], 'desc', workspaces, repos)).toEqual([])
  })
})

describe('groupByStatus (FR-10)', () => {
  it('묶음 순서는 정렬과 무관하게 답변 필요 → 실패 → 중단됨 → 완료·미확인 → 대기 중 취소됨이고, 빈 카테고리는 없다', () => {
    const items = [
      makeRun({ id: 'done', endedAt: 90 }),
      makeRun({ id: 'dropped', status: 'canceled', startedAt: null, endedAt: 80 }),
      makeRun({ id: 'failed-1', status: 'failed', endedAt: 70 }),
      makeRun({ id: 'cut', status: 'interrupted', endedAt: 65 }),
      makeRun({ id: 'ask', needsAnswer: true, endedAt: 60 }),
      makeRun({ id: 'failed-2', status: 'failed', endedAt: 50 })
    ]
    for (const order of ['desc', 'asc'] as const) {
      expect(groupByStatus(items, order).map((g) => [g.key, g.label])).toEqual([
        ['status:needs-answer', '답변 필요'],
        ['status:failed', '실패'],
        ['status:interrupted', '중단됨'],
        ['status:done', '완료 · 미확인'],
        ['status:dropped', '대기 중 취소됨']
      ])
    }
    expect(ids(groupByStatus(items, 'desc')[1]!.items)).toEqual(['failed-1', 'failed-2'])
    expect(ids(groupByStatus(items, 'asc')[1]!.items)).toEqual(['failed-2', 'failed-1'])
    expect(groupByStatus(items, 'desc').map((g) => g.needsAnswer)).toEqual([true, false, false, false, false])
  })

  it('순서 표는 모든 카테고리를 담는다 — 카테고리가 늘었는데 표에 없으면 그 대화가 상태별에서 사라진다', () => {
    expect([...STATUS_ORDER].sort()).toEqual([...CATEGORIES].sort())
  })
})

describe('보기와 접힘의 기억 (FR-3·14)', () => {
  it('기본은 시간순 · 최신 먼저이고, 고른 것을 이 장비에 남긴다', () => {
    expect(readInboxView()).toEqual({ mode: 'time', order: 'desc' })
    expect(DEFAULT_INBOX_VIEW).toEqual({ mode: 'time', order: 'desc' })
    writeInboxView({ mode: 'workspace', order: 'asc' })
    expect(readInboxView()).toEqual({ mode: 'workspace', order: 'asc' })
  })

  it('모르는 값은 그 칸만 기본이다', () => {
    localStorage.setItem('one-desk.inbox.view', JSON.stringify({ mode: 'kanban', order: 'asc' }))
    expect(readInboxView()).toEqual({ mode: 'time', order: 'asc' })
    localStorage.setItem('one-desk.inbox.view', '{깨진')
    expect(readInboxView()).toEqual({ mode: 'time', order: 'desc' })
  })

  it('접은 묶음의 키를 남긴다', () => {
    expect(readInboxCollapsed()).toEqual(new Set())
    writeInboxCollapsed(new Set(['ws:w1', 'status:failed']))
    expect(readInboxCollapsed()).toEqual(new Set(['ws:w1', 'status:failed']))
    localStorage.setItem('one-desk.inbox.collapsed', JSON.stringify(['ws:w1', 3, null]))
    expect(readInboxCollapsed()).toEqual(new Set(['ws:w1']))
  })

  it('저장소가 막혀도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readInboxView()).toEqual({ mode: 'time', order: 'desc' })
    expect(readInboxCollapsed()).toEqual(new Set())
    expect(() => { writeInboxView({ mode: 'status', order: 'asc' }); writeInboxCollapsed(new Set(['x'])) }).not.toThrow()
  })
})
