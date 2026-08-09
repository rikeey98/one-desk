import type { RunEvent } from '@shared/events'

const EMPTY: readonly RunEvent[] = []

export interface RunEventStoreOptions {
  /** run당 메모리에 유지할 최대 이벤트 수. 전체는 로그 파일에 있다. */
  maxPerRun?: number
}

export function createRunEventStore(opts: RunEventStoreOptions = {}) {
  const max = opts.maxPerRun ?? 2000
  const byRun = new Map<string, RunEvent[]>()
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

  return {
    push(event: RunEvent): void {
      const ids = seen.get(event.runId) ?? new Set<number>()
      if (ids.has(event.seq)) return
      ids.add(event.seq)
      seen.set(event.runId, ids)

      const list = [...(byRun.get(event.runId) ?? []), event]
      list.sort((a, b) => a.seq - b.seq)
      byRun.set(event.runId, list.length > max ? list.slice(list.length - max) : list)
      notify()
    },

    /** 로그 파일에서 읽어온 이벤트로 채운다 (종료된 run의 탭을 다시 열 때) */
    hydrate(runId: string, events: RunEvent[]): void {
      byRun.set(runId, [...events].sort((a, b) => a.seq - b.seq))
      seen.set(runId, new Set(events.map((e) => e.seq)))
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
