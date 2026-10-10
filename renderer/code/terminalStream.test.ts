import { describe, it, expect } from 'vitest'
import type { TerminalData } from '@shared/models'
import { createTerminalStream } from './terminalStream'

const chunk = (start: number, data: string, generation = 1, repoId = 'api'): TerminalData => ({ repoId, generation, start, data })

function setup() {
  const written: string[] = []
  const stream = createTerminalStream('api', (text) => { written.push(text) })
  return { stream, written, all: () => written.join('') }
}

describe('셸 출력 이어 붙이기 (docs/sdlc/code-editor/terminal-plan.md 7단계)', () => {
  it('붙으면 스냅샷을 쓰고, 그 뒤 조각을 이어 쓴다', () => {
    const { stream, all } = setup()
    stream.attach(1, { text: 'PS> ', end: 4 })
    stream.push(chunk(4, 'dir\r\n'))
    expect(all()).toBe('PS> dir\r\n')
  })

  it('스냅샷보다 먼저 온 조각은 모아 두었다가, 스냅샷에 이미 든 앞부분을 잘라 쓴다 — 같은 출력이 두 번 찍히지 않는다', () => {
    const { stream, written } = setup()
    stream.push(chunk(0, 'abc'))   // 스냅샷에 통째로 든다
    stream.push(chunk(3, 'defg'))  // 앞 둘(de)만 스냅샷에 든다
    expect(written).toEqual([])
    stream.attach(1, { text: 'abcde', end: 5 })
    expect(written).toEqual(['abcde', 'fg'])
  })

  it('붙은 뒤에도 이미 쓴 범위의 조각은 버린다', () => {
    const { stream, all } = setup()
    stream.attach(1, { text: 'abcdef', end: 6 })
    stream.push(chunk(2, 'cd'))
    stream.push(chunk(4, 'efgh'))
    expect(all()).toBe('abcdefgh')
  })

  it('다른 셸(generation)과 다른 repo의 조각은 버린다 — 다시 시작하면 새 셸의 것만 받는다', () => {
    const { stream, all } = setup()
    stream.attach(1, { text: 'old', end: 3 })
    stream.push(chunk(0, 'x', 1, 'web'))
    stream.attach(2, { text: '', end: 0 })
    stream.push(chunk(3, 'late', 1))
    stream.push(chunk(0, 'new', 2))
    expect(all()).toBe('oldnew')
  })

  it('다시 시작의 응답보다 먼저 온 새 셸의 조각도 잃지 않는다 — 지금보다 새 generation은 모아 둔다', () => {
    const { stream, all } = setup()
    stream.attach(1, { text: 'old', end: 3 })
    stream.push(chunk(0, 'PS> ', 2))
    expect(all()).toBe('old')
    stream.attach(2, { text: '', end: 0 })
    expect(all()).toBe('oldPS> ')
  })
})
