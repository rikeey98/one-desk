import { describe, it, expect, vi } from 'vitest'
import { createAgentProbeService, type AgentProbeDeps } from './service'
import type { AgentAuth, AgentKind } from '@shared/models'
import type { PreflightResult } from '../runner/types'

const OK_PREFLIGHT: PreflightResult = { ok: true, executable: '/bin/agent' }
const LOGGED_IN: AgentAuth = { state: 'ok', method: 'claude.ai', plan: 'max' }

function deps(over: Partial<AgentProbeDeps> = {}): AgentProbeDeps {
  return {
    preflight: async () => OK_PREFLIGHT,
    checkAuth: async () => LOGGED_IN,
    agentInfo: async () => ({ model: 'claude-opus-5[1m]', version: '2.1.278', error: null }),
    listModels: async () => [],
    firstRepoPath: () => '/tmp/api',
    ...over
  }
}

async function probe(over: Partial<AgentProbeDeps> = {}, kind: AgentKind = 'claude-code') {
  const service = createAgentProbeService(deps(over))
  return (await service.probeAgents('ws-1'))[kind]
}

describe('createAgentProbeService — 칸이 쌓인다 (FR-1)', () => {
  it('셋 다 통과하면 모델 이름까지 채운다', async () => {
    const result = await probe()

    expect(result.auth).toEqual(LOGGED_IN)
    expect(result.model).toEqual({ state: 'resolved', model: 'claude-opus-5[1m]' })
    expect(result.version).toBe('2.1.278')
  })

  it('실행 파일이 없으면 뒤의 두 칸을 아예 돌리지 않는다', async () => {
    // 실행 파일이 없는데 인증을 물으면 없는 프로세스를 띄우려 든다. 첫 칸이
    // 막히면 그 뒤는 물을 것도 없다.
    const checkAuth = vi.fn(async () => LOGGED_IN)
    const agentInfo = vi.fn(async () => ({ model: 'x', version: null, error: null }))

    const result = await probe({
      preflight: async () => ({ ok: false, reason: 'PATH에서 찾을 수 없습니다' }),
      checkAuth,
      agentInfo
    })

    expect(checkAuth).not.toHaveBeenCalled()
    expect(agentInfo).not.toHaveBeenCalled()
    expect(result.auth.state).toBe('unknown')
    expect(result.model.state).toBe('skipped')
  })

  it('인증이 none이면 모델 probe를 돌리지 않는다 (FR-2)', async () => {
    // **이 작업의 핵심이다.** init은 인증을 보지 않아 토큰이 없어도 모델 이름을
    // 되돌려 준다(2026-09-22 실측) — 그것을 화면에 올리면 아무것도 못 돌리는
    // 사람에게 초록으로 모델을 자신 있게 띄우게 된다.
    const agentInfo = vi.fn(async () => ({ model: 'claude-opus-5[1m]', version: null, error: null }))

    const result = await probe({
      checkAuth: async () => ({ state: 'none', hint: '`claude auth login`으로 로그인하세요.' }),
      agentInfo
    })

    expect(agentInfo).not.toHaveBeenCalled()
    expect(result.model.state).toBe('skipped')
    if (result.model.state === 'skipped') expect(result.model.reason).toContain('로그인')
  })

  it('인증이 unknown이면 모델 probe를 돌린다', async () => {
    // 모르는 것과 없는 것은 다르다. 모른다는 이유로 정보를 감추면 `auth status`가
    // 없는 옛 CLI에서 화면이 통째로 빈다.
    const agentInfo = vi.fn(async () => ({ model: 'claude-opus-5[1m]', version: null, error: null }))

    const result = await probe({
      checkAuth: async () => ({ state: 'unknown', reason: '서브커맨드가 없습니다' }),
      agentInfo
    })

    expect(agentInfo).toHaveBeenCalledTimes(1)
    expect(result.model).toEqual({ state: 'resolved', model: 'claude-opus-5[1m]' })
  })
})

describe('createAgentProbeService — 모델 칸', () => {
  it('repo가 없으면 skipped다', async () => {
    // probe의 cwd는 실행 패널이 쓰는 것과 같아야 한다 — repo의 설정이 모델을
    // 바꿀 수 있어 아무 데서나 돌리면 실행과 다른 답이 나온다.
    const agentInfo = vi.fn(async () => ({ model: 'x', version: null, error: null }))

    const result = await probe({ firstRepoPath: () => null, agentInfo })

    expect(agentInfo).not.toHaveBeenCalled()
    expect(result.model.state).toBe('skipped')
    if (result.model.state === 'skipped') expect(result.model.reason).toContain('repo')
  })

  it('probe가 실패하면 unknown이다 — skipped가 아니다', async () => {
    // 안 돌린 것과 돌렸는데 못 얻은 것은 다른 말이다(FR-3).
    const result = await probe({
      agentInfo: async () => ({ model: null, version: null, error: '시간이 초과됐습니다' })
    })

    expect(result.model.state).toBe('unknown')
    if (result.model.state === 'unknown') expect(result.model.reason).toContain('초과')
  })

  it('probe는 됐는데 모델이 비면 unknown이다', async () => {
    const result = await probe({
      agentInfo: async () => ({ model: null, version: '2.1.278', error: null })
    })
    expect(result.model.state).toBe('unknown')
  })

  it('opencode는 모델을 관측할 수 없어 늘 skipped다', async () => {
    // 스트림 어디에도 모델이 없다(docs/sdlc/run-info/ 실측). 대신 제안 목록을 채운다.
    const agentInfo = vi.fn(async () => ({ model: 'x', version: null, error: null }))

    const result = await probe({
      agentInfo,
      listModels: async () => ['openrouter/anthropic/claude-sonnet-4.5']
    }, 'opencode')

    expect(result.model.state).toBe('skipped')
    expect(result.models).toEqual(['openrouter/anthropic/claude-sonnet-4.5'])
    // claude 쪽만 probe를 탄다 — opencode 때문에 CLI가 뜨면 안 된다.
    expect(agentInfo).toHaveBeenCalledTimes(1)
  })

  it('claude의 제안 목록은 비어 있다 — 화면이 자기 별칭 표를 쓴다', async () => {
    const result = await probe({ listModels: async () => [] })
    expect(result.models).toEqual([])
  })
})

describe('createAgentProbeService — 실패 내성', () => {
  it('한쪽 agent가 터져도 다른 쪽 결과는 온다', async () => {
    const service = createAgentProbeService(deps({
      preflight: async (kind) => {
        if (kind === 'opencode') throw new Error('갑자기 터짐')
        return OK_PREFLIGHT
      }
    }))

    const result = await service.probeAgents('ws-1')

    expect(result['claude-code'].model.state).toBe('resolved')
    expect(result.opencode.auth.state).toBe('unknown')
  })

  it('던지지 않는다', async () => {
    const service = createAgentProbeService(deps({
      checkAuth: () => Promise.reject(new Error('터짐')),
      agentInfo: () => Promise.reject(new Error('터짐'))
    }))

    const result = await service.probeAgents('ws-1')

    expect(result['claude-code'].auth.state).toBe('unknown')
    expect(result['claude-code'].model.state).toBe('unknown')
  })

  it('두 agent를 함께 조회한다', async () => {
    const preflight = vi.fn(async () => OK_PREFLIGHT)
    const service = createAgentProbeService(deps({ preflight }))

    await service.probeAgents('ws-1')

    expect(preflight).toHaveBeenCalledTimes(2)
  })
})
