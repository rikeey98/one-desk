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
  /** runId → groupKey. 그룹 제약이 없으면 null */
  const running = new Map<string, string | null>()
  const waiting: { runId: string; groupKey: string | null; start: () => void }[] = []
  let pumping = false

  function snapshot(): QueueSnapshot {
    return { running: running.size, limit, waiting: waiting.length }
  }

  /**
   * 그 그룹이 이미 하나 돌고 있는가.
   *
   * 대화 하나가 자기 자신과 경쟁하면 안 된다 — Claude Code는 이전 프로세스가
   * 끝나야 --resume이 되므로 같은 대화의 두 턴이 동시에 뜨면 뒤엣것이 깨진다.
   */
  function groupBusy(key: string | null): boolean {
    if (key === null) return false
    for (const g of running.values()) if (g === key) return true
    return false
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
      while (running.size < limit) {
        // 앞에서부터 보되 그룹이 막힌 항목은 건너뛴다. 건너뛰지 않으면 한 대화가
        // 뒤의 모든 대화를 막아 전역 상한이 사실상 1이 된다.
        const i = waiting.findIndex((w) => !groupBusy(w.groupKey))
        if (i < 0) break
        const next = waiting.splice(i, 1)[0]!
        running.set(next.runId, next.groupKey)
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
    enqueue(runId: string, start: () => void, groupKey?: string): void {
      waiting.push({ runId, groupKey: groupKey ?? null, start })
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
