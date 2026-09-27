import { describe, it, expect } from 'vitest'
import { RUN_EVENT_WINDOW, eventWeight, isCount, type RunEvent } from './events'

// `docs/sdlc/conversation-events/` spec FR-29·31·33. core의 `readLog`는 로그 줄의 길이로,
// 렌더러 스토어는 이 함수로 잰다 — 두 자가 같은 수를 내야 되살린 턴과 실시간 턴의 창이
// 같다. `createLogWriter`가 실제로 쓴 줄과 같은지는 `core/db/repositories/run.test.ts`가
// 본다(shared는 renderer 타입 검사에도 걸려 node 모듈을 가져올 수 없다).

describe('eventWeight', () => {
  it('로그 한 줄의 길이다 — JSON으로 쓴 글자 수', () => {
    const event: RunEvent = { type: 'text', runId: 'r', seq: 3, at: 1700000000000, text: 'hello' }
    expect(eventWeight(event)).toBe(JSON.stringify(event).length)
  })

  it('바이트가 아니라 글자로 잰다 — 한글 한 자는 1이다', () => {
    // 읽는 쪽(readLog)은 utf8로 디코드한 문자열의 길이를 본다. 바이트로 재면 한글 로그가
    // 세 배 무겁게 잡혀 두 곳의 창이 갈린다.
    const ascii: RunEvent = { type: 'text', runId: 'r', seq: 0, at: 0, text: 'ab' }
    const hangul: RunEvent = { type: 'text', runId: 'r', seq: 0, at: 0, text: '안녕' }
    expect(eventWeight(hangul)).toBe(eventWeight(ascii))
  })

  it('실린 세부만큼 무겁다 — 출력이 든 도구 결과는 요약만 든 것보다 무겁다', () => {
    const base = {
      type: 'tool_result' as const, runId: 'r', seq: 1, at: 0, toolUseId: 't', ok: true, summary: '끝'
    }
    const output = 'x'.repeat(10_000)
    expect(eventWeight({ ...base, output })).toBe(eventWeight(base) + `,"output":${JSON.stringify(output)}`.length)
  })
})

describe('isCount', () => {
  it('음이 아닌 정수만 개수다 — 어댑터와 렌더러가 같은 판정을 쓴다', () => {
    for (const ok of [0, 1, 250, 1_000_000]) expect(isCount(ok), String(ok)).toBe(true)
    for (const bad of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined]) {
      expect(isCount(bad), String(bad)).toBe(false)
    }
  })
})

describe('RUN_EVENT_WINDOW', () => {
  it('run 하나의 창은 2,000개 그리고 800만 자다', () => {
    // 개수는 이 기능 전의 스토어 상한 그대로다. 글자는 무거운 이벤트(최대 약 33만 자)가
    // 2,000개 쌓여 수백 MB가 되는 것을 막는다(spec §5-1).
    expect(RUN_EVENT_WINDOW).toEqual({ maxEvents: 2000, maxChars: 8_000_000 })
  })
})
