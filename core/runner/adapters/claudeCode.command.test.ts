import { describe, it, expect } from 'vitest'
import { claudeCodeAdapter } from './claudeCode'
import { MCP_SERVER_NAME } from '../../mcp/host'
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
    mcp: null,
    ...over
  }
}

const MCP = {
  // 리터럴 'onedesk'를 쓰지 않는다 — 그러면 MCP_SERVER_NAME이 바뀌어도 이
  // 픽스처는 여전히 옛 값과 우연히 일치해 어긋남을 못 잡는다 (전 브랜치
  // 리뷰 I-1). 실제 execution.ts가 채우는 값과 같은 소스를 쓴다.
  serverName: MCP_SERVER_NAME,
  configFile: '/tmp/one-desk/mcp/r1.json',
  token: 'super-secret-token-value',
  url: 'http://127.0.0.1:51234/mcp'
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

describe('claudeCodeAdapter.buildCommand — MCP', () => {
  it('mcp가 null이면 MCP 인자를 붙이지 않는다', () => {
    const { args } = claudeCodeAdapter.buildCommand(spec())
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--strict-mcp-config')
    expect(args.join(' ')).not.toContain('mcp__')
  })

  it('설정 파일 경로를 --mcp-config로 넘긴다', () => {
    const { args } = claudeCodeAdapter.buildCommand(spec({ mcp: MCP }))
    const i = args.indexOf('--mcp-config')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe(MCP.configFile)
  })

  it('--strict-mcp-config로 사용자의 개인 MCP 설정을 차단한다', () => {
    // 이것이 없으면 사용자 홈의 MCP 서버가 실행에 딸려 들어와, 우리가 통제하지
    // 못하는 도구가 agent에게 열린다.
    const { args } = claudeCodeAdapter.buildCommand(spec({ mcp: MCP }))
    expect(args).toContain('--strict-mcp-config')
  })

  it('토큰과 URL이 커맨드 인자에 나타나지 않는다', () => {
    // ps aux로 같은 머신의 다른 사용자에게 인자가 그대로 보인다. 토큰이 인자에
    // 실리면 그 순간 workspace가 열린다.
    const built = claudeCodeAdapter.buildCommand(spec({ mcp: MCP }))
    const joined = built.args.join(' ')
    expect(joined).not.toContain(MCP.token)
    expect(joined).not.toContain(MCP.url)
    expect(JSON.stringify(built.env)).not.toContain(MCP.token)
  })

  it('세 권한 모두 allowedTools에 mcp__<MCP_SERVER_NAME>이 들어간다', () => {
    for (const permission of ['read_only', 'edit', 'full'] as const) {
      const { args } = claudeCodeAdapter.buildCommand(spec({ permission, mcp: MCP }))
      const i = args.indexOf('--allowedTools')
      expect(i, `${permission}에 --allowedTools가 없다`).toBeGreaterThanOrEqual(0)
      expect(args[i + 1]!.split(',')).toContain(`mcp__${MCP_SERVER_NAME}`)
    }
  })
})
