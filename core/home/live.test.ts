import { describe, it, expect } from 'vitest'
import type { RunEvent } from '@shared/events'
import { LIVE_TEXT_MAX, applyRunEvent, dropRun, type LiveMap } from './live'

const base = { runId: 'r1', seq: 0, at: 1 }

function tool(name: string, runId = 'r1'): RunEvent {
  return { ...base, runId, type: 'tool_use', toolUseId: 't', name, effect: 'read', targetPaths: [], input: {} }
}
function text(t: string, runId = 'r1'): RunEvent {
  return { ...base, runId, type: 'text', text: t }
}

describe('applyRunEvent', () => {
  it('tool_use는 지금 도는 도구를, text는 마지막 글을 갈아 끼운다 — run마다 따로', () => {
    const map: LiveMap = new Map()
    applyRunEvent(map, tool('Read'))
    applyRunEvent(map, text('파일을 읽는 중'))
    applyRunEvent(map, tool('Edit'))
    applyRunEvent(map, tool('Grep', 'r2'))
    expect(map.get('r1')).toEqual({ currentTool: 'Edit', lastText: '파일을 읽는 중' })
    expect(map.get('r2')).toEqual({ currentTool: 'Grep', lastText: null })
  })

  it('마지막 글은 앞 160자다 — 공백뿐인 text는 무시한다', () => {
    const map: LiveMap = new Map()
    applyRunEvent(map, text('가'.repeat(500)))
    expect(map.get('r1')?.lastText).toHaveLength(LIVE_TEXT_MAX)
    applyRunEvent(map, text('   \n'))
    expect(map.get('r1')?.lastText).toHaveLength(LIVE_TEXT_MAX)
  })

  it('result가 오면 그 run의 항목을 지운다 — 종료 기록이 늦어도 낡은 도구 이름을 보이지 않는다', () => {
    const map: LiveMap = new Map()
    applyRunEvent(map, tool('Read'))
    applyRunEvent(map, { ...base, type: 'result', status: 'succeeded', resultText: '끝', sessionId: null, needsAnswer: false })
    expect(map.has('r1')).toBe(false)
  })

  it('그 밖의 이벤트는 아무것도 바꾸지 않는다', () => {
    const map: LiveMap = new Map()
    applyRunEvent(map, { ...base, type: 'session', sessionId: 's' })
    applyRunEvent(map, { ...base, type: 'error', message: 'x' })
    expect(map.size).toBe(0)
  })
})

describe('dropRun', () => {
  it('끝난 run의 스냅샷은 없다 — 결과 없이 죽은 run(실패·취소)도', () => {
    const map: LiveMap = new Map()
    applyRunEvent(map, tool('Bash'))
    dropRun(map, 'r1')
    expect(map.has('r1')).toBe(false)
    dropRun(map, 'none') // 없는 것을 지워도 던지지 않는다
  })
})
