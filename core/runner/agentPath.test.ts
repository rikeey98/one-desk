import { describe, it, expect } from 'vitest'
import { resolveAgentPath } from './agentPath'

const ws = { claudePath: '/ws/claude', opencodePath: '/ws/opencode' }

describe('resolveAgentPath', () => {
  it('환경변수가 workspace 설정보다 우선한다', () => {
    expect(resolveAgentPath('claude-code', ws, { ONE_DESK_AGENT_PATH: '/tmp/fake' }))
      .toBe('/tmp/fake')
  })

  it('환경변수가 없으면 workspace의 claudePath를 쓴다', () => {
    expect(resolveAgentPath('claude-code', ws, {})).toBe('/ws/claude')
  })

  it('opencode는 opencodePath를 쓴다', () => {
    expect(resolveAgentPath('opencode', ws, {})).toBe('/ws/opencode')
  })

  it('아무것도 없으면 null이다 — 어댑터가 PATH를 뒤진다', () => {
    expect(resolveAgentPath('claude-code', null, {})).toBeNull()
    expect(resolveAgentPath('claude-code', { claudePath: null, opencodePath: null }, {}))
      .toBeNull()
  })

  it('빈 문자열 환경변수는 없는 것으로 본다', () => {
    // 셸에서 ONE_DESK_AGENT_PATH= 로 지우면 빈 문자열이 들어온다.
    // 이걸 경로로 쓰면 preflight가 빈 경로로 access를 부른다.
    expect(resolveAgentPath('claude-code', ws, { ONE_DESK_AGENT_PATH: '' }))
      .toBe('/ws/claude')
  })
})
