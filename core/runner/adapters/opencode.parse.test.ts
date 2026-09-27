import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { opencodeAdapter } from './opencode'
import type { RunEventInit } from '@shared/events'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, 'fixtures/opencode-stream.jsonl')

function parseAll(): RunEventInit[] {
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .flatMap((line) => opencodeAdapter.parseLine(line, 'run-1'))
}

describe('opencodeAdapter.parseLine — 실측 픽스처', () => {
  it('세션 id를 집는다', () => {
    const session = parseAll().find((e) => e.type === 'session')
    expect(session).toBeDefined()
    expect((session as { sessionId: string }).sessionId).toMatch(/^ses/)
  })

  it('읽기 도구를 read 효과로 옮긴다', () => {
    const read = parseAll().find((e) => e.type === 'tool_use' && e.name === 'read')
    expect(read).toMatchObject({ effect: 'read' })
  })

  it('쓰기 도구를 write 효과와 대상 경로로 옮긴다', () => {
    // 이 두 값이 앞으로 diff 뷰어의 입력이다 (전체 설계 §329).
    const write = parseAll().find((e) => e.type === 'tool_use' && e.name === 'write')
    expect(write).toMatchObject({ effect: 'write' })
    expect((write as { targetPaths: string[] }).targetPaths[0]).toMatch(/summary\.txt$/)
  })

  it('도구 한 줄에서 tool_use와 tool_result가 같은 id로 나온다', () => {
    const events = parseAll()
    const use = events.find((e) => e.type === 'tool_use')!
    const result = events.find((e) => e.type === 'tool_result')!
    expect((use as { toolUseId: string }).toolUseId).not.toBe('')
    expect((result as { toolUseId: string }).toolUseId)
      .toBe((use as { toolUseId: string }).toolUseId)
    expect((result as { ok: boolean }).ok).toBe(true)
  })

  it('최종 텍스트가 text와 result 둘 다로 나온다', () => {
    // OpenCode에는 종료 이벤트가 없어 result를 합성한다 (설계 §7).
    const events = parseAll()
    const text = events.filter((e) => e.type === 'text').at(-1)!
    const result = events.filter((e) => e.type === 'result').at(-1)!
    expect((result as { resultText: string }).resultText)
      .toBe((text as { text: string }).text)
    expect((result as { status: string }).status).toBe('succeeded')
  })
})

describe('opencodeAdapter.parseLine — 단위', () => {
  it('깨진 줄을 raw로 흘려보낸다', () => {
    // 한 줄이 깨졌다고 run 전체를 죽이지 않는다 (전체 설계 §11).
    expect(opencodeAdapter.parseLine('{깨진', 'run-1'))
      .toEqual([{ type: 'raw', runId: 'run-1', at: expect.any(Number), line: '{깨진' }])
  })

  it('모르는 type은 버린다', () => {
    const line = JSON.stringify({ type: 'step_finish', sessionID: 'ses_x', part: {} })
    expect(opencodeAdapter.parseLine(line, 'run-1')).toEqual([])
  })

  it('[NEEDS_ANSWER] 표식을 떼고 needsAnswer를 세운다', () => {
    const line = JSON.stringify({
      type: 'text', sessionID: 'ses_x',
      part: { type: 'text', text: '[NEEDS_ANSWER]\nA와 B 중 어느 쪽으로 할까요?' }
    })
    const events = opencodeAdapter.parseLine(line, 'run-1')
    const result = events.find((e) => e.type === 'result')!
    expect((result as { needsAnswer: boolean }).needsAnswer).toBe(true)
    expect((result as { resultText: string }).resultText).toBe('A와 B 중 어느 쪽으로 할까요?')
    // 표식은 로그에도 새어나가면 안 된다.
    const text = events.find((e) => e.type === 'text')!
    expect((text as { text: string }).text).not.toContain('[NEEDS_ANSWER]')
  })

  it('bash 도구는 execute 효과다', () => {
    const line = JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: { tool: 'bash', callID: 'c1', state: { status: 'completed', input: {}, output: '' } }
    })
    const use = opencodeAdapter.parseLine(line, 'run-1')[0]!
    expect((use as { effect: string }).effect).toBe('execute')
  })

  it('실패한 도구는 ok=false다', () => {
    const line = JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: { tool: 'read', callID: 'c1', state: { status: 'error', input: {}, output: '없음' } }
    })
    const result = opencodeAdapter.parseLine(line, 'run-1')
      .find((e) => e.type === 'tool_result')!
    expect((result as { ok: boolean }).ok).toBe(false)
  })
})

/**
 * `{"type":"error"}` 줄 (`docs/sdlc/conversation-fixes/` spec FR-13).
 *
 * json 모드의 opencode는 오류를 stderr에 쓰지 않고 이 줄 하나로 낸다 — 버리면 원인 없는
 * failed가 된다. 모양은 `run.ts`의 `emit("error", { error })`다: `{type, timestamp,
 * sessionID, error}`이고 `error`는 session.error의 NamedError(`{name, data}`)다.
 * CLI 자신도 `data.message`를 먼저, 없으면 `name`을 보여준다.
 */
describe('opencodeAdapter.parseLine — error', () => {
  const errorLine = (error: unknown) => JSON.stringify({
    type: 'error', timestamp: 1788661877138, sessionID: 'ses_x', error
  })

  it('error 줄을 error 이벤트로 낸다 — 메시지는 error.data.message다', () => {
    const out = opencodeAdapter.parseLine(errorLine({
      name: 'APIError',
      data: {
        message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode",
        statusCode: 403, isRetryable: false
      }
    }), 'run-1')
    expect(out).toEqual([{
      type: 'error', runId: 'run-1', at: expect.any(Number),
      message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"
    }])
  })

  it('data.message가 없으면 error.message, 그다음 error.name이다', () => {
    const [byMessage] = opencodeAdapter.parseLine(errorLine({ name: 'X', message: '메시지' }), 'run-1')
    expect(byMessage).toMatchObject({ type: 'error', message: '메시지' })
    const [byName] = opencodeAdapter.parseLine(
      errorLine({ name: 'ProviderAuthError', data: { providerID: 'anthropic' } }), 'run-1'
    )
    expect(byName).toMatchObject({ type: 'error', message: 'ProviderAuthError' })
  })

  it('이름조차 없으면 error를 JSON으로 싣는다 — 빈 메시지로 두지 않는다', () => {
    const [event] = opencodeAdapter.parseLine(errorLine({ code: 7 }), 'run-1')
    expect(event).toMatchObject({ type: 'error', message: '{"code":7}' })
  })

  it('error 필드가 없어도 줄을 버리지 않는다', () => {
    const line = JSON.stringify({ type: 'error', sessionID: 'ses_x' })
    const [event] = opencodeAdapter.parseLine(line, 'run-1')
    expect(event).toMatchObject({ type: 'error', message: line })
  })
})

/** 모델·토큰·컨텍스트 (`docs/sdlc/run-info/`). 값은 기록된 실측 픽스처의 모양이다. */
describe('opencodeAdapter.parseLine — usage', () => {
  const stepFinish = (tokens: unknown, cost = 0) => JSON.stringify({
    type: 'step_finish', sessionID: 'ses_x',
    part: { type: 'step-finish', reason: 'tool-calls', tokens, cost }
  })

  it('step_finish 한 줄이 usage 하나가 된다', () => {
    const out = opencodeAdapter.parseLine(stepFinish({
      total: 4017, input: 1765, output: 45, reasoning: 31, cache: { write: 12, read: 2176 }
    }, 0.004), 'run-1')
    expect(out.filter((e) => e.type === 'usage')).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'usage',
      usage: {
        inputTokens: 1765, outputTokens: 45, reasoningTokens: 31,
        cacheReadTokens: 2176, cacheWriteTokens: 12, costUsd: 0.004
      }
    })
  })

  it('contextTokens는 그 스텝의 입력 + 캐시 읽기 + 캐시 쓰기다', () => {
    const out = opencodeAdapter.parseLine(stepFinish({
      total: 4017, input: 1765, output: 45, reasoning: 0, cache: { write: 12, read: 2176 }
    }), 'run-1')
    // 1765 + 2176 + 12 = 3953. total(4017)은 출력까지 포함하므로 컨텍스트가 아니다.
    expect(out[0]).toMatchObject({ usage: { contextTokens: 3953 } })
  })

  it('모델과 컨텍스트 창은 알 수 없어 null이다', () => {
    // OpenCode 스트림에는 모델도 창 크기도 없다 — 지어내지 않는다(spec §3-1).
    const out = opencodeAdapter.parseLine(stepFinish({
      total: 10, input: 5, output: 5, reasoning: 0, cache: { write: 0, read: 0 }
    }), 'run-1')
    expect(out[0]).toMatchObject({ usage: { model: null, contextWindow: null } })
  })

  it('tokens가 없는 step_finish는 usage를 내지 않는다', () => {
    const out = opencodeAdapter.parseLine(JSON.stringify({
      type: 'step_finish', sessionID: 'ses_x', part: { type: 'step-finish', reason: 'stop' }
    }), 'run-1')
    expect(out).toEqual([])
  })

  it('기록된 픽스처의 step_finish 넷이 모두 usage가 된다', () => {
    // 픽스처에는 step_finish가 넷 있다 — 마지막(reason: "stop")까지 포함한다.
    expect(parseAll().filter((e) => e.type === 'usage')).toHaveLength(4)
  })
})
