import { describe, it, expect } from 'vitest'
import { resolveAgentPath } from './agentPath'
import { HOST_ENV } from '../wsl/env'

const ws = { claudePath: '/ws/claude', opencodePath: '/ws/opencode' }
const noWs = { claudePath: null, opencodePath: null }
const app = { claude: '/app/claude', opencode: '/app/opencode', claudeWsl: null }
const noApp = { claude: null, opencode: null, claudeWsl: null }

describe('resolveAgentPath', () => {
  it('환경변수가 workspace 설정보다 우선한다', () => {
    expect(resolveAgentPath('claude-code', HOST_ENV, ws, app, { ONE_DESK_AGENT_PATH: '/tmp/fake' }))
      .toBe('/tmp/fake')
  })

  it('환경변수가 없으면 workspace의 claudePath를 쓴다 — 앱 기본값보다 먼저다(예외)', () => {
    expect(resolveAgentPath('claude-code', HOST_ENV, ws, app, {})).toBe('/ws/claude')
  })

  it('opencode는 opencodePath를 쓴다', () => {
    expect(resolveAgentPath('opencode', HOST_ENV, ws, app, {})).toBe('/ws/opencode')
  })

  it('workspace가 비워 두었으면 앱 기본값을 따른다 (agent-path-default FR-1)', () => {
    expect(resolveAgentPath('claude-code', HOST_ENV, noWs, app, {})).toBe('/app/claude')
    expect(resolveAgentPath('opencode', HOST_ENV, noWs, app, {})).toBe('/app/opencode')
    expect(resolveAgentPath('opencode', HOST_ENV, null, app, {})).toBe('/app/opencode')
  })

  it('agent마다 따로 따른다 — opencode만 예외를 두면 claude는 앱 기본값이다', () => {
    const onlyOpencode = { claudePath: null, opencodePath: '/ws/opencode' }
    expect(resolveAgentPath('claude-code', HOST_ENV, onlyOpencode, app, {})).toBe('/app/claude')
    expect(resolveAgentPath('opencode', HOST_ENV, onlyOpencode, app, {})).toBe('/ws/opencode')
  })

  it('아무것도 없으면 null이다 — 어댑터가 PATH를 뒤진다', () => {
    expect(resolveAgentPath('claude-code', HOST_ENV, null, noApp, {})).toBeNull()
    expect(resolveAgentPath('claude-code', HOST_ENV, noWs, noApp, {})).toBeNull()
  })

  it('빈 문자열 환경변수는 없는 것으로 본다', () => {
    // 셸에서 ONE_DESK_AGENT_PATH= 로 지우면 빈 문자열이 들어온다.
    // 이걸 경로로 쓰면 preflight가 빈 경로로 access를 부른다.
    expect(resolveAgentPath('claude-code', HOST_ENV, ws, app, { ONE_DESK_AGENT_PATH: '' }))
      .toBe('/ws/claude')
  })

  // docs/sdlc/wsl-support/ FR-12 — WSL 갈래는 자리가 다르다
  describe('wsl 환경', () => {
    const WSL = { kind: 'wsl' as const, distro: 'Ubuntu' }

    it('환경변수가 가장 먼저다 — 테스트 이음매는 WSL에서도 그대로 이긴다', () => {
      expect(resolveAgentPath('claude-code', WSL, ws, { ...app, claudeWsl: '/home/me/claude' }, { ONE_DESK_AGENT_PATH: '/tmp/fake' }))
        .toBe('/tmp/fake')
    })

    it('앱 탭의 WSL claude 경로를 쓴다 — workspace 예외(claudePath)는 Windows 경로라 무시한다', () => {
      expect(resolveAgentPath('claude-code', WSL, ws, { ...app, claudeWsl: '/home/me/.local/bin/claude' }, {}))
        .toBe('/home/me/.local/bin/claude')
    })

    it('WSL 경로가 비었으면 null이다 — Windows 앱 기본값(claude)으로 떨어지지 않는다', () => {
      expect(resolveAgentPath('claude-code', WSL, ws, app, {})).toBeNull()
      expect(resolveAgentPath('claude-code', WSL, null, noApp, {})).toBeNull()
    })
  })
})
