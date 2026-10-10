import { describe, it, expect } from 'vitest'
import { createOutputBuffer, OUTPUT_LIMIT } from './buffer'

describe('셸 출력 버퍼 (docs/sdlc/code-editor/terminal-spec.md FR-6)', () => {
  it('상한은 512 KiB(UTF-16 길이)다', () => {
    expect(OUTPUT_LIMIT).toBe(512 * 1024)
  })

  it('조각마다 누적 시작 위치를 주고, 스냅샷은 지금까지의 글과 끝 위치다', () => {
    const buf = createOutputBuffer(100)
    expect(buf.append('abc')).toBe(0)
    expect(buf.append('de')).toBe(3)
    expect(buf.snapshot()).toEqual({ text: 'abcde', end: 5 })
  })

  it('상한을 넘으면 앞에서부터 버린다 — 끝 위치는 버린 것까지 센다', () => {
    const buf = createOutputBuffer(10)
    for (let i = 0; i < 7; i++) buf.append('0123')
    const snap = buf.snapshot()
    expect(snap.end).toBe(28)
    expect(snap.text).toBe('2301230123')
    expect(snap.text.length).toBe(10)
  })

  it('버리는 자리가 서로게이트 쌍 가운데면 한 글자 더 버린다 — 깨진 글자를 남기지 않는다', () => {
    const buf = createOutputBuffer(4)
    buf.append('a😀bcd') // 'a' + 서로게이트 둘 + 'bcd' = 6, 남길 4는 😀의 뒤쪽 반부터다
    const snap = buf.snapshot()
    expect(snap.text).toBe('bcd')
    expect(snap.end).toBe(6)
  })
})
