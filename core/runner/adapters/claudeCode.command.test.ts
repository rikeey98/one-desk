import { describe, it, expect } from 'vitest'
import { claudeCodeAdapter } from './claudeCode'
import type { ResolvedRunSpec } from '../types'

function spec(over: Partial<ResolvedRunSpec> = {}): ResolvedRunSpec {
  return {
    runId: 'r1',
    cwd: '/tmp/repo',
    model: null,
    permission: 'edit',
    prompt: '테스트 프롬프트',
    resumeSessionId: null,
    executable: '/usr/local/bin/claude',
    ...over
  }
}

describe('claudeCodeAdapter.buildCommand', () => {
  it('stream-json에는 반드시 --verbose를 함께 넣는다', () => {
    const { args } = claudeCodeAdapter.buildCommand(spec())
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    // --verbose가 없으면 CLI가 실행을 거부한다 (실측 확인됨)
    expect(args).toContain('--verbose')
  })

  it('프롬프트는 인자가 아니라 stdin으로 넘긴다', () => {
    const { args } = claudeCodeAdapter.buildCommand(spec({ prompt: '아주 긴 프롬프트' }))
    expect(args.join(' ')).not.toContain('아주 긴 프롬프트')
  })

  it('resumeSessionId가 있으면 --resume을 붙인다', () => {
    const { args } = claudeCodeAdapter.buildCommand(spec({ resumeSessionId: 'sess-1' }))
    const i = args.indexOf('--resume')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('sess-1')
  })

  it('resumeSessionId가 없으면 --resume을 붙이지 않는다', () => {
    const { args } = claudeCodeAdapter.buildCommand(spec())
    expect(args).not.toContain('--resume')
  })

  it('model이 있으면 --model을 붙인다', () => {
    const { args } = claudeCodeAdapter.buildCommand(spec({ model: 'sonnet' }))
    const i = args.indexOf('--model')
    expect(args[i + 1]).toBe('sonnet')
  })

  it('cwd와 executable을 SpawnSpec에 담는다', () => {
    const s = claudeCodeAdapter.buildCommand(spec())
    expect(s.cwd).toBe('/tmp/repo')
    expect(s.cmd).toBe('/usr/local/bin/claude')
  })
})
