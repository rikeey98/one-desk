import { describe, it, expect } from 'vitest'
import type { Workspace } from '@shared/models'
import { defaultEffortOf, defaultModelOf, newRunInput } from './runDefaults'

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1', name: '회사', description: null, defaultAgentKind: 'claude-code',
    defaultModelClaude: 'sonnet', defaultModelOpencode: 'openai/gpt-5',
    defaultEffortClaude: 'high', defaultVariantOpencode: null,
    defaultPermission: 'edit', claudePath: null, opencodePath: null, createdAt: 1, updatedAt: 1,
    ...over
  }
}

const host = { path: 'C:\\work\\api', agentEnv: 'host' as const }
const wsl = { path: '\\\\wsl$\\Ubuntu\\home\\me\\api', agentEnv: 'wsl' as const }

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

describe('newRunInput', () => {
  it('workspace 기본값과 repo 경로로 새 대화 한 턴의 입력을 만든다 — 맥락은 없다', () => {
    expect(newRunInput(ws(), host, '로그인 고쳐줘')).toEqual({
      workspaceId: 'w1', agentKind: 'claude-code', model: 'sonnet', effort: 'high',
      cwd: 'C:\\work\\api', permission: 'edit', userPrompt: '로그인 고쳐줘', context: []
    })
  })

  it('사람이 바꾼 값이 기본값을 이기고, 빈 모델·effort는 null이다', () => {
    const input = newRunInput(ws(), host, 'x', { agentKind: 'opencode', model: '  ', effort: '', permission: 'read_only' })
    expect(input.agentKind).toBe('opencode')
    expect(input.model).toBeNull()
    expect(input.effort).toBeNull()
    expect(input.permission).toBe('read_only')
  })

  it('agent를 바꾸면 모델·effort 기본값도 그 agent의 것이다', () => {
    const input = newRunInput(ws(), host, 'x', { agentKind: 'opencode' })
    expect(input.model).toBe('openai/gpt-5')
    expect(input.effort).toBeNull()
  })

  it('WSL repo는 claude-code다 — opencode를 골라도 떨어뜨린다 (wsl-support FR-7)', () => {
    expect(newRunInput(ws({ defaultAgentKind: 'opencode' }), wsl, 'x').agentKind).toBe('claude-code')
    expect(newRunInput(ws(), wsl, 'x', { agentKind: 'opencode' }).agentKind).toBe('claude-code')
    // 떨어뜨린 뒤의 모델도 claude의 것이다
    expect(newRunInput(ws({ defaultAgentKind: 'opencode' }), wsl, 'x').model).toBe('sonnet')
  })
})
