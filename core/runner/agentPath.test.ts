import { describe, it, expect } from 'vitest'
import { resolveAgentPath } from './agentPath'

const ws = { claudePath: '/ws/claude', opencodePath: '/ws/opencode' }
const noWs = { claudePath: null, opencodePath: null }
const app = { claude: '/app/claude', opencode: '/app/opencode' }
const noApp = { claude: null, opencode: null }

describe('resolveAgentPath', () => {
  it('환경변수가 workspace 설정보다 우선한다', () => {
    expect(resolveAgentPath('claude-code', ws, app, { ONE_DESK_AGENT_PATH: '/tmp/fake' }))
      .toBe('/tmp/fake')
  })

  it('환경변수가 없으면 workspace의 claudePath를 쓴다 — 앱 기본값보다 먼저다(예외)', () => {
    expect(resolveAgentPath('claude-code', ws, app, {})).toBe('/ws/claude')
  })

  it('opencode는 opencodePath를 쓴다', () => {
    expect(resolveAgentPath('opencode', ws, app, {})).toBe('/ws/opencode')
  })

  it('workspace가 비워 두었으면 앱 기본값을 따른다 (agent-path-default FR-1)', () => {
    expect(resolveAgentPath('claude-code', noWs, app, {})).toBe('/app/claude')
    expect(resolveAgentPath('opencode', noWs, app, {})).toBe('/app/opencode')
    expect(resolveAgentPath('opencode', null, app, {})).toBe('/app/opencode')
  })

  it('agent마다 따로 따른다 — opencode만 예외를 두면 claude는 앱 기본값이다', () => {
    const onlyOpencode = { claudePath: null, opencodePath: '/ws/opencode' }
    expect(resolveAgentPath('claude-code', onlyOpencode, app, {})).toBe('/app/claude')
    expect(resolveAgentPath('opencode', onlyOpencode, app, {})).toBe('/ws/opencode')
  })

  it('아무것도 없으면 null이다 — 어댑터가 PATH를 뒤진다', () => {
    expect(resolveAgentPath('claude-code', null, noApp, {})).toBeNull()
    expect(resolveAgentPath('claude-code', noWs, noApp, {})).toBeNull()
  })

  it('빈 문자열 환경변수는 없는 것으로 본다', () => {
    // 셸에서 ONE_DESK_AGENT_PATH= 로 지우면 빈 문자열이 들어온다.
    // 이걸 경로로 쓰면 preflight가 빈 경로로 access를 부른다.
    expect(resolveAgentPath('claude-code', ws, app, { ONE_DESK_AGENT_PATH: '' }))
      .toBe('/ws/claude')
  })
})
