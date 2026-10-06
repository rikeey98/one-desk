import { describe, it, expect } from 'vitest'
import { historyOf, stepHistory, NO_HISTORY } from './promptHistory'
import { groupConversations } from './conversation'
import type { Run } from '@shared/models'

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'w1', agentKind: 'claude-code', model: null, effort: null,
    cwd: '/tmp/api', permission: 'edit', userPrompt: '지시', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: 'sess-1', parentRunId: null, rootRunId: over.id,
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: null,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    title: null, closedAt: null,
    startedAt: null, endedAt: null, createdAt: 0, contextItems: [], issue: null, usage: null,
    ...over
  }
}

/** 오래된 것부터 준 지시로 한 대화를 만든다. */
function conversationOf(prompts: string[], last: Partial<Run> = {}) {
  const runs = prompts.map((userPrompt, i) => makeRun({
    id: `t${i}`, rootRunId: 't0', parentRunId: i === 0 ? null : `t${i - 1}`,
    createdAt: (i + 1) * 10, userPrompt,
    ...(i === prompts.length - 1 ? last : {})
  }))
  // runs.list처럼 최신순으로 넘긴다 — groupConversations가 그 순서를 뒤집어 오래된 순을 만든다.
  return groupConversations(runs.reverse())[0]!
}

describe('historyOf (spec FR-1)', () => {
  it('최근 것부터 늘어놓고, 이웃한 같은 지시는 하나로 접고, 공백뿐인 지시는 뺀다', () => {
    const conv = conversationOf(['첫', '둘', '둘', '  \n ', '셋', '첫'])

    expect(historyOf(conv)).toEqual(['첫', '셋', '둘', '첫'])
  })

  it('대화가 없으면(새 대화) 비어 있다', () => {
    expect(historyOf(null)).toEqual([])
  })

  it('예약(뿌리가 아닌 pending)의 지시도 들어간다 — 보낸 지시다', () => {
    const conv = conversationOf(['첫', '예약한 것'], { status: 'pending' })

    expect(historyOf(conv)[0]).toBe('예약한 것')
  })
})

describe('stepHistory (spec FR-2·FR-3)', () => {
  const entries = ['셋', '둘', '첫']

  it('빈 입력에서 ↑는 가장 최근 지시다', () => {
    expect(stepHistory({ entries, index: NO_HISTORY, text: '' }, 'up')).toEqual({ index: 0, text: '셋' })
  })

  it('공백뿐인 입력도 빈 입력이다', () => {
    expect(stepHistory({ entries, index: NO_HISTORY, text: ' \n' }, 'up')).toEqual({ index: 0, text: '셋' })
  })

  it('불러온 글 그대로에서 ↑는 한 칸 더 오래된 것이다', () => {
    expect(stepHistory({ entries, index: 0, text: '셋' }, 'up')).toEqual({ index: 1, text: '둘' })
  })

  it('가장 오래된 것에서 ↑는 제자리다 — 기본 동작(줄 이동)으로 새지 않는다', () => {
    expect(stepHistory({ entries, index: 2, text: '첫' }, 'up')).toEqual({ index: 2, text: '첫' })
  })

  it('↓는 한 칸 더 최근 것이고, 가장 최근 것에서 ↓는 빈 입력으로 돌아간다', () => {
    expect(stepHistory({ entries, index: 1, text: '둘' }, 'down')).toEqual({ index: 0, text: '셋' })
    expect(stepHistory({ entries, index: 0, text: '셋' }, 'down')).toEqual({ index: NO_HISTORY, text: '' })
  })

  it('빈 입력에서 ↓는 기본 동작에 맡긴다', () => {
    expect(stepHistory({ entries, index: NO_HISTORY, text: '' }, 'down')).toBeNull()
  })

  it('불러온 글을 고치면 그 뒤의 ↑↓는 기본 동작이다', () => {
    expect(stepHistory({ entries, index: 1, text: '둘 고침' }, 'up')).toBeNull()
    expect(stepHistory({ entries, index: 1, text: '둘 고침' }, 'down')).toBeNull()
  })

  it('쓰던 글이 있으면 ↑는 기본 동작이다', () => {
    expect(stepHistory({ entries, index: NO_HISTORY, text: '쓰던 글' }, 'up')).toBeNull()
  })

  it('history가 비었으면 ↑는 기본 동작이다', () => {
    expect(stepHistory({ entries: [], index: NO_HISTORY, text: '' }, 'up')).toBeNull()
  })

  it('목록이 줄어 index가 밖을 가리키면 기본 동작이다 — 없는 칸을 불러오지 않는다', () => {
    expect(stepHistory({ entries: ['셋'], index: 2, text: '첫' }, 'up')).toBeNull()
  })
})
