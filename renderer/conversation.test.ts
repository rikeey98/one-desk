import { describe, it, expect } from 'vitest'
import { conversationIdOf, groupConversations, titleOf } from './conversation'
import type { Run } from '@shared/models'

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'ws', agentKind: 'claude-code', model: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], ...over
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

describe('titleOf', () => {
  it('첫 줄만 쓰고 24자에서 자른다', () => {
    expect(titleOf(makeRun({ id: 'a', userPrompt: '첫 줄\n둘째 줄' }))).toBe('첫 줄')
    expect(titleOf(makeRun({ id: 'a', userPrompt: 'x'.repeat(30) }))).toBe(`${'x'.repeat(24)}…`)
  })

  it('빈 지시도 이름을 갖는다', () => {
    expect(titleOf(makeRun({ id: 'a', userPrompt: '   ' }))).toBe('(빈 지시)')
  })
})
