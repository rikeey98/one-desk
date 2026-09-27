import { RUN_EVENT_WINDOW, eventWeight, type RunEvent } from '@shared/events'

const EMPTY: readonly RunEvent[] = []

export interface RunEventStoreOptions {
  /** run당 메모리에 유지할 최대 이벤트 수. 전체는 로그 파일에 있다. 테스트가 작게 준다. */
  maxPerRun?: number
  /** run당 무게(`eventWeight`) 합의 상한. 테스트가 작게 준다 (spec FR-32). */
  maxCharsPerRun?: number
}

/**
 * run별 이벤트 스토어.
 *
 * **run마다 창 하나를 지킨다** (`docs/sdlc/conversation-events/` spec FR-31) — 개수와
 * 무게 합 두 한계를 모두 지키는 가장 긴 꼬리만 남기고, 넘으면 가장 오래된 이벤트부터
 * 버린다. core의 `readLog`와 같은 창(`RUN_EVENT_WINDOW`)·같은 자(`eventWeight`)다 — 따로
 * 두면 되살린 턴과 실시간 턴의 모양이 갈린다. 도구 출력·hunk·before가 실리면서 이벤트
 * 하나가 수십만 자일 수 있어 개수만으로는 메모리가 묶이지 않는다.
 */
export function createRunEventStore(opts: RunEventStoreOptions = {}) {
  const maxEvents = opts.maxPerRun ?? RUN_EVENT_WINDOW.maxEvents
  const maxChars = opts.maxCharsPerRun ?? RUN_EVENT_WINDOW.maxChars
  const byRun = new Map<string, RunEvent[]>()
  /** byRun에 지금 남은 이벤트의 무게 합 */
  const charsByRun = new Map<string, number>()
  /** 무게는 넣을 때 한 번만 잰다 — 버릴 때 다시 직렬화하지 않는다 */
  const weights = new WeakMap<RunEvent, number>()
  /**
   * 한 번이라도 받은 seq. **창 밖으로 버린 뒤에도 기억한다** — 늦게 온 옛 이벤트(같은 seq의
   * push, 겹치는 hydrate)가 되살아나지 않게.
   */
  const seen = new Map<string, Set<number>>()
  const listeners = new Set<() => void>()
  let frame: number | null = null

  function notify() {
    // 이벤트마다 알리면 수천 번 리렌더링된다. 프레임 단위로 묶는다 (설계 §9).
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      for (const l of listeners) l()
    })
  }

  function weigh(event: RunEvent): number {
    const weight = eventWeight(event)
    weights.set(event, weight)
    return weight
  }

  /** seq로 정렬된 목록을 창에 맞춰 앞에서부터 잘라 담는다. chars는 목록 전체의 무게 합이다. */
  function settle(runId: string, list: RunEvent[], chars: number): void {
    let start = 0
    while (start < list.length && (list.length - start > maxEvents || chars > maxChars)) {
      chars -= weights.get(list[start]!)!
      start++
    }
    byRun.set(runId, start > 0 ? list.slice(start) : list)
    charsByRun.set(runId, chars)
  }

  return {
    push(event: RunEvent): void {
      const ids = seen.get(event.runId) ?? new Set<number>()
      if (ids.has(event.seq)) return
      ids.add(event.seq)
      seen.set(event.runId, ids)

      const chars = (charsByRun.get(event.runId) ?? 0) + weigh(event)
      const list = [...(byRun.get(event.runId) ?? []), event]
      list.sort((a, b) => a.seq - b.seq)
      settle(event.runId, list, chars)
      notify()
    },

    /**
     * 로그 파일에서 읽어온 이벤트로 채운다 (종료된 run의 탭을 다시 열 때).
     *
     * **교체가 아니라 seq 병합이다** (`docs/sdlc/conversation-fixes/` spec FR-19). 로그를
     * 요청한 뒤 응답이 오기 전에 실시간 이벤트가 push될 수 있고, 그 이벤트는 파일에 아직
     * 안 쓰였을 수 있다(로그 쓰기는 비동기다). 통째로 바꾸면 그 줄이 사라진다.
     * 병합한 뒤 push와 같은 창을 건다(spec FR-31) — `readLog`가 이미 같은 창으로 잘라
     * 보내지만, 실시간 이벤트와 합치면 다시 넘을 수 있다.
     */
    hydrate(runId: string, events: RunEvent[]): void {
      const ids = seen.get(runId) ?? new Set<number>()
      const merged = [...(byRun.get(runId) ?? [])]
      let chars = charsByRun.get(runId) ?? 0
      for (const event of events) {
        if (ids.has(event.seq)) continue
        ids.add(event.seq)
        chars += weigh(event)
        merged.push(event)
      }
      merged.sort((a, b) => a.seq - b.seq)
      settle(runId, merged, chars)
      seen.set(runId, ids)
      notify()
    },

    // 같은 내용이면 같은 참조를 돌려줘야 useSyncExternalStore가 무한 루프에 안 빠진다.
    // 빈 경우도 매번 새 배열을 만들면 안 되므로 공유 상수를 쓴다.
    getSnapshot(runId: string): readonly RunEvent[] {
      return byRun.get(runId) ?? EMPTY
    },

    /** 이벤트가 하나라도 도착한 run들. 도크 탭 목록의 출처다. */
    runIds(): string[] {
      return [...byRun.keys()]
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
}

export type RunEventStore = ReturnType<typeof createRunEventStore>
