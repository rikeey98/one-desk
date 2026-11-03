import { describe, it, expect } from 'vitest'
import { activityView, availableAgents } from './agentActivity'
import type { AgentStatuses } from '@shared/models'

const BOTH: AgentStatuses = {
  'claude-code': { ok: true, executable: '/bin/claude' },
  opencode: { ok: true, executable: '/bin/opencode' }
}
const CLAUDE_ONLY: AgentStatuses = {
  'claude-code': { ok: true, executable: '/bin/claude' },
  opencode: { ok: false, reason: 'opencode를 찾을 수 없습니다' }
}
const NONE: AgentStatuses = {
  'claude-code': { ok: false, reason: '없음' },
  opencode: { ok: false, reason: '없음' }
}

describe('availableAgents (docs/sdlc/agent-status/ FR-1 개정)', () => {
  it('실행 파일이 잡힌 agent만, 실행 패널과 같은 순서로', () => {
    expect(availableAgents(BOTH)).toEqual([
      { key: 'claude-code', label: 'Claude Code' },
      { key: 'opencode', label: 'OpenCode' }
    ])
    expect(availableAgents(CLAUDE_ONLY)).toEqual([{ key: 'claude-code', label: 'Claude Code' }])
  })

  it('판정 전이면 null, 하나도 없으면 빈 배열 — 둘은 다른 말이다', () => {
    expect(availableAgents(null)).toBeNull()
    expect(availableAgents(NONE)).toEqual([])
  })

  it('WSL claude가 잡히면 끝에 짧은 이름으로 선다', () => {
    const withWsl: AgentStatuses = { ...CLAUDE_ONLY, wsl: { ok: true, executable: '/usr/bin/claude', distro: 'Ubuntu' } }
    expect(availableAgents(withWsl)?.map((a) => a.label)).toEqual(['Claude Code', 'Claude Code (WSL)'])
    const wslMissing: AgentStatuses = { ...CLAUDE_ONLY, wsl: { ok: false, reason: '없음', distro: 'Ubuntu' } }
    expect(availableAgents(wslMissing)?.map((a) => a.label)).toEqual(['Claude Code'])
  })
})

describe('activityView (FR-1·FR-2 개정)', () => {
  it('포트·실행 수·대기는 글자가 아니라 풍선에 있다', () => {
    const view = activityView({ state: 'listening', port: 53021 }, { running: 2, limit: 3, waiting: 1 }, BOTH)
    expect(view.agents?.map((a) => a.label)).toEqual(['Claude Code', 'OpenCode'])
    expect(view.busy).toBe(true)
    expect(view.title).toBe('Claude Code · OpenCode · MCP :53021 · 실행 2/3 · 대기 1 — 눌러서 에이전트 현황 보기')
  })

  it('풍선은 WSL 배포판까지 말한다', () => {
    const withWsl: AgentStatuses = { ...CLAUDE_ONLY, wsl: { ok: true, executable: '/usr/bin/claude', distro: 'Ubuntu' } }
    expect(activityView({ state: 'starting' }, null, withWsl).title)
      .toBe('Claude Code · Claude Code (WSL · Ubuntu) · MCP 시작 중 — 눌러서 에이전트 현황 보기')
  })

  it('판정 전·agent 없음·MCP 실패를 서로 다른 말로 한다', () => {
    expect(activityView({ state: 'starting' }, null, null).title).toBe('agent 확인 전 · MCP 시작 중 — 눌러서 에이전트 현황 보기')
    const failed = activityView({ state: 'failed', message: 'EADDRINUSE' }, { running: 0, limit: 2, waiting: 0 }, NONE)
    expect(failed.agents).toEqual([])
    expect(failed.busy).toBe(false)
    expect(failed.title).toBe('쓸 수 있는 agent 없음 · MCP 연결 실패: EADDRINUSE · 실행 0/2 — 눌러서 에이전트 현황 보기')
  })
})
