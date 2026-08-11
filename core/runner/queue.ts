import type { QueueSnapshot } from '@shared/models'

export interface RunQueueOptions {
  /** 동시 실행 상한. 1 이상의 정수여야 한다 (검증은 setting 저장소가 한다). */
  limit: number
  /** 큐가 바뀔 때마다 새 스냅샷을 준다. 렌더러로 push할 때 쓴다. */
  onChange?: (snapshot: QueueSnapshot) => void
}

/**
 * 전역 동시 실행 상한과 FIFO 대기열.
 *
 * DB도 프로세스도 모른다 — id 문자열과 숫자만 다룬다. 그래서 상한·순서·재진입을
 * 프로세스 하나 띄우지 않고 결정적으로 검증할 수 있다.
 *
 * **start를 부르는 순간 슬롯은 점유된 것으로 센다.** 실제 spawn을 기다렸다가 세면
 * 그 사이 들어온 enqueue가 상한을 넘긴다. 따라서 호출자는 성공하든 실패하든
 * 반드시 release를 불러야 한다. 한 번 빠뜨리면 슬롯이 영구히 줄고,
 * 증상은 "언젠가부터 N개까지만 돈다"라서 원인을 찾기 어렵다.
 */
export function createRunQueue(opts: RunQueueOptions) {
  let limit = opts.limit
  const running = new Set<string>()
  const waiting: { runId: string; start: () => void }[] = []
  let pumping = false

  function snapshot(): QueueSnapshot {
    return { running: running.size, limit, waiting: waiting.length }
  }

  /**
   * 슬롯이 남는 동안 대기열 앞에서부터 꺼내 시작한다.
   *
   * start가 동기로 release를 부를 수 있다(유령 run). 그때 release가 다시 pump를
   * 부르면 같은 대기열을 두 곳에서 건드리게 되므로 재진입을 막는다 —
   * 안쪽 호출은 그냥 돌아가고 바깥 루프가 다음 회차에 집어간다.
   */
  function pump(): void {
    if (pumping) return
    pumping = true
    try {
      while (running.size < limit && waiting.length > 0) {
        const next = waiting.shift()!
        running.add(next.runId)
        try {
          next.start()
        } catch {
          // 시작하지 못했으므로 슬롯을 돌려준다. 여기서 던지게 두면 뒤에 남은
          // 대기분이 영영 흐르지 않는다. 실패를 기록하는 것은 호출자의 몫이다.
          running.delete(next.runId)
        }
      }
    } finally {
      pumping = false
    }
  }

  function changed(): void {
    opts.onChange?.(snapshot())
  }

  return {
    enqueue(runId: string, start: () => void): void {
      waiting.push({ runId, start })
      pump()
      changed()
    },

    release(runId: string): void {
      running.delete(runId)
      pump()
      changed()
    },

    remove(runId: string): boolean {
      const i = waiting.findIndex((w) => w.runId === runId)
      if (i < 0) return false
      waiting.splice(i, 1)
      changed()
      return true
    },

    setLimit(next: number): void {
      limit = next
      pump()
      changed()
    },

    snapshot
  }
}

export type RunQueue = ReturnType<typeof createRunQueue>
