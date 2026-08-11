# 3b단계 구현 계획 — 결과 인박스와 후속 행동

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "결과가 나온 줄 몰라서 확인하러 돌아다니는" 문제를 없앤다 — 지금 사용자의 손이 필요한 run만 모인 큐를 만들고, 카테고리마다 다음 수를 제시하고, 세션을 이어서 실행할 수 있게 한다.

**Architecture:** 인박스는 `reviewed_at IS NULL AND status IN (…)` 쿼리 하나다. 카테고리는 저장하지 않고 `status` + `needsAnswer`에서 파생한다. 배지 카운트는 `event:inboxUpdate`로 push한다(3a의 `event:queueUpdate` 전례). 이어서 실행은 `execution.resume`이 원본에서 잠긴 값을 채우고, 3a가 만든 큐·슬롯 회계 경로를 그대로 탄다.

**Tech Stack:** 기존과 동일 — pnpm / TypeScript 5.9.3 / Electron 43.3.0 / drizzle-orm 0.45.2 + better-sqlite3 / React / Vitest 4.1.10 / playwright-core. 새 의존성 없음. **스키마 변경 없음** — `reviewedAt`·`reviewedKind`·`parentRunId`·`externalSessionId`가 이미 있다.

**참조:**
- 설계: `docs/superpowers/specs/2026-08-11-stage3b-inbox-design.md`
- 3a 설계: `docs/superpowers/specs/2026-08-10-stage3a-run-queue-design.md`
- 앱 전체 설계 §6(이어서 실행)·§10(인박스): `docs/superpowers/specs/2026-08-07-one-desk-design.md`

## Global Constraints

- **`core/`는 `electron`을 import하지 않는다.** ESLint가 강제한다. 확인: `grep -rn "from 'electron'" core/`는 출력이 없어야 한다.
- **`renderer/`는 `core/`를 import하지 않는다.** `window.oneDesk` 참조는 `renderer/main.tsx` 한 곳뿐이다. 컴포넌트는 `useClient()`를 쓴다.
- **`e2e/`는 `@core`/`@shared`를 import하지 않는다.** ESLint가 강제한다.
- **IPC 핸들러는 얇다.** core 메서드 호출만 하고 로직을 넣지 않는다.
- **의도된 중복을 합치지 않는다.** `issue.ts`↔`memo.ts`, `useIssues.ts`↔`useMemos.ts`는 사용자가 승인한 설계 결정이다. 이 계획은 그 네 파일을 건드리지 않는다.
- **시각은 전부 epoch milliseconds 정수.** `Date.now()`로 명시 삽입한다.
- **쓰기는 트랜잭션으로 감싼다.**
- **카테고리를 컬럼으로 저장하지 않는다.** `status` + `needsAnswer`에서 파생한다 — `closedAt`을 `status`에서 파생시킨 것과 같은 이유다.
- **패키지 매니저는 pnpm이다.**
- 들여쓰기 2칸, 함수명 camelCase, 상수 UPPER_SNAKE_CASE.
- `verbatimModuleSyntax: true` — 타입 전용 import는 `import type`.
- **주석과 오류 메시지는 한국어. 커밋 메시지는 영어 명령형.**
- **`pnpm test`에 e2e가 섞이면 안 된다.** 시작 시점 175개.
- 시작 시점: `pnpm test` 175개 통과, `pnpm test:e2e` 4개 통과.

## 변이 목록 — 테스트보다 먼저 읽는다

**3a에서 배운 것이다.** 3a는 테스트 175개로 끝났지만 최종 리뷰가 실제로 코드를 되돌려 보기 전까지 핵심 약속 네 개가 전혀 지켜지지 않고 있었다. 넷 다 로직이 아니라 **배선 한 줄**이었다. 계획이 명시한 변이 세 건은 전부 물었으니, 문제는 방법이 아니라 목록이었다.

각 태스크는 아래 표에서 자기 몫을 확인하고, **그 변이를 실제로 되돌려 해당 테스트가 실패하는지 보고 되돌려 놓는다.**

| # | 되돌릴 것 | 실패해야 하는 테스트 | 태스크 |
|---|---|---|---|
| M1 | `inbox()`의 `isNull(run.reviewedAt)` | 확인함 누른 run이 목록에 남는다 | 1 |
| M2 | `INBOX_STATUSES`에서 `'canceled'` | 앱이 취소한 대기 run이 인박스에 없다 | 1 |
| M3 | `markReviewed`의 `isNull(run.reviewedAt)` 조건 | 두 번 부르면 시각이 갱신된다 | 1 |
| M4 | `inbox()`의 `desc(sql\`rowid\`)` tie-break | 같은 밀리초 항목들의 순서가 흔들린다 | 1 |
| M5 | `inboxCounts()`의 `groupBy(run.workspaceId)` | workspace별 카운트가 뭉개진다 | 1 |
| M6 | `cancel`의 대기 경로 `reviewedKind: 'archived'` 쓰기 | 사용자가 취소한 대기 run이 인박스에 뜬다 | 2 |
| M7 | `cancel`의 실행 경로 `markReviewedOnly` 호출 | 사용자가 취소한 실행 중 run이 인박스에 뜬다 | 2 |
| M8 | `resume`의 `agentKind`/`cwd`를 원본에서 가져오는 것 | 호출자가 넘긴 값이 먹힌다 | 3 |
| M9 | `resume`의 `externalSessionId` 없음 거부 | 세션 없이도 시작된다 | 3 |
| M10 | `beginRun`에 `resumeSessionId`를 넘기는 것 | resume이 새 세션으로 돈다 | 3 |
| M11 | `emitInbox()` 호출 | run이 끝나도 배지가 안 변한다 | 4 |
| M12 | `core.inbox.markReviewed`가 `emitInbox`를 부르는 것 | 확인함을 눌러도 배지가 안 줄어든다 | 4 |
| M13 | `inboxCategory`의 `needsAnswer` 분기 | 답변 필요가 완료·미확인으로 분류된다 | 6 |
| M14 | 사이드바 배지의 `byWorkspace` 조회 | 전체만 맞고 workspace별이 0이다 | 6 |
| M15 | 배지의 `count > 0` 가드 | 0인 workspace에도 배지가 붙는다 | 6 |
| M16 | `externalSessionId` 없을 때 "이어서 실행" 숨김 | 세션 없는 run에도 버튼이 뜬다 | 8 |
| M17 | "대기 중 취소됨"에서 "로그 보기" 제외 | 로그가 없는 run에 로그 버튼이 뜬다 | 8 |
| M18 | resume 모드의 `agentKind`/`cwd` 읽기 전용 | resume인데 작업 디렉토리를 바꿀 수 있다 | 7 |
| M19 | resume 모드의 권한 기본값을 원본에서 가져오는 것 | 권한이 조용히 edit으로 깎인다 | 7 |

## File Structure

```
생성:
  renderer/inbox.ts                       카테고리 파생 (순수 함수)
  renderer/inbox.test.ts
  renderer/hooks/useInbox.ts              목록·카운트 구독
  renderer/hooks/useInbox.test.tsx
  renderer/components/InboxPanel.tsx      인박스 화면과 후속 행동
  renderer/components/InboxPanel.test.tsx
  e2e/inbox.e2e.ts

수정:
  shared/models.ts                        InboxCounts, ResumeRunInput
  shared/channels.ts                      runs:inbox/inboxCounts/markReviewed/resume, event:inboxUpdate
  shared/client.ts                        위 네 메서드와 onInboxUpdate
  core/db/repositories/run.ts             inbox(), inboxCounts(), markReviewed()
  core/db/repositories/run.test.ts
  core/execution.ts                       cancel이 reviewed를 찍는다, resume, launch 공통화
  core/execution.test.ts
  core/index.ts                           inbox 그룹, emitInbox, onInboxUpdate
  core/index.test.ts
  electron/ipc/runs.ts                    핸들러 넷과 이벤트 중계
  electron/preload.ts                     메서드 다섯
  renderer/App.tsx                        view 상태, useInbox, resume 배선
  renderer/App.test.tsx
  renderer/components/Sidebar.tsx         인박스 항목과 배지
  renderer/components/Sidebar.test.tsx
  renderer/components/Dock.tsx            resumeFrom 전달
  renderer/components/Dock.test.tsx
  renderer/components/RunPanel.tsx        resume 모드
  renderer/components/RunPanel.test.tsx
  renderer/index.css                      인박스·배지 스타일
```

---

## Task 1: 인박스 쿼리와 `markReviewed`

인박스의 진실의 출처다. 나머지 전부가 이 세 메서드 위에 선다.

**Files:**
- Modify: `core/db/repositories/run.ts`, `core/db/repositories/run.test.ts`, `shared/models.ts`

**Interfaces:**
- Produces: `InboxCounts` = `{ total: number; byWorkspace: Record<string, number> }` (`shared/models.ts`)
- Produces: `inbox(): Run[]`
- Produces: `inboxCounts(): InboxCounts`
- Produces: `markReviewed(id: string, kind: 'confirmed' | 'archived'): Run`

**변이:** M1, M2, M3, M4, M5

- [ ] **Step 1: `InboxCounts` 타입 추가**

`shared/models.ts` 맨 아래, `QueueSnapshot` 옆에 붙인다.

```ts
/** 사이드바 배지가 쓰는 미처리 건수. 인박스는 모든 workspace를 가로지른다. */
export interface InboxCounts {
  total: number
  /** workspace id → 그 workspace의 미처리 건수. 0인 workspace는 키가 없다. */
  byWorkspace: Record<string, number>
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`core/db/repositories/run.test.ts`의 `describe('RunRepository')` 안 맨 끝(마지막 `})` 직전)에 넣는다.

```ts
  describe('인박스', () => {
    /** 끝난 run을 하나 만든다. 인박스 조건은 종료 상태만 본다. */
    function finished(status: 'succeeded' | 'failed' | 'interrupted' | 'canceled', extra: {
      needsAnswer?: boolean
      workspaceId?: string
    } = {}) {
      const created = runs.create({
        ...baseInput(),
        ...(extra.workspaceId ? { workspaceId: extra.workspaceId } : {})
      })
      return runs.markFinished(created.id, {
        status,
        resultText: null,
        externalSessionId: null,
        needsAnswer: extra.needsAnswer ?? false,
        exitCode: null,
        errorMessage: null
      })
    }

    it('종료된 run 중 확인하지 않은 것만 담는다', () => {
      const done = finished('succeeded')
      const failed = finished('failed')
      const stopped = finished('interrupted')
      // 앱이 재시작하며 취소한 대기 run — 사용자가 취소한 것이 아니므로 알려야 한다.
      const dropped = finished('canceled')
      // 아직 도는 중인 run은 인박스가 아니다.
      const running = runs.create(baseInput())
      runs.markStarted(running.id)

      const ids = runs.inbox().map((r) => r.id)
      expect(ids).toContain(done.id)
      expect(ids).toContain(failed.id)
      expect(ids).toContain(stopped.id)
      expect(ids).toContain(dropped.id)
      expect(ids).not.toContain(running.id)
    })

    it('확인한 run은 목록에서 빠진다', () => {
      const done = finished('succeeded')
      expect(runs.inbox().map((r) => r.id)).toContain(done.id)

      runs.markReviewed(done.id, 'confirmed')

      expect(runs.inbox().map((r) => r.id)).not.toContain(done.id)
      const after = runs.get(done.id)
      expect(after.reviewedAt).toBeTypeOf('number')
      expect(after.reviewedKind).toBe('confirmed')
    })

    it('이미 확인한 run에 다시 불러도 처음 시각을 덮어쓰지 않는다', () => {
      // 처음 확인한 때가 기록으로서 의미가 있다.
      const done = finished('succeeded')
      const first = runs.markReviewed(done.id, 'confirmed')
      const second = runs.markReviewed(done.id, 'archived')
      expect(second.reviewedAt).toBe(first.reviewedAt)
      expect(second.reviewedKind).toBe('confirmed')
    })

    it('최신 종료 순으로 정렬하고 같은 밀리초는 삽입 순의 역순으로 가른다', () => {
      // endedAt만으로는 같은 밀리초에 끝난 항목들의 순서가 흔들린다.
      const a = finished('succeeded')
      const b = finished('succeeded')
      const c = finished('succeeded')
      const listed = runs.inbox().map((r) => r.id)
      expect(listed.slice(0, 3)).toEqual([c.id, b.id, a.id])
    })

    it('전체와 workspace별 건수를 센다', () => {
      const other = createWorkspaceRepository(db).create({ name: 'ws2' }).id
      finished('succeeded')
      finished('failed')
      finished('succeeded', { workspaceId: other })

      const counts = runs.inboxCounts()
      expect(counts.total).toBe(3)
      expect(counts.byWorkspace[workspaceId]).toBe(2)
      expect(counts.byWorkspace[other]).toBe(1)
    })

    it('미처리가 없는 workspace는 키가 없다', () => {
      // 0을 키로 넣으면 배지가 0을 그리게 되고, 0이 상시 붙으면 눈이 걸러낸다.
      const other = createWorkspaceRepository(db).create({ name: 'ws2' }).id
      finished('succeeded')
      expect(runs.inboxCounts().byWorkspace[other]).toBeUndefined()
    })
  })
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run core/db/repositories/run.test.ts`
Expected: FAIL — `runs.inbox is not a function`

- [ ] **Step 4: 구현**

`core/db/repositories/run.ts`의 import 줄을 바꾼다.

```ts
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
```

`import type { Run, ContextItemRef, RunStatus, AgentKind, Permission } from '@shared/models'` 를 다음으로 바꾼다.

```ts
import type {
  Run, ContextItemRef, RunStatus, AgentKind, Permission, InboxCounts
} from '@shared/models'
```

`export function createRunRepository(db: Database) {` 바로 아래(다른 헬퍼들 위)에 상수를 둔다.

```ts
  /**
   * 인박스에 들어올 수 있는 상태 (설계 §4).
   * canceled가 들어 있는 이유: 3a부터 앱이 재시작하며 대기 중이던 run을 취소한다.
   * 사용자가 스스로 취소한 것은 execution.cancel이 reviewedAt을 찍어 제외되므로,
   * 여기 남는 canceled는 앱이 취소한 것뿐이다.
   */
  const INBOX_STATUSES: RunStatus[] = ['succeeded', 'failed', 'interrupted', 'canceled']
```

반환 객체의 `reapStale` 뒤에 세 메서드를 더한다(콤마에 주의).

```ts
    /**
     * 지금 사용자의 손이 필요한 run만 모은다 (설계 §4).
     * 모든 workspace를 가로지른다 — 어디에 쌓였는지는 사이드바 배지가 보여준다.
     */
    inbox(): Run[] {
      const rows = db.select().from(run)
        .where(and(isNull(run.reviewedAt), inArray(run.status, INBOX_STATUSES)))
        // endedAt만으로는 같은 밀리초에 끝난 항목들의 순서가 흔들린다.
        // rowid가 삽입 순서를 결정적으로 갈라준다.
        .orderBy(desc(run.endedAt), desc(sql`rowid`)).all()
      return hydrate(rows)
    },

    inboxCounts(): InboxCounts {
      const rows = db.select({ workspaceId: run.workspaceId, n: count() }).from(run)
        .where(and(isNull(run.reviewedAt), inArray(run.status, INBOX_STATUSES)))
        .groupBy(run.workspaceId).all()

      const byWorkspace: Record<string, number> = {}
      let total = 0
      for (const row of rows) {
        byWorkspace[row.workspaceId] = row.n
        total += row.n
      }
      return { total, byWorkspace }
    },

    /**
     * 인박스에서 내린다. 확인함과 보관은 reviewedKind로만 갈린다.
     *
     * 이미 확인된 run의 시각은 덮어쓰지 않는다 — 처음 확인한 때가 기록으로서
     * 의미가 있고, 나중에 컬럼을 추가해도 그 이전 기록은 복구할 수 없다.
     */
    markReviewed(id: string, kind: 'confirmed' | 'archived'): Run {
      db.update(run)
        .set({ reviewedAt: Date.now(), reviewedKind: kind })
        .where(and(eq(run.id, id), isNull(run.reviewedAt))).run()
      return get(id)
    }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run core/db/repositories/run.test.ts`
Expected: PASS

- [ ] **Step 6: 변이 M1~M5를 하나씩 되돌려 실패를 확인한다**

각각 되돌리고 `pnpm vitest run core/db/repositories/run.test.ts`를 돌린 뒤 원상복구한다. 어느 테스트가 어떻게 실패했는지 출력을 리포트에 남긴다.

| 변이 | 되돌릴 것 | 기대 |
|---|---|---|
| M1 | `inbox()`에서 `isNull(run.reviewedAt)` 제거 | `확인한 run은 목록에서 빠진다` 실패 |
| M2 | `INBOX_STATUSES`에서 `'canceled'` 제거 | `종료된 run 중 확인하지 않은 것만 담는다` 실패 |
| M3 | `markReviewed`의 `isNull(run.reviewedAt)` 제거 | `이미 확인한 run에…` 실패 |
| M4 | `inbox()`에서 `desc(sql\`rowid\`)` 제거 | `최신 종료 순으로…` 실패 |
| M5 | `inboxCounts()`에서 `.groupBy(run.workspaceId)` 제거 | `전체와 workspace별 건수를 센다` 실패 |

**M4가 실패하지 않으면** 그 테스트가 tie-break를 검증하지 못하는 것이다. 테스트를 고쳐 억지로 맞추지 말고 **관찰한 것과 함께 보고하라.**

되돌린 뒤 `git diff core/db/repositories/run.ts`가 비었는지 확인한다.

- [ ] **Step 7: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add shared/models.ts core/db/repositories/run.ts core/db/repositories/run.test.ts
git commit -m "feat: add the inbox query and review marking"
```

Expected: `pnpm test` 181개 (175 + 6)

---

## Task 2: 사용자 취소는 인박스에 뜨지 않는다

`execution.cancel`이 두 갈래인 것이 핵심이다. 둘 다 찍어야 인박스에 남는 `canceled`가 앱이 취소한 것만 남는다.

**Files:**
- Modify: `core/execution.ts`, `core/execution.test.ts`

**Interfaces:**
- Consumes: `runs.markReviewed(id, kind)`, `runs.inbox()` (Task 1)
- Produces: `cancel(runId: string): void` — 동작만 바뀌고 시그니처는 그대로

**변이:** M6, M7

- [ ] **Step 1: 실패하는 테스트 작성**

`core/execution.test.ts`의 `describe('ExecutionService')` 안 맨 끝에 넣는다.

```ts
  it('사용자가 대기 중인 run을 취소하면 인박스에 뜨지 않는다', async () => {
    // 본인이 알아서 한 일이니 이미 "확인됨"이다. 인박스에 남는 canceled는
    // 앱이 재시작하며 취소한 것뿐이어야 한다.
    const local = setup({ limit: 1 })
    await local.service.start({
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
    expect(local.runs.get(waiting.id).reviewedKind).toBe('archived')
    expect(local.runs.inbox().map((r) => r.id)).not.toContain(waiting.id)
    rmSync(local.logDir, { recursive: true, force: true })
  })

  it('사용자가 실행 중인 run을 취소하면 인박스에 뜨지 않는다', async () => {
    // 실행 경로는 SIGTERM만 보내고 종료 기록은 나중에 온다. 그 시점에 run이
    // 아직 running이지만 reviewedAt을 미리 찍어도 무해하다 — 인박스는 종료
    // 상태만 보고, markFinished는 reviewedAt을 건드리지 않는다.
    const run = await startBase()
    expect(run.status).toBe('running')

    ctx.service.cancel(run.id)

    expect(ctx.runs.get(run.id).reviewedKind).toBe('archived')
    await vi.waitFor(() => expect(ctx.runs.get(run.id).endedAt).toBeTypeOf('number'))
    expect(ctx.runs.inbox().map((r) => r.id)).not.toContain(run.id)
  })
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run core/execution.test.ts`
Expected: FAIL — `reviewedKind`가 `null`이고 두 run 모두 인박스에 남는다

- [ ] **Step 3: 구현**

`core/execution.ts`의 `cancel`을 다음으로 교체한다.

```ts
  /**
   * 대기 중이면 큐에서 빼고 canceled로 끝낸다. 실행 중이면 프로세스를 죽인다.
   *
   * manager는 프로세스가 있는 run만 안다 — 대기 중인 run을 manager.cancel에
   * 넘기면 아무 일도 일어나지 않고 사용자는 취소가 안 된다고 느낀다.
   *
   * 어느 쪽이든 **사용자가 스스로 한 일이므로 그 자리에서 확인 표시를 찍는다.**
   * 그래야 인박스에 남는 canceled가 앱이 재시작하며 취소한 것만 남고,
   * "대기 중 취소됨"이라는 이름이 정확해진다 (설계 §5).
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
      notify(opts.runs.markReviewed(runId, 'archived'))
      return
    }

    // 실행 중이다. 종료 기록은 manager의 결과가 오면 finish가 쓴다.
    // 확인 표시는 지금 찍는다 — markFinished는 reviewedAt을 건드리지 않으므로 살아남는다.
    notify(opts.runs.markReviewed(runId, 'archived'))
    opts.manager.cancel(runId)
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run core/execution.test.ts`
Expected: PASS

- [ ] **Step 5: 변이 M6·M7 확인**

| 변이 | 되돌릴 것 | 기대 |
|---|---|---|
| M6 | 대기 경로의 `markReviewed(runId, 'archived')` 제거 | `사용자가 대기 중인 run을…` 실패 |
| M7 | 실행 경로의 `markReviewed(runId, 'archived')` 제거 | `사용자가 실행 중인 run을…` 실패 |

되돌린 뒤 `git diff core/execution.ts`가 비었는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/execution.ts core/execution.test.ts
git commit -m "feat: mark user cancellations as already reviewed"
```

Expected: `pnpm test` 183개 (181 + 2)

---

## Task 3: `execution.resume`

잠금 규칙이 core에 있어야 데몬으로 뗄 때 따라간다.

**Files:**
- Modify: `shared/models.ts`, `core/execution.ts`, `core/execution.test.ts`

**Interfaces:**
- Produces: `ResumeRunInput` (`shared/models.ts`)
- Produces: `resume(input: ResumeRunInput): Promise<Run>`

**변이:** M8, M9, M10

- [ ] **Step 1: `ResumeRunInput` 타입 추가**

`shared/models.ts`의 `StartRunInput` 바로 아래에 넣는다.

```ts
/**
 * 세션을 이어받아 실행한다.
 *
 * StartRunInput에도 parentRunId가 있지만 그것은 "원본을 가리키는 기록"일 뿐
 * 세션을 이어받지 않는다. resume은 external_session_id까지 이어받는다.
 */
export interface ResumeRunInput {
  /** 이어받을 원본 run */
  parentRunId: string
  model?: string | null
  permission: Permission
  userPrompt: string
  /** 기본은 빈 배열 — 이전 대화가 이미 세션에 있다 (설계 §6) */
  context: ContextItemRef[]
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`core/execution.test.ts`의 `describe('ExecutionService')` 안 맨 끝에 넣는다.

```ts
  describe('resume', () => {
    /** 세션 id를 가진 채 끝난 run을 하나 만든다. */
    async function finishedWithSession() {
      const run = await startBase()
      await vi.waitFor(() => expect(ctx.runs.get(run.id).status).toBe('succeeded'))
      return ctx.runs.get(run.id)
    }

    it('원본의 agent와 작업 디렉토리를 그대로 쓰고 세션을 이어받는다', async () => {
      const parent = await finishedWithSession()
      expect(parent.externalSessionId).toBe('fake-session')

      const child = await ctx.service.resume({
        parentRunId: parent.id,
        permission: 'read_only',
        userPrompt: '이어서 해줘',
        context: []
      })

      // 잠긴 값 — 원본에서 온다
      expect(child.agentKind).toBe(parent.agentKind)
      expect(child.cwd).toBe(parent.cwd)
      expect(child.workspaceId).toBe(parent.workspaceId)
      expect(child.parentRunId).toBe(parent.id)
      // 바꿀 수 있는 값
      expect(child.permission).toBe('read_only')
      expect(child.userPrompt).toBe('이어서 해줘')
      await vi.waitFor(() => expect(ctx.runs.get(child.id).status).toBe('succeeded'))
    })

    it('이어받을 세션이 없으면 거부한다', async () => {
      // 실패한 run은 세션이 만들어지기 전에 죽었을 수 있다.
      const created = ctx.runs.create({
        workspaceId: ctx.workspaceId,
        agentKind: 'claude-code',
        model: null,
        cwd: process.cwd(),
        permission: 'edit',
        userPrompt: 'x',
        assembledPrompt: 'x',
        logPath: '/tmp/none/stream.jsonl',
        context: []
      })
      ctx.runs.markFinished(created.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: '죽음'
      })

      await expect(ctx.service.resume({
        parentRunId: created.id, permission: 'edit', userPrompt: 'x', context: []
      })).rejects.toThrow(/세션/)
    })

    it('원본이 없으면 거부한다', async () => {
      await expect(ctx.service.resume({
        parentRunId: '없는-id', permission: 'edit', userPrompt: 'x', context: []
      })).rejects.toThrow(/원본/)
    })

    it('manager에 원본의 세션 id를 넘긴다', async () => {
      // 이걸 안 넘기면 resume이 조용히 새 세션으로 돈다 — 화면에서는 구별되지 않는다.
      const parent = await finishedWithSession()
      const seen: (string | null)[] = []
      // setup은 옵션 객체를 받는다 (3a의 최종 수정 웨이브가 그렇게 바꿨다).
      // SetupOptions: { preflight?, manager?, limit?, wrapRuns?, onRunUpdate? }
      const spy = setup({
        manager: {
          logPathFor: (id: string) => resolve(tmpdir(), `one-desk-spy-${id}.jsonl`),
          start: async (spec) => {
            seen.push(spec.resumeSessionId)
            return {
              status: 'succeeded' as const, resultText: null, externalSessionId: null,
              needsAnswer: false, exitCode: 0, errorMessage: null, logPath: 'x'
            }
          },
          cancel: () => {},
          cancelAll: () => {},
          isRunning: () => false
        }
      })
      // 원본을 spy 쪽 DB에도 만들어야 하므로 원본 run을 그대로 옮겨 심는다.
      const seeded = spy.runs.create({
        workspaceId: spy.workspaceId,
        agentKind: parent.agentKind,
        model: null,
        cwd: parent.cwd,
        permission: parent.permission,
        userPrompt: parent.userPrompt,
        assembledPrompt: parent.assembledPrompt,
        logPath: parent.logPath,
        context: []
      })
      spy.runs.markFinished(seeded.id, {
        status: 'succeeded', resultText: null, externalSessionId: 'fake-session',
        needsAnswer: false, exitCode: 0, errorMessage: null
      })

      await spy.service.resume({
        parentRunId: seeded.id, permission: 'edit', userPrompt: '이어서', context: []
      })

      expect(seen).toEqual(['fake-session'])
      rmSync(spy.logDir, { recursive: true, force: true })
    })
  })
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run core/execution.test.ts`
Expected: FAIL — `ctx.service.resume is not a function`

- [ ] **Step 4: 공통 경로를 뽑고 `resume`을 붙인다**

`core/execution.ts`의 import에 타입을 더한다.

```ts
import type { AgentKind, ContextItemRef, Permission, ResumeRunInput, Run, StartRunInput } from '@shared/models'
```

`beginRun`의 spec 타입에 `resumeSessionId`를 더하고, `manager.start`에 넘기는 하드코딩을 바꾼다.

```ts
  /** 슬롯을 얻은 run을 실제로 띄운다. 큐가 부른다. */
  function beginRun(runId: string, spec: {
    agentKind: AgentKind
    cwd: string
    model: string | null
    permission: Permission
    prompt: string
    executable: string
    resumeSessionId: string | null
    timeoutMs: number | null
  }): void {
```

같은 함수 안에서 `resumeSessionId: null,`을 다음으로 바꾼다.

```ts
      resumeSessionId: spec.resumeSessionId,
```

`start` 전체를 아래 세 함수로 교체한다(`collectContext`와 `assertFound`는 그대로 둔다).

```ts
  /** start와 resume이 공유하는 경로. 다른 것은 채우는 값뿐이다. */
  interface LaunchSpec {
    workspaceId: string
    agentKind: AgentKind
    model: string | null
    cwd: string
    permission: Permission
    userPrompt: string
    context: ContextItemRef[]
    parentRunId: string | null
    resumeSessionId: string | null
    timeoutMs: number | null
  }

  async function launch(spec: LaunchSpec): Promise<Run> {
    const { repos, issues, memos } = collectContext(opts.db, spec)

    const assembled = assemblePrompt({
      repos, issues, memos, userPrompt: spec.userPrompt
    })

    // 로그 경로가 run id를 포함하므로 id를 먼저 정한다.
    // 경로 계산은 manager가 단일 출처다 — 여기서 따로 조립하면 어긋난다.
    const runId = randomUUID()
    const logPath = opts.manager.logPathFor(runId)

    const created = opts.runs.create({
      id: runId,
      workspaceId: spec.workspaceId,
      agentKind: spec.agentKind,
      model: spec.model,
      cwd: spec.cwd,
      permission: spec.permission,
      userPrompt: spec.userPrompt,
      assembledPrompt: assembled,
      logPath,
      context: spec.context,
      ...(spec.parentRunId ? { parentRunId: spec.parentRunId } : {}),
      timeoutMs: spec.timeoutMs
    })
    notify(created)

    // preflight는 큐에 넣기 전에 본다. 실행 파일이 없는 run이 슬롯을 잡았다
    // 놓는 낭비가 없고, "preflight 실패는 startedAt이 null"이라는 성질도 남는다.
    const preflight = await opts.resolveExecutable(spec.agentKind, spec.workspaceId)
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
      agentKind: spec.agentKind,
      cwd: spec.cwd,
      model: spec.model,
      permission: spec.permission,
      prompt: assembled,
      executable,
      resumeSessionId: spec.resumeSessionId,
      timeoutMs: spec.timeoutMs
    }))

    // 슬롯이 있었으면 beginRun이 동기로 끝나 running이고, 없었으면 pending이다.
    return opts.runs.get(created.id)
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
    return launch({
      workspaceId: input.workspaceId,
      agentKind: input.agentKind,
      model: input.model ?? null,
      cwd: input.cwd,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: input.context,
      parentRunId: input.parentRunId ?? null,
      resumeSessionId: null,
      timeoutMs: input.timeoutMs ?? null
    })
  }

  /**
   * 원본 run의 세션을 이어받아 새 run을 만든다 (설계 §6).
   *
   * **agentKind와 cwd는 잠긴다** — 세션은 특정 CLI가 특정 디렉토리에서 만든
   * 것이라 다른 조합으로 이어받을 수 없다. 그 규칙이 여기 있어야 나중에
   * core를 별도 데몬으로 뗄 때 따라간다. 호출자는 바꿀 수 있는 것만 넘긴다.
   */
  async function resume(input: ResumeRunInput): Promise<Run> {
    let parent: Run
    try {
      parent = opts.runs.get(input.parentRunId)
    } catch {
      throw new Error('이어서 실행할 원본 run이 없습니다. workspace가 지워졌을 수 있습니다.')
    }

    if (!parent.externalSessionId) {
      throw new Error('이어받을 세션이 없습니다. 새 실행으로 시작하세요.')
    }

    return launch({
      // 잠긴 값
      workspaceId: parent.workspaceId,
      agentKind: parent.agentKind,
      cwd: parent.cwd,
      resumeSessionId: parent.externalSessionId,
      parentRunId: parent.id,
      // 바꿀 수 있는 값
      model: input.model ?? null,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: input.context,
      timeoutMs: null
    })
  }
```

반환 줄을 바꾼다.

```ts
  return { start, resume, cancel }
```

`collectContext`의 시그니처를 좁힌다 — `StartRunInput` 전체가 필요하지 않고 두 필드만 쓴다.

```ts
/** 맥락 항목이 이 workspace 소속인지 확인하며 실제 데이터를 모은다. */
function collectContext(db: Database, input: { workspaceId: string; context: ContextItemRef[] }) {
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run core/execution.test.ts`
Expected: PASS

- [ ] **Step 6: 변이 M8·M9·M10 확인**

| 변이 | 되돌릴 것 | 기대 |
|---|---|---|
| M8 | `resume`의 `agentKind: parent.agentKind`를 `'opencode'`로 바꾼다 | `원본의 agent와 작업 디렉토리를…` 실패 |
| M9 | `externalSessionId` 없음 거부 블록 제거 | `이어받을 세션이 없으면 거부한다` 실패 |
| M10 | `beginRun`의 `resumeSessionId: spec.resumeSessionId`를 `null`로 | `manager에 원본의 세션 id를 넘긴다` 실패 |

되돌린 뒤 `git diff core/execution.ts`가 비었는지 확인한다.

- [ ] **Step 7: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add shared/models.ts core/execution.ts core/execution.test.ts
git commit -m "feat: resume a run from its recorded session"
```

Expected: `pnpm test` 187개 (183 + 4)

---

## Task 4: core 배선과 인박스 이벤트

**Files:**
- Modify: `core/index.ts`, `core/index.test.ts`

**Interfaces:**
- Consumes: `runs.inbox/inboxCounts/markReviewed` (Task 1), `execution.resume` (Task 3)
- Produces: `core.inbox` = `{ list(): Run[]; counts(): InboxCounts; markReviewed(runId, kind): Run }`
- Produces: `core.onInboxUpdate(cb: (counts: InboxCounts) => void): () => void`

**변이:** M11, M12

- [ ] **Step 1: 실패하는 테스트 작성**

`core/index.test.ts`의 마지막 `})` 직전에 넣는다.

`core/index.test.ts`는 이미 헬퍼 셋을 갖고 있다 — `makeDataDir()`, `open(dataDir)`, `close(core)`. `afterEach`가 열린 core를 전부 닫고 임시 디렉토리를 지우므로 **테스트가 직접 정리하지 않는다.** 그대로 쓴다.

파일 위쪽 import에 셋을 더한다.

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { InboxCounts } from '@shared/models'
```

`MIGRATIONS_DIR` 옆에 가짜 CLI 경로를 더한다.

```ts
const FAKE_AGENT = resolve(HERE, 'runner/fixtures/fake-claude.mjs')
```

`describe('createCore')` 안 맨 끝에 넣는다.

```ts
  /**
   * 실제로 프로세스를 띄우는 유일한 테스트다.
   *
   * emitInbox는 execution의 onRunUpdate 경로에 있으므로, runs.markFinished를 직접
   * 불러서는 그 경로를 지나지 않아 아무것도 검증하지 못한다. 그래서 가짜 CLI를 실제로
   * 돌린다 — resolveAgentPath가 ONE_DESK_AGENT_PATH를 먼저 보므로 그 이음매로 물린다.
   */
  it('run이 끝나면 인박스 카운트를 push한다', async () => {
    const previous = process.env['ONE_DESK_AGENT_PATH']
    process.env['ONE_DESK_AGENT_PATH'] = FAKE_AGENT
    try {
      const dataDir = makeDataDir()
      const core = open(dataDir)
      const seen: InboxCounts[] = []
      core.onInboxUpdate((counts) => seen.push(counts))

      const ws = core.workspaces.create({ name: 'ws' }).id
      const run = await core.execution.start({
        workspaceId: ws, agentKind: 'claude-code', cwd: dataDir,
        permission: 'edit', userPrompt: 'x', context: []
      })
      await vi.waitFor(() => expect(core.runs.get(run.id).endedAt).toBeTypeOf('number'))

      await vi.waitFor(() => {
        expect(seen.at(-1)?.total).toBe(1)
        expect(seen.at(-1)?.byWorkspace[ws]).toBe(1)
      })
    } finally {
      // 전역을 건드렸으니 반드시 되돌린다. 남기면 뒤 테스트가 가짜 CLI를 쓴다.
      if (previous === undefined) delete process.env['ONE_DESK_AGENT_PATH']
      else process.env['ONE_DESK_AGENT_PATH'] = previous
    }
  })

  it('확인함을 누르면 카운트가 줄어든 것을 push한다', () => {
    // 여기서는 프로세스를 띄울 필요가 없다. seedRun으로 행을 만들고 끝난 상태로
    // 바꾼 뒤, inbox.markReviewed가 스스로 push하는지만 본다.
    const dataDir = makeDataDir()
    const core = open(dataDir)
    const seeded = seedRun(core, dataDir, '확인 대상')
    core.runs.markFinished(seeded.id, {
      status: 'succeeded', resultText: null, externalSessionId: null,
      needsAnswer: false, exitCode: 0, errorMessage: null
    })
    expect(core.inbox.counts().total).toBe(1)

    const seen: InboxCounts[] = []
    core.onInboxUpdate((counts) => seen.push(counts))
    core.inbox.markReviewed(seeded.id, 'confirmed')

    expect(seen.at(-1)).toEqual({ total: 0, byWorkspace: {} })
    expect(core.inbox.list()).toHaveLength(0)
  })
```

> **주의:** 첫 테스트가 이 파일에서 **유일하게 실제 프로세스를 띄운다.** 기존 테스트들은 `seedRun`으로 행만 만들고 `logs/` 디렉토리의 부재로 "아무것도 시작하지 않았다"를 판정한다 — 그 단언을 깨지 않도록 새 테스트는 자기 `dataDir`를 따로 쓴다(`makeDataDir()`가 매번 새로 만든다).

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run core/index.test.ts`
Expected: FAIL — `core.onInboxUpdate is not a function`

- [ ] **Step 3: 구현**

`core/index.ts`의 import에 타입을 더한다.

```ts
import type { AgentKind, InboxCounts, QueueSnapshot, Run } from '@shared/models'
```

이벤트 이름 상수를 하나 더한다.

```ts
const INBOX_UPDATE = 'inbox-update'
```

`const execution = createExecutionService({...})` **아래**에 헬퍼를 둔다.

```ts
  /**
   * 인박스 소속이 바뀔 수 있는 쓰기 뒤마다 부른다.
   * 배지는 항상 보이므로 push가 필요하다 — run 하나 단위인 onRunUpdate로는
   * 전역 카운트를 표현할 수 없고, 렌더러는 현재 workspace의 run만 안다.
   */
  function emitInbox(): void {
    emitter.emit(INBOX_UPDATE, runs.inboxCounts())
  }
```

`createExecutionService`의 `onRunUpdate`를 다음으로 바꾼다.

```ts
    onRunUpdate: (run) => {
      emitter.emit(RUN_UPDATE, run)
      // 종료·취소·확인 표시가 전부 이 경로를 지난다.
      emitInbox()
    }
```

반환 객체의 `queue` 그룹 뒤에 인박스 그룹을 더한다.

```ts
    /** 지금 사용자의 손이 필요한 run. 모든 workspace를 가로지른다 (설계 §4). */
    inbox: {
      list: (): Run[] => runs.inbox(),
      counts: (): InboxCounts => runs.inboxCounts(),

      markReviewed(runId: string, kind: 'confirmed' | 'archived'): Run {
        const reviewed = runs.markReviewed(runId, kind)
        emitter.emit(RUN_UPDATE, reviewed)
        emitInbox()
        return reviewed
      }
    },
```

`onQueueUpdate` 뒤에 구독을 더한다.

```ts
    /** 인박스 건수가 바뀔 때마다 준다. 사이드바 배지가 이걸로 산다. */
    onInboxUpdate(cb: (counts: InboxCounts) => void): () => void {
      emitter.on(INBOX_UPDATE, cb)
      return () => { emitter.off(INBOX_UPDATE, cb) }
    },
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run core/index.test.ts`
Expected: PASS

- [ ] **Step 5: 변이 M11·M12 확인**

| 변이 | 되돌릴 것 | 기대 |
|---|---|---|
| M11 | `onRunUpdate`에서 `emitInbox()` 제거 | `run이 끝나면 인박스 카운트를 push한다` 실패 |
| M12 | `inbox.markReviewed`에서 `emitInbox()` 제거 | `확인함을 누르면…` 실패 |

되돌린 뒤 `git diff core/index.ts`가 비었는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/index.ts core/index.test.ts
git commit -m "feat: expose the inbox from core and push its counts"
```

Expected: `pnpm test` 189개 (187 + 2)

---

## Task 5: IPC · preload · client 배선

**Files:**
- Modify: `shared/channels.ts`, `shared/client.ts`, `electron/ipc/runs.ts`, `electron/preload.ts`

**Interfaces:**
- Consumes: `core.inbox`, `core.onInboxUpdate` (Task 4), `core.execution.resume` (Task 3)
- Produces: `client.runs.inbox/inboxCounts/markReviewed/resume`, `client.events.onInboxUpdate`

- [ ] **Step 1: 채널 추가**

`shared/channels.ts`의 `CHANNELS`에서 `runsSetConcurrencyLimit` 줄 뒤에 더한다.

```ts
  runsSetConcurrencyLimit: 'runs:setConcurrencyLimit',
  runsInbox: 'runs:inbox',
  runsInboxCounts: 'runs:inboxCounts',
  runsMarkReviewed: 'runs:markReviewed',
  runsResume: 'runs:resume'
```

`EVENT_CHANNELS`에 더한다.

```ts
export const EVENT_CHANNELS = {
  runEvent: 'event:run',
  runUpdate: 'event:runUpdate',
  queueUpdate: 'event:queueUpdate',
  inboxUpdate: 'event:inboxUpdate'
} as const
```

- [ ] **Step 2: 클라이언트 인터페이스 갱신**

`shared/client.ts`의 타입 import에 `InboxCounts`와 `ResumeRunInput`을 더하고, `runs`와 `events` 블록에 더한다.

```ts
    /** 전역 실행 슬롯 현황. workspace와 무관하다. */
    queueSnapshot(): Promise<QueueSnapshot>
    setConcurrencyLimit(n: number): Promise<QueueSnapshot>
    /** 지금 사용자의 손이 필요한 run. 모든 workspace를 가로지른다. */
    inbox(): Promise<Run[]>
    inboxCounts(): Promise<InboxCounts>
    /** 인박스에서 내린다. 확인함은 'confirmed', 보관은 'archived'. */
    markReviewed(runId: string, kind: 'confirmed' | 'archived'): Promise<Run>
    /** 원본의 세션을 이어받아 실행한다. agentKind와 cwd는 원본에서 온다. */
    resume(input: ResumeRunInput): Promise<Run>
  }
  events: {
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe
    onRunUpdate(cb: (run: Run) => void): Unsubscribe
    onQueueUpdate(cb: (snapshot: QueueSnapshot) => void): Unsubscribe
    onInboxUpdate(cb: (counts: InboxCounts) => void): Unsubscribe
  }
```

- [ ] **Step 3: IPC 핸들러 추가**

`electron/ipc/runs.ts`의 `runsSetConcurrencyLimit` 줄 아래에 더한다.

```ts
  ipcMain.handle(CHANNELS.runsInbox, () => core.inbox.list())
  ipcMain.handle(CHANNELS.runsInboxCounts, () => core.inbox.counts())
  ipcMain.handle(
    CHANNELS.runsMarkReviewed,
    (_e, runId: string, kind: 'confirmed' | 'archived') => core.inbox.markReviewed(runId, kind)
  )
  ipcMain.handle(CHANNELS.runsResume, (_e, input: ResumeRunInput) => core.execution.resume(input))
```

파일 위쪽 타입 import를 바꾼다.

```ts
import type { ResumeRunInput, StartRunInput } from '@shared/models'
```

이벤트 중계에 하나 더한다.

```ts
  core.onInboxUpdate((counts) => {
    getWindow()?.webContents.send(EVENT_CHANNELS.inboxUpdate, counts)
  })
```

- [ ] **Step 4: preload 배선**

`electron/preload.ts`의 `runs` 블록에 네 줄을 더한다.

```ts
    queueSnapshot: () => call<QueueSnapshot>(CHANNELS.runsQueueSnapshot),
    setConcurrencyLimit: (n) => call<QueueSnapshot>(CHANNELS.runsSetConcurrencyLimit, n),
    inbox: () => call<Run[]>(CHANNELS.runsInbox),
    inboxCounts: () => call<InboxCounts>(CHANNELS.runsInboxCounts),
    markReviewed: (runId, kind) => call<Run>(CHANNELS.runsMarkReviewed, runId, kind),
    resume: (input) => call<Run>(CHANNELS.runsResume, input)
  },
```

`events` 블록에 더한다.

```ts
    onInboxUpdate(cb: (counts: InboxCounts) => void): Unsubscribe {
      const listener = (_e: IpcRendererEvent, counts: InboxCounts) => cb(counts)
      ipcRenderer.on(EVENT_CHANNELS.inboxUpdate, listener)
      return () => { ipcRenderer.off(EVENT_CHANNELS.inboxUpdate, listener) }
    }
```

타입 import에 `InboxCounts`를 더한다.

- [ ] **Step 5: 확인**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 통과, 189개 유지

- [ ] **Step 6: 커밋**

```bash
git add shared/channels.ts shared/client.ts electron/ipc/runs.ts electron/preload.ts
git commit -m "feat: wire the inbox and resume through ipc"
```

---

## Task 6: 카테고리 파생과 사이드바 배지

**Files:**
- Create: `renderer/inbox.ts`, `renderer/inbox.test.ts`, `renderer/hooks/useInbox.ts`, `renderer/hooks/useInbox.test.tsx`
- Modify: `renderer/components/Sidebar.tsx`, `renderer/components/Sidebar.test.tsx`, `renderer/App.tsx`, `renderer/App.test.tsx`, `renderer/index.css`

**Interfaces:**
- Consumes: `client.runs.inbox/inboxCounts`, `client.events.onInboxUpdate` (Task 5)
- Produces: `InboxCategory` = `'needs-answer' | 'done' | 'failed' | 'interrupted' | 'dropped'`
- Produces: `inboxCategory(run: Run): InboxCategory`, `CATEGORY_LABELS: Record<InboxCategory, string>`
- Produces: `useInbox(): { items: Run[]; counts: InboxCounts; error: string | null; refresh(): Promise<void> }`

**변이:** M13, M14, M15

- [ ] **Step 1: 카테고리 테스트 작성**

```ts
// renderer/inbox.test.ts
import { describe, it, expect } from 'vitest'
import { inboxCategory, CATEGORY_LABELS } from './inbox'
import type { Run } from '@shared/models'

function run(over: Partial<Run>): Run {
  return {
    id: 'r1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp', permission: 'edit', userPrompt: 'x', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: null, parentRunId: null,
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 0, contextItems: [],
    ...over
  }
}

describe('inboxCategory', () => {
  it('needsAnswer면 답변 필요다', () => {
    expect(inboxCategory(run({ status: 'succeeded', needsAnswer: true }))).toBe('needs-answer')
  })

  it('succeeded인데 needsAnswer가 아니면 완료·미확인이다', () => {
    expect(inboxCategory(run({ status: 'succeeded', needsAnswer: false }))).toBe('done')
  })

  it('failed는 실패다', () => {
    expect(inboxCategory(run({ status: 'failed' }))).toBe('failed')
  })

  it('interrupted는 중단됨이다', () => {
    expect(inboxCategory(run({ status: 'interrupted' }))).toBe('interrupted')
  })

  it('canceled는 대기 중 취소됨이다', () => {
    // 사용자가 취소한 것은 execution.cancel이 확인 표시를 찍어 인박스에 오지 않는다.
    // 여기 오는 canceled는 앱이 재시작하며 취소한 것뿐이다.
    expect(inboxCategory(run({ status: 'canceled' }))).toBe('dropped')
  })

  it('모든 카테고리에 한국어 라벨이 있다', () => {
    for (const key of ['needs-answer', 'done', 'failed', 'interrupted', 'dropped'] as const) {
      expect(CATEGORY_LABELS[key]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run renderer/inbox.test.ts`
Expected: FAIL — `Cannot find module './inbox'`

- [ ] **Step 3: 카테고리 구현**

```ts
// renderer/inbox.ts
import type { Run } from '@shared/models'

/**
 * 인박스 항목의 카테고리 (설계 §4).
 * 컬럼으로 저장하지 않고 status + needsAnswer에서 파생한다 — 저장하면 둘이 어긋난다.
 */
export type InboxCategory = 'needs-answer' | 'done' | 'failed' | 'interrupted' | 'dropped'

export const CATEGORY_LABELS: Record<InboxCategory, string> = {
  'needs-answer': '답변 필요',
  done: '완료 · 미확인',
  failed: '실패',
  interrupted: '중단됨',
  dropped: '대기 중 취소됨'
}

export function inboxCategory(run: Run): InboxCategory {
  // needsAnswer가 먼저다. succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다.
  if (run.needsAnswer) return 'needs-answer'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'interrupted') return 'interrupted'
  if (run.status === 'canceled') return 'dropped'
  return 'done'
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run renderer/inbox.test.ts`
Expected: PASS (6개)

- [ ] **Step 5: `useInbox` 훅과 테스트**

```ts
// renderer/hooks/useInbox.ts
import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { InboxCounts, Run } from '@shared/models'

const EMPTY: InboxCounts = { total: 0, byWorkspace: {} }

/**
 * 인박스 목록과 배지 건수. 모든 workspace를 가로지른다.
 *
 * 건수는 event:inboxUpdate로 push되고, 그때 목록도 다시 읽는다 —
 * 목록은 스냅샷이지 진실의 출처가 아니다.
 */
export function useInbox() {
  const client = useClient()
  const [items, setItems] = useState<Run[]>([])
  const [counts, setCounts] = useState<InboxCounts>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, next] = await Promise.all([client.runs.inbox(), client.runs.inboxCounts()])
      setItems(list)
      setCounts(next)
      // 한 번 실패한 뒤 성공하면 오류를 지운다 — 남겨두면 이후 오류를 영구히 가린다.
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => client.events.onInboxUpdate(() => { void refresh() }), [client, refresh])

  return { items, counts, error, refresh }
}
```

```tsx
// renderer/hooks/useInbox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ClientProvider } from '../client/ClientProvider'
import { useInbox } from './useInbox'
import type { OneDeskClient } from '@shared/client'
import type { ReactNode } from 'react'

function wrap(client: OneDeskClient) {
  return ({ children }: { children: ReactNode }) => (
    <ClientProvider client={client}>{children}</ClientProvider>
  )
}

describe('useInbox', () => {
  it('처음에 목록과 건수를 읽는다', async () => {
    const client = {
      runs: {
        inbox: vi.fn().mockResolvedValue([{ id: 'r1' }]),
        inboxCounts: vi.fn().mockResolvedValue({ total: 1, byWorkspace: { w1: 1 } })
      },
      events: { onInboxUpdate: vi.fn(() => () => {}) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(), { wrapper: wrap(client) })
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
      expect(result.current.counts.total).toBe(1)
    })
  })

  it('push가 오면 다시 읽는다', async () => {
    let fire: (() => void) | null = null
    const client = {
      runs: {
        inbox: vi.fn().mockResolvedValue([]),
        inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} })
      },
      events: { onInboxUpdate: vi.fn((cb: () => void) => { fire = cb; return () => {} }) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(), { wrapper: wrap(client) })
    await waitFor(() => expect(client.runs.inbox).toHaveBeenCalledTimes(1))

    fire?.()

    await waitFor(() => expect(client.runs.inbox).toHaveBeenCalledTimes(2))
    expect(result.current.error).toBeNull()
  })

  it('조회에 실패하면 오류를 드러내고, 이후 성공하면 지운다', async () => {
    // 조용히 감추면 "처리할 것이 없다"와 "못 읽었다"가 구별되지 않는다.
    let fire: (() => void) | null = null
    const inbox = vi.fn()
      .mockRejectedValueOnce(new Error('읽기 실패'))
      .mockResolvedValue([])
    const client = {
      runs: { inbox, inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} }) },
      events: { onInboxUpdate: vi.fn((cb: () => void) => { fire = cb; return () => {} }) }
    } as unknown as OneDeskClient

    const { result } = renderHook(() => useInbox(), { wrapper: wrap(client) })
    await waitFor(() => expect(result.current.error).toBe('읽기 실패'))

    fire?.()

    await waitFor(() => expect(result.current.error).toBeNull())
  })
})
```

- [ ] **Step 6: 사이드바 테스트 작성**

`renderer/components/Sidebar.test.tsx`의 마지막 `})` 직전에 넣는다. 그 파일의 렌더 헬퍼에 `counts`를 넘길 수 있어야 하므로, 헬퍼 시그니처에 선택 인자를 더하고 `<Sidebar>`에 `counts={counts}` `view={'workspace'}` `onSelectInbox={vi.fn()}`을 붙인다(기존 단언은 그대로 둔다).

```tsx
  it('인박스 항목에 전체 건수를 단다', () => {
    renderSidebar({ counts: { total: 3, byWorkspace: { w1: 2 } } })
    expect(screen.getByRole('button', { name: /인박스/ })).toHaveTextContent('3')
  })

  it('workspace마다 그 workspace의 건수를 단다', () => {
    // 전체만 맞고 workspace별이 0이면 어디에 쌓였는지 알 수 없다.
    renderSidebar({ counts: { total: 3, byWorkspace: { w1: 2 } } })
    expect(screen.getByRole('button', { name: /ws-1/ })).toHaveTextContent('2')
  })

  it('건수가 0인 곳에는 배지를 그리지 않는다', () => {
    // 0이 상시 붙어 있으면 눈이 걸러내는 법을 배우고, 숫자가 생겨도 안 보인다.
    renderSidebar({ counts: { total: 0, byWorkspace: {} } })
    expect(screen.getByRole('button', { name: /인박스/ })).not.toHaveTextContent('0')
  })
```

- [ ] **Step 7: 사이드바 구현**

`renderer/components/Sidebar.tsx`의 props와 렌더를 바꾼다.

```tsx
export function Sidebar({ selectedId, onSelect, view, onSelectInbox, counts }: {
  selectedId: string | null
  onSelect: (id: string) => void
  view: 'workspace' | 'inbox'
  onSelectInbox: () => void
  counts: InboxCounts
}) {
```

import를 더한다.

```tsx
import type { InboxCounts } from '@shared/models'
```

`<nav className="sidebar">` 바로 안, `sidebar-label` 위에 인박스 항목을 넣는다.

```tsx
      <button
        type="button"
        className={view === 'inbox' ? 'inbox-link inbox-link-selected' : 'inbox-link'}
        onClick={onSelectInbox}
      >
        인박스
        {counts.total > 0 && <span className="badge">{counts.total}</span>}
      </button>
```

workspace 버튼 안에 배지를 더한다.

```tsx
            <button
              type="button"
              className={w.id === selectedId && view === 'workspace' ? 'ws ws-selected' : 'ws'}
              onClick={() => onSelect(w.id)}
            >
              {w.name}
              {(counts.byWorkspace[w.id] ?? 0) > 0 && (
                <span className="badge">{counts.byWorkspace[w.id]}</span>
              )}
            </button>
```

- [ ] **Step 8: App 배선**

`renderer/App.tsx`에 import와 상태를 더한다.

```tsx
import { useInbox } from './hooks/useInbox'
```

```tsx
  const [view, setView] = useState<'workspace' | 'inbox'>('workspace')
  const { items: inboxItems, counts: inboxCounts, error: inboxError } = useInbox()
```

`selectWorkspace`가 화면도 되돌리게 한다.

```tsx
  function selectWorkspace(id: string) {
    setWorkspaceId(id)
    setView('workspace')
    setRepoId(null)   // workspace가 바뀌면 이전 repo 필터는 무의미하다
    setChips([])      // 맥락도 마찬가지다. 다른 workspace의 항목은 실행 시 거부된다
  }
```

`<Sidebar>` 호출을 바꾼다.

```tsx
      <Sidebar
        selectedId={workspaceId}
        onSelect={selectWorkspace}
        view={view}
        onSelectInbox={() => setView('inbox')}
        counts={inboxCounts}
      />
```

`<main className="main">` 안의 첫 두 줄을 바꾼다 — 인박스일 때는 workspace 화면을 그리지 않는다.

```tsx
        {view === 'inbox' && <div className="blank">인박스 (다음 태스크에서 채운다)</div>}
        {view === 'workspace' && !workspaceId && (
          <div className="blank">왼쪽에서 workspace를 선택하세요</div>
        )}
        {view === 'workspace' && workspaceId && (
```

> **주의:** `inboxItems`와 `inboxError`는 Task 8에서 쓴다. 지금 선언만 하면 lint가 미사용을 잡으므로, **이 태스크에서는 `items`와 `error`를 구조 분해하지 말고 `counts`만 꺼낸다.** Task 7에서 나머지를 더한다.

```tsx
  const { counts: inboxCounts } = useInbox()
```

- [ ] **Step 9: `App.test.tsx`와 `Dock.test.tsx`의 가짜 클라이언트 보강**

`App.test.tsx`의 가짜 `OneDeskClient`에 새 메서드를 더한다(단언은 바꾸지 않는다).

```ts
      inbox: vi.fn().mockResolvedValue([]),
      inboxCounts: vi.fn().mockResolvedValue({ total: 0, byWorkspace: {} }),
      markReviewed: vi.fn(),
      resume: vi.fn(),
```

```ts
      onInboxUpdate: vi.fn(() => () => {}),
```

`Dock.test.tsx`의 가짜 클라이언트에도 같은 것을 더한다 — `Dock`이 직접 부르지는 않지만 타입을 만족해야 하고, 빠뜨리면 다음 사람이 이 가짜를 복사해 쓸 때 조용히 `undefined`를 부른다.

- [ ] **Step 10: CSS**

`renderer/index.css`에 더한다.

```css
.inbox-link { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; border-radius: 5px; background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; padding: 5px 8px; text-align: left; }
.inbox-link-selected { background: #e4e4e7; }
.badge { margin-left: auto; border-radius: 9px; background: #dc2626; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 6px; }
```

`.ws`에 `display: flex; align-items: center; gap: 6px;`를 더해 배지가 오른쪽에 붙게 한다.

- [ ] **Step 11: 변이 M13·M14·M15 확인**

| 변이 | 되돌릴 것 | 기대 |
|---|---|---|
| M13 | `inboxCategory`의 `if (run.needsAnswer) return 'needs-answer'` 제거 | `needsAnswer면 답변 필요다` 실패 |
| M14 | 사이드바 workspace 배지의 `counts.byWorkspace[w.id]`를 `0`으로 | `workspace마다 그 workspace의 건수를 단다` 실패 |
| M15 | 배지의 `> 0` 가드 제거 | `건수가 0인 곳에는 배지를 그리지 않는다` 실패 |

되돌린 뒤 `git diff`로 확인한다.

- [ ] **Step 12: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add renderer/
git commit -m "feat: show unreviewed run counts in the sidebar"
```

Expected: `pnpm test` 201개 (189 + 6 + 3 + 3)

---

## Task 7: 실행 패널의 resume 모드

**Files:**
- Modify: `renderer/components/RunPanel.tsx`, `renderer/components/RunPanel.test.tsx`, `renderer/components/Dock.tsx`, `renderer/components/Dock.test.tsx`, `renderer/App.tsx`

**Interfaces:**
- Consumes: `client.runs.resume` (Task 5)
- Produces: `RunPanel`에 `resumeFrom: Run | null`, `draftPrompt: string`, `onExitResume: () => void` prop
- Produces: `App`의 `resumeFrom` / `draftPrompt` 상태와 그 setter — Task 8의 인박스가 이걸 세운다

**변이:** M18, M19

> **이 태스크가 resume 모드를 먼저 만드는 이유.** 인박스(Task 8)가 "이어서 실행"으로 이 모드를 연다. 순서를 뒤집으면 App이 `resumeFrom` 상태를 선언해 놓고 읽는 곳이 없어 `@typescript-eslint/no-unused-vars`가 그 커밋의 `pnpm lint`를 떨어뜨린다(실측 확인). 3a에서 태스크 하나가 자기 검증을 통과할 수 없던 것과 같은 종류다.
>
> 그래서 이 태스크가 끝난 시점에는 resume 모드가 **코드로는 완성이지만 화면에서 도달할 수 없다** — 세우는 곳이 아직 없기 때문이다. 단위 테스트로 검증되고, Task 8이 진입점을 붙인다. IPC(Task 5)가 렌더러 없이 먼저 선 것과 같은 모양이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`renderer/components/RunPanel.test.tsx`의 마지막 `})` 직전에 넣는다. 그 파일의 렌더 헬퍼에 `resumeFrom`·`draftPrompt`·`onExitResume`를 넘길 수 있게 선택 인자를 더한다(기존 단언은 그대로).

```tsx
  const parent: Run = {
    id: 'p1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp/api', permission: 'read_only', userPrompt: '원래 지시', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: 'sess-1', parentRunId: null,
    resultText: null, needsAnswer: true, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 0, contextItems: []
  }

  it('resume 모드에서는 작업 디렉토리를 바꿀 수 없다', () => {
    // 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 다른 조합으로 이어받을 수 없다.
    renderPanel({ resumeFrom: parent })
    expect(screen.queryByLabelText('작업 디렉토리')).toBeNull()
    expect(screen.getByText('/tmp/api')).toBeInTheDocument()
  })

  it('resume 모드의 권한 기본값은 원본의 권한이다', () => {
    // 기본값이 낮아지면 조용히 권한이 깎이고, 높아지면 의도보다 넓어진다.
    renderPanel({ resumeFrom: parent })
    expect(screen.getByLabelText('권한')).toHaveValue('read_only')
  })

  it('resume 모드에서 실행하면 resume을 부른다', async () => {
    const client = makeClient()
    renderPanel({ resumeFrom: parent, client })
    await userEvent.type(screen.getByPlaceholderText(/무엇을 시킬지/), '이어서 해줘')
    await userEvent.click(screen.getByRole('button', { name: '▶ 실행' }))
    expect(client.runs.resume).toHaveBeenCalledWith(expect.objectContaining({
      parentRunId: 'p1',
      permission: 'read_only',
      userPrompt: '이어서 해줘',
      context: []
    }))
    expect(client.runs.start).not.toHaveBeenCalled()
  })

  it('resume 모드가 아니면 start를 부른다', async () => {
    const client = makeClient()
    renderPanel({ client })
    await userEvent.type(screen.getByPlaceholderText(/무엇을 시킬지/), '새로 해줘')
    await userEvent.click(screen.getByRole('button', { name: '▶ 실행' }))
    expect(client.runs.start).toHaveBeenCalled()
    expect(client.runs.resume).not.toHaveBeenCalled()
  })
```

> 헬퍼가 없으면 그 파일의 기존 렌더 방식에 맞춰 `makeClient()`(가짜 `OneDeskClient`를 만드는 함수)를 그 파일 안에 정의한다. `runs.start`와 `runs.resume`을 둘 다 `vi.fn().mockResolvedValue(<run 객체>)`로 둔다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run renderer/components/RunPanel.test.tsx`
Expected: FAIL — resume 모드 관련 단언이 전부 실패

- [ ] **Step 3: `RunPanel` 구현**

props에 셋을 더한다.

```tsx
export function RunPanel({
  workspaceId, repos, reposError, chips, onRemoveChip, onStarted,
  resumeFrom, draftPrompt, onExitResume
}: {
  workspaceId: string
  repos: Repo[]
  reposError: string | null
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onStarted: (run: Run) => void
  /** 이어서 실행할 원본. null이면 새 실행이다. */
  resumeFrom: Run | null
  /** "다시 실행"이 채워 넣는 초기 프롬프트 */
  draftPrompt: string
  onExitResume: () => void
}) {
```

`permission` 기본값과 프롬프트가 원본을 따르게 한다. 기존 `useEffect`(workspace의 defaultPermission을 넣는 것) 아래에 더한다.

```tsx
  // resume은 원본의 권한에서 출발한다. 낮추면 조용히 깎이고, 올리는 것은 사용자의 판단이다.
  useEffect(() => {
    if (resumeFrom) setPermission(resumeFrom.permission)
  }, [resumeFrom])

  useEffect(() => {
    if (draftPrompt) setPrompt(draftPrompt)
  }, [draftPrompt])
```

작업 디렉토리 select를 감싼다 — resume이면 읽기 전용 표시로 바꾼다.

```tsx
        {resumeFrom ? (
          <div className="resume-locked">
            <span className="resume-badge">이어서 실행</span>
            {/* 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 둘은 바꿀 수 없다 (설계 §6). */}
            <span>{resumeFrom.agentKind}</span>
            <span>{resumeFrom.cwd}</span>
            <button type="button" onClick={onExitResume}>새 실행으로</button>
          </div>
        ) : (
          <label>
            작업 디렉토리
            <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
              {/* 기존 option들 그대로 */}
            </select>
          </label>
        )}
```

> 위 `<label>` 안의 내용은 **지금 파일에 있는 작업 디렉토리 select를 그대로 옮긴다.** 라벨 텍스트와 `aria-label`이 바뀌면 e2e가 깨진다.

`ready` 조건과 `start()`를 바꾼다.

```tsx
  // resume은 cwd를 원본에서 받으므로 로컬 cwd가 비어도 실행할 수 있다.
  const ready = (resumeFrom !== null || cwd !== '') && prompt.trim() !== '' && !busy

  async function start() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const run = resumeFrom
        ? await client.runs.resume({
            parentRunId: resumeFrom.id,
            model: model.trim() || null,
            permission,
            userPrompt: prompt,
            context: chips.map(({ type, id }) => ({ type, id }))
          })
        : await client.runs.start({
            workspaceId,
            agentKind: 'claude-code',
            model: model.trim() || null,
            cwd,
            permission,
            userPrompt: prompt,
            context: chips.map(({ type, id }) => ({ type, id }))
          })
      setPrompt('')
      onStarted(run)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 4: `Dock`과 App 배선**

`Dock`의 props에 셋을 더하고 `RunPanel`에 그대로 넘긴다.

```tsx
  resumeFrom: Run | null
  draftPrompt: string
  onExitResume: () => void
```

```tsx
            <RunPanel
              workspaceId={workspaceId}
              repos={repos}
              reposError={reposError}
              chips={chips}
              onRemoveChip={onRemoveChip}
              onStarted={started}
              resumeFrom={resumeFrom}
              draftPrompt={draftPrompt}
              onExitResume={onExitResume}
            />
```

`Dock.test.tsx`의 `renderDock` 헬퍼에 `resumeFrom={null} draftPrompt="" onExitResume={vi.fn()}`을 더한다.

`App.tsx`에 상태 둘을 선언한다. Task 8의 인박스가 이걸 세우고, 지금은 `<Dock>`이 읽는다.

```tsx
  const [resumeFrom, setResumeFrom] = useState<Run | null>(null)
  const [draftPrompt, setDraftPrompt] = useState('')
```

`Run` 타입 import를 더한다.

```tsx
import type { Run } from '@shared/models'
```

`App.tsx`의 `<Dock>`에 더한다.

```tsx
              resumeFrom={resumeFrom}
              draftPrompt={draftPrompt}
              onExitResume={() => { setResumeFrom(null); setDraftPrompt('') }}
```

그리고 실행이 시작되면 resume 모드를 푼다.

```tsx
              onRunStarted={() => {
                setChips([])
                setResumeFrom(null)
                setDraftPrompt('')
              }}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test`
Expected: `pnpm test` 205개 (201 + 4)

- [ ] **Step 6: 변이 M18·M19 확인**

| 변이 | 되돌릴 것 | 기대 |
|---|---|---|
| M18 | `resumeFrom ? … : …` 삼항을 항상 select 쪽으로 | `resume 모드에서는 작업 디렉토리를…` 실패 |
| M19 | `if (resumeFrom) setPermission(resumeFrom.permission)` 제거 | `resume 모드의 권한 기본값은…` 실패 |

- [ ] **Step 7: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add renderer/
git commit -m "feat: let the run panel resume a recorded session"
```

---

## Task 8: 인박스 화면과 후속 행동

**Files:**
- Create: `renderer/components/InboxPanel.tsx`, `renderer/components/InboxPanel.test.tsx`
- Modify: `renderer/App.tsx`, `renderer/index.css`

**Interfaces:**
- Consumes: `inboxCategory`, `CATEGORY_LABELS` (Task 6), `useInbox` (Task 6)
- Produces: `<InboxPanel items workspaces error onReview onOpenLog onResume onRestart onCloseIssue onMakeIssue />`

**변이:** M16, M17

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// renderer/components/InboxPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InboxPanel } from './InboxPanel'
import type { Run, Workspace } from '@shared/models'

const workspaces: Workspace[] = [
  { id: 'w1', name: '앱', claudePath: null, opencodePath: null, defaultPermission: 'edit', createdAt: 0 }
]

function run(over: Partial<Run>): Run {
  return {
    id: 'r1', workspaceId: 'w1', agentKind: 'claude-code', model: null,
    cwd: '/tmp', permission: 'edit', userPrompt: '토큰 만료 고쳐줘', assembledPrompt: 'x',
    status: 'succeeded', externalSessionId: 'sess-1', parentRunId: null,
    resultText: null, needsAnswer: false, timeoutMs: null, exitCode: 0,
    errorMessage: null, logPath: '/tmp/x', reviewedAt: null, reviewedKind: null,
    startedAt: 1, endedAt: 2, createdAt: 0, contextItems: [],
    ...over
  }
}

function renderPanel(items: Run[], over: Partial<Parameters<typeof InboxPanel>[0]> = {}) {
  const props = {
    items,
    workspaces,
    error: null,
    onReview: vi.fn(),
    onOpenLog: vi.fn(),
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onCloseIssue: vi.fn(),
    onMakeIssue: vi.fn(),
    ...over
  }
  render(<InboxPanel {...props} />)
  return props
}

describe('InboxPanel', () => {
  it('비어 있으면 그렇게 말한다', () => {
    renderPanel([])
    expect(screen.getByText('처리할 결과가 없습니다')).toBeInTheDocument()
  })

  it('어느 workspace 것인지 보여준다', () => {
    // 전역 목록이라 workspace 이름이 없으면 같은 지시를 두 곳에서 돌렸을 때 구별할 수 없다.
    renderPanel([run({})])
    expect(screen.getByText('앱')).toBeInTheDocument()
  })

  it('카테고리 라벨을 보여준다', () => {
    renderPanel([run({ needsAnswer: true })])
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })

  it('세션이 없으면 이어서 실행을 보여주지 않는다', () => {
    // 눌러서야 실패를 알게 되면 안 된다.
    renderPanel([run({ externalSessionId: null })])
    expect(screen.queryByRole('button', { name: '이어서 실행' })).toBeNull()
  })

  it('세션이 있으면 이어서 실행을 보여준다', () => {
    renderPanel([run({ externalSessionId: 'sess-1' })])
    expect(screen.getByRole('button', { name: '이어서 실행' })).toBeInTheDocument()
  })

  it('대기 중 취소됨에는 로그 보기를 보여주지 않는다', () => {
    // 시작도 못 한 run이라 로그 파일이 없다.
    renderPanel([run({ status: 'canceled', externalSessionId: null })])
    expect(screen.queryByRole('button', { name: '로그 보기' })).toBeNull()
    expect(screen.getByRole('button', { name: '다시 실행' })).toBeInTheDocument()
  })

  it('실패한 run은 이슈로 만들 수 있다', () => {
    renderPanel([run({ status: 'failed', errorMessage: '권한 거부' })])
    expect(screen.getByRole('button', { name: '이슈로 만들기' })).toBeInTheDocument()
    expect(screen.getByText('권한 거부')).toBeInTheDocument()
  })

  it('첨부된 이슈가 없으면 관련 이슈 닫기를 보여주지 않는다', () => {
    renderPanel([run({ contextItems: [] })])
    expect(screen.queryByRole('button', { name: '관련 이슈 닫기' })).toBeNull()
  })

  it('첨부된 이슈마다 관련 이슈 닫기를 보여주고 그 id로 알린다', () => {
    const item = run({ contextItems: [{ type: 'issue', id: 'i1' }, { type: 'issue', id: 'i2' }] })
    const { onCloseIssue } = renderPanel([item])
    const buttons = screen.getAllByRole('button', { name: '관련 이슈 닫기' })
    expect(buttons).toHaveLength(2)
    buttons[0]!.click()
    expect(onCloseIssue).toHaveBeenCalledWith(item, 'i1')
  })

  it('repo 맥락은 관련 이슈 닫기를 만들지 않는다', () => {
    // contextItems에는 repo·memo도 섞여 온다. 이슈만 골라야 한다.
    renderPanel([run({ contextItems: [{ type: 'repo', id: 'p1' }] })])
    expect(screen.queryByRole('button', { name: '관련 이슈 닫기' })).toBeNull()
  })

  it('확인함을 누르면 confirmed로 알린다', async () => {
    const { onReview } = renderPanel([run({})])
    await userEvent.click(screen.getByRole('button', { name: '확인함' }))
    expect(onReview).toHaveBeenCalledWith('r1', 'confirmed')
  })

  it('보관을 누르면 archived로 알린다', async () => {
    const { onReview } = renderPanel([run({ status: 'failed' })])
    await userEvent.click(screen.getByRole('button', { name: '보관' }))
    expect(onReview).toHaveBeenCalledWith('r1', 'archived')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run renderer/components/InboxPanel.test.tsx`
Expected: FAIL — `Cannot find module './InboxPanel'`

- [ ] **Step 3: 구현**

```tsx
// renderer/components/InboxPanel.tsx
import { inboxCategory, CATEGORY_LABELS, type InboxCategory } from '../inbox'
import type { Run, Workspace } from '@shared/models'

/** 지시의 첫 줄만. 목록에서는 그것으로 충분하다. */
function label(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || '(빈 지시)'
}

function when(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toLocaleString('ko-KR')
}

/** 카테고리마다 다음 수를 미리 제시한다 (설계 §5). */
function shows(category: InboxCategory, action: 'log' | 'resume' | 'restart' | 'confirm' | 'archive' | 'makeIssue'): boolean {
  switch (action) {
    // 대기 중 취소됨은 시작도 못 해 로그 파일이 없다.
    case 'log': return category !== 'dropped'
    case 'resume': return category === 'needs-answer' || category === 'done'
    case 'restart': return category === 'failed' || category === 'interrupted' || category === 'dropped'
    case 'confirm': return category === 'done'
    case 'archive': return category !== 'done'
    case 'makeIssue': return category === 'failed'
  }
}

export function InboxPanel({
  items, workspaces, error, onReview, onOpenLog, onResume, onRestart, onCloseIssue, onMakeIssue
}: {
  items: Run[]
  workspaces: Workspace[]
  error: string | null
  onReview: (runId: string, kind: 'confirmed' | 'archived') => void
  onOpenLog: (run: Run) => void
  onResume: (run: Run) => void
  onRestart: (run: Run) => void
  onCloseIssue: (run: Run, issueId: string) => void
  onMakeIssue: (run: Run) => void
}) {
  return (
    <section className="inbox">
      {error && <div role="alert" className="form-error">{error}</div>}
      {items.length === 0 && !error && (
        <div className="panel-empty">처리할 결과가 없습니다</div>
      )}
      <ul className="inbox-list">
        {items.map((run) => {
          const category = inboxCategory(run)
          const ws = workspaces.find((w) => w.id === run.workspaceId)
          const issueIds = run.contextItems.filter((c) => c.type === 'issue').map((c) => c.id)
          return (
            <li key={run.id} className="inbox-item">
              <div className="inbox-head">
                <span className={`status status-${run.status}`}>{CATEGORY_LABELS[category]}</span>
                {/* 전역 목록이라 어느 workspace 것인지가 없으면 맥락이 사라진다. */}
                <span className="inbox-ws">{ws?.name ?? '(사라진 workspace)'}</span>
                <span className="inbox-when">{when(run.endedAt)}</span>
              </div>
              <div className="inbox-prompt">{label(run)}</div>
              {run.errorMessage && <div className="inbox-error">{run.errorMessage}</div>}
              <div className="inbox-actions">
                {shows(category, 'log') && (
                  <button type="button" onClick={() => onOpenLog(run)}>로그 보기</button>
                )}
                {/* 세션이 없으면 이어받을 것이 없다. 보여주면 눌러서야 알게 된다. */}
                {shows(category, 'resume') && run.externalSessionId && (
                  <button type="button" onClick={() => onResume(run)}>
                    {category === 'needs-answer' ? '답하고 이어서' : '이어서 실행'}
                  </button>
                )}
                {shows(category, 'restart') && (
                  <button type="button" onClick={() => onRestart(run)}>다시 실행</button>
                )}
                {shows(category, 'makeIssue') && (
                  <button type="button" onClick={() => onMakeIssue(run)}>이슈로 만들기</button>
                )}
                {issueIds.map((id) => (
                  <button key={id} type="button" onClick={() => onCloseIssue(run, id)}>
                    관련 이슈 닫기
                  </button>
                ))}
                {shows(category, 'confirm') && (
                  <button type="button" onClick={() => onReview(run.id, 'confirmed')}>확인함</button>
                )}
                {shows(category, 'archive') && (
                  <button type="button" onClick={() => onReview(run.id, 'archived')}>보관</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run renderer/components/InboxPanel.test.tsx`
Expected: PASS (12개)

- [ ] **Step 5: App에 붙인다**

`renderer/App.tsx`의 `useInbox` 구조 분해를 넓힌다.

```tsx
  const { items: inboxItems, counts: inboxCounts, error: inboxError } = useInbox()
```

import를 더한다.

```tsx
import { InboxPanel } from './components/InboxPanel'
import { useWorkspaces } from './hooks/useWorkspaces'
```

```tsx
  const { workspaces } = useWorkspaces()
```

핸들러를 더한다.

```tsx
  function review(runId: string, kind: 'confirmed' | 'archived') {
    setInboxActionError(null)
    client.runs.markReviewed(runId, kind).catch((err: unknown) => {
      setInboxActionError(err instanceof Error ? err.message : String(err))
    })
  }

  /** 인박스 항목을 그 run의 workspace 화면으로 데려간다. */
  function goToRun(run: Run) {
    setWorkspaceId(run.workspaceId)
    setRepoId(null)
    setChips([])
    setView('workspace')
  }

  function openLog(run: Run) {
    goToRun(run)
  }

  function startResume(run: Run) {
    goToRun(run)
    setResumeFrom(run)
  }

  function restart(run: Run) {
    goToRun(run)
    setResumeFrom(null)
    setDraftPrompt(run.userPrompt)
  }

  function closeIssue(run: Run, issueId: string) {
    setInboxActionError(null)
    client.issues.update({ id: issueId, status: 'done' })
      .then(() => { review(run.id, 'confirmed') })
      .catch((err: unknown) => {
        setInboxActionError(err instanceof Error ? err.message : String(err))
      })
  }

  function makeIssue(run: Run) {
    setInboxActionError(null)
    // 실패는 대개 나중에 다뤄야 할 일인데, 인박스에서 사라지면 그대로 잊힌다.
    const title = run.userPrompt.trim().split('\n')[0] || '실패한 실행'
    client.issues.create({
      workspaceId: run.workspaceId,
      title,
      body: run.errorMessage ?? ''
    })
      .then(() => { review(run.id, 'archived') })
      .catch((err: unknown) => {
        setInboxActionError(err instanceof Error ? err.message : String(err))
      })
  }
```

상태를 하나 더한다. `resumeFrom`과 `draftPrompt`는 **Task 7이 이미 선언했다** — 여기서는 그 setter를 쓰기만 한다.

```tsx
  const [inboxActionError, setInboxActionError] = useState<string | null>(null)
```

인박스 자리를 채운다.

```tsx
        {view === 'inbox' && (
          <InboxPanel
            items={inboxItems}
            workspaces={workspaces}
            error={inboxActionError ?? inboxError}
            onReview={review}
            onOpenLog={openLog}
            onResume={startResume}
            onRestart={restart}
            onCloseIssue={closeIssue}
            onMakeIssue={makeIssue}
          />
        )}
```

이 태스크가 끝나면 인박스에서 "이어서 실행"을 눌렀을 때 Task 7이 만든 resume 모드가 실제로 열린다 — 그 진입점이 여기서 붙는다.

- [ ] **Step 6: CSS**

```css
.inbox { flex: 1; overflow-y: auto; padding: 10px 12px; }
.inbox-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.inbox-item { border: 1px solid #e4e4e7; border-radius: 7px; padding: 9px 11px; }
.inbox-head { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.inbox-ws { font-weight: 700; }
.inbox-when { margin-left: auto; opacity: .6; }
.inbox-prompt { margin-top: 5px; font-size: 13px; }
.inbox-error { margin-top: 4px; font-size: 11px; color: #991b1b; }
.inbox-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.inbox-actions button { border: 1px solid #e4e4e7; border-radius: 5px; background: #fff; cursor: pointer; font: inherit; font-size: 11px; padding: 3px 9px; }
```

- [ ] **Step 7: 변이 M16·M17 확인**

| 변이 | 되돌릴 것 | 기대 |
|---|---|---|
| M16 | `&& run.externalSessionId` 제거 | `세션이 없으면 이어서 실행을 보여주지 않는다` 실패 |
| M17 | `shows`의 `case 'log'`를 `return true`로 | `대기 중 취소됨에는 로그 보기를…` 실패 |

- [ ] **Step 8: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add renderer/
git commit -m "feat: add the inbox screen with per-category actions"
```

Expected: `pnpm test` 217개 (205 + 12)

---

## Task 9: e2e — 인박스가 실제 앱에서 도는지

**Files:**
- Create: `e2e/inbox.e2e.ts`

**Interfaces:**
- Consumes: `launchApp()` (`e2e/driver.ts`)

- [ ] **Step 1: 테스트 작성**

`e2e/smoke.e2e.ts`·`e2e/core-loop.e2e.ts`와 같은 구조다 — **테스트가 앱을 닫지 않는다.** 드라이버가 `onTestFinished`로 정리하며, 테스트가 먼저 닫으면 실패 스크린샷이 남지 않는다.

```ts
// e2e/inbox.e2e.ts
import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const PROMPT = '인박스 확인용 지시'

describe('결과 인박스', () => {
  it('끝난 run이 인박스에 뜨고 확인함을 누르면 사라진다', async () => {
    const app = await launchApp()
    const page = app.page

    // 1. workspace와 repo를 만든다 — repo가 없으면 실행 버튼이 비활성이다
    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-inbox')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: /e2e-inbox/ })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 2. 실행하고 끝나기를 기다린다
    await page.getByPlaceholder(/무엇을 시킬지/).fill(PROMPT)
    await page.getByRole('button', { name: '▶ 실행' }).click()
    await page.getByRole('button', { name: new RegExp(`succeeded.*${PROMPT}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })

    // 3. 사이드바 배지가 붙는다 — 아직 아무것도 확인하지 않았다
    const inboxLink = page.getByRole('button', { name: /인박스/ })
    await inboxLink.getByText('1').waitFor({ state: 'visible', timeout: 10_000 })

    // 4. 인박스에 그 run이 있다
    await inboxLink.click()
    await page.getByText(PROMPT).waitFor({ state: 'visible', timeout: 5_000 })
    // 전역 목록이라 어느 workspace 것인지가 함께 보여야 한다
    await page.getByText('e2e-inbox').first().waitFor({ state: 'visible', timeout: 5_000 })

    // 5. 확인함을 누르면 목록과 배지에서 함께 사라진다
    await page.getByRole('button', { name: '확인함' }).click()
    await page.getByText('처리할 결과가 없습니다').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await inboxLink.textContent()).not.toContain('1')
  })
})
```

- [ ] **Step 2: 실행하고 통과 확인**

Run: `pnpm test:e2e`
Expected: PASS (5개 — harness, smoke, core-loop, queue, inbox)

실패하면 `e2e/artifacts/fail-*.png`를 열어 어느 단계에서 멈췄는지 본다. 흔한 원인 둘:
- **인박스 링크를 못 찾는다**: 사이드바의 버튼 텍스트가 `인박스`인지 확인한다.
- **배지가 안 붙는다**: `emitInbox()`가 `onRunUpdate` 경로에 있는지 본다.

- [ ] **Step 3: 이 e2e가 실제로 무는지 확인**

`core/index.ts`의 `onRunUpdate`에서 `emitInbox()` 줄을 잠시 지운다.

Run: `pnpm test:e2e`
Expected: **FAIL** — 3번 단계에서 배지가 뜨지 않아 타임아웃한다.

되돌리고 `git diff core/index.ts`가 빈 것을 확인한 뒤 다시 통과를 본다.

**실패하지 않으면** 테스트를 고쳐 억지로 맞추지 말고 관찰한 것과 함께 보고하라.

- [ ] **Step 4: 전체 검증**

```bash
pnpm test && pnpm typecheck && pnpm lint
pnpm test:e2e
pgrep -fl "Electron.app/Contents/MacOS/Electron"
```

Expected: 217개 / e2e 5개 / `pgrep` 출력 없음. `/tmp/one-desk-e2e-*`도 남지 않아야 한다.

- [ ] **Step 5: 커밋**

```bash
git add e2e/inbox.e2e.ts
git commit -m "test: cover the inbox end to end"
```

---

## 완료 기준

- [ ] `pnpm test`가 217개다 — e2e가 섞이지 않았다
- [ ] `pnpm test:e2e`가 5개 통과한다
- [ ] `pnpm typecheck`, `pnpm lint` 통과
- [ ] **변이 M1~M19를 전부 되돌려 각각 해당 테스트가 실패하는 것을 확인했다.** 하나라도 실패하지 않으면 보고됐다
- [ ] 끝난 run이 인박스에 뜨고 확인함으로 사라지는 것을 실제 앱에서 확인했다
- [ ] 사용자가 취소한 run은 인박스에 뜨지 않고, 앱이 재시작하며 취소한 run은 뜬다
- [ ] 세션이 없는 run에는 "이어서 실행"이 보이지 않는다
- [ ] resume한 run이 `parentRunId`로 원본을 가리키고 `agentKind`·`cwd`가 원본과 같다
- [ ] 테스트 후 Electron 프로세스와 임시 디렉토리가 남지 않는다

## 다음으로 넘기는 것

- **4단계** — MCP 서버
- **5단계** — diff 뷰어와 `run_file_change`. §5 행동표의 "변경 보기"가 그때 채워진다
- 3a에서 넘어온 것: `notify`가 던질 때 run이 프로세스 없이 `running`으로 남는 경로, `core/`의 `console.error`를 주입식 `onError`로
- `(reviewed_at, status)` 부분 인덱스 — run이 수천 개가 되거나 배지 갱신이 느려지면
- 인박스 필터·검색. 지금은 전체 목록만이며 필요해지기 전에는 만들지 않는다
