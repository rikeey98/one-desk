import { describe, it, expect } from 'vitest'
import { contextOf, conversationIdOf, groupConversations, titleOf } from './conversation'
import type { Run } from '@shared/models'

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'ws', agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    // 대화의 이름과 끝. 뿌리 행에서만 의미가 있고 기본은 둘 다 null이다.
    title: null, closedAt: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], issue: null, usage: null, ...over
  }
}

describe('conversationIdOf', () => {
  it('rootRunId가 없는 낡은 행은 자기 자신이 뿌리다', () => {
    expect(conversationIdOf(makeRun({ id: 'a', rootRunId: null }))).toBe('a')
  })
})

describe('groupConversations', () => {
  // useRuns는 최신순으로 준다.
  const runs = [
    makeRun({ id: 'a3', rootRunId: 'a1', createdAt: 30, userPrompt: '3턴' }),
    makeRun({ id: 'b1', rootRunId: 'b1', createdAt: 25, userPrompt: '다른 대화' }),
    makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, userPrompt: '2턴' }),
    makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '첫 지시' })
  ]

  it('같은 뿌리를 한 대화로 묶는다', () => {
    const convs = groupConversations(runs)
    expect(convs.map((c) => c.id)).toEqual(['a1', 'b1'])
  })

  it('턴은 오래된 순이다 — 대화록은 위에서 아래로 읽는다', () => {
    const [a] = groupConversations(runs)
    expect(a!.runs.map((r) => r.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('마지막 턴과 제목이 서로 다른 턴에서 온다', () => {
    const [a] = groupConversations(runs)
    // 제목은 첫 턴, 상태는 마지막 턴.
    expect(a!.title).toBe('첫 지시')
    expect(a!.last.id).toBe('a3')
  })

  it('마지막 활동이 최근인 대화가 앞에 온다', () => {
    const older = makeRun({ id: 'c1', rootRunId: 'c1', createdAt: 5 })
    expect(groupConversations([...runs, older]).map((c) => c.id)).toEqual(['a1', 'b1', 'c1'])
  })
})

/**
 * 대화의 상태를 정하는 턴 (`docs/sdlc/conversation-fixes/` spec FR-1·FR-3).
 *
 * `last`는 "가장 최근에 만든 턴"이고 `state`는 **대표 턴**이다 — 시작하지 못하고 취소된
 * 예약을 건너뛴다. 둘을 가르지 않으면 2턴의 실패가 3턴 예약의 취소에 가려 도크 목록의
 * 점이 "canceled"가 되고, 배지(core)와 도크가 서로 다른 턴을 본다.
 */
describe('대화의 대표 턴과 활성 턴', () => {
  it('시작하지 못하고 취소된 예약은 state가 건너뛰지만 last는 그 턴이다', () => {
    const [conv] = groupConversations([
      makeRun({ id: 'a3', rootRunId: 'a1', createdAt: 30, status: 'canceled', startedAt: null }),
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'failed', startedAt: 20 }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', startedAt: 10 })
    ])
    expect(conv!.state.id).toBe('a2')
    expect(conv!.last.id).toBe('a3')
  })

  it('시작한 뒤 취소된 턴은 state가 건너뛰지 않는다', () => {
    const [conv] = groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'canceled', startedAt: 20 }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'failed', startedAt: 10 })
    ])
    expect(conv!.state.id).toBe('a2')
  })

  it('끝난 대화에는 활성 턴이 없다', () => {
    const [conv] = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', startedAt: 1 })
    ])
    expect(conv!.active).toBeNull()
  })

  it('활성 턴은 실행 중인 턴이 예약보다 앞선다', () => {
    // 2턴이 도는 중에 3턴을 예약했다. "가장 최근 턴"은 예약이지만, 멈출 대상으로
    // 먼저 떠오르는 것은 돌고 있는 턴이다(도크 헤더의 취소가 이것을 겨눈다 — FR-11).
    const [conv] = groupConversations([
      makeRun({ id: 'a3', rootRunId: 'a1', createdAt: 30, status: 'pending' }),
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'running', startedAt: 20 }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', startedAt: 10 })
    ])
    expect(conv!.active?.id).toBe('a2')
  })

  it('실행 중인 턴이 없으면 예약이 활성 턴이다', () => {
    const [conv] = groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded', startedAt: 10 })
    ])
    expect(conv!.active?.id).toBe('a2')
  })
})

/**
 * 제목의 폴백 사다리 (`docs/sdlc/conversation-lifecycle/` FR-11).
 *
 * 사용자가 붙인 이름 > 담긴 이슈·메모 > repo 이름 > 첫 지시의 첫 줄.
 * 첫 지시만 쓰던 시절에는 "이거 좀 봐줘"가 제목이 되어 대화를 알아볼 수 없었다.
 */
describe('대화 제목 사다리', () => {
  const ISSUE = { type: 'issue' as const, id: 'i1', label: '로그인 깨짐' }
  const ISSUE2 = { type: 'issue' as const, id: 'i2', label: '세션 타임아웃' }
  const MEMO = { type: 'memo' as const, id: 'm1', label: '릴리스 절차' }
  const REPO = { type: 'repo' as const, id: 'r1', label: 'api' }
  const ASSET = { type: 'asset' as const, id: 's1', label: 'review' }

  function one(over: Partial<Run>) {
    return groupConversations([makeRun({ id: 'x1', rootRunId: 'x1', ...over })])[0]!
  }

  it('1단 — 사용자가 붙인 이름이 다른 모든 것을 이긴다', () => {
    const conv = one({ title: '인증 정리', contextItems: [ISSUE], userPrompt: '이거 봐줘' })
    expect(conv.title).toBe('인증 정리')
    expect(conv.named).toBe(true)
  })

  it('2단 — 담긴 이슈·메모의 이름을 쓴다', () => {
    const conv = one({ contextItems: [ISSUE], userPrompt: '이거 봐줘' })
    expect(conv.title).toBe('로그인 깨짐')
    expect(conv.named).toBe(false)
  })

  it('2단 — 이슈·메모가 여럿이면 나머지 개수를 붙인다', () => {
    expect(one({ contextItems: [ISSUE, ISSUE2] }).title).toBe('로그인 깨짐 +1')
    expect(one({ contextItems: [ISSUE, MEMO, ISSUE2] }).title).toBe('로그인 깨짐 +2')
  })

  it('2단 — repo·asset은 개수에 세지 않는다', () => {
    // 배경이지 주제가 아니다. 세면 이슈 하나짜리 대화에 "+3"이 붙어 무엇이 더
    // 있다는 뜻인지 알 수 없게 된다.
    expect(one({ contextItems: [ISSUE, REPO, ASSET] }).title).toBe('로그인 깨짐')
  })

  it('3단 — 이슈·메모가 없으면 첫 repo 이름을 쓴다', () => {
    expect(one({ contextItems: [REPO, ASSET], userPrompt: '이거 봐줘' }).title).toBe('api')
  })

  it('4단 — 아무것도 담지 않았으면 첫 지시의 첫 줄이다', () => {
    expect(one({ contextItems: [], userPrompt: '토큰 만료 고쳐줘\n둘째 줄' }).title)
      .toBe('토큰 만료 고쳐줘')
  })

  it('빈 이름은 붙이지 않은 것으로 본다', () => {
    // 저장소가 빈 값을 null로 만들지만(FR-14), 낡은 행이나 공백만 있는 값이
    // 들어와도 화면이 빈 제목을 그리면 안 된다.
    const conv = one({ title: '   ', contextItems: [ISSUE] })
    expect(conv.title).toBe('로그인 깨짐')
    expect(conv.named).toBe(false)
  })

  it('취소된 턴이 담았던 것은 제목에 쓰지 않는다', () => {
    // contextOf와 같은 규칙이다 — 담으려다 만 것이다.
    const conv = groupConversations([
      makeRun({ id: 'y2', rootRunId: 'y1', createdAt: 20, status: 'canceled', contextItems: [ISSUE] }),
      makeRun({ id: 'y1', rootRunId: 'y1', createdAt: 10, userPrompt: '첫 지시' })
    ])[0]!
    expect(conv.title).toBe('첫 지시')
  })

  it('제목·종료는 뿌리 행에서 읽는다 — 이어진 턴의 값이 아니다', () => {
    // title·closedAt은 뿌리 행에서만 의미가 있다. 가장 오래된 행이 뿌리라는
    // 가정에 기대지 않고 id로 찾는다 — 목록이 반쪽일 때 조용히 null이 된다.
    const conv = groupConversations([
      makeRun({ id: 'z2', rootRunId: 'z1', createdAt: 20, title: '턴이 가진 이름', closedAt: 999 }),
      makeRun({ id: 'z1', rootRunId: 'z1', createdAt: 10, title: '뿌리의 이름', closedAt: 111 })
    ])[0]!
    expect(conv.title).toBe('뿌리의 이름')
    expect(conv.closedAt).toBe(111)
  })

  it('목록 순서가 흔들려도 뿌리를 찾는다', () => {
    // 위 테스트는 목록이 최신순이라 `ordered[0]`도 우연히 뿌리였다 — 그것만으로는
    // "id로 찾는다"가 지워져도 초록이다. 여기서는 순서를 일부러 깨서, 가장 오래된
    // 행이 뿌리라는 **가정 자체**를 쓰지 않는다는 것을 고정한다. useRuns가 지금은
    // 최신순을 지키지만, 목록에 개수 제한이 붙거나 push 순서가 바뀌면 그 가정은
    // 조용히 무너지고 제목·종료가 null이 된다.
    const conv = groupConversations([
      makeRun({ id: 'w1', rootRunId: 'w1', createdAt: 10, title: '뿌리의 이름', closedAt: 111 }),
      makeRun({ id: 'w2', rootRunId: 'w1', createdAt: 20 })
    ])[0]!
    expect(conv.title).toBe('뿌리의 이름')
    expect(conv.closedAt).toBe(111)
  })

  it('끝나지 않은 대화의 closedAt은 null이다', () => {
    expect(one({}).closedAt).toBeNull()
  })
})

describe('titleOf', () => {
  it('첫 줄만 쓰고 24자에서 자른다', () => {
    expect(titleOf(makeRun({ id: 'a', userPrompt: '첫 줄\n둘째 줄' }))).toBe('첫 줄')
    expect(titleOf(makeRun({ id: 'a', userPrompt: 'x'.repeat(30) }))).toBe(`${'x'.repeat(24)}…`)
  })

  it('빈 지시도 이름을 갖는다', () => {
    expect(titleOf(makeRun({ id: 'a', userPrompt: '   ' }))).toBe('(빈 지시)')
  })
})

describe('contextOf', () => {
  const A = { type: 'issue' as const, id: 'i1', label: '버그' }
  const B = { type: 'memo' as const, id: 'm1', label: '릴리스 절차' }
  const C = { type: 'asset' as const, id: 'a1', label: 'review' }
  const D = { type: 'memo' as const, id: 'm2', label: '취소된 턴의 메모' }

  // useRuns가 주는 최신순 목록을 그대로 묶는다 — 3턴이 앞이다.
  const conversation = groupConversations([
    makeRun({ id: 't3', rootRunId: 't1', createdAt: 30, status: 'canceled', contextItems: [D] }),
    makeRun({ id: 't2', rootRunId: 't1', createdAt: 20, contextItems: [B, A] }),
    makeRun({ id: 't1', rootRunId: 't1', createdAt: 10, contextItems: [A, C] })
  ])[0]!

  it('처음 담긴 턴 순으로 모은다 — 같은 턴 안에서는 담긴 순서다', () => {
    expect(contextOf(conversation)).toEqual([A, C, B])
  })

  it('같은 항목을 여러 턴에 담아도 한 번만 나온다', () => {
    expect(contextOf(conversation).filter((c) => c.id === 'i1')).toHaveLength(1)
  })

  it('취소된 턴이 담았던 것은 세지 않는다', () => {
    expect(contextOf(conversation).map((c) => c.id)).not.toContain('m2')
  })

  it('아무것도 담지 않은 대화는 빈 목록이다', () => {
    const empty = groupConversations([makeRun({ id: 'e1', rootRunId: 'e1' })])[0]!
    expect(contextOf(empty)).toEqual([])
  })
})
