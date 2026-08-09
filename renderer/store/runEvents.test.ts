import { describe, it, expect, vi } from 'vitest'
import { createRunEventStore } from './runEvents'
import type { RunEvent } from '@shared/events'

function ev(runId: string, seq: number): RunEvent {
  return { type: 'text', runId, seq, at: 0, text: `줄 ${seq}` }
}

describe('runEvent 스토어', () => {
  it('run별로 이벤트를 모은다', () => {
    const store = createRunEventStore()
    store.push(ev('a', 0))
    store.push(ev('b', 0))
    store.push(ev('a', 1))
    expect(store.getSnapshot('a')).toHaveLength(2)
    expect(store.getSnapshot('b')).toHaveLength(1)
  })

  it('같은 seq가 두 번 오면 한 번만 담는다', () => {
    const store = createRunEventStore()
    store.push(ev('a', 0))
    store.push(ev('a', 0))
    expect(store.getSnapshot('a')).toHaveLength(1)
  })

  it('순서가 뒤바뀌어 도착해도 seq 순으로 정렬한다', () => {
    const store = createRunEventStore()
    store.push(ev('a', 2))
    store.push(ev('a', 0))
    store.push(ev('a', 1))
    expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([0, 1, 2])
  })

  it('같은 내용이면 같은 배열 참조를 돌려준다', () => {
    const store = createRunEventStore()
    store.push(ev('a', 0))
    expect(store.getSnapshot('a')).toBe(store.getSnapshot('a'))
  })

  it('이벤트가 없는 run도 같은 빈 배열 참조를 돌려준다', () => {
    const store = createRunEventStore()
    // getSnapshot이 매번 새 배열을 만들면 useSyncExternalStore가 무한 루프에 빠진다
    expect(store.getSnapshot('없음')).toBe(store.getSnapshot('없음'))
  })

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    const store = createRunEventStore({ maxPerRun: 3 })
    for (let i = 0; i < 5; i++) store.push(ev('a', i))
    expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([2, 3, 4])
  })

  it('구독자에게 프레임 단위로 묶어 알린다', async () => {
    const store = createRunEventStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.push(ev('a', 0))
    store.push(ev('a', 1))
    store.push(ev('a', 2))
    await new Promise((r) => setTimeout(r, 32))
    // 세 번이 아니라 한 번만 알려야 한다
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('로그 파일에서 읽은 이벤트로 채운다', () => {
    const store = createRunEventStore()
    store.hydrate('a', [ev('a', 2), ev('a', 0), ev('a', 1)])
    expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([0, 1, 2])
    // 채운 뒤 같은 seq가 스트림으로 또 와도 중복되지 않는다
    store.push(ev('a', 1))
    expect(store.getSnapshot('a')).toHaveLength(3)
  })

  it('해제한 구독자에게는 알리지 않는다', async () => {
    const store = createRunEventStore()
    const listener = vi.fn()
    store.subscribe(listener)()
    store.push(ev('a', 0))
    await new Promise((r) => setTimeout(r, 32))
    expect(listener).not.toHaveBeenCalled()
  })
})
