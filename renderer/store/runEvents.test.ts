import { describe, it, expect, vi } from 'vitest'
import { createRunEventStore } from './runEvents'
import { RUN_EVENT_WINDOW, eventWeight, type RunEvent } from '@shared/events'

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

  it('로그를 읽는 사이에 push된 이벤트를 지우지 않는다 — 교체가 아니라 seq 병합이다', () => {
    // `docs/sdlc/conversation-fixes/` spec FR-19. useRunEvents는 스토어가 비어 있을 때
    // 로그 파일을 요청한다. 응답이 오기 전에 실시간 이벤트가 push되고, 그 이벤트는
    // 파일에 아직 안 쓰였을 수 있다(로그 쓰기는 비동기다). 교체하면 그 줄이 사라진다.
    const store = createRunEventStore()
    store.push(ev('a', 3))

    store.hydrate('a', [ev('a', 0), ev('a', 1), ev('a', 2)])

    expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([0, 1, 2, 3])
  })

  it('병합할 때 양쪽에 있는 seq는 하나만 남긴다', () => {
    const store = createRunEventStore()
    store.push(ev('a', 1))
    store.push(ev('a', 2))

    store.hydrate('a', [ev('a', 0), ev('a', 1), ev('a', 2)])

    expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([0, 1, 2])
    // 병합 뒤에도 같은 seq가 스트림으로 또 오면 무시한다.
    store.push(ev('a', 0))
    expect(store.getSnapshot('a')).toHaveLength(3)
  })

  // `docs/sdlc/conversation-events/` spec FR-31·32 — 개수에 더해 **무게 합**으로도 묶는다.
  // 무게는 eventWeight(로그 한 줄의 길이)이고, core의 readLog와 같은 창(RUN_EVENT_WINDOW)이다.
  describe('글자 예산 (FR-31)', () => {
    function heavy(runId: string, seq: number, chars: number): RunEvent {
      return { type: 'text', runId, seq, at: 0, text: 'x'.repeat(chars) }
    }

    it('push: 무게 합이 예산을 넘으면 가장 오래된 것부터 버린다', () => {
      const events = [0, 1, 2].map((s) => heavy('a', s, 100))
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(events[1]!) + eventWeight(events[2]!) })
      for (const e of events) store.push(e)
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([1, 2])
    })

    it('push: 예산에 딱 맞으면 버리지 않는다', () => {
      const events = [0, 1].map((s) => heavy('a', s, 100))
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(events[0]!) + eventWeight(events[1]!) })
      for (const e of events) store.push(e)
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([0, 1])
    })

    it('hydrate도 글자 예산으로 앞을 버린다', () => {
      const events = [0, 1, 2].map((s) => heavy('a', s, 100))
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(events[1]!) + eventWeight(events[2]!) })
      store.hydrate('a', events)
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([1, 2])
    })

    it('hydrate도 개수 상한을 건다', () => {
      // 이 기능 전에는 hydrate에 상한이 없었다(되살린 로그는 전부 보여 줬다). 이제 readLog가
      // 같은 창으로 자르므로 둘이 같은 규칙이어야 되살린 턴과 실시간 턴이 갈리지 않는다.
      const store = createRunEventStore({ maxPerRun: 3 })
      store.hydrate('a', [0, 1, 2, 3, 4].map((s) => ev('a', s)))
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([2, 3, 4])
    })

    it('hydrate는 이미 있던 실시간 이벤트와 합친 무게로 잰다', () => {
      const events = [0, 1, 2].map((s) => heavy('a', s, 100))
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(events[1]!) + eventWeight(events[2]!) })
      store.push(events[2]!)
      store.hydrate('a', [events[0]!, events[1]!])
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([1, 2])
    })

    it('버린 seq가 다시 push돼도 들어오지 않는다 — 늦게 온 옛 이벤트가 되살아나지 않게', () => {
      const events = [0, 1, 2].map((s) => heavy('a', s, 100))
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(events[1]!) + eventWeight(events[2]!) })
      for (const e of events) store.push(e)
      const before = store.getSnapshot('a')

      store.push(events[0]!)
      // 창만 보면 어차피 다시 잘려 나가지만, 기억하지 않으면 목록을 새로 만들어 참조가 바뀌고
      // 구독자가 헛되이 다시 그린다. 이미 본 seq는 아무 일도 일으키지 않아야 한다.
      expect(store.getSnapshot('a')).toBe(before)

      store.hydrate('a', [events[0]!])
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([1, 2])
    })

    it('처음 보는 seq라도 창보다 오래된 것은 들어오자마자 버린다', () => {
      const events = [5, 6].map((s) => heavy('a', s, 100))
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(events[0]!) + eventWeight(events[1]!) })
      for (const e of events) store.push(e)
      store.push(heavy('a', 1, 100))
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([5, 6])
    })

    it('혼자서 예산을 넘는 이벤트는 남지 않는다 — readLog와 같은 규칙이다', () => {
      // readLog도 끝에서부터 예산 안에 드는 만큼만 돌려준다. 한쪽만 "하나는 남긴다"로 두면
      // 되살린 턴과 실시간 턴이 갈린다. (어댑터 상한 때문에 실제로는 창에 한참 못 미친다.)
      const big = heavy('a', 1, 100)
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(big) - 1 })
      store.push(ev('a', 0))
      store.push(big)
      expect(store.getSnapshot('a')).toEqual([])
    })

    it('개수와 글자로 번갈아 버려도 남는 것은 늘 두 한계를 지키는 가장 긴 꼬리다', () => {
      // 버릴 때 무게를 빼먹거나 두 번 빼면 합이 어긋나 한동안은 멀쩡하다가 엉뚱한 자리에서
      // 자른다. 크기가 제각각인 이벤트를 흘리며 매번 기준 답과 대조한다.
      const maxPerRun = 4
      const maxCharsPerRun = 900
      const store = createRunEventStore({ maxPerRun, maxCharsPerRun })
      const sizes = [10, 300, 20, 400, 5, 5, 5, 5, 5, 700, 30, 30, 200, 10, 600, 1, 1]
      const all: RunEvent[] = []
      sizes.forEach((size, seq) => {
        const e = heavy('a', seq, size)
        all.push(e)
        store.push(e)

        const expected: number[] = []
        let chars = 0
        for (let i = all.length - 1; i >= 0 && expected.length < maxPerRun; i--) {
          chars += eventWeight(all[i]!)
          if (chars > maxCharsPerRun) break
          expected.unshift(all[i]!.seq)
        }
        expect(store.getSnapshot('a').map((x) => x.seq)).toEqual(expected)
      })
    })

    it('넘기지 않으면 RUN_EVENT_WINDOW의 글자 수를 쓴다', () => {
      const store = createRunEventStore()
      const size = Math.floor(RUN_EVENT_WINDOW.maxChars * 0.4)
      for (const seq of [0, 1, 2]) store.push(heavy('a', seq, size))
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([1, 2])
    })

    it('넘기지 않으면 RUN_EVENT_WINDOW의 개수를 쓴다', () => {
      const store = createRunEventStore()
      const count = RUN_EVENT_WINDOW.maxEvents + 1
      store.hydrate('a', Array.from({ length: count }, (_, seq) => ev('a', seq)))
      expect(store.getSnapshot('a')).toHaveLength(RUN_EVENT_WINDOW.maxEvents)
      expect(store.getSnapshot('a')[0]!.seq).toBe(1)
    })

    it('run마다 따로 잰다', () => {
      const events = [0, 1].map((s) => heavy('a', s, 100))
      const store = createRunEventStore({ maxCharsPerRun: eventWeight(events[0]!) + eventWeight(events[1]!) })
      for (const e of events) store.push(e)
      store.push(heavy('b', 0, 100))
      expect(store.getSnapshot('a').map((e) => e.seq)).toEqual([0, 1])
      expect(store.getSnapshot('b').map((e) => e.seq)).toEqual([0])
    })
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
