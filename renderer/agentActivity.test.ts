import { describe, it, expect } from 'vitest'
import { activityView } from './agentActivity'

describe('activityView (docs/sdlc/agent-status/ FR-1·FR-2)', () => {
  it('MCP 포트와 실행 슬롯, 대기를 한 줄로 말한다', () => {
    const view = activityView({ state: 'listening', port: 53021 }, { running: 2, limit: 3, waiting: 1 })
    expect(view).toEqual({
      mcp: 'MCP :53021',
      activity: '실행 2/3',
      waiting: '+1 대기',
      busy: true,
      title: 'MCP :53021 · 실행 2/3 · +1 대기 — 눌러서 에이전트 현황 보기'
    })
  })

  it('스냅샷이 없으면 실행 칸이 없고 쉬는 중이다', () => {
    const view = activityView({ state: 'starting' }, null)
    expect(view.activity).toBeNull()
    expect(view.waiting).toBeNull()
    expect(view.busy).toBe(false)
    expect(view.title).toBe('MCP 시작 중 — 눌러서 에이전트 현황 보기')
  })

  it('실패면 이유를 풍선에 싣는다', () => {
    const view = activityView({ state: 'failed', message: 'EADDRINUSE' }, { running: 0, limit: 2, waiting: 0 })
    expect(view.mcp).toBe('MCP 연결 실패')
    expect(view.title).toBe('MCP 연결 실패: EADDRINUSE · 실행 0/2 — 눌러서 에이전트 현황 보기')
  })

  it('`대기 N`을 쓰지 않는다 — 도크 슬롯 표시기를 잡는 e2e와 부딪힌다', () => {
    const view = activityView({ state: 'listening', port: 1 }, { running: 1, limit: 1, waiting: 1 })
    expect(`${view.activity} ${view.waiting}`).not.toMatch(/대기 \d/)
  })
})
