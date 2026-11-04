import { describe, it, expect } from 'vitest'
import type { Workspace } from '@shared/models'
import { defaultEffortOf, defaultModelOf } from './runDefaults'

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1', name: '회사', description: null, defaultAgentKind: 'claude-code',
    defaultModelClaude: 'sonnet', defaultModelOpencode: 'openai/gpt-5',
    defaultEffortClaude: 'high', defaultVariantOpencode: null,
    defaultPermission: 'edit', claudePath: null, opencodePath: null, kind: 'normal', createdAt: 1, updatedAt: 1,
    ...over
  }
}

describe('defaultModelOf · defaultEffortOf', () => {
  it('고르는 기준은 workspace가 아니라 지금 고른 agent다', () => {
    expect(defaultModelOf(ws(), 'claude-code')).toBe('sonnet')
    expect(defaultModelOf(ws(), 'opencode')).toBe('openai/gpt-5')
    expect(defaultEffortOf(ws(), 'claude-code')).toBe('high')
    expect(defaultEffortOf(ws(), 'opencode')).toBe('')
  })

  it('workspace가 없거나 값이 null이면 빈 문자열(CLI 자신의 기본값)이다', () => {
    expect(defaultModelOf(null, 'claude-code')).toBe('')
    expect(defaultModelOf(ws({ defaultModelClaude: null }), 'claude-code')).toBe('')
  })
})
