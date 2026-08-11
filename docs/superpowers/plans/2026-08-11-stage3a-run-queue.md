# 3a단계 구현 계획 — 동시 실행 큐와 재시작 복구

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 여러 개를 연달아 던져도 머신이 멎지 않게 하고, 앱이 죽었다 다시 떠도 run이 `running`인 채로 방치되지 않게 한다.

**Architecture:** DB도 프로세스도 모르는 `RunQueue`를 새로 두고, `ExecutionService`가 그 위에서 `pending → running → 종료` 전이를 쓴다. 상한은 `app_setting`에 저장하고 도크의 슬롯 표시기에서 바꾼다. `RunManager`는 순수한 프로세스 관리자로 남는다.

**Tech Stack:** 기존과 동일 — pnpm / TypeScript 5.9.3 / Electron 43.3.0 / drizzle-orm + better-sqlite3 / React / Vitest 4.1.10 / playwright-core. 새 의존성은 없다.

**참조:**
- 설계: `docs/superpowers/specs/2026-08-10-stage3a-run-queue-design.md`
- 앱 전체 설계 §6(동시 실행)·§13(구현 순서): `docs/superpowers/specs/2026-08-07-one-desk-design.md`

## Global Constraints

- **`core/`는 `electron`을 import하지 않는다.** ESLint가 강제한다. 확인: `grep -rn "from 'electron'" core/`는 출력이 없어야 한다.
- **`renderer/`는 `core/`를 import하지 않는다.** `window.oneDesk` 참조는 `renderer/main.tsx` 한 곳뿐이다. 컴포넌트는 `useClient()`를 쓴다.
- **`e2e/`는 `@core`/`@shared`를 import하지 않는다.** ESLint가 강제한다.
- **IPC 핸들러는 얇다.** core 메서드 호출만 하고 로직을 넣지 않는다.
- **의도된 중복을 합치지 않는다.** `issue.ts`↔`memo.ts`, `useIssues.ts`↔`useMemos.ts`는 사용자가 승인한 설계 결정이다. 이 계획은 그 네 파일을 건드리지 않는다.
- **시각은 전부 epoch milliseconds 정수.** `Date.now()`로 명시 삽입한다.
- **쓰기는 트랜잭션으로 감싼다.**
- **패키지 매니저는 pnpm이다.**
- 들여쓰기 2칸, 함수명 camelCase, 상수 UPPER_SNAKE_CASE.
- `verbatimModuleSyntax: true` — 타입 전용 import는 `import type`.
- **주석과 오류 메시지는 한국어. 커밋 메시지는 영어 명령형.**
- **회귀 테스트를 추가하면 대상 코드를 잠시 망가뜨려 그 테스트가 실제로 실패하는지 확인한다.** 이 저장소는 무력화된 회귀 테스트에 한 번 당했다.
- **`pnpm test`에 e2e가 섞이면 안 된다.** 시작 시점 137개이고, 각 태스크가 더한 만큼만 늘어야 한다.
- 시작 시점: `pnpm test` 137개 통과, `pnpm test:e2e` 3개 통과.

## File Structure

```
생성:
  core/runner/queue.ts                    RunQueue — 상한, FIFO, 슬롯 회계
  core/runner/queue.test.ts
  core/db/repositories/setting.ts         app_setting 읽기/쓰기와 상한 검증
  core/db/repositories/setting.test.ts
  renderer/hooks/useQueue.ts              큐 스냅샷 구독
  renderer/components/SlotIndicator.tsx   "실행 중 2/3 · 대기 1"과 상한 조절
  renderer/components/SlotIndicator.test.tsx
  e2e/queue.e2e.ts                        상한 1에서 두 번째 run이 대기했다 시작한다

수정:
  shared/models.ts                        QueueSnapshot 타입
  shared/channels.ts                      runs:queueSnapshot, runs:setConcurrencyLimit, event:queueUpdate
  shared/client.ts                        runs.queueSnapshot/setConcurrencyLimit, events.onQueueUpdate
  core/db/repositories/run.ts             reapStale — pending은 canceled로
  core/db/repositories/run.test.ts        위 테스트 갱신
  core/runner/manager.ts                  active.size > 0 → active.has(spec.runId)
  core/execution.ts                       큐 연결, 취소 분기, 슬롯 회계
  core/execution.test.ts                  큐 관련 테스트 추가
  core/index.ts                           설정·큐 생성, queue 그룹과 onQueueUpdate 노출
  electron/ipc/runs.ts                    새 핸들러 둘과 이벤트 중계
  electron/preload.ts                     새 메서드 셋
  renderer/App.tsx                        useQueue를 들고 Dock에 내린다
  renderer/components/Dock.tsx            슬롯 표시기 배치, pending도 취소 가능
  renderer/components/Dock.test.tsx       props 추가에 맞춰 배선
  renderer/index.css                      슬롯 표시기 스타일
```

---

## Task 1: `RunQueue` — 상한과 FIFO

큐는 이 단계의 핵심이고, DB도 프로세스도 모르므로 순수 로직으로 먼저 완성한다.

**Files:**
- Create: `core/runner/queue.ts`, `core/runner/queue.test.ts`
- Modify: `shared/models.ts`

**Interfaces:**
- Produces: `QueueSnapshot` = `{ running: number; limit: number; waiting: number }` (`shared/models.ts`)
- Produces: `createRunQueue(opts: RunQueueOptions): RunQueue`
- Produces: `RunQueue` = `{ enqueue(runId: string, start: () => void): void; release(runId: string): void; remove(runId: string): boolean; setLimit(n: number): void; snapshot(): QueueSnapshot }`
- Produces: `RunQueueOptions` = `{ limit: number; onChange?: (snapshot: QueueSnapshot) => void }`

- [ ] **Step 1: `QueueSnapshot` 타입을 shared에 추가**

`shared/models.ts` 맨 아래에 붙인다.

```ts
/** 도크의 슬롯 표시기가 쓰는 전역 실행 현황. workspace와 무관하다. */
export interface QueueSnapshot {
  /** 지금 슬롯을 쥔 run 수. 상한을 낮추면 일시적으로 limit보다 클 수 있다. */
  running: number
  limit: number
  waiting: number
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// core/runner/queue.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunQueue } from './queue'

/** 시작된 순서를 기록하는 큐. 대부분의 테스트가 이걸로 충분하다. */
function makeQueue(limit: number) {
  const started: string[] = []
  const queue = createRunQueue({ limit })
  const add = (id: string) => queue.enqueue(id, () => { started.push(id) })
  return { queue, started, add }
}

describe('createRunQueue', () => {
  it('상한까지는 즉시 시작하고 초과분은 대기시킨다', () => {
    const { queue, started, add } = makeQueue(2)
    add('a'); add('b'); add('c')
    expect(started).toEqual(['a', 'b'])
    expect(queue.snapshot()).toEqual({ running: 2, limit: 2, waiting: 1 })
  })

  it('슬롯이 있으면 enqueue가 start를 동기로 부른다', () => {
    // 비동기로 미루면 execution.start()가 running run을 못 돌려주고
    // 도크 탭이 늦게 뜬다 — 이미 고정해 둔 계약이 깨진다.
    const started: string[] = []
    const queue = createRunQueue({ limit: 1 })
    queue.enqueue('a', () => { started.push('a') })
    expect(started).toEqual(['a'])
  })

  it('release하면 대기열에서 FIFO 순으로 다음이 시작한다', () => {
    const { queue, started, add } = makeQueue(1)
    add('a'); add('b'); add('c')
    expect(started).toEqual(['a'])
    queue.release('a')
    expect(started).toEqual(['a', 'b'])
    queue.release('b')
    expect(started).toEqual(['a', 'b', 'c'])
  })

  it('대기 중인 것은 remove로 뺄 수 있고, 실행 중인 것은 false다', () => {
    const { queue, started, add } = makeQueue(1)
    add('a'); add('b')
    expect(queue.remove('b')).toBe(true)
    expect(queue.remove('a')).toBe(false)
    expect(queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 0 })
    queue.release('a')
    expect(started).toEqual(['a'])
  })

  it('없는 id를 remove하면 false다', () => {
    const { queue } = makeQueue(1)
    expect(queue.remove('없음')).toBe(false)
  })

  it('상한을 낮춰도 돌던 것을 죽이지 않고 새로 시작하지도 않는다', () => {
    const { queue, started, add } = makeQueue(3)
    add('a'); add('b'); add('c'); add('d')
    expect(started).toEqual(['a', 'b', 'c'])
    queue.setLimit(1)
    expect(started).toEqual(['a', 'b', 'c'])
    // 넘긴 상태를 그대로 드러낸다. 감추면 왜 새 run이 안 뜨는지 알 수 없다.
    expect(queue.snapshot()).toEqual({ running: 3, limit: 1, waiting: 1 })
    queue.release('a'); queue.release('b')
    expect(started).toEqual(['a', 'b', 'c'])
    queue.release('c')
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('상한을 올리면 대기분이 즉시 시작한다', () => {
    const { queue, started, add } = makeQueue(1)
    add('a'); add('b'); add('c')
    queue.setLimit(3)
    expect(started).toEqual(['a', 'b', 'c'])
  })

  it('start가 던져도 슬롯을 돌려주고 다음 대기분으로 넘어간다', () => {
    // 여기서 던지게 두면 뒤에 남은 대기분이 영영 흐르지 않는다.
    const started: string[] = []
    const queue = createRunQueue({ limit: 1 })
    queue.enqueue('a', () => { throw new Error('시작 실패') })
    queue.enqueue('b', () => { started.push('b') })
    expect(started).toEqual(['b'])
    expect(queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 0 })
  })

  it('start 안에서 release를 불러도 큐가 꼬이지 않는다', () => {
    // 유령 run 경로다 — run 행이 사라지면 execution이 곧바로 release한다.
    const started: string[] = []
    const queue = createRunQueue({ limit: 1 })
    queue.enqueue('a', () => { started.push('a'); queue.release('a') })
    queue.enqueue('b', () => { started.push('b') })
    expect(started).toEqual(['a', 'b'])
    expect(queue.snapshot().waiting).toBe(0)
  })

  it('바뀔 때마다 onChange로 새 스냅샷을 준다', () => {
    const onChange = vi.fn()
    const queue = createRunQueue({ limit: 1, onChange })
    queue.enqueue('a', () => {})
    expect(onChange).toHaveBeenLastCalledWith({ running: 1, limit: 1, waiting: 0 })
    queue.enqueue('b', () => {})
    expect(onChange).toHaveBeenLastCalledWith({ running: 1, limit: 1, waiting: 1 })
    queue.release('a')
    expect(onChange).toHaveBeenLastCalledWith({ running: 1, limit: 1, waiting: 0 })
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run core/runner/queue.test.ts`
Expected: FAIL — `Cannot find module './queue'`

- [ ] **Step 4: 구현**

```ts
// core/runner/queue.ts
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run core/runner/queue.test.ts`
Expected: PASS (10개)

- [ ] **Step 6: 재진입 가드가 실제로 무는지 확인**

`queue.ts`의 `if (pumping) return`을 잠시 지우고 다시 돌린다.

Run: `pnpm vitest run core/runner/queue.test.ts`
Expected: `start 안에서 release를 불러도 큐가 꼬이지 않는다`가 **실패**한다. 실패하지 않으면 그 테스트가 재진입을 검증하지 못하는 것이므로 보고한다.

가드를 원래대로 되돌리고 통과를 다시 확인한다.

- [ ] **Step 7: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add shared/models.ts core/runner/queue.ts core/runner/queue.test.ts
git commit -m "feat: add a run queue with a global concurrency limit"
```

Expected: `pnpm test` 147개 (137 + 10)

---

## Task 2: 상한 설정 저장소

`app_setting` 테이블의 첫 사용처다. 값 검증과 폴백이 여기 모인다.

**Files:**
- Create: `core/db/repositories/setting.ts`, `core/db/repositories/setting.test.ts`

**Interfaces:**
- Produces: `createSettingRepository(db: Database): SettingRepository`
- Produces: `SettingRepository` = `{ concurrencyLimit(): number; setConcurrencyLimit(n: number): number }`
- Produces: `DEFAULT_CONCURRENCY_LIMIT = 3`, `CONCURRENCY_LIMIT_KEY = 'run.concurrencyLimit'`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/db/repositories/testing.ts`의 `makeTestDb()`가 마이그레이션까지 끝난 DB를 준다 — 다른 저장소 테스트와 같은 방식이다.

```ts
// core/db/repositories/setting.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { appSetting } from '../schema'
import {
  createSettingRepository, CONCURRENCY_LIMIT_KEY, DEFAULT_CONCURRENCY_LIMIT
} from './setting'
import type { Database } from '../open'

describe('SettingRepository', () => {
  let db: Database
  let settings: ReturnType<typeof createSettingRepository>

  beforeEach(() => {
    db = makeTestDb()
    settings = createSettingRepository(db)
  })

  /** 검증을 우회해 망가진 값을 직접 심는다. */
  function poke(value: string) {
    db.insert(appSetting).values({ key: CONCURRENCY_LIMIT_KEY, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run()
  }

  it('저장된 값이 없으면 기본값이다', () => {
    expect(settings.concurrencyLimit()).toBe(DEFAULT_CONCURRENCY_LIMIT)
  })

  it('저장하면 그 값을 읽는다', () => {
    settings.setConcurrencyLimit(5)
    expect(settings.concurrencyLimit()).toBe(5)
    expect(createSettingRepository(db).concurrencyLimit()).toBe(5)
  })

  it('두 번 저장해도 행이 하나다', () => {
    settings.setConcurrencyLimit(2)
    settings.setConcurrencyLimit(4)
    expect(db.select().from(appSetting).all()).toHaveLength(1)
    expect(settings.concurrencyLimit()).toBe(4)
  })

  it('망가진 값이 저장돼 있으면 기본값으로 떨어진다', () => {
    // Number()는 빈 문자열을 0으로, 쓰레기를 NaN으로 조용히 흘린다.
    for (const bad of ['', '   ', 'abc', '0', '-1', '2.5', 'NaN', 'Infinity']) {
      poke(bad)
      expect(settings.concurrencyLimit()).toBe(DEFAULT_CONCURRENCY_LIMIT)
    }
  })

  it('1 미만이거나 정수가 아니면 저장을 거부한다', () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => settings.setConcurrencyLimit(bad)).toThrow(/1 이상의 정수/)
    }
    expect(settings.concurrencyLimit()).toBe(DEFAULT_CONCURRENCY_LIMIT)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run core/db/repositories/setting.test.ts`
Expected: FAIL — `Cannot find module './setting'`

- [ ] **Step 3: 구현**

```ts
// core/db/repositories/setting.ts
import { eq } from 'drizzle-orm'
import type { Database } from '../open'
import { appSetting } from '../schema'

/** 동시 실행 상한을 담는 키 */
export const CONCURRENCY_LIMIT_KEY = 'run.concurrencyLimit'

/** 설계 §6이 정한 기본 상한 */
export const DEFAULT_CONCURRENCY_LIMIT = 3

/** 1 이상의 정수만 상한으로 받는다. */
function isValidLimit(n: number): boolean {
  return Number.isInteger(n) && n >= 1
}

export function createSettingRepository(db: Database) {
  return {
    /**
     * 저장된 동시 실행 상한.
     * 값이 없거나 망가졌으면 기본값으로 떨어진다 — 상한이 0이나 NaN이 되면
     * 큐가 아무것도 시작하지 않고 조용히 멈춘다.
     */
    concurrencyLimit(): number {
      const row = db.select().from(appSetting)
        .where(eq(appSetting.key, CONCURRENCY_LIMIT_KEY)).get()
      if (!row) return DEFAULT_CONCURRENCY_LIMIT
      const n = Number(row.value)
      return isValidLimit(n) ? n : DEFAULT_CONCURRENCY_LIMIT
    },

    setConcurrencyLimit(n: number): number {
      if (!isValidLimit(n)) {
        throw new Error(`동시 실행 상한은 1 이상의 정수여야 합니다: ${n}`)
      }
      const value = String(n)
      db.insert(appSetting).values({ key: CONCURRENCY_LIMIT_KEY, value })
        .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run()
      return n
    }
  }
}

export type SettingRepository = ReturnType<typeof createSettingRepository>
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run core/db/repositories/setting.test.ts`
Expected: PASS (5개)

- [ ] **Step 5: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/db/repositories/setting.ts core/db/repositories/setting.test.ts
git commit -m "feat: store the concurrency limit in app settings"
```

Expected: `pnpm test` 152개 (147 + 5)

---

## Task 3: 재시작 복구를 두 상태로 나눈다

`reapStale()`은 **이미 존재하고 `createCore`가 이미 부르고 있다.** 지금은 `running`과 `pending`을 모두 `interrupted`로 넘긴다. 시작도 못 한 run은 "중단"이 아니므로 `canceled`로 나눈다.

**Files:**
- Modify: `core/db/repositories/run.ts`, `core/db/repositories/run.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `reapStale(): number` — 시그니처는 그대로, 동작만 나뉜다

- [ ] **Step 1: 기존 테스트를 새 동작으로 바꾼다**

`core/db/repositories/run.test.ts`의 `앱 재시작 시 running/pending을 interrupted로 정리한다` 블록을 통째로 아래로 교체한다.

```ts
  it('앱 재시작 시 running은 interrupted로, pending은 canceled로 정리한다', () => {
    const a = runs.create(baseInput())
    runs.markStarted(a.id)
    const b = runs.create(baseInput())

    expect(runs.reapStale()).toBe(2)

    const reaped = runs.get(a.id)
    expect(reaped.status).toBe('interrupted')
    expect(reaped.endedAt).toBeTypeOf('number')
    expect(reaped.errorMessage).toMatch(/중단/)

    // 시작도 못 한 run은 "중단"이 아니다. 그리고 여기서 자동으로 시작하지 않는다 —
    // 앱을 여는 행위가 agent 실행을 불러서는 안 된다.
    const dropped = runs.get(b.id)
    expect(dropped.status).toBe('canceled')
    expect(dropped.endedAt).toBeTypeOf('number')
    expect(dropped.errorMessage).toMatch(/대기/)

    // 복구 후에는 시작을 기다리는 run이 하나도 없다. 대기 큐는 메모리에만 있으므로
    // 여기서 pending이 남으면 영영 시작되지 않는 유령이 된다.
    const alive = runs.list(workspaceId).filter(
      (r) => r.status === 'pending' || r.status === 'running'
    )
    expect(alive).toHaveLength(0)
  })

  it('정리할 것이 없으면 0을 돌려주고 끝난 run은 건드리지 않는다', () => {
    const done = runs.create(baseInput())
    runs.markStarted(done.id)
    runs.markFinished(done.id, {
      status: 'succeeded', resultText: '끝남', externalSessionId: null,
      needsAnswer: false, exitCode: 0, errorMessage: null
    })
    const before = runs.get(done.id)

    expect(runs.reapStale()).toBe(0)

    expect(runs.get(done.id).status).toBe('succeeded')
    expect(runs.get(done.id).endedAt).toBe(before.endedAt)
  })
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run core/db/repositories/run.test.ts`
Expected: FAIL — pending인 `b`가 `interrupted`인데 `canceled`를 기대한다

- [ ] **Step 3: 구현**

`core/db/repositories/run.ts`의 `reapStale`을 아래로 교체한다.

```ts
    /**
     * 앱 시작 시 유령 run을 정리한다 (설계 §11).
     *
     * running은 실행 중 끊긴 것이므로 interrupted다.
     * pending은 시작도 못 한 것이므로 canceled다 — 대기 큐는 메모리에만 있어
     * 재시작하면 어차피 사라지고, 여기서 자동으로 다시 시작하지도 않는다.
     * 앱을 여는 행위가 agent 실행을 부르면 안 되고(전체 설계 §14의 자율 실행),
     * 조립된 프롬프트도 그 사이 낡았을 수 있다.
     */
    reapStale(): number {
      const stale = db.select({ id: run.id, status: run.status }).from(run)
        .where(inArray(run.status, ['running', 'pending'])).all()
      if (stale.length === 0) return 0

      const wasRunning = stale.filter((s) => s.status === 'running').map((s) => s.id)
      const wasPending = stale.filter((s) => s.status === 'pending').map((s) => s.id)
      const endedAt = Date.now()

      db.transaction((tx: Runner) => {
        if (wasRunning.length > 0) {
          tx.update(run).set({
            status: 'interrupted',
            endedAt,
            errorMessage: '앱이 종료되어 중단되었습니다.'
          }).where(inArray(run.id, wasRunning)).run()
        }
        if (wasPending.length > 0) {
          tx.update(run).set({
            status: 'canceled',
            endedAt,
            errorMessage: '앱이 종료되어 대기 중이던 실행이 취소되었습니다.'
          }).where(inArray(run.id, wasPending)).run()
        }
      })
      return stale.length
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run core/db/repositories/run.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/db/repositories/run.ts core/db/repositories/run.test.ts
git commit -m "fix: cancel queued runs instead of marking them interrupted"
```

Expected: `pnpm test` 153개 (152 + 1)

---

## Task 4: `ExecutionService`를 큐 위에 올린다

이 태스크가 슬롯 회계를 진짜로 만든다. 누수 한 번이면 상한이 영구히 줄어든다.

**Files:**
- Modify: `core/execution.ts`, `core/execution.test.ts`, `core/runner/manager.ts`

**Interfaces:**
- Consumes: `RunQueue` (Task 1)
- Produces: `ExecutionOptions`에 `queue: RunQueue` 추가
- Produces: `cancel(runId: string): void` — 대기 중이면 큐에서 빼고 `canceled`로, 아니면 `manager.cancel`

- [ ] **Step 1: `manager.ts`의 "한 번에 하나" 제약을 좁힌다**

`core/runner/manager.ts`의 `start` 첫 세 줄을 교체한다.

```ts
  async function start(spec: StartSpec): Promise<RunOutcome> {
    // 동시 실행 상한은 RunQueue가 본다. 여기 남은 것은 같은 run을 두 번 띄우지
    // 않는다는 방어선뿐이다 — 두 번 띄우면 로그 파일 하나에 두 프로세스가 쓴다.
    if (active.has(spec.runId)) {
      throw new Error(`이미 실행 중인 run입니다: ${spec.runId}`)
    }
```

- [ ] **Step 2: 실패하는 테스트 작성**

`core/execution.test.ts`의 `setup` 함수를 큐를 받을 수 있게 바꾼다. 시그니처를 아래로 교체한다.

```ts
function setup(
  preflight?: () => Promise<PreflightResult>,
  managerOverride?: RunManager,
  limit = 3
) {
```

`const manager = managerOverride ?? createRunManager({...})` 아래에 큐 생성을 넣는다.

```ts
  const queue = createRunQueue({ limit })
```

`createExecutionService({...})` 호출에 `queue`를 더하고, 반환 객체에도 `queue`를 더한다.

```ts
  const service = createExecutionService({
    db, runs, manager, queue,
    resolveExecutable: preflight ?? (async () => ({ ok: true, executable: process.execPath })),
    onRunUpdate: (run) => updates.push(run),
    extraArgs: [FAKE, '--scenario', 'success']
  })
  return { db, service, runs, queue, updates, workspaceId, repoId, issueId, logDir }
```

import를 추가한다.

```ts
import { createRunQueue } from './runner/queue'
```

기존 테스트 `이미 실행 중일 때 시작하면 run이 running으로 방치되지 않고 failed로 끝난다`는 큐가 생기면서 의미가 사라진다 — 두 번째 run은 이제 실패하지 않고 대기한다. 그 블록을 삭제하고 아래 네 개를 `describe('ExecutionService')` 안 맨 끝에 넣는다.

```ts
  it('상한을 넘으면 두 번째 run이 pending으로 대기한다', async () => {
    const local = setup(undefined, undefined, 1)
    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫째', context: []
    })
    const second = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '둘째', context: []
    })

    expect(first.status).toBe('running')
    expect(second.status).toBe('pending')
    expect(second.startedAt).toBeNull()
    expect(local.queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 1 })

    // 앞이 끝나면 뒤가 시작해서 끝난다.
    await vi.waitFor(() => expect(local.runs.get(second.id).status).toBe('succeeded'))
    expect(local.runs.get(first.id).status).toBe('succeeded')
    expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('run이 끝날 때마다 슬롯을 돌려준다', async () => {
    // 한 번이라도 빠뜨리면 상한이 영구히 줄고, 증상은
    // "언젠가부터 N개까지만 돈다"라서 원인을 찾기 어렵다.
    for (let i = 0; i < 3; i += 1) {
      const run = await startBase()
      await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
    }
    expect(ctx.queue.snapshot()).toEqual({ running: 0, limit: 3, waiting: 0 })
  })

  it('preflight가 실패하면 슬롯을 쓰지 않는다', async () => {
    const local = setup(async () => ({ ok: false, reason: 'claude를 찾을 수 없습니다' }), undefined, 1)
    const run = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: 'x', context: []
    })
    expect(run.status).toBe('failed')
    expect(local.queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('대기 중인 run을 취소하면 canceled로 끝나고 다음이 시작한다', async () => {
    const local = setup(undefined, undefined, 1)
    const first = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '첫째', context: []
    })
    const waiting = await local.service.start({
      workspaceId: local.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '대기', context: []
    })
    expect(waiting.status).toBe('pending')

    local.service.cancel(waiting.id)

    expect(local.runs.get(waiting.id).status).toBe('canceled')
    // 슬롯을 쥔 적이 없으므로 돌려줄 것도 없다.
    expect(local.queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 0 })
    await vi.waitFor(() => expect(local.runs.get(first.id).status).toBe('succeeded'))
    rmSync(local.logDir, { recursive: true, force: true })
  })
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run core/execution.test.ts`
Expected: FAIL — `createExecutionService`가 `queue`를 모르고, 두 번째 run이 대기하지 않는다

- [ ] **Step 4: 구현**

`core/execution.ts`를 아래로 교체한다. `collectContext`와 `assertFound`는 그대로 둔다.

```ts
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from './db/open'
import { issue, memo, repo } from './db/schema'
import { assemblePrompt } from './context/assemble'
import type { FinishRunInput, RunRepository } from './db/repositories/run'
import type { RunManager } from './runner/manager'
import type { RunQueue } from './runner/queue'
import type { PreflightResult } from './runner/types'
import type { AgentKind, Run, StartRunInput } from '@shared/models'

export interface ExecutionOptions {
  db: Database
  runs: RunRepository
  manager: RunManager
  /** 전역 동시 실행 상한과 대기열 */
  queue: RunQueue
  resolveExecutable: (agentKind: AgentKind, workspaceId: string) => Promise<PreflightResult>
  /** run 행이 바뀔 때마다 불린다. 시작 이후의 상태 변화는 이 경로로만 알 수 있다. */
  onRunUpdate?: (run: Run) => void
  /** 테스트에서 가짜 CLI를 주입하는 통로 */
  extraArgs?: string[]
}

export function createExecutionService(opts: ExecutionOptions) {
  function notify(run: Run): Run {
    opts.onRunUpdate?.(run)
    return run
  }

  /**
   * 종료를 기록하고 슬롯을 돌려준다.
   *
   * 기록에 실패해도 release는 반드시 부른다 — run 행이 사라진 경우(workspace 삭제)
   * 여기서 던지면 슬롯이 영구히 줄어든다.
   */
  function finish(runId: string, input: FinishRunInput): void {
    try {
      notify(opts.runs.markFinished(runId, input))
    } catch {
      // 기록할 곳이 없다. 슬롯만 돌려주고 넘어간다.
    } finally {
      opts.queue.release(runId)
    }
  }

  /** 슬롯을 얻은 run을 실제로 띄운다. 큐가 부른다. */
  function beginRun(runId: string, spec: {
    agentKind: AgentKind
    cwd: string
    model: string | null
    permission: Run['permission']
    prompt: string
    executable: string
    timeoutMs: number | null
  }): void {
    try {
      notify(opts.runs.markStarted(runId))
    } catch {
      // 유령 run — 대기 중에 workspace가 지워져 행이 cascade로 사라졌다.
      // 던지면 큐가 그대로 멈춘다. 슬롯만 돌려주고 다음으로 넘어간다.
      opts.queue.release(runId)
      return
    }

    // 여기서 await하지 않는다. 종료 처리는 아래 체인이 맡는다.
    void opts.manager.start({
      runId,
      agentKind: spec.agentKind,
      cwd: spec.cwd,
      model: spec.model,
      permission: spec.permission,
      prompt: spec.prompt,
      resumeSessionId: null,
      executable: spec.executable,
      timeoutMs: spec.timeoutMs,
      ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {})
    }).then(
      (outcome) => finish(runId, {
        status: outcome.status,
        resultText: outcome.resultText,
        externalSessionId: outcome.externalSessionId,
        needsAnswer: outcome.needsAnswer,
        exitCode: outcome.exitCode,
        errorMessage: outcome.errorMessage
      }),
      // spawn 거부를 여기서 잡지 않으면 run이 영원히 running으로 남는다.
      (err: unknown) => finish(runId, {
        status: 'failed',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    )
  }

  /**
   * 실행을 등록하고 **완료를 기다리지 않고** 돌아온다.
   *
   * 슬롯이 있으면 running run을, 상한에 걸리면 pending run을 돌려준다.
   * 어느 쪽이든 종료까지 기다리지 않는다 — 기다리면 IPC 한 번이 몇 분씩 막히고,
   * 그동안 렌더러는 run의 id를 모르므로 도크에 탭을 만들 수도 취소 버튼을
   * 붙일 수도 없다(설계 §9). 완료는 onRunUpdate로 알린다.
   */
  async function start(input: StartRunInput): Promise<Run> {
    const { repos, issues, memos } = collectContext(opts.db, input)

    const assembled = assemblePrompt({
      repos, issues, memos, userPrompt: input.userPrompt
    })

    // 로그 경로가 run id를 포함하므로 id를 먼저 정한다.
    // 경로 계산은 manager가 단일 출처다 — 여기서 따로 조립하면 어긋난다.
    const runId = randomUUID()
    const logPath = opts.manager.logPathFor(runId)

    const created = opts.runs.create({
      id: runId,
      workspaceId: input.workspaceId,
      agentKind: input.agentKind,
      model: input.model ?? null,
      cwd: input.cwd,
      permission: input.permission,
      userPrompt: input.userPrompt,
      assembledPrompt: assembled,
      logPath,
      context: input.context,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      timeoutMs: input.timeoutMs ?? null
    })
    notify(created)

    // preflight는 큐에 넣기 전에 본다. 실행 파일이 없는 run이 슬롯을 잡았다
    // 놓는 낭비가 없고, "preflight 실패는 startedAt이 null"이라는 성질도 남는다.
    const preflight = await opts.resolveExecutable(input.agentKind, input.workspaceId)
    if (!preflight.ok || !preflight.executable) {
      return notify(opts.runs.markFinished(created.id, {
        status: 'failed',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: preflight.reason ?? '실행 파일을 찾을 수 없습니다.'
      }))
    }

    const executable = preflight.executable
    opts.queue.enqueue(created.id, () => beginRun(created.id, {
      agentKind: input.agentKind,
      cwd: input.cwd,
      model: input.model ?? null,
      permission: input.permission,
      prompt: assembled,
      executable,
      timeoutMs: input.timeoutMs ?? null
    }))

    // 슬롯이 있었으면 beginRun이 동기로 끝나 running이고, 없었으면 pending이다.
    return opts.runs.get(created.id)
  }

  /**
   * 대기 중이면 큐에서 빼고 canceled로 끝낸다. 실행 중이면 프로세스를 죽인다.
   *
   * manager는 프로세스가 있는 run만 안다 — 대기 중인 run을 manager.cancel에
   * 넘기면 아무 일도 일어나지 않고 사용자는 취소가 안 된다고 느낀다.
   */
  function cancel(runId: string): void {
    if (opts.queue.remove(runId)) {
      // 슬롯을 쥔 적이 없으므로 돌려줄 것도 없다.
      notify(opts.runs.markFinished(runId, {
        status: 'canceled',
        resultText: null,
        externalSessionId: null,
        needsAnswer: false,
        exitCode: null,
        errorMessage: null
      }))
      return
    }
    opts.manager.cancel(runId)
  }

  return { start, cancel }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run core/execution.test.ts`
Expected: PASS (11개 — 기존 8개에서 하나 지우고 넷 추가)

- [ ] **Step 6: 슬롯 누수 테스트가 실제로 무는지 확인**

`execution.ts`의 `finish`에서 `finally { opts.queue.release(runId) }`를 `finally {}`로 잠시 바꾼다.

Run: `pnpm vitest run core/execution.test.ts`
Expected: `run이 끝날 때마다 슬롯을 돌려준다`와 `상한을 넘으면…`이 **실패**한다.

원래대로 되돌리고 `git diff core/execution.ts`로 확인한 뒤 통과를 다시 본다.

- [ ] **Step 7: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/execution.ts core/execution.test.ts core/runner/manager.ts
git commit -m "feat: run the execution service on top of the queue"
```

Expected: `pnpm test` 156개 (153 - 1 + 4)

---

## Task 5: core 배선과 큐 이벤트

**Files:**
- Modify: `core/index.ts`

**Interfaces:**
- Consumes: `createRunQueue` (Task 1), `createSettingRepository` (Task 2)
- Produces: `core.queue` = `{ snapshot(): QueueSnapshot; setLimit(n: number): QueueSnapshot }`
- Produces: `core.onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): () => void`

- [ ] **Step 1: import와 상수 추가**

`core/index.ts`에 추가한다.

```ts
import { createSettingRepository } from './db/repositories/setting'
import { createRunQueue } from './runner/queue'
import type { AgentKind, QueueSnapshot, Run } from '@shared/models'
```

기존 `import type { AgentKind, Run } from '@shared/models'` 줄은 위 줄로 대체된다.

이벤트 이름 상수 옆에 하나 더한다.

```ts
const QUEUE_UPDATE = 'queue-update'
```

- [ ] **Step 2: 설정과 큐를 만든다**

`const emitter = new EventEmitter()` 아래, `createRunManager` 위에 넣는다.

```ts
  const settings = createSettingRepository(db)
  const queue = createRunQueue({
    limit: settings.concurrencyLimit(),
    onChange: (snapshot) => emitter.emit(QUEUE_UPDATE, snapshot)
  })
```

`createExecutionService({...})` 호출에 `queue`를 더한다.

```ts
  const execution = createExecutionService({
    db,
    runs,
    manager,
    queue,
    resolveExecutable: async (agentKind, workspaceId) => {
      const ws = workspaces.list().find((w) => w.id === workspaceId) ?? null
      return adapters[agentKind].preflight(resolveAgentPath(agentKind, ws))
    },
    onRunUpdate: (run) => emitter.emit(RUN_UPDATE, run)
  })
```

- [ ] **Step 3: 반환 객체에 큐를 노출한다**

`runs,` `execution,` 아래에 넣는다.

```ts
    /** 전역 실행 슬롯. workspace와 무관하다 (설계 §6 — 제약의 근거가 머신 자원이다). */
    queue: {
      snapshot: (): QueueSnapshot => queue.snapshot(),

      /** 상한을 바꾸고 저장한다. 검증은 setting 저장소가 하므로 잘못된 값은 여기서 던진다. */
      setLimit(n: number): QueueSnapshot {
        settings.setConcurrencyLimit(n)
        queue.setLimit(n)
        return queue.snapshot()
      }
    },
```

`onRunUpdate` 아래에 구독을 더한다.

```ts
    /** 큐가 바뀔 때마다 새 스냅샷을 준다. run 하나 단위인 onRunUpdate로는 표현되지 않는다. */
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): () => void {
      emitter.on(QUEUE_UPDATE, cb)
      return () => { emitter.off(QUEUE_UPDATE, cb) }
    },
```

- [ ] **Step 4: 타입과 린트 확인**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 통과, `pnpm test` 156개 유지

- [ ] **Step 5: 커밋**

```bash
git add core/index.ts
git commit -m "feat: expose the run queue from core"
```

---

## Task 6: IPC · preload · client 배선

**Files:**
- Modify: `shared/channels.ts`, `shared/client.ts`, `electron/ipc/runs.ts`, `electron/preload.ts`

**Interfaces:**
- Consumes: `core.queue`, `core.onQueueUpdate` (Task 5)
- Produces: `client.runs.queueSnapshot()`, `client.runs.setConcurrencyLimit(n)`, `client.events.onQueueUpdate(cb)`

- [ ] **Step 1: 채널 추가**

`shared/channels.ts`의 `CHANNELS`에서 `runsReadLog` 줄 뒤에 더한다.

```ts
  runsReadLog: 'runs:readLog',
  runsQueueSnapshot: 'runs:queueSnapshot',
  runsSetConcurrencyLimit: 'runs:setConcurrencyLimit'
```

`EVENT_CHANNELS`에 더한다.

```ts
export const EVENT_CHANNELS = {
  runEvent: 'event:run',
  runUpdate: 'event:runUpdate',
  queueUpdate: 'event:queueUpdate'
} as const
```

- [ ] **Step 2: 클라이언트 인터페이스 갱신**

`shared/client.ts`의 `runs` 블록을 아래로 교체한다. **기존 `start` 주석이 이제 부정확하다** — 큐에 걸리면 `pending`이 돌아온다.

```ts
  runs: {
    list(workspaceId: string): Promise<Run[]>
    /**
     * 완료를 기다리지 않는다. 슬롯이 있으면 running, 상한에 걸리면 pending run이
     * 곧바로 돌아온다. 이후 상태 변화는 events.onRunUpdate로만 알 수 있다.
     */
    start(input: StartRunInput): Promise<Run>
    cancel(runId: string): Promise<void>
    readLog(runId: string): Promise<RunEvent[]>
    /** 전역 실행 슬롯 현황. workspace와 무관하다. */
    queueSnapshot(): Promise<QueueSnapshot>
    setConcurrencyLimit(n: number): Promise<QueueSnapshot>
  }
  events: {
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe
    onRunUpdate(cb: (run: Run) => void): Unsubscribe
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe
  }
```

파일 위쪽 타입 import에 `QueueSnapshot`을 더한다.

- [ ] **Step 3: IPC 핸들러 추가**

`electron/ipc/runs.ts`의 `runsReadLog` 줄 아래에 더한다.

```ts
  ipcMain.handle(CHANNELS.runsQueueSnapshot, () => core.queue.snapshot())
  ipcMain.handle(CHANNELS.runsSetConcurrencyLimit, (_e, n: number) => core.queue.setLimit(n))
```

이벤트 중계에 하나 더한다.

```ts
  core.onQueueUpdate((snapshot) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.queueUpdate, snapshot)
  })
```

- [ ] **Step 4: preload 배선**

`electron/preload.ts`의 `runs` 블록에 두 줄을 더한다.

```ts
  runs: {
    list: (workspaceId) => call<Run[]>(CHANNELS.runsList, workspaceId),
    start: (input) => call<Run>(CHANNELS.runsStart, input),
    cancel: (runId) => call<void>(CHANNELS.runsCancel, runId),
    readLog: (runId) => call<RunEvent[]>(CHANNELS.runsReadLog, runId),
    queueSnapshot: () => call<QueueSnapshot>(CHANNELS.runsQueueSnapshot),
    setConcurrencyLimit: (n) => call<QueueSnapshot>(CHANNELS.runsSetConcurrencyLimit, n)
  },
```

`events` 블록에 더한다.

```ts
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe {
      const listener = (_e: IpcRendererEvent, snapshot: QueueSnapshot) => cb(snapshot)
      ipcRenderer.on(EVENT_CHANNELS.queueUpdate, listener)
      return () => { ipcRenderer.off(EVENT_CHANNELS.queueUpdate, listener) }
    }
```

타입 import에 `QueueSnapshot`을 더한다.

- [ ] **Step 5: 타입과 린트 확인**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 통과, 156개 유지

- [ ] **Step 6: 커밋**

```bash
git add shared/channels.ts shared/client.ts electron/ipc/runs.ts electron/preload.ts
git commit -m "feat: wire the queue snapshot through ipc"
```

---

## Task 7: 슬롯 표시기와 대기 중 취소

**Files:**
- Create: `renderer/hooks/useQueue.ts`, `renderer/components/SlotIndicator.tsx`, `renderer/components/SlotIndicator.test.tsx`
- Modify: `renderer/App.tsx`, `renderer/components/Dock.tsx`, `renderer/components/Dock.test.tsx`, `renderer/index.css`

**Interfaces:**
- Consumes: `client.runs.queueSnapshot/setConcurrencyLimit`, `client.events.onQueueUpdate` (Task 6)
- Produces: `useQueue(): { snapshot: QueueSnapshot | null; error: string | null }`
- Produces: `<SlotIndicator snapshot={…} />`

- [ ] **Step 1: `useQueue` 훅**

```ts
// renderer/hooks/useQueue.ts
import { useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { QueueSnapshot } from '@shared/models'

/**
 * 전역 실행 슬롯 현황. workspace와 무관하다.
 * 초기 1회 조회한 뒤 push로만 갱신된다 — 큐는 run 하나 단위가 아니라서
 * onRunUpdate로는 표현되지 않는다.
 */
export function useQueue() {
  const client = useClient()
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    client.runs.queueSnapshot().then(
      (s) => { if (alive) setSnapshot(s) },
      (err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) }
    )
    return () => { alive = false }
  }, [client])

  useEffect(() => client.events.onQueueUpdate(setSnapshot), [client])

  return { snapshot, error }
}
```

- [ ] **Step 2: 실패하는 테스트 작성 — 표시기**

```tsx
// renderer/components/SlotIndicator.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlotIndicator } from './SlotIndicator'

describe('SlotIndicator', () => {
  it('실행 중인 수와 상한을 보여준다', () => {
    render(<SlotIndicator snapshot={{ running: 2, limit: 3, waiting: 0 }} onChangeLimit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /실행 슬롯/ })).toHaveTextContent('2/3')
  })

  it('대기가 있을 때만 대기 수를 보여준다', () => {
    const { rerender } = render(
      <SlotIndicator snapshot={{ running: 3, limit: 3, waiting: 0 }} onChangeLimit={vi.fn()} />
    )
    expect(screen.queryByText(/대기/)).toBeNull()
    rerender(<SlotIndicator snapshot={{ running: 3, limit: 3, waiting: 2 }} onChangeLimit={vi.fn()} />)
    expect(screen.getByText(/대기 2/)).toBeInTheDocument()
  })

  it('상한을 넘긴 상태를 감추지 않는다', () => {
    // 상한을 낮추면 돌던 것은 그대로 두므로 running > limit이 될 수 있다.
    // 감추면 왜 새 run이 안 뜨는지 알 수 없다.
    render(<SlotIndicator snapshot={{ running: 4, limit: 3, waiting: 1 }} onChangeLimit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /실행 슬롯/ })).toHaveTextContent('4/3')
  })

  it('눌러서 상한을 바꾸면 새 값으로 알린다', async () => {
    const onChangeLimit = vi.fn()
    render(<SlotIndicator snapshot={{ running: 0, limit: 3, waiting: 0 }} onChangeLimit={onChangeLimit} />)
    await userEvent.click(screen.getByRole('button', { name: /실행 슬롯/ }))
    const input = screen.getByLabelText('동시 실행 상한')
    await userEvent.clear(input)
    await userEvent.type(input, '1{Enter}')
    expect(onChangeLimit).toHaveBeenCalledWith(1)
  })

  it('스냅샷이 아직 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<SlotIndicator snapshot={null} onChangeLimit={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run renderer/components/SlotIndicator.test.tsx`
Expected: FAIL — `Cannot find module './SlotIndicator'`

- [ ] **Step 4: 표시기 구현**

```tsx
// renderer/components/SlotIndicator.tsx
import { useState, type KeyboardEvent } from 'react'
import type { QueueSnapshot } from '@shared/models'

/**
 * 전역 실행 슬롯 표시기.
 *
 * 상한은 앱 전역인데 도크는 workspace별이라, 다른 workspace가 슬롯을 쥐고 있으면
 * 내 run이 왜 대기하는지 화면 어디에도 드러나지 않는다. 이 한 줄이 그 공백을 메운다.
 */
export function SlotIndicator({ snapshot, onChangeLimit }: {
  snapshot: QueueSnapshot | null
  onChangeLimit: (n: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!snapshot) return null

  function open() {
    setDraft(String(snapshot!.limit))
    setEditing(true)
  }

  function commit() {
    const n = Number(draft)
    setEditing(false)
    if (Number.isInteger(n) && n >= 1 && n !== snapshot!.limit) onChangeLimit(n)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <span className="dock-slots">
      <button
        type="button"
        className="dock-slots-button"
        aria-label="실행 슬롯"
        onClick={open}
      >
        실행 중 {snapshot.running}/{snapshot.limit}
      </button>
      {/* 대기가 0이면 숫자만 늘어나 눈에 걸린다. 있을 때만 보인다. */}
      {snapshot.waiting > 0 && <span className="dock-slots-waiting">· 대기 {snapshot.waiting}</span>}
      {editing && (
        <input
          className="dock-slots-input"
          type="number"
          min={1}
          aria-label="동시 실행 상한"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      )}
    </span>
  )
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run renderer/components/SlotIndicator.test.tsx`
Expected: PASS (5개)

- [ ] **Step 6: 도크에 배치하고 pending도 취소 가능하게**

`renderer/components/Dock.tsx`의 props에 두 개를 더한다.

```tsx
export function Dock({ runs, error, workspaceId, repos, reposError, queue, onChangeLimit, chips, onRemoveChip, onRunStarted }: {
  runs: Run[]
  error: string | null
  workspaceId: string
  repos: Repo[]
  reposError: string | null
  queue: QueueSnapshot | null
  onChangeLimit: (n: number) => void
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onRunStarted: (run: Run) => void
}) {
```

import를 더한다.

```tsx
import { SlotIndicator } from './SlotIndicator'
import type { QueueSnapshot, Repo, Run } from '@shared/models'
```

`dock-toggle` 버튼 바로 뒤에 표시기를 넣는다.

```tsx
        <button type="button" className="dock-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▴'} 실행
        </button>
        <SlotIndicator snapshot={queue} onChangeLimit={onChangeLimit} />
```

취소 버튼 조건을 넓힌다.

```tsx
        {/* 대기 중인 run도 취소할 수 있어야 한다 — 프로세스가 없을 뿐 사용자에겐 똑같이 걸려 있다. */}
        {view === 'log' && (selected?.status === 'running' || selected?.status === 'pending') && (
          <button type="button" className="dock-cancel" onClick={() => void cancel(selected.id)}>
            취소
          </button>
        )}
```

- [ ] **Step 7: App에서 훅을 들고 내린다**

`renderer/App.tsx`에 import와 훅을 더한다.

```tsx
import { useQueue } from './hooks/useQueue'
```

`const { runs, error: runsError } = useRuns(workspaceId)` 아래에 넣는다.

```tsx
  // 훅을 공통 부모에 둔다. RepoStrip과 RunPanel이 각자 useRepos 인스턴스를 갖는 바람에
  // repo를 등록해도 한쪽만 갱신된 사고가 있었다(커밋 fbcd0e6).
  const { snapshot: queue } = useQueue()
  const client = useClient()
```

`useClient` import도 더한다.

```tsx
import { useClient } from './client/ClientProvider'
```

상한 변경 핸들러를 컴포넌트 안에 더한다.

```tsx
  function changeLimit(n: number) {
    // 결과 스냅샷은 event:queueUpdate로도 오므로 여기서 상태를 따로 쓰지 않는다.
    void client.runs.setConcurrencyLimit(n)
  }
```

`<Dock …>`에 두 props를 더한다.

```tsx
            <Dock
              runs={runs}
              error={runsError}
              workspaceId={workspaceId}
              repos={repos}
              reposError={reposError}
              queue={queue}
              onChangeLimit={changeLimit}
              chips={chips}
              onRemoveChip={toggleChip}
              onRunStarted={() => setChips([])}
            />
```

- [ ] **Step 8: `Dock.test.tsx` 배선 보정**

`Dock.test.tsx`에는 `renderDock` 헬퍼 하나만 `<Dock>`을 그린다. 그 안의 props에 두 줄을 더한다. 기존 단언의 의도는 바꾸지 않는다.

```tsx
        <Dock
          runs={runs}
          error={null}
          workspaceId="w1"
          repos={repos}
          reposError={null}
          queue={null}
          onChangeLimit={vi.fn()}
          chips={[]}
          onRemoveChip={vi.fn()}
          onRunStarted={vi.fn()}
        />
```

`queue={null}`이면 `SlotIndicator`가 아무것도 그리지 않으므로 기존 테스트의 화면이 달라지지 않는다.

같은 파일의 가짜 클라이언트에도 새 메서드를 더해야 한다 — `Dock`이 직접 부르지는 않지만 `OneDeskClient` 타입을 만족해야 한다. `runs` 블록과 `events` 블록에 각각 넣는다.

```ts
      readLog: vi.fn().mockResolvedValue([]),
      queueSnapshot: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      setConcurrencyLimit: vi.fn().mockResolvedValue({ running: 0, limit: 3, waiting: 0 }),
      ...over
    },
    events: {
      onRunEvent: vi.fn(() => () => {}),
      onRunUpdate: vi.fn(() => () => {}),
      onQueueUpdate: vi.fn(() => () => {})
    }
```

`as unknown as OneDeskClient` 캐스팅이 있어 없어도 타입은 통과하지만, 빠진 채로 두면 다음 사람이 이 가짜를 복사해 쓸 때 조용히 `undefined`를 부른다.

- [ ] **Step 9: CSS**

`renderer/index.css`의 `.dock-cancel` 줄 근처에 더한다.

```css
.dock-slots { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dock-slots-button { border: 1px solid #e4e4e7; border-radius: 5px; background: #fff; cursor: pointer; font: inherit; font-size: 11px; padding: 3px 8px; }
.dock-slots-waiting { font-size: 11px; opacity: .6; }
.dock-slots-input { width: 52px; border: 1px solid #a1a1aa; border-radius: 5px; font: inherit; font-size: 11px; padding: 2px 4px; }
```

- [ ] **Step 10: 회귀 테스트가 무는지 확인하고 전체 통과**

`SlotIndicator.tsx`의 `{snapshot.waiting > 0 && …}`를 `{true && …}`로 잠시 바꾼다.

Run: `pnpm vitest run renderer/components/SlotIndicator.test.tsx`
Expected: `대기가 있을 때만 대기 수를 보여준다`가 **실패**한다.

되돌린 뒤:

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 161개 (156 + 5), typecheck·lint 통과

- [ ] **Step 11: 커밋**

```bash
git add renderer/
git commit -m "feat: show global run slots in the dock and allow cancelling queued runs"
```

---

## Task 8: e2e — 대기했다가 시작하는 것을 실제 앱에서 본다

**Files:**
- Create: `e2e/queue.e2e.ts`

**Interfaces:**
- Consumes: `launchApp()` (`e2e/driver.ts`)

- [ ] **Step 1: 테스트 작성**

`e2e/smoke.e2e.ts`와 같은 구조다 — `try/finally`로 앱을 닫지 않는다. 드라이버가 `onTestFinished`로 정리하며, 테스트가 먼저 닫으면 실패 스크린샷이 남지 않는다.

```ts
// e2e/queue.e2e.ts
import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const FIRST = '첫째 지시'
const SECOND = '둘째 지시'

describe('동시 실행 상한', () => {
  it('상한이 1이면 두 번째 실행이 대기했다가 앞이 끝나면 시작한다', async () => {
    const app = await launchApp()
    const page = app.page

    // 1. workspace와 repo를 만든다 — repo가 없으면 실행 버튼이 비활성이다
    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-queue')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: 'e2e-queue' })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 2. 상한을 1로 낮춘다. app_setting을 직접 건드리지 않고 UI를 거쳐야
    //    조절 화면과 저장 경로까지 같은 테스트가 덮는다.
    const slots = page.getByRole('button', { name: '실행 슬롯' })
    await slots.waitFor({ state: 'visible', timeout: 10_000 })
    await slots.click()
    const limitInput = page.getByLabel('동시 실행 상한')
    await limitInput.fill('1')
    await limitInput.press('Enter')
    await slots.getByText('실행 중 0/1').waitFor({ state: 'visible', timeout: 5_000 })

    // 3. 두 번 연달아 실행한다. 가짜 CLI가 1500ms 지연되므로 관찰할 창이 있다.
    await page.getByPlaceholder(/무엇을 시킬지/).fill(FIRST)
    await page.getByRole('button', { name: '▶ 실행' }).click()

    const runningTab = page.getByRole('button', { name: new RegExp(`running.*${FIRST}`) })
    await runningTab.waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('button', { name: '+ 새 실행' }).click()
    await page.getByPlaceholder(/무엇을 시킬지/).fill(SECOND)
    await page.getByRole('button', { name: '▶ 실행' }).click()

    // 4. 두 번째는 대기한다 — 상한이 1이므로 슬롯이 없다
    const pendingTab = page.getByRole('button', { name: new RegExp(`pending.*${SECOND}`) })
    await pendingTab.waitFor({ state: 'visible', timeout: 5_000 })
    await page.getByText('대기 1').waitFor({ state: 'visible', timeout: 5_000 })
    expect(await slots.textContent()).toContain('1/1')

    // 5. 앞이 끝나면 뒤가 시작해서 끝난다
    await page.getByRole('button', { name: new RegExp(`succeeded.*${FIRST}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: new RegExp(`succeeded.*${SECOND}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })
    expect(await slots.textContent()).toContain('0/1')
  })
})
```

- [ ] **Step 2: 실행하고 통과 확인**

Run: `pnpm test:e2e`
Expected: PASS (4개 — harness, smoke, core-loop, queue)

실패하면 `e2e/artifacts/fail-*.png`를 열어 어느 단계에서 멈췄는지 본다. 흔한 원인 둘:
- **`실행 슬롯` 버튼이 안 보인다**: `App.tsx`가 `queue`를 `Dock`에 내리지 않았거나 `queueSnapshot` IPC가 안 붙었다.
- **두 번째가 곧바로 running이 된다**: 상한 저장이 큐에 반영되지 않았다. `core.queue.setLimit`이 `queue.setLimit`을 부르는지 본다.

- [ ] **Step 3: 이 e2e가 실제로 무는지 확인**

`core/index.ts`의 `queue.setLimit(n)` 줄을 잠시 지운다(저장만 하고 큐에는 반영하지 않는 상태).

Run: `pnpm test:e2e`
Expected: **FAIL** — 두 번째 run이 대기하지 않고 곧바로 시작해 4번 단계가 타임아웃한다.

원래대로 되돌리고 `git diff core/index.ts`가 빈 것을 확인한 뒤 다시 통과를 본다.

- [ ] **Step 4: 전체 검증**

```bash
pnpm test && pnpm typecheck && pnpm lint
pnpm test:e2e
pgrep -fl "Electron.app/Contents/MacOS/Electron"
```

Expected: 161개 통과 / e2e 4개 통과 / `pgrep` 출력 없음. `/tmp/one-desk-e2e-*`도 남지 않아야 한다.

- [ ] **Step 5: 커밋**

```bash
git add e2e/queue.e2e.ts
git commit -m "test: cover the concurrency limit end to end"
```

---

## 완료 기준

- [ ] `pnpm test`가 161개다 — e2e가 섞이지 않았다
- [ ] `pnpm test:e2e`가 4개 통과한다
- [ ] `pnpm typecheck`, `pnpm lint` 통과
- [ ] 상한을 1로 낮추고 두 개를 실행하면 두 번째가 대기했다가 시작하는 것을 실제 앱에서 확인했다
- [ ] 슬롯 누수 테스트가 `release`를 지웠을 때 실제로 실패하는 것을 확인했다 (Task 4 Step 6)
- [ ] 재진입 가드를 지웠을 때 해당 테스트가 실제로 실패하는 것을 확인했다 (Task 1 Step 6)
- [ ] e2e가 `queue.setLimit`을 지웠을 때 실제로 실패하는 것을 확인했다 (Task 8 Step 3)
- [ ] 앱을 강제 종료한 뒤 다시 띄우면 `running`은 `interrupted`, `pending`은 `canceled`이고 **아무것도 자동으로 시작하지 않는다**
- [ ] 상한을 실행 중인 개수보다 낮춰도 돌던 run이 죽지 않고, 표시기가 넘긴 상태를 그대로 보여준다
- [ ] 테스트 후 Electron 프로세스와 임시 디렉토리가 남지 않는다

## 다음으로 넘기는 것

- **3b** — 인박스(`reviewed_at IS NULL` 쿼리), 사이드바 배지, 상태별 후속 행동, 세션 이어서 실행
- **5단계** — diff 뷰어와 `run_file_change`
- 큐 우선순위. FIFO만 있으며 필요해지기 전에는 만들지 않는다
- 상한의 상한. 지금은 1 이상이면 무엇이든 받는다
