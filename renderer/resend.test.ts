import { describe, it, expect } from 'vitest'
import type { Run } from '@shared/models'
import { resendInput } from './resend'

function run(over: Partial<Run> = {}): Run {
  return {
    id: 'r2', workspaceId: 'w', agentKind: 'claude-code', model: 'opus', effort: 'high', cwd: '/w', permission: 'full',
    userPrompt: '다시', assembledPrompt: '', status: 'failed', externalSessionId: null, parentRunId: 'r1', rootRunId: 'r1',
    title: null, closedAt: null, issue: null, resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 1,
    errorMessage: 'x', logPath: '', reviewedAt: null, reviewedKind: null, startedAt: 1, endedAt: 2, createdAt: 0,
    contextItems: [
      { type: 'issue', id: 'i1', label: '이슈' },
      { type: 'file', id: 'repo:src/a.ts', label: 'src/a.ts' },
      { type: 'asset', id: 'a1', label: 'skill' }
    ],
    usage: null, ...over
  }
}

describe('resendInput', () => {
  it('그 턴의 지시·조건을 그대로, 맥락은 id만 — 파일은 뺀다 (input-triggers FR-18)', () => {
    expect(resendInput('r1', run())).toEqual({
      conversationId: 'r1', userPrompt: '다시', model: 'opus', effort: 'high', permission: 'full',
      context: [{ type: 'issue', id: 'i1' }, { type: 'asset', id: 'a1' }]
    })
  })
})
