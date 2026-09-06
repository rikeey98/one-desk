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
