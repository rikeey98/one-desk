import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { claudeCodeAdapter } from './claudeCode'

const HERE = dirname(fileURLToPath(import.meta.url))
const LINES = readFileSync(resolve(HERE, 'fixtures/claude-stream.jsonl'), 'utf8')
  .split('\n').filter(Boolean)

function parseAll() {
  return LINES.flatMap((line) => claudeCodeAdapter.parseLine(line, 'r1'))
}

describe('claudeCodeAdapter.parseLine', () => {
  it('init에서 세션 id를 뽑는다', () => {
    const ev = parseAll().find((e) => e.type === 'session')
    expect(ev).toMatchObject({ sessionId: '1c84c36a-b05c-45c2-945c-d83bd29ec52f' })
  })

  it('assistant 한 줄에서 text와 tool_use를 모두 뽑는다', () => {
    const events = claudeCodeAdapter.parseLine(LINES[1]!, 'r1')
    expect(events.map((e) => e.type)).toEqual(['text', 'tool_use'])
  })

  it('thinking 블록은 버린다', () => {
    const events = claudeCodeAdapter.parseLine(LINES[3]!, 'r1')
    expect(events.map((e) => e.type)).toEqual(['tool_use'])
  })

  it('도구 결과는 type이 user인 줄에서 나온다', () => {
    const events = claudeCodeAdapter.parseLine(LINES[2]!, 'r1')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'tool_result', ok: true })
  })

  it('성공한 도구 결과는 is_error 필드가 없어도 ok로 판정한다', () => {
    const ok = parseAll().filter((e) => e.type === 'tool_result')
    expect(ok[0]).toMatchObject({ ok: true })
    expect(ok[1]).toMatchObject({ ok: false })
  })

  it('Read는 read, Edit는 write로 효과를 판정하고 경로를 뽑는다', () => {
    const uses = parseAll().filter((e) => e.type === 'tool_use')
    expect(uses[0]).toMatchObject({ effect: 'read', targetPaths: ['/tmp/repo/src/auth.ts'] })
    expect(uses[1]).toMatchObject({ effect: 'write', targetPaths: ['/tmp/repo/src/auth.ts'] })
  })

  it('result에서 상태와 결과 텍스트를 뽑는다', () => {
    const ev = parseAll().find((e) => e.type === 'result')
    expect(ev).toMatchObject({ status: 'succeeded', resultText: '수정을 마쳤습니다.' })
  })

  it('[NEEDS_ANSWER] 표식을 감지하고 결과 텍스트에서 제거한다', () => {
    const line = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: '[NEEDS_ANSWER]\nA와 B 중 어느 쪽으로 할까요?', session_id: 's'
    })
    const [ev] = claudeCodeAdapter.parseLine(line, 'r1')
    expect(ev).toMatchObject({
      needsAnswer: true,
      resultText: 'A와 B 중 어느 쪽으로 할까요?'
    })
  })

  it('text 블록의 [NEEDS_ANSWER] 표식도 제거한다', () => {
    // 실측: 같은 내용이 assistant 텍스트 블록으로 먼저 흐르고 result에 다시 담긴다.
    // result에서만 벗겨내면 표식이 도크 로그에 날것으로 새어나온다.
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '[NEEDS_ANSWER]\nA와 B 중 어느 쪽인가요?' }] }
    })
    const [ev] = claudeCodeAdapter.parseLine(line, 'r1')
    expect(ev).toMatchObject({ type: 'text', text: 'A와 B 중 어느 쪽인가요?' })
  })

  it('표식이 없는 text는 그대로 둔다', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '  들여쓴 그대로  ' }] }
    })
    const [ev] = claudeCodeAdapter.parseLine(line, 'r1')
    expect(ev).toMatchObject({ text: '  들여쓴 그대로  ' })
  })

  it('관심 없는 줄은 빈 배열을 반환한다', () => {
    expect(claudeCodeAdapter.parseLine(LINES[5]!, 'r1')).toEqual([])
  })

  it('깨진 JSON은 raw 이벤트로 남기고 예외를 던지지 않는다', () => {
    const events = claudeCodeAdapter.parseLine('{깨진 줄', 'r1')
    expect(events).toEqual([expect.objectContaining({ type: 'raw', line: '{깨진 줄' })])
  })
})

describe('init의 MCP 연결 상태', () => {
  function initLine(servers: unknown): string {
    return JSON.stringify({
      type: 'system', subtype: 'init', session_id: 's1', mcp_servers: servers
    })
  }

  it('연결에 실패한 서버가 있으면 error 이벤트를 낸다', () => {
    // CLI는 첫 줄에 연결 상태를 알려준다. 흘려보내면 MCP가 통째로 죽은
    // run이 조용히 "성공"으로 끝나고, 사용자는 이유를 알 방법이 없다.
    const out = claudeCodeAdapter.parseLine(
      initLine([{ name: 'one-desk', status: 'failed' }]), 'r1'
    )
    const err = out.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect(err && 'message' in err ? err.message : '').toContain('one-desk')
  })

  it('연결에 성공하면 error를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(
      initLine([{ name: 'one-desk', status: 'connected' }]), 'r1'
    )
    expect(out.find((e) => e.type === 'error')).toBeUndefined()
  })

  it('실패해도 세션 id는 그대로 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(
      initLine([{ name: 'one-desk', status: 'failed' }]), 'r1'
    )
    expect(out.find((e) => e.type === 'session')).toMatchObject({ sessionId: 's1' })
  })

  it('mcp_servers가 없는 init에도 error를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }), 'r1'
    )
    expect(out.find((e) => e.type === 'error')).toBeUndefined()
  })
})

/**
 * 모델·토큰·컨텍스트 (`docs/sdlc/run-info/`). 값은 2026-09-21에 claude 2.1.278로
 * 실측한 모양 그대로다.
 */
describe('claudeCodeAdapter.parseLine — usage', () => {
  const resultLine = (usage: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: 'result', subtype: 'success', session_id: 's1', result: '끝',
      ...(usage === undefined ? {} : { usage }),
      ...extra
    })

  it('init에서 실제로 쓰인 모델을 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(
      JSON.stringify({
        type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5[1m]'
      }), 'r1'
    )
    const ev = out.find((e) => e.type === 'usage')
    // 사용자가 모델 칸을 비워도 무엇이 돌았는지 알 수 있는 유일한 자리다.
    expect(ev).toMatchObject({ usage: { model: 'claude-opus-5[1m]' } })
  })

  it('model이 없는 init은 usage를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }), 'r1'
    )
    expect(out.find((e) => e.type === 'usage')).toBeUndefined()
  })

  it('result에서 토큰과 비용을 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine({
      input_tokens: 2,
      output_tokens: 4,
      cache_read_input_tokens: 15428,
      cache_creation_input_tokens: 37917,
      output_tokens_details: { thinking_tokens: 11 }
    }, { total_cost_usd: 0.386994 }), 'r1')
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: {
        inputTokens: 2, outputTokens: 4,
        cacheReadTokens: 15428, cacheWriteTokens: 37917,
        reasoningTokens: 11, costUsd: 0.386994
      }
    })
  })

  it('contextTokens는 iterations의 마지막 요청으로 잰다', () => {
    // 합이 아니라 마지막 하나다 — 합으로 재면 도구를 쓴 턴에서 창을 넘는다(spec §3-2).
    const out = claudeCodeAdapter.parseLine(resultLine({
      input_tokens: 12, output_tokens: 8,
      cache_read_input_tokens: 500, cache_creation_input_tokens: 100,
      iterations: [
        { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 },
        { input_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 }
      ]
    }), 'r1')
    // 마지막 = 2 + 500 + 0 = 502. 앞의 것(110)이나 합(612)이 아니다.
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: { contextTokens: 502 }
    })
  })

  it('iterations가 없으면 최상위 값으로 컨텍스트를 잰다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine({
      input_tokens: 2, output_tokens: 4,
      cache_read_input_tokens: 15428, cache_creation_input_tokens: 37917
    }), 'r1')
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: { contextTokens: 53347 }
    })
  })

  it('modelUsage에서 컨텍스트 창 크기를 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine(
      { input_tokens: 1, output_tokens: 1 },
      { modelUsage: { 'claude-opus-5[1m]': { contextWindow: 1000000, costUSD: 0.5 } } }
    ), 'r1')
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: { contextWindow: 1000000 }
    })
  })

  it('usage가 없는 옛 result 줄은 usage 이벤트를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine(undefined), 'r1')
    expect(out.find((e) => e.type === 'usage')).toBeUndefined()
    // result 자체는 그대로 나와야 한다.
    expect(out.find((e) => e.type === 'result')).toBeDefined()
  })

  it('rate_limit_event는 아무 이벤트도 내지 않는다', () => {
    // 개인 구독 정보다 — 파싱하지 않는 것이 결정이고, 그 금지를 여기서 고정한다(spec §7).
    const out = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'rate_limit_event', session_id: 's1',
      rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.03 } } }
    }), 'r1')
    expect(out).toEqual([])
  })
})
