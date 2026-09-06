import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { opencodeAdapter } from './opencode'
import type { ResolvedRunSpec } from '../types'

function spec(over: Partial<ResolvedRunSpec> = {}): ResolvedRunSpec {
  return {
    runId: 'run-1',
    cwd: '/tmp/work',
    model: null,
    permission: 'edit',
    prompt: '무엇이든',
    resumeSessionId: null,
    executable: '/usr/local/bin/opencode',
    mcp: null,
    ...over
  }
}

describe('opencodeAdapter.buildCommand', () => {
  it('run과 --format json으로 시작한다', () => {
    const built = opencodeAdapter.buildCommand(spec())
    expect(built.args.slice(0, 3)).toEqual(['run', '--format', 'json'])
    expect(built.cmd).toBe('/usr/local/bin/opencode')
    expect(built.cwd).toBe('/tmp/work')
  })

  it('프롬프트를 인자에 싣지 않는다', () => {
    // stdin으로 넘긴다 — 맥락이 합쳐지면 수십 KB라 인자 길이 제한에 걸린다.
    const built = opencodeAdapter.buildCommand(spec({ prompt: '아주 긴 프롬프트' }))
    expect(built.args).not.toContain('아주 긴 프롬프트')
  })

  it('권한을 OPENCODE_PERMISSION 환경변수로 넘긴다', () => {
    // 파일(OPENCODE_CONFIG)은 repo의 opencode.json에게 진다 (설계 §2-3).
    const built = opencodeAdapter.buildCommand(spec({ permission: 'read_only' }))
    const parsed = JSON.parse(built.env['OPENCODE_PERMISSION']!) as Record<string, string>
    expect(parsed['read']).toBe('allow')
    expect(parsed['edit']).toBe('deny')
    expect(Object.values(parsed)).not.toContain('ask')
  })

  it('--auto는 전체 허용에서만 붙는다', () => {
    expect(opencodeAdapter.buildCommand(spec({ permission: 'full' })).args).toContain('--auto')
    expect(opencodeAdapter.buildCommand(spec({ permission: 'edit' })).args).not.toContain('--auto')
    expect(opencodeAdapter.buildCommand(spec({ permission: 'read_only' })).args).not.toContain('--auto')
  })

  it('모델이 있으면 -m으로 붙이고 없으면 붙이지 않는다', () => {
    const withModel = opencodeAdapter.buildCommand(spec({ model: 'anthropic/claude-sonnet-4-5' }))
    expect(withModel.args).toContain('-m')
    expect(withModel.args[withModel.args.indexOf('-m') + 1]).toBe('anthropic/claude-sonnet-4-5')
    expect(opencodeAdapter.buildCommand(spec({ model: null })).args).not.toContain('-m')
  })

  it('이어서 실행은 --session으로 넘긴다', () => {
    const built = opencodeAdapter.buildCommand(spec({ resumeSessionId: 'ses_abc' }))
    expect(built.args).toContain('--session')
    expect(built.args[built.args.indexOf('--session') + 1]).toBe('ses_abc')
  })

  it('MCP가 있으면 OPENCODE_CONFIG로 설정 파일을 가리킨다', () => {
    const built = opencodeAdapter.buildCommand(spec({
      mcp: {
        serverName: 'one-desk',
        configFile: '/data/mcp/run-1.json',
        token: 't',
        url: 'http://127.0.0.1:1/mcp'
      }
    }))
    expect(built.env['OPENCODE_CONFIG']).toBe('/data/mcp/run-1.json')
  })

  it('MCP가 없으면 OPENCODE_CONFIG를 세우지 않는다', () => {
    // 사용자 설정을 우리 것으로 덮을 이유가 없다. 권한은 환경변수가 따로 지킨다.
    expect(opencodeAdapter.buildCommand(spec({ mcp: null })).env['OPENCODE_CONFIG']).toBeUndefined()
  })

  it('루프백을 프록시 예외로 넣는다', () => {
    const built = opencodeAdapter.buildCommand(spec())
    expect(built.env['NO_PROXY']).toContain('127.0.0.1')
    expect(built.env['no_proxy']).toContain('127.0.0.1')
  })
})

describe('opencodeAdapter.preflight', () => {
  it('명시 경로가 실행 불가면 거부한다', async () => {
    const result = await opencodeAdapter.preflight('/없는/경로/opencode')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('/없는/경로/opencode')
  })

  it('.cmd 설치본을 거부하고 대안을 안내한다', async () => {
    // .cmd는 shell 없이 spawn하면 EINVAL이고, shell을 켜면 취소가 자식에 닿지 않는다.
    const dir = mkdtempSync(join(tmpdir(), 'od-pre-'))
    const shim = join(dir, 'opencode.cmd')
    writeFileSync(shim, '')
    chmodSync(shim, 0o755)
    try {
      const result = await opencodeAdapter.preflight(shim)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('opencode.exe')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('실행 가능한 명시 경로를 그대로 쓴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-pre-'))
    const bin = join(dir, 'opencode')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    try {
      const result = await opencodeAdapter.preflight(bin)
      expect(result).toEqual({ ok: true, executable: bin })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
