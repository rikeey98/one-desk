import { describe, it, expect } from 'vitest'
import type { AgentProbe, AgentProbes, AgentStatuses } from '@shared/models'
import { cliReadinessOf, setupStateOf } from './setup'

const ok = { ok: true, executable: '/bin/claude' }
const no = { ok: false, reason: '없음' }
function probe(over: Partial<AgentProbe> = {}): AgentProbe {
  return { auth: { state: 'ok', method: null, plan: null }, model: { state: 'resolved', model: 'sonnet' }, version: null, models: [], ...over }
}

describe('cliReadinessOf (FR-15)', () => {
  it('statuses가 아직 없으면 pending, 실행 파일이 하나도 없으면 probe를 기다리지 않고 none이다', () => {
    expect(cliReadinessOf(null, null)).toBe('pending')
    expect(cliReadinessOf({ 'claude-code': no, opencode: no } as AgentStatuses, null)).toBe('none')
  })

  it('실행 파일은 있는데 probe가 아직이면 pending이다', () => {
    expect(cliReadinessOf({ 'claude-code': ok, opencode: no } as AgentStatuses, null)).toBe('pending')
  })

  it('어느 하나가 실행 파일 · 인증 · 모델까지 통과하면 ready다 — OpenCode만 준비돼도 끝(모델은 skipped)', () => {
    const statuses = { 'claude-code': no, opencode: ok } as AgentStatuses
    const probes = { 'claude-code': probe({ auth: { state: 'none', hint: 'claude login' } }), opencode: probe({ model: { state: 'skipped', reason: 'opencode' } }) } as AgentProbes
    expect(cliReadinessOf(statuses, probes)).toBe('ready')
  })

  it('실행 파일은 있는데 로그인이 안 됐거나 모델을 못 얻었으면 none이다', () => {
    const statuses = { 'claude-code': ok, opencode: no } as AgentStatuses
    expect(cliReadinessOf(statuses, { 'claude-code': probe({ auth: { state: 'none', hint: 'claude login' } }), opencode: probe() } as AgentProbes)).toBe('none')
    expect(cliReadinessOf(statuses, { 'claude-code': probe({ model: { state: 'unknown', reason: 'x' } }), opencode: probe() } as AgentProbes)).toBe('none')
  })

  it('WSL 안의 claude도 센다', () => {
    const statuses = { 'claude-code': no, opencode: no, wsl: { ...ok, distro: 'Ubuntu' } } as AgentStatuses
    const probes = { 'claude-code': probe({ auth: { state: 'unknown', reason: 'x' } }), opencode: probe({ auth: { state: 'unknown', reason: 'x' } }), wsl: { ...probe(), distro: 'Ubuntu' } } as AgentProbes
    expect(cliReadinessOf(statuses, probes)).toBe('ready')
  })
})

describe('setupStateOf (FR-14)', () => {
  it('done은 넷 다다', () => {
    const all = { workspace: true, repo: true, firstRun: true }
    expect(setupStateOf(all, 'ready')).toEqual({ ...all, cli: 'ready', done: true })
    expect(setupStateOf(all, 'pending').done).toBe(false)
    expect(setupStateOf({ ...all, repo: false }, 'ready').done).toBe(false)
    expect(setupStateOf({ ...all, firstRun: false }, 'ready').done).toBe(false)
  })
})
