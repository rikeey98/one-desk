import { describe, it, expect } from 'vitest'
import { inboxCategory, CATEGORY_LABELS } from './inbox'
import type { Run } from '@shared/models'

function run(over: Partial<Run>): Run {
  return {
    id: 'r1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp', permission: 'edit', userPrompt: 'x', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: null, parentRunId: null, rootRunId: 'r1',
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 0, contextItems: [],
    ...over
  }
}

describe('inboxCategory', () => {
  it('needsAnswer면 답변 필요다', () => {
    expect(inboxCategory(run({ status: 'succeeded', needsAnswer: true }))).toBe('needs-answer')
  })

  it('succeeded인데 needsAnswer가 아니면 완료·미확인이다', () => {
    expect(inboxCategory(run({ status: 'succeeded', needsAnswer: false }))).toBe('done')
  })

  it('failed는 실패다', () => {
    expect(inboxCategory(run({ status: 'failed' }))).toBe('failed')
  })

  it('interrupted는 중단됨이다', () => {
    expect(inboxCategory(run({ status: 'interrupted' }))).toBe('interrupted')
  })

  it('canceled는 대기 중 취소됨이다', () => {
    // 사용자가 취소한 것은 execution.cancel이 확인 표시를 찍어 인박스에 오지 않는다.
    // 여기 오는 canceled는 앱이 재시작하며 취소한 것뿐이다.
    expect(inboxCategory(run({ status: 'canceled' }))).toBe('dropped')
  })

  it('모든 카테고리에 한국어 라벨이 있다', () => {
    for (const key of ['needs-answer', 'done', 'failed', 'interrupted', 'dropped'] as const) {
      expect(CATEGORY_LABELS[key]).toBeTruthy()
    }
  })
})
