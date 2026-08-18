# 대화 (이어지는 세션) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일회용 run을 이어지는 대화로 바꾼다 — 한 화면에서 대화록을 보며 계속 주고받는다.

**Architecture:** `run`에 `rootRunId`를 더해 같은 뿌리를 가진 run들을 한 대화로 묶는다. 새 테이블은 없고, 대화의 제목·확인 표시는 root run 행이 맡는다. `resume()`은 대화 id를 받아 체인에서 세션 id를 가진 가장 최근 run을 고르고, 예약된 다음 턴은 진짜 `pending` run으로 남아 큐의 그룹 직렬화가 순서를 지킨다. UI는 도크가 대화창이 된다.

**Tech Stack:** TypeScript, Electron, React, drizzle-orm + better-sqlite3, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-08-18-conversation-design.md`

## Global Constraints

이 프로젝트의 경계는 CLAUDE.md가 강제한다. 모든 태스크에 암묵적으로 적용된다.

- **`core/`는 `electron`을 import하지 않는다.** 경로가 필요하면 인자로 받는다.
- **`renderer/`는 `core/`를 import하지 않는다.** `window.oneDesk` 참조는 `renderer/main.tsx` 한 곳뿐이다. 컴포넌트는 `useClient()`를 쓴다.
- **IPC 핸들러는 얇다.** core 메서드 호출만 한다.
- **`issue.ts`↔`memo.ts`, `useIssues.ts`↔`useMemos.ts`의 중복은 의도된 것이다.** 합치지 말 것. 이 계획은 그 파일들을 건드리지 않는다.
- **패키지 매니저는 pnpm이다.** `npm`이 아니다.
- 들여쓰기 2칸, 함수명 camelCase, 상수 UPPER_SNAKE_CASE.
- `verbatimModuleSyntax: true` — 타입 전용 import는 `import type`.
- **주석과 오류 메시지는 한국어로 쓴다.**
- 시각은 전부 epoch milliseconds 정수, `Date.now()`로 명시 삽입한다.
- **TDD.** 실패를 먼저 확인하고 구현한다. **회귀 테스트를 추가할 때는 대상 코드를 잠시 망가뜨려 그 테스트가 실제로 실패하는지 확인한다.**
- **`pnpm test:e2e`와 `pnpm dev`를 동시에 돌리지 않는다.** e2e 빌드가 dev의 `out/`을 갈아끼운다.

**검증 명령:**

```bash
pnpm test        # Vitest (core=node, renderer=jsdom)
pnpm typecheck   # tsc --build
pnpm lint        # eslint
pnpm test:e2e    # 빌드 후 Playwright
```

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `core/db/schema.ts` | `run.rootRunId` 컬럼과 인덱스 | 1 |
| `drizzle/0002_*.sql` | 컬럼 추가 + 백필 + 인덱스 | 1 |
| `shared/models.ts` | `Run.rootRunId`, `ResumeRunInput.conversationId` | 1, 2 |
| `core/db/repositories/run.ts` | 뿌리 승계, `latestSessionRun`, 대화 단위 인박스 | 1, 2, 5 |
| `core/execution.ts` | 대화에서 세션 고르기, 예약 턴의 지연 해석 | 2, 3, 4 |
| `core/runner/queue.ts` | `groupKey` 직렬화 | 3 |
| `renderer/conversation.ts` (신규) | run 목록 → 대화 목록 순수 파생 | 6 |
| `renderer/components/Transcript.tsx` (신규) | 대화록 — 턴 버블 | 7 |
| `renderer/components/ConversationPanel.tsx` (신규) | 대화록 + 입력부 | 8 |
| `renderer/components/RunPanel.tsx` | 입력부(composer)로 축소 | 8 |
| `renderer/components/Dock.tsx` | 탭이 대화 단위 | 8 |
| `renderer/App.tsx` | `resumeFrom` 제거, `focusConversationId` 배선 | 9 |
| `renderer/components/InboxPanel.tsx` | 버튼 둘 → "대화 열기" 하나 | 9 |
| `e2e/conversation.e2e.ts` (신규) | 3턴 대화 왕복 | 10 |

**순서는 core → renderer다.** 태스크 1~5가 끝나도 기존 UI는 그대로 초록이어야 한다 — 그래야 각 단계를 독립적으로 되돌릴 수 있다.

---

### Task 1: `rootRunId` 컬럼과 승계

**Files:**
- Modify: `core/db/schema.ts`
- Create: `drizzle/0002_<생성된이름>.sql` (생성 후 본문 교체)
- Modify: `core/db/repositories/run.ts`
- Modify: `shared/models.ts:141-165` (`Run` 인터페이스)
- Test: `core/db/repositories/run.test.ts`

**Interfaces:**
- Produces: `Run.rootRunId: string | null` — 낡은 행은 `null`이고 그때는 자기 자신이 뿌리다. 읽는 쪽은 항상 `rootRunId ?? id`로 해석한다.
- Produces: `createRunRepository(db).create(input)` 가 `rootRunId`를 스스로 정한다. 호출자는 넘기지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/db/repositories/run.test.ts`의 `describe('RunRepository', ...)` 안에 더한다. `baseInput()`은 이미 파일 위쪽에 있다.

```ts
  describe('rootRunId', () => {
    it('부모가 없으면 자기 자신이 뿌리다', () => {
      const first = runs.create(baseInput())
      expect(first.rootRunId).toBe(first.id)
    })

    it('부모가 있으면 부모의 뿌리를 물려받는다', () => {
      const first = runs.create(baseInput())
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      expect(second.rootRunId).toBe(first.id)
    })

    it('3단 체인이 전부 같은 뿌리를 갖는다', () => {
      const first = runs.create(baseInput())
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      const third = runs.create({ ...baseInput(), parentRunId: second.id })
      expect(third.rootRunId).toBe(first.id)
      expect([first, second, third].map((r) => r.rootRunId))
        .toEqual([first.id, first.id, first.id])
    })

    it('부모가 사라졌으면 자기 자신이 뿌리다', () => {
      // parent_run_id에는 외래키가 없다 — 가리키는 run이 없을 수 있다.
      const orphan = runs.create({ ...baseInput(), parentRunId: 'ghost' })
      expect(orphan.rootRunId).toBe(orphan.id)
    })
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- core/db/repositories/run.test.ts`
Expected: FAIL — `rootRunId`가 `Run`에 없어 타입 오류이거나 `undefined`가 나온다.

- [ ] **Step 3: 스키마에 컬럼과 인덱스를 더한다**

`core/db/schema.ts`의 `run` 테이블에서 `parentRunId` 바로 아래에 넣는다.

```ts
  // 자기 참조 외래키를 붙이지 않는다. drizzle에서 타입 순환을 만들고,
  // 원본 run이 지워져도 이어서 실행한 run의 기록은 남아야 한다.
  parentRunId: text('parent_run_id'),
  // 대화의 뿌리. 부모가 없으면 자기 자신이다. **nullable인 것은 의도된 것이다**
  // (설계 §2) — NOT NULL로 만들려면 테이블을 다시 만들어야 하는데, 그 DROP TABLE이
  // run_context_item의 cascade를 건드려 모든 맥락 기록을 지운다. 마이그레이션의
  // PRAGMA foreign_keys=OFF는 트랜잭션 안이라 무시된다. 읽는 쪽이 `?? id`로 푼다.
  rootRunId: text('root_run_id'),
```

같은 파일의 인덱스 목록에 더한다.

```ts
}, (t) => [
  index('run_workspace_created_idx').on(t.workspaceId, t.createdAt),
  index('run_status_idx').on(t.status),
  index('run_root_created_idx').on(t.rootRunId, t.createdAt)
])
```

- [ ] **Step 4: 마이그레이션을 만들고 본문을 교체한다**

Run: `pnpm db:generate`

`drizzle/`에 `0002_*.sql`이 생긴다. **그 파일의 내용을 아래로 통째로 바꾼다.** drizzle이 만든 `drizzle/meta/` 스냅샷은 건드리지 않는다 — 스냅샷이 schema.ts와 맞아야 다음 generate가 정상 동작한다.

```sql
ALTER TABLE `run` ADD `root_run_id` text;--> statement-breakpoint
WITH RECURSIVE chain(id, root) AS (
  SELECT `id`, `id` FROM `run`
    WHERE `parent_run_id` IS NULL OR `parent_run_id` NOT IN (SELECT `id` FROM `run`)
  UNION ALL
  SELECT r.`id`, c.root FROM `run` r JOIN chain c ON r.`parent_run_id` = c.id
)
UPDATE `run` SET `root_run_id` = (SELECT root FROM chain WHERE chain.id = `run`.`id`);--> statement-breakpoint
UPDATE `run` SET `root_run_id` = `id` WHERE `root_run_id` IS NULL;--> statement-breakpoint
CREATE INDEX `run_root_created_idx` ON `run` (`root_run_id`,`created_at`);
```

세 번째 문장이 필요한 이유: 부모가 순환하거나 재귀가 닿지 못한 행이 남으면 `NULL`인 채로 통과한다. 그런 행은 자기 자신을 뿌리로 본다.

- [ ] **Step 5: `Run` 모델에 필드를 더한다**

`shared/models.ts`의 `Run` 인터페이스에서 `parentRunId` 아래에 넣는다.

```ts
  parentRunId: string | null
  /** 대화의 뿌리. 낡은 행은 null이고 그때는 자기 자신이 뿌리다 (설계 §2) */
  rootRunId: string | null
```

- [ ] **Step 6: 저장소가 뿌리를 정하게 한다**

`core/db/repositories/run.ts`. `createRunRepository` 안, `get()` 아래에 헬퍼를 더한다.

```ts
  /**
   * 새 run의 뿌리를 정한다 (설계 §2).
   *
   * **호출자가 넘기게 하지 않는다** — 두 곳이 어긋나면 대화가 조용히 갈라진다.
   * parent_run_id에는 외래키가 없으므로 가리키는 run이 없을 수 있다. 그때는
   * 자기 자신이 뿌리다.
   */
  function rootFor(parentRunId: string | null, ownId: string): string {
    if (!parentRunId) return ownId
    const parent = db.select({ id: run.id, rootRunId: run.rootRunId })
      .from(run).where(eq(run.id, parentRunId)).get()
    if (!parent) return ownId
    return parent.rootRunId ?? parent.id
  }
```

`create()`의 `tx.insert(run).values({...})`에서 `parentRunId` 줄 아래에 더한다.

```ts
          parentRunId: input.parentRunId ?? null,
          rootRunId: rootFor(input.parentRunId ?? null, id),
```

- [ ] **Step 7: 테스트가 통과하는지 본다**

Run: `pnpm test -- core/db/repositories/run.test.ts`
Expected: PASS

- [ ] **Step 8: 백필을 실제 마이그레이션으로 검증한다**

`core/db/open.test.ts`에 더한다. 기존 마이그레이션만 적용된 DB를 만들어 체인을 심고, 전체 마이그레이션으로 다시 열어 뿌리가 채워지는지 본다.

```ts
  it('0002 마이그레이션이 기존 체인의 뿌리를 백필한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'one-desk-backfill-'))
    const file = join(dir, 'test.db')
    const full = resolve(HERE, '../../drizzle')

    // 0002 이전 상태를 만든다 — 마이그레이션 파일을 0001까지만 복사한다.
    const partial = join(dir, 'migrations')
    mkdirSync(join(partial, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(join(full, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[]
    }
    const keep = journal.entries.filter((e) => !e.tag.startsWith('0002'))
    writeFileSync(
      join(partial, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: keep })
    )
    for (const entry of keep) copyFileSync(join(full, `${entry.tag}.sql`), join(partial, `${entry.tag}.sql`))

    // 0001까지만 적용된 DB를 만든다.
    openDb({ file, migrationsDir: partial })

    // 심는 것은 raw 핸들로 한다 — root_run_id 컬럼이 없어 drizzle 스키마를 쓸 수
    // 없고, openDb는 핸들을 돌려주지 않는다. WAL이라 연결이 여럿이어도 된다.
    const seed = new BetterSqlite3(file)
    seed.exec(`
      INSERT INTO workspace (id, name, created_at, updated_at)
        VALUES ('ws', 'ws', 1, 1);
      INSERT INTO run (id, workspace_id, agent_kind, cwd, permission, user_prompt,
                       assembled_prompt, log_path, parent_run_id, created_at)
        VALUES
          ('a','ws','claude-code','/tmp','edit','1','1','/tmp/a.log', NULL, 1),
          ('b','ws','claude-code','/tmp','edit','2','2','/tmp/b.log', 'a',  2),
          ('c','ws','claude-code','/tmp','edit','3','3','/tmp/c.log', 'b',  3),
          ('z','ws','claude-code','/tmp','edit','4','4','/tmp/z.log', 'ghost', 4);
    `)
    seed.close()

    // 전체 마이그레이션으로 다시 연다 — 0002가 백필한다.
    openDb({ file, migrationsDir: full })

    const check = new BetterSqlite3(file)
    const rows = check
      .prepare('SELECT id, root_run_id FROM run ORDER BY created_at')
      .all() as { id: string; root_run_id: string }[]
    expect(rows).toEqual([
      { id: 'a', root_run_id: 'a' },
      { id: 'b', root_run_id: 'a' },
      { id: 'c', root_run_id: 'a' },
      // 부모가 사라진 행은 자기 자신이 뿌리다.
      { id: 'z', root_run_id: 'z' }
    ])
    check.close()
    rmSync(dir, { recursive: true, force: true })
  })
```

파일 위쪽 import에 `BetterSqlite3`(`from 'better-sqlite3'`)와 `mkdirSync`·`copyFileSync`·`readFileSync`·`writeFileSync`·`mkdtempSync`·`rmSync`·`tmpdir`·`join`·`resolve`가 필요하다. `HERE`는 `dirname(fileURLToPath(import.meta.url))`로 만든다(`core/db/repositories/testing.ts`와 같은 방식).

**`openDb`가 연 핸들은 닫지 않는다** — 돌려주지 않기 때문이다. WAL 모드라 같은 프로세스의 여러 연결이 공존할 수 있고, 테스트가 끝나면 프로세스와 함께 정리된다.

- [ ] **Step 9: 백필 테스트가 실제로 무언가를 지키는지 확인한다**

마이그레이션의 두 번째 문장(재귀 CTE UPDATE)을 잠시 지우고 다시 돌린다.

Run: `pnpm test -- core/db/open.test.ts`
Expected: FAIL — `b`, `c`의 `root_run_id`가 자기 자신이 된다. 확인했으면 되돌린다.

- [ ] **Step 10: 전체 검증과 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/db/schema.ts core/db/repositories/run.ts core/db/repositories/run.test.ts \
        core/db/open.test.ts shared/models.ts drizzle/
git commit -m "feat: add rootRunId to group runs into conversations"
```

---

### Task 2: `resume()`가 대화에서 세션을 고른다

**Files:**
- Modify: `core/db/repositories/run.ts`
- Modify: `core/execution.ts:284-326` (`resume`)
- Modify: `shared/models.ts:182-196` (`ResumeRunInput`)
- Modify: `renderer/components/RunPanel.tsx:101-107` (호출부)
- Test: `core/db/repositories/run.test.ts`, `core/execution.test.ts`

**Interfaces:**
- Consumes: `Run.rootRunId` (Task 1)
- Produces: `runs.latestSessionRun(rootRunId: string): Run | null` — 그 대화에서 `externalSessionId`가 있는 가장 최근 run
- Produces: `ResumeRunInput.conversationId: string` — `parentRunId`를 대체한다

- [ ] **Step 1: 저장소 테스트를 쓴다**

`core/db/repositories/run.test.ts`에 더한다.

```ts
  describe('latestSessionRun', () => {
    function finishWithSession(id: string, sessionId: string | null) {
      runs.markFinished(id, {
        status: 'succeeded', resultText: null, externalSessionId: sessionId,
        needsAnswer: false, exitCode: 0, errorMessage: null
      })
    }

    it('세션 id를 가진 가장 최근 run을 고른다', () => {
      const first = runs.create(baseInput())
      finishWithSession(first.id, 'sess-1')
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      finishWithSession(second.id, 'sess-2')

      expect(runs.latestSessionRun(first.id)?.id).toBe(second.id)
    })

    it('마지막 턴에 세션이 없으면 그 앞 턴을 고른다', () => {
      // preflight 실패나 MCP 준비 실패로 끝난 run은 프로세스가 뜬 적이 없어
      // 세션 id가 없다. 이 경우가 체인을 끊으면 안 된다 (설계 §3-1).
      const first = runs.create(baseInput())
      finishWithSession(first.id, 'sess-1')
      const failed = runs.create({ ...baseInput(), parentRunId: first.id })
      finishWithSession(failed.id, null)

      expect(runs.latestSessionRun(first.id)?.id).toBe(first.id)
    })

    it('세션을 가진 run이 하나도 없으면 null이다', () => {
      const first = runs.create(baseInput())
      expect(runs.latestSessionRun(first.id)).toBeNull()
    })
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- core/db/repositories/run.test.ts`
Expected: FAIL — `runs.latestSessionRun is not a function`

- [ ] **Step 3: 저장소에 구현한다**

`core/db/repositories/run.ts`. import에 `isNotNull`을 더한다.

```ts
import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
```

반환 객체에 더한다(`list` 아래가 자연스럽다).

```ts
    /**
     * 그 대화에서 세션 id를 가진 가장 최근 run (설계 §3-1).
     *
     * 마지막 턴이 preflight 실패로 끝나 세션 id가 없어도 그 앞 턴에서 이어받게
     * 하는 것이 목적이다. 마지막 run을 그냥 쓰면 그런 턴 하나가 대화를 끊는다.
     */
    latestSessionRun(rootRunId: string): Run | null {
      const row = db.select().from(run)
        .where(and(
          // 낡은 행은 root_run_id가 null이고 그때는 자기 자신이 뿌리다.
          or(eq(run.rootRunId, rootRunId), and(isNull(run.rootRunId), eq(run.id, rootRunId))),
          isNotNull(run.externalSessionId)
        ))
        // createdAt만으로는 같은 밀리초의 순서가 흔들린다. rowid가 갈라준다.
        .orderBy(desc(run.createdAt), desc(sql`rowid`)).get()
      return row ? hydrate([row])[0]! : null
    },
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- core/db/repositories/run.test.ts`
Expected: PASS

- [ ] **Step 5: `ResumeRunInput`을 바꾼다**

`shared/models.ts`:

```ts
/**
 * 대화를 이어받아 실행한다.
 *
 * StartRunInput에도 parentRunId가 있지만 그것은 "원본을 가리키는 기록"일 뿐
 * 세션을 이어받지 않는다. resume은 external_session_id까지 이어받는다.
 */
export interface ResumeRunInput {
  /** 이어받을 대화 (= root run의 id) */
  conversationId: string
  model?: string | null
  permission: Permission
  userPrompt: string
  /** 기본은 빈 배열 — 이전 대화가 이미 세션에 있다 (설계 §6) */
  context: ContextItemRef[]
}
```

- [ ] **Step 6: execution 테스트를 쓴다**

`core/execution.test.ts`의 `describe('resume', ...)` 안에 더한다. 이 파일은 `setup()`이 만든 `ctx`(`ctx.service`·`ctx.runs`·`ctx.workspaceId`·`ctx.issueId`)와 헬퍼 `startBase()`·`finishedWithSession()`을 이미 갖고 있다. 가짜 CLI는 항상 `externalSessionId: 'fake-session'`을 남긴다.

```ts
    it('마지막 턴이 세션 없이 실패해도 그 앞 턴에서 이어받는다', async () => {
      const first = await finishedWithSession()
      expect(first.externalSessionId).toBe('fake-session')

      // 2턴이 세션 없이 실패한 상황을 만든다 — preflight 실패와 같은 모양이다.
      const failed = await ctx.service.resume({
        conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
      })
      await vi.waitFor(() => expect(ctx.runs.get(failed.id).status).toBe('succeeded'))
      ctx.runs.markFinished(failed.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: '실행 파일을 찾을 수 없습니다.'
      })

      // 3턴은 그 앞 턴(1턴)의 세션을 이어받는다.
      const third = await ctx.service.resume({
        conversationId: first.id, permission: 'edit', userPrompt: '3턴', context: []
      })
      expect(third.rootRunId).toBe(first.id)
      // 세션을 준 run이 부모다 — 실패한 2턴이 아니다.
      expect(third.parentRunId).toBe(first.id)
    })

    it('세션을 가진 run이 하나도 없으면 던진다', async () => {
      const first = await startBase()
      ctx.runs.markFinished(first.id, {
        status: 'failed', resultText: null, externalSessionId: null,
        needsAnswer: false, exitCode: 1, errorMessage: 'x'
      })
      await expect(ctx.service.resume({
        conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
      })).rejects.toThrow('이어받을 세션이 없습니다')
    })
```

기존 `resume` 테스트들이 `parentRunId: parent.id`를 넘기고 있다 — **전부 `conversationId: parent.id`로 바꾼다.** 1턴짜리 대화에서는 뿌리와 부모가 같은 id라 값은 그대로다.

- [ ] **Step 7: 실패를 확인한다**

Run: `pnpm test -- core/execution.test.ts`
Expected: FAIL — `conversationId`가 `ResumeRunInput`에 없다는 타입 오류

- [ ] **Step 8: `resume()`을 고친다**

`core/execution.ts`의 `resume` 전체를 바꾼다.

```ts
  /**
   * 대화를 이어받아 새 run을 만든다 (설계 §3-1).
   *
   * **이어받을 run을 core가 고른다.** 마지막 턴이 preflight 실패나 MCP 준비
   * 실패로 끝나면 세션 id가 없다 — 그 한 턴이 대화를 끊지 않도록 체인에서
   * 세션 id를 가진 가장 최근 run을 찾는다.
   *
   * **agentKind와 cwd는 잠긴다** — 세션은 특정 CLI가 특정 디렉토리에서 만든
   * 것이라 다른 조합으로 이어받을 수 없다. 그 규칙이 여기 있어야 나중에
   * core를 별도 데몬으로 뗄 때 따라간다.
   */
  async function resume(input: ResumeRunInput): Promise<Run> {
    let root: Run
    try {
      root = opts.runs.get(input.conversationId)
    } catch (err) {
      // 없는 것과 못 읽는 것을 가른다. 전부 뭉개면 DB 장애가 "대화가 없다"로
      // 둔갑해 조사가 엉뚱한 데로 간다.
      if (err instanceof NotFoundError) {
        throw new Error('이어서 실행할 대화가 없습니다. workspace가 지워졌을 수 있습니다.')
      }
      throw err
    }

    const source = opts.runs.latestSessionRun(root.rootRunId ?? root.id)
    if (!source) {
      throw new Error('이어받을 세션이 없습니다. 새 실행으로 시작하세요.')
    }

    return launch({
      // 잠긴 값 — 세션을 준 run에서 가져온다
      workspaceId: source.workspaceId,
      agentKind: source.agentKind,
      cwd: source.cwd,
      resumeSessionId: source.externalSessionId,
      parentRunId: source.id,
      // 바꿀 수 있는 값
      model: input.model ?? null,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: input.context,
      // timeoutMs는 원본의 성질을 따른다 (설계 §6의 목록에 빠져 있던 자리다).
      timeoutMs: source.timeoutMs
    })
  }
```

- [ ] **Step 9: 렌더러 호출부를 맞춘다**

`renderer/components/RunPanel.tsx`의 `client.runs.resume({...})`에서 `parentRunId: resumeFrom.id`를 바꾼다.

```ts
        ? await client.runs.resume({
            // resumeFrom은 아직 개별 run이다 — 대화 UI는 Task 8에서 들어온다.
            conversationId: resumeFrom.rootRunId ?? resumeFrom.id,
```

- [ ] **Step 10: 통과와 전체 검증, 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/db/repositories/run.ts core/db/repositories/run.test.ts core/execution.ts \
        core/execution.test.ts shared/models.ts renderer/components/RunPanel.tsx
git commit -m "feat: resume from the latest run in a conversation that has a session"
```

---

### Task 3: 큐의 그룹 직렬화

**Files:**
- Modify: `core/runner/queue.ts`
- Modify: `core/execution.ts:245-255` (`queue.enqueue` 호출)
- Test: `core/runner/queue.test.ts`

**Interfaces:**
- Produces: `queue.enqueue(runId: string, start: () => void, groupKey?: string): void` — 같은 `groupKey`를 가진 run은 동시에 하나만 돈다. `undefined`면 제약 없음(기존 동작).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/runner/queue.test.ts`에 더한다.

```ts
  it('같은 그룹은 슬롯이 남아도 하나만 돈다', () => {
    const queue = createRunQueue({ limit: 3 })
    const started: string[] = []

    queue.enqueue('a1', () => started.push('a1'), 'conv-a')
    queue.enqueue('a2', () => started.push('a2'), 'conv-a')
    queue.enqueue('b1', () => started.push('b1'), 'conv-b')

    // 상한이 3인데도 conv-a는 하나만 떴다. conv-b는 막히지 않는다.
    expect(started).toEqual(['a1', 'b1'])
  })

  it('앞 턴이 끝나면 같은 그룹의 다음 턴이 뜬다', () => {
    const queue = createRunQueue({ limit: 3 })
    const started: string[] = []

    queue.enqueue('a1', () => started.push('a1'), 'conv-a')
    queue.enqueue('a2', () => started.push('a2'), 'conv-a')
    expect(started).toEqual(['a1'])

    queue.release('a1')
    expect(started).toEqual(['a1', 'a2'])
  })

  it('막힌 그룹을 건너뛰고 뒤의 다른 그룹을 띄운다', () => {
    const queue = createRunQueue({ limit: 1 })
    const started: string[] = []

    queue.enqueue('a1', () => started.push('a1'), 'conv-a')
    queue.enqueue('a2', () => started.push('a2'), 'conv-a')
    queue.enqueue('b1', () => started.push('b1'), 'conv-b')
    expect(started).toEqual(['a1'])

    // 상한을 올리면 대기열 앞의 a2가 아니라 b1이 뜬다 — a2의 그룹은 아직 막혀
    // 있다. 건너뛰지 않으면 한 대화가 뒤의 모든 대화를 막아버린다.
    queue.setLimit(3)
    expect(started).toEqual(['a1', 'b1'])
  })

  it('groupKey가 없으면 제약이 없다', () => {
    const queue = createRunQueue({ limit: 3 })
    const started: string[] = []
    queue.enqueue('x', () => started.push('x'), undefined)
    queue.enqueue('y', () => started.push('y'), undefined)
    expect(started).toEqual(['x', 'y'])
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- core/runner/queue.test.ts`
Expected: FAIL — 첫 테스트에서 `['a1','a2','b1']`이 나온다(그룹 제약이 없다)

- [ ] **Step 3: 큐를 고친다**

`core/runner/queue.ts`. `running`을 `Set`에서 `Map`으로 바꾼다.

```ts
  let limit = opts.limit
  /** runId → groupKey. 그룹 제약이 없으면 null */
  const running = new Map<string, string | null>()
  const waiting: { runId: string; groupKey: string | null; start: () => void }[] = []
  let pumping = false
```

`groupBusy`를 더하고 `pump`를 바꾼다.

```ts
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
```

`enqueue`를 바꾼다.

```ts
    enqueue(runId: string, start: () => void, groupKey?: string): void {
      waiting.push({ runId, groupKey: groupKey ?? null, start })
      pump()
      changed()
    },
```

`release`와 `snapshot`은 그대로 둔다 — `Map`도 `delete`와 `size`를 갖는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- core/runner/queue.test.ts`
Expected: PASS

- [ ] **Step 5: 테스트가 실제로 무언가를 지키는지 확인한다**

`pump`의 `findIndex` 조건에서 `!groupBusy(w.groupKey)`를 지우고 `waiting.shift()`로 되돌린다.

Run: `pnpm test -- core/runner/queue.test.ts`
Expected: FAIL — "같은 그룹은 슬롯이 남아도 하나만 돈다"가 깨진다. 확인했으면 되돌린다.

- [ ] **Step 6: execution이 그룹을 넘기게 한다**

`core/execution.ts`의 `launch()` 안 `opts.queue.enqueue(...)` 호출을 바꾼다. `created`는 이미 `rootRunId`를 갖고 있다(Task 1).

```ts
    opts.queue.enqueue(created.id, () => beginRun(created.id, {
      agentKind: spec.agentKind,
      cwd: spec.cwd,
      model: spec.model,
      permission: spec.permission,
      prompt: assembled,
      executable,
      mcp,
      resumeSessionId: spec.resumeSessionId,
      timeoutMs: spec.timeoutMs
    // 같은 대화의 두 턴이 동시에 뜨면 --resume이 깨진다 (설계 §3-2).
    }), created.rootRunId ?? created.id)
```

- [ ] **Step 7: 전체 검증과 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/runner/queue.ts core/runner/queue.test.ts core/execution.ts
git commit -m "feat: serialize runs within a conversation in the queue"
```

---

### Task 4: 예약된 턴의 세션을 실행 시점에 해석한다

**Files:**
- Modify: `core/execution.ts:80-155` (`beginRun`), `157-259` (`LaunchSpec`, `launch`), `resume`
- Test: `core/execution.test.ts`

**Interfaces:**
- Consumes: `runs.latestSessionRun` (Task 2), 큐의 `groupKey` (Task 3)
- Produces: `LaunchSpec`에서 `resumeSessionId: string | null`이 `resumeFromRootRunId: string | null`로 바뀐다. `beginRun`이 실행 직전에 체인을 다시 본다.

이 태스크가 "실행 중에 다음 말을 치면 예약된다"를 가능하게 한다. 예약 시점에는 앞 턴이 아직 안 끝나 세션 id가 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

먼저 `core/execution.test.ts`의 `createPerRunManager()`가 세션 id를 남길 수 있게 한다 — 지금은 항상 `externalSessionId: null`이다.

```ts
    finish(runId: string, sessionId: string | null = null) {
      const settle = settlers.get(runId)
      if (!settle) throw new Error(`시작한 적 없는 run입니다: ${runId}`)
      settlers.delete(runId)
      settle({
        status: 'succeeded',
        resultText: null,
        externalSessionId: sessionId,
        needsAnswer: false,
        exitCode: 0,
        errorMessage: null,
        logPath: logPathFor(runId)
      })
    }
```

그리고 테스트를 더한다. 이 manager는 우리가 `finish`를 부를 때까지 끝나지 않으므로 "1턴이 도는 중"을 결정적으로 재현한다.

```ts
  it('예약할 때 세션이 없어도 실행 시점에 앞 턴의 세션을 집는다', async () => {
    const fake = createPerRunManager()
    const ctx2 = setup({ manager: fake.manager, limit: 3 })
    const first = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    expect(first.status).toBe('running')

    // 1턴이 도는 중에 2턴을 예약한다. 아직 세션 id가 없다.
    const second = await ctx2.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
    })
    // 같은 대화라 슬롯이 둘 남아도 뜨지 않는다 (Task 3).
    expect(second.status).toBe('pending')
    expect(fake.started(second.id)).toBe(false)

    fake.finish(first.id, 'sess-1')

    // 이제 2턴이 뜨면서 그 세션을 집는다.
    await vi.waitFor(() => expect(fake.started(second.id)).toBe(true))
    expect(ctx2.runs.get(second.id).status).toBe('running')
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })

  it('예약한 사이 세션이 하나도 남지 않으면 실패로 끝난다', async () => {
    const fake = createPerRunManager()
    const ctx2 = setup({ manager: fake.manager, limit: 3 })
    const first = await ctx2.service.start({
      workspaceId: ctx2.workspaceId, agentKind: 'claude-code', cwd: process.cwd(),
      permission: 'edit', userPrompt: '1턴', context: []
    })
    const second = await ctx2.service.resume({
      conversationId: first.id, permission: 'edit', userPrompt: '2턴', context: []
    })

    // 1턴이 세션 없이 끝났다. 조용히 새 세션으로 시작하면 agent는 이전 대화를
    // 모르는 채 돌고, 사용자는 답이 이상해진 이유를 알 방법이 없다.
    fake.finish(first.id, null)

    await vi.waitFor(() => expect(ctx2.runs.get(second.id).status).toBe('failed'))
    const stored = ctx2.runs.get(second.id)
    expect(stored.errorMessage).toContain('이어받을 세션이 없습니다')
    // 프로세스는 뜬 적이 없다.
    expect(stored.startedAt).toBeNull()
    expect(fake.started(second.id)).toBe(false)
    rmSync(ctx2.logDir, { recursive: true, force: true })
  })
```

두 번째 테스트는 Task 2의 `resume()`이 **호출 시점에** 세션을 요구하므로 지금은 `resume` 자리에서 던진다. 이 태스크가 그 요구를 실행 시점으로 옮긴다. 옮기고 나면 Task 2의 "세션을 가진 run이 하나도 없으면 던진다"는 **`resume()`이 아니라 실행 시점 실패**를 보게 되므로, 그 테스트는 이 두 번째 테스트로 대체한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- core/execution.test.ts`
Expected: FAIL — 첫 테스트는 `resumeSessionId`가 `null`, 두 번째는 `resume()`이 던진다

- [ ] **Step 3: `LaunchSpec`과 `beginRun`을 바꾼다**

`core/execution.ts`. `beginRun`의 spec 타입에서 `resumeSessionId`를 빼고 `resumeFromRootRunId`를 넣는다.

```ts
  /** 슬롯을 얻은 run을 실제로 띄운다. 큐가 부른다. */
  function beginRun(runId: string, spec: {
    agentKind: AgentKind
    cwd: string
    model: string | null
    permission: Permission
    prompt: string
    executable: string
    mcp: McpRunConfig | null
    /** 이어받을 대화. null이면 새 세션이다 */
    resumeFromRootRunId: string | null
    timeoutMs: number | null
  }): void {
    // **세션은 여기서 고른다 — launch 시점이 아니다 (설계 §3-2).**
    // 실행 중에 예약된 턴은 만들어질 때 앞 턴이 아직 안 끝나 세션 id가 없다.
    // 슬롯을 받은 지금이 체인이 확정된 첫 순간이다.
    let resumeSessionId: string | null = null
    if (spec.resumeFromRootRunId) {
      const source = opts.runs.latestSessionRun(spec.resumeFromRootRunId)
      if (!source?.externalSessionId) {
        // 조용히 새 세션으로 시작하지 않는다 — agent는 이전 대화를 모르는 채로
        // 돌고, 사용자는 답이 이상해진 이유를 알 방법이 없다.
        finish(runId, {
          status: 'failed',
          resultText: null,
          externalSessionId: null,
          needsAnswer: false,
          exitCode: null,
          errorMessage: '이어받을 세션이 없습니다. 앞 턴이 세션을 남기지 못했습니다.'
        })
        return
      }
      resumeSessionId = source.externalSessionId
    }

    // ... 기존 markStarted 블록 그대로 ...
```

아래 `opts.manager.start({...})`의 `resumeSessionId: spec.resumeSessionId`를 지역 변수로 바꾼다.

```ts
      resumeSessionId,
```

- [ ] **Step 4: `LaunchSpec`과 `launch`를 바꾼다**

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
    /** 이어받을 대화. null이면 새 세션이다 */
    resumeFromRootRunId: string | null
    timeoutMs: number | null
  }
```

`launch()`의 `enqueue` 호출에서 넘기는 값을 바꾼다.

```ts
      mcp,
      resumeFromRootRunId: spec.resumeFromRootRunId,
      timeoutMs: spec.timeoutMs
```

- [ ] **Step 5: `start`와 `resume`을 맞춘다**

`start()`의 `resumeSessionId: null`을 바꾼다.

```ts
      resumeFromRootRunId: null,
```

`resume()`에서 세션 확인을 **덜어낸다** — 실행 시점으로 옮겼다. 대신 잠긴 값의 출처만 남는다.

```ts
    // 잠긴 값의 출처로만 쓴다. 세션 자체는 beginRun이 실행 직전에 다시 고른다
    // — 예약된 턴은 지금 세션이 없을 수 있다 (설계 §3-2).
    const source = opts.runs.latestSessionRun(root.rootRunId ?? root.id) ?? root

    return launch({
      workspaceId: source.workspaceId,
      agentKind: source.agentKind,
      cwd: source.cwd,
      resumeFromRootRunId: root.rootRunId ?? root.id,
      parentRunId: source.id,
      model: input.model ?? null,
      permission: input.permission,
      userPrompt: input.userPrompt,
      context: input.context,
      timeoutMs: source.timeoutMs
    })
```

Task 2에서 쓴 "세션을 가진 run이 하나도 없으면 던진다" 테스트는 이제 **실행 시점 실패**로 성격이 바뀐다. 그 테스트를 Step 1의 두 번째 테스트로 대체한다.

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm test -- core/execution.test.ts`
Expected: PASS

- [ ] **Step 7: 지연 해석이 실제로 검증되는지 확인한다**

`beginRun`의 `latestSessionRun` 호출을 `spec.resumeFromRootRunId`를 그대로 세션 id로 쓰도록 잠시 바꾼다.

Run: `pnpm test -- core/execution.test.ts`
Expected: FAIL — "실행 시점에 앞 턴의 세션을 집는다"가 깨진다. 확인했으면 되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/execution.ts core/execution.test.ts
git commit -m "feat: resolve the resumed session when the turn actually starts"
```

---

### Task 5: 인박스를 대화 단위로 올린다

**Files:**
- Modify: `core/db/repositories/run.ts:213-234` (`inbox`, `inboxCounts`)
- Test: `core/db/repositories/run.test.ts`

**Interfaces:**
- Produces: `runs.inbox()`가 **대화당 한 줄**을 돌려준다. 각 항목은 그 대화의 **마지막 턴**이고, `rootRunId`가 대화 id다. 미확인 판정은 root run의 `reviewedAt`으로 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
  describe('대화 단위 인박스', () => {
    function succeed(id: string, sessionId = 'sess') {
      runs.markFinished(id, {
        status: 'succeeded', resultText: null, externalSessionId: sessionId,
        needsAnswer: false, exitCode: 0, errorMessage: null
      })
    }

    it('3턴 대화가 인박스에 한 줄로 뜬다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      succeed(second.id)
      const third = runs.create({ ...baseInput(), parentRunId: second.id })
      succeed(third.id)

      const items = runs.inbox()
      expect(items).toHaveLength(1)
      // 보여줄 내용은 마지막 턴에서 온다.
      expect(items[0]!.id).toBe(third.id)
      expect(items[0]!.rootRunId).toBe(first.id)
    })

    it('root를 확인하면 대화가 통째로 내려간다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      succeed(second.id)

      runs.markReviewed(first.id, 'confirmed')
      expect(runs.inbox()).toHaveLength(0)
      expect(runs.inboxCounts().total).toBe(0)
    })

    it('마지막 턴이 아직 돌고 있으면 인박스에 없다', () => {
      const first = runs.create(baseInput())
      succeed(first.id)
      const second = runs.create({ ...baseInput(), parentRunId: first.id })
      runs.markStarted(second.id)

      expect(runs.inbox()).toHaveLength(0)
    })

    it('건수도 대화 단위로 센다', () => {
      const a = runs.create(baseInput())
      succeed(a.id)
      const a2 = runs.create({ ...baseInput(), parentRunId: a.id })
      succeed(a2.id)
      const b = runs.create(baseInput())
      succeed(b.id)

      expect(runs.inboxCounts().total).toBe(2)
      expect(runs.inboxCounts().byWorkspace[workspaceId]).toBe(2)
    })
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- core/db/repositories/run.test.ts`
Expected: FAIL — 첫 테스트에서 3줄이 나온다

- [ ] **Step 3: 구현한다**

`core/db/repositories/run.ts`. `inbox`를 `return {}` **위쪽에** 이름 있는 함수로 옮긴다(그래야 `inboxCounts`가 부를 수 있다). `get`, `rootFor` 옆에 둔다.

```ts
  /**
   * 지금 사용자의 손이 필요한 대화만 모은다 (설계 §5).
   *
   * **단위는 run이 아니라 대화다.** 미확인 판정은 root run의 reviewedAt으로
   * 하고, 보여줄 내용은 그 대화의 마지막 턴에서 가져온다. 턴마다 한 줄씩
   * 쌓이면 긴 대화 하나가 인박스를 덮어버린다.
   *
   * 모든 workspace를 가로지른다 — 어디에 쌓였는지는 사이드바 배지가 보여준다.
   */
  function inbox(): Run[] {
    // 미확인인 뿌리들. 낡은 행은 root_run_id가 null이고 그때는 자기 자신이 뿌리다.
    const roots = db.select({ id: run.id }).from(run)
      .where(and(
        isNull(run.reviewedAt),
        or(isNull(run.rootRunId), eq(run.rootRunId, run.id))
      )).all()
    if (roots.length === 0) return []

    const rootIds = roots.map((r) => r.id)
    const rows = db.select().from(run)
      .where(or(inArray(run.rootRunId, rootIds), inArray(run.id, rootIds)))
      // 최신순이므로 대화별 첫 행이 마지막 턴이다.
      .orderBy(desc(run.createdAt), desc(sql`rowid`)).all()

    const rootOf = new Set(rootIds)
    const lastTurn = new Map<string, typeof rows[number]>()
    for (const row of rows) {
      const key = row.rootRunId ?? row.id
      // 뿌리가 이미 확인된 대화의 턴이 섞여 들어올 수 있다 — 걸러낸다.
      if (!rootOf.has(key)) continue
      if (!lastTurn.has(key)) lastTurn.set(key, row)
    }

    const items = [...lastTurn.values()]
      .filter((r) => INBOX_STATUSES.includes(r.status))
      // endedAt만으로는 같은 밀리초에 끝난 항목들의 순서가 흔들린다.
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    return hydrate(items)
  }
```

`return {}` 안에서 `inbox,`로 노출하고 `inboxCounts`를 바꾼다.

```ts
    inbox,

    inboxCounts(): InboxCounts {
      // 목록과 같은 규칙으로 센다 — 따로 세면 배지와 목록이 어긋난다.
      const byWorkspace: Record<string, number> = {}
      let total = 0
      for (const item of inbox()) {
        byWorkspace[item.workspaceId] = (byWorkspace[item.workspaceId] ?? 0) + 1
        total += 1
      }
      return { total, byWorkspace }
    },
```

`count`와 `groupBy` import가 더 이상 쓰이지 않으면 지운다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- core/db/repositories/run.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 검증과 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add core/db/repositories/run.ts core/db/repositories/run.test.ts
git commit -m "feat: group the inbox by conversation instead of by run"
```

기존 `e2e/inbox.e2e.ts`가 깨질 수 있다. 깨지면 **대화 단위 기대값으로 고친다** — 되돌리지 않는다.

---

### Task 6: 렌더러의 대화 파생

**Files:**
- Create: `renderer/conversation.ts`
- Test: `renderer/conversation.test.ts`

**Interfaces:**
- Produces: `conversationIdOf(run: Run): string`
- Produces: `titleOf(run: Run): string`
- Produces: `groupConversations(runs: Run[]): Conversation[]` — `Conversation`은 `{ id: string; runs: Run[]; last: Run; title: string }`. `runs`는 **오래된 순**, 대화 목록은 마지막 활동이 최근인 순.

`useRuns(workspaceId)`는 건드리지 않는다 — 평평한 목록을 최신순으로 주는 지금 동작이 그대로 맞다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`renderer/conversation.test.ts`를 만든다.

```ts
import { describe, it, expect } from 'vitest'
import { conversationIdOf, groupConversations, titleOf } from './conversation'
import type { Run } from '@shared/models'

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'ws', agentKind: 'claude-code', model: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], ...over
  }
}

describe('conversationIdOf', () => {
  it('rootRunId가 없는 낡은 행은 자기 자신이 뿌리다', () => {
    expect(conversationIdOf(makeRun({ id: 'a', rootRunId: null }))).toBe('a')
  })
})

describe('groupConversations', () => {
  // useRuns는 최신순으로 준다.
  const runs = [
    makeRun({ id: 'a3', rootRunId: 'a1', createdAt: 30, userPrompt: '3턴' }),
    makeRun({ id: 'b1', rootRunId: 'b1', createdAt: 25, userPrompt: '다른 대화' }),
    makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, userPrompt: '2턴' }),
    makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '첫 지시' })
  ]

  it('같은 뿌리를 한 대화로 묶는다', () => {
    const convs = groupConversations(runs)
    expect(convs.map((c) => c.id)).toEqual(['a1', 'b1'])
  })

  it('턴은 오래된 순이다 — 대화록은 위에서 아래로 읽는다', () => {
    const [a] = groupConversations(runs)
    expect(a!.runs.map((r) => r.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('마지막 턴과 제목이 서로 다른 턴에서 온다', () => {
    const [a] = groupConversations(runs)
    // 제목은 첫 턴, 상태는 마지막 턴.
    expect(a!.title).toBe('첫 지시')
    expect(a!.last.id).toBe('a3')
  })

  it('마지막 활동이 최근인 대화가 앞에 온다', () => {
    const older = makeRun({ id: 'c1', rootRunId: 'c1', createdAt: 5 })
    expect(groupConversations([...runs, older]).map((c) => c.id)).toEqual(['a1', 'b1', 'c1'])
  })
})

describe('titleOf', () => {
  it('첫 줄만 쓰고 24자에서 자른다', () => {
    expect(titleOf(makeRun({ id: 'a', userPrompt: '첫 줄\n둘째 줄' }))).toBe('첫 줄')
    expect(titleOf(makeRun({ id: 'a', userPrompt: 'x'.repeat(30) }))).toBe(`${'x'.repeat(24)}…`)
  })

  it('빈 지시도 이름을 갖는다', () => {
    expect(titleOf(makeRun({ id: 'a', userPrompt: '   ' }))).toBe('(빈 지시)')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- renderer/conversation.test.ts`
Expected: FAIL — `renderer/conversation.ts`가 없다

- [ ] **Step 3: 구현한다**

`renderer/conversation.ts`를 만든다.

```ts
import type { Run } from '@shared/models'

/**
 * 한 대화. run 목록에서 파생하며 저장되지 않는다 (설계 §2).
 * inbox.ts가 status에서 카테고리를 파생하는 것과 같은 패턴이다.
 */
export interface Conversation {
  /** root run의 id */
  id: string
  /** 오래된 순 — 대화록은 위에서 아래로 읽는다 */
  runs: Run[]
  last: Run
  title: string
}

/** 낡은 행은 rootRunId가 없다 — 그때는 자기 자신이 뿌리다 (설계 §2). */
export function conversationIdOf(run: Run): string {
  return run.rootRunId ?? run.id
}

/** 대화의 이름. 첫 턴의 지시 첫 줄이다. */
export function titleOf(run: Run): string {
  const text = run.userPrompt.trim().split('\n')[0] ?? ''
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || '(빈 지시)'
}

/**
 * 최신순 run 목록을 대화 목록으로 묶는다.
 *
 * useRuns는 최신순으로 준다. 대화록은 오래된 순으로 읽으므로 안에서 뒤집는다.
 */
export function groupConversations(runs: Run[]): Conversation[] {
  const byId = new Map<string, Run[]>()
  for (const run of runs) {
    const id = conversationIdOf(run)
    const list = byId.get(id)
    if (list) list.push(run)
    else byId.set(id, [run])
  }

  const out: Conversation[] = []
  for (const [id, list] of byId) {
    const ordered = [...list].reverse()
    out.push({
      id,
      runs: ordered,
      last: ordered[ordered.length - 1]!,
      title: titleOf(ordered[0]!)
    })
  }
  return out.sort((a, b) => b.last.createdAt - a.last.createdAt)
}
```

- [ ] **Step 4: 통과와 커밋**

```bash
pnpm test -- renderer/conversation.test.ts && pnpm typecheck && pnpm lint
git add renderer/conversation.ts renderer/conversation.test.ts
git commit -m "feat: derive conversations from the flat run list"
```

---

### Task 7: `Transcript` — 대화록

**Files:**
- Create: `renderer/components/Transcript.tsx`
- Modify: `renderer/index.css`
- Test: `renderer/components/Transcript.test.tsx`

**Interfaces:**
- Consumes: `Conversation` (Task 6), 기존 `RunLog`, 기존 `useRunEvents`
- Produces: `<Transcript conversation={c} onCancel={(runId) => void} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`renderer/components/Transcript.test.tsx`를 만든다. `renderer/vitest.setup.ts`가 이미 testing-library를 세운다. `useRunEvents`가 `useClient()`를 부르므로 **접힌 턴에서는 마운트하지 않는 것**이 이 테스트로 검증된다.

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transcript } from './Transcript'
import { groupConversations } from '../conversation'
import type { Run } from '@shared/models'

vi.mock('../hooks/useRunEvents', () => ({
  useRunEvents: () => ({ events: [{ type: 'text', seq: 1, runId: 'a1', at: 0, text: '도구 로그' }], error: null })
}))

function makeRun(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'ws', agentKind: 'claude-code', model: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], ...over
  }
}

describe('Transcript', () => {
  it('턴마다 지시와 답변을 그린다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '첫 지시', resultText: '첫 답변' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.getByText('첫 지시')).toBeInTheDocument()
    expect(screen.getByText('첫 답변')).toBeInTheDocument()
  })

  it('지난 턴의 로그는 접혀 있고 눌러야 펼쳐진다', async () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'succeeded', resultText: '답변' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.queryByText('도구 로그')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '자세히' }))
    expect(screen.getByText('도구 로그')).toBeInTheDocument()
  })

  it('진행 중인 턴은 로그가 처음부터 펼쳐져 있다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.getByText('도구 로그')).toBeInTheDocument()
  })

  it('예약된 턴은 대기 중으로 보이고 취소할 수 있다', async () => {
    const onCancel = vi.fn()
    const conv = groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending', userPrompt: '예약된 말' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'succeeded' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={onCancel} />)
    expect(screen.getByText('대기 중')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledWith('a2')
  })

  it('답변 필요 배지를 단다', () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', needsAnswer: true, resultText: '무엇을 할까요?' })
    ])[0]!
    render(<Transcript conversation={conv} onCancel={() => {}} />)
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- renderer/components/Transcript.test.tsx`
Expected: FAIL — `Transcript`가 없다

- [ ] **Step 3: 구현한다**

`renderer/components/Transcript.tsx`를 만든다.

```tsx
import { useState } from 'react'
import { RunLog } from './RunLog'
import { useRunEvents } from '../hooks/useRunEvents'
import type { Conversation } from '../conversation'
import type { Run } from '@shared/models'

/**
 * 한 턴의 로그. **펼쳐졌을 때만 마운트한다** — 접힌 턴까지 훅을 걸면 대화를
 * 열 때마다 모든 턴의 로그 파일을 읽는다 (설계 §4-1).
 */
function TurnLog({ runId }: { runId: string }) {
  const { events, error } = useRunEvents(runId)
  return (
    <>
      {error && <div role="alert" className="form-error">{error}</div>}
      <RunLog events={events} />
    </>
  )
}

function Turn({ run, onCancel }: { run: Run; onCancel: (runId: string) => void }) {
  const live = run.status === 'running'
  // 진행 중인 턴은 처음부터 펼쳐져 있다. 지난 턴은 접혀 있다.
  const [open, setOpen] = useState(live)

  if (run.status === 'pending') {
    return (
      <div className="turn turn-pending">
        <div className="turn-user">{run.userPrompt}</div>
        <div className="turn-meta">
          <span>대기 중</span>
          <button type="button" onClick={() => onCancel(run.id)}>취소</button>
        </div>
      </div>
    )
  }

  return (
    <div className="turn">
      <div className="turn-user">{run.userPrompt}</div>
      {run.errorMessage && <div role="alert" className="form-error">{run.errorMessage}</div>}
      {run.resultText && <div className="turn-answer">{run.resultText}</div>}
      <div className="turn-meta">
        <span className={`status status-${run.status}`}>{run.status}</span>
        {/* succeeded로 끝나도 agent가 질문하고 멈춘 것일 수 있다. */}
        {run.needsAnswer && <span className="needs-answer">답변 필요</span>}
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? '접기' : '자세히'}
        </button>
      </div>
      {open && <TurnLog runId={run.id} />}
    </div>
  )
}

export function Transcript({
  conversation, onCancel
}: {
  conversation: Conversation
  onCancel: (runId: string) => void
}) {
  return (
    <div className="transcript">
      {conversation.runs.map((run) => (
        <Turn key={run.id} run={run} onCancel={onCancel} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 스타일을 더한다**

`renderer/index.css` 끝에 더한다. 기존 `.log-*`, `.status`, `.needs-answer`는 그대로 쓴다.

```css
/* 대화록 — 턴 버블 (설계 §4-1) */
.transcript { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; padding: 8px 4px; }
.turn { display: flex; flex-direction: column; gap: 6px; }
.turn-user { align-self: flex-end; max-width: 80%; border-radius: 10px; background: #eff6ff; padding: 8px 11px; white-space: pre-wrap; }
.turn-answer { align-self: flex-start; max-width: 90%; border-radius: 10px; background: #f4f4f5; padding: 8px 11px; white-space: pre-wrap; }
.turn-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: .8; }
.turn-meta button { border: 1px solid #e4e4e7; border-radius: 5px; background: #fff; cursor: pointer; font: inherit; font-size: 11px; padding: 2px 8px; }
.turn-pending { opacity: .7; }
```

- [ ] **Step 5: 통과와 커밋**

```bash
pnpm test -- renderer/components/Transcript.test.tsx && pnpm typecheck && pnpm lint
git add renderer/components/Transcript.tsx renderer/components/Transcript.test.tsx renderer/index.css
git commit -m "feat: add the conversation transcript with per-turn log expansion"
```

---

### Task 8: `ConversationPanel`과 도크 재편

**Files:**
- Create: `renderer/components/ConversationPanel.tsx`
- Modify: `renderer/components/RunPanel.tsx`
- Modify: `renderer/components/Dock.tsx`
- Test: `renderer/components/ConversationPanel.test.tsx`, `renderer/components/Dock.test.tsx`

**Interfaces:**
- Consumes: `groupConversations`, `titleOf` (Task 6), `Transcript` (Task 7)
- Produces: `<ConversationPanel conversation={c | null} ... />` — `null`이면 새 대화(대화록이 비어 있고 작업 디렉토리를 고를 수 있다)
- Produces: `RunPanel`이 `resumeFrom: Run | null` 대신 `conversation: Conversation | null`을 받고, `onExitResume`이 빠지고, `reserved: boolean`이 더해진다
- Produces: `Dock`이 `resumeFrom`·`onExitResume`·`focusRun` 대신 `focusConversationId: string | null`을 받는다

- [ ] **Step 1: `RunPanel`을 입력부로 바꾼다**

`renderer/components/RunPanel.tsx`:

- prop `resumeFrom: Run | null` → `conversation: Conversation | null`
- prop `onExitResume` 제거 — 대화를 벗어나는 것은 도크 탭이 한다
- `ready` 판정: `conversation !== null || (cwd !== '' && missingCwd === null)`
- 권한 초기화 effect 둘의 `resumeFrom`을 `conversation`으로 바꾼다. 대화가 있으면 **마지막 턴의 권한**에서 출발한다.

```tsx
  // 대화를 이어갈 때는 마지막 턴의 권한에서 출발한다. 낮추면 조용히 깎이고,
  // 올리는 것은 사용자의 판단이다 (설계 §7).
  useEffect(() => {
    if (conversation) setPermission(conversation.last.permission)
  }, [conversation])

  useEffect(() => {
    if (workspace && !conversation) setPermission(workspace.defaultPermission)
  }, [workspace, conversation])
```

- 실행 호출을 바꾼다.

```tsx
      const run = conversation
        ? await client.runs.resume({
            conversationId: conversation.id,
            model: model.trim() || null,
            permission,
            userPrompt: prompt,
            context: chips.map(({ type, id }) => ({ type, id }))
          })
        : await client.runs.start({ /* 기존 그대로 */ })
```

- 잠긴 값 표시에서 `resume-locked` 블록을 바꾼다. "새 실행으로" 버튼은 지운다.

```tsx
        {conversation ? (
          <div className="resume-locked">
            <span className="resume-badge">대화 이어가기</span>
            {/* 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 둘은 바꿀 수 없다 (설계 §6). */}
            <span>{conversation.last.agentKind}</span>
            <span>{conversation.last.cwd}</span>
          </div>
        ) : ( /* 기존 작업 디렉토리 select 그대로 */ )}
```

- [ ] **Step 2: `ConversationPanel` 테스트를 쓴다**

```tsx
  it('예약이 이미 있으면 전송이 잠긴다', async () => {
    // 대화당 예약은 하나다 (설계 §3-2).
    const conv = groupConversations([
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, status: 'pending' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, status: 'running' })
    ])[0]!
    renderPanel(conv)
    await userEvent.type(screen.getByRole('textbox', { name: /지시/ }), '또 하나')
    expect(screen.getByRole('button', { name: '실행' })).toBeDisabled()
  })

  it('실행 중이어도 입력은 받는다', async () => {
    const conv = groupConversations([
      makeRun({ id: 'a1', rootRunId: 'a1', status: 'running' })
    ])[0]!
    renderPanel(conv)
    const box = screen.getByRole('textbox', { name: /지시/ })
    await userEvent.type(box, '다음 말')
    expect(box).toHaveValue('다음 말')
    expect(screen.getByRole('button', { name: '실행' })).toBeEnabled()
  })
```

`renderPanel`은 `ClientProvider`로 감싸 `client.runs.resume`을 가짜로 주는 헬퍼다 — `renderer/components/RunPanel.test.tsx`의 기존 방식을 그대로 따른다.

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm test -- renderer/components/ConversationPanel.test.tsx`
Expected: FAIL — 컴포넌트가 없다

- [ ] **Step 4: `ConversationPanel`을 만든다**

```tsx
import { Transcript } from './Transcript'
import { RunPanel } from './RunPanel'
import type { Conversation } from '../conversation'
import type { ContextChip } from '../context'
import type { Repo, Run, Workspace } from '@shared/models'

/**
 * 대화 하나. 위는 대화록, 아래는 입력이다 (설계 §4-1).
 *
 * 새 대화는 conversation이 null일 뿐 같은 컴포넌트다 — 대화록이 비어 있고
 * 입력부가 작업 디렉토리를 고르게 한다.
 */
export function ConversationPanel({
  conversation, workspaceId, workspaces, repos, reposError, chips, onRemoveChip,
  onStarted, onCancel, draftPrompt, draftCwd
}: {
  conversation: Conversation | null
  workspaceId: string
  workspaces: Workspace[]
  repos: Repo[]
  reposError: string | null
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onStarted: (run: Run) => void
  onCancel: (runId: string) => void
  draftPrompt: string
  draftCwd: string | null
}) {
  // 대화당 예약은 하나다. 이미 있으면 입력부가 전송을 잠근다 (설계 §3-2).
  const reserved = conversation?.runs.some((r) => r.status === 'pending') ?? false

  return (
    <div className="conversation-panel">
      {conversation
        ? <Transcript conversation={conversation} onCancel={onCancel} />
        : <div className="panel-empty">지시를 입력하면 대화가 시작됩니다</div>}
      <RunPanel
        conversation={conversation}
        workspaceId={workspaceId}
        workspaces={workspaces}
        repos={repos}
        reposError={reposError}
        chips={chips}
        onRemoveChip={onRemoveChip}
        onStarted={onStarted}
        draftPrompt={draftPrompt}
        draftCwd={draftCwd}
        reserved={reserved}
      />
    </div>
  )
}
```

`RunPanel`에 `reserved: boolean` prop을 더하고 `ready` 판정에 `&& !reserved`를 넣는다.

- [ ] **Step 5: 도크를 대화 단위로 바꾼다**

`renderer/components/Dock.tsx`:

- 지역 `label()`을 지우고 `titleOf`를 쓴다 (Task 6)
- `const conversations = useMemo(() => groupConversations(runs), [runs])`
- `view: 'log' | 'new'` → `'conversation' | 'new'`
- `pickedId`는 **대화 id**를 든다
- `focusRun` prop → `focusConversationId: string | null`
- `resumeFrom`, `onExitResume` prop 제거
- 탭 이름 `+ 새 실행` → `+ 새 대화`, 탭 하나가 `conversations`의 항목 하나
- 탭의 상태 배지와 `답변 필요`는 `conv.last`에서 온다
- 취소 버튼은 `conv.last`가 `running`/`pending`일 때 보인다
- 본문은 항상 `ConversationPanel` — `view === 'new'`면 `conversation={null}`

```tsx
  const selected = conversations.find((c) => c.id === pickedId) ?? null

  useEffect(() => {
    if (!focusConversationId) return
    setPickedId(focusConversationId)
    setView('conversation')
    setOpen(true)
  }, [focusConversationId])
```

- [ ] **Step 6: 도크 테스트를 갱신한다**

`renderer/components/Dock.test.tsx`의 기존 기대값을 대화 단위로 고친다. 최소한 다음을 지킨다.

```tsx
  it('3턴 대화가 탭 하나로 뜬다', () => {
    renderDock([
      makeRun({ id: 'a3', rootRunId: 'a1', createdAt: 30 }),
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20 }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '첫 지시' })
    ])
    expect(screen.getAllByRole('button', { name: /첫 지시/ })).toHaveLength(1)
  })

  it('focusConversationId가 그 대화를 연다', () => {
    renderDock([makeRun({ id: 'a1', rootRunId: 'a1', userPrompt: '첫 지시' })], 'a1')
    expect(screen.getByText('첫 지시')).toBeInTheDocument()
  })
```

- [ ] **Step 7: 통과와 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add renderer/components/ConversationPanel.tsx renderer/components/ConversationPanel.test.tsx \
        renderer/components/RunPanel.tsx renderer/components/Dock.tsx renderer/components/Dock.test.tsx
git commit -m "feat: turn the dock into a conversation panel"
```

---

### Task 9: `App.tsx` 배선과 인박스 버튼 통합

**Files:**
- Modify: `renderer/App.tsx`
- Modify: `renderer/components/InboxPanel.tsx`
- Test: `renderer/App.test.tsx`, `renderer/components/InboxPanel.test.tsx`

**Interfaces:**
- Consumes: Task 8의 `Dock` prop들
- Produces: `InboxPanel`이 `onOpenLog`/`onResume` 대신 `onOpenConversation: (run: Run) => void` 하나를 받는다

**이 태스크가 3a·3b에서 두 번 새어나간 자리다.** `App.tsx`가 자식에게 내려보내는 prop 한 줄은 그 자체로 되돌릴 수 있는 변이다 — 지우거나 다른 값을 넘겨도 테스트가 잡아야 한다.

- [ ] **Step 1: 배선 테스트를 먼저 쓴다**

`renderer/App.test.tsx`에 더한다. 이 파일은 `makeRun(over: Partial<Run> = {})`과 `makeClient(runsOver, seed)`를 이미 갖고 있고, `seed.inbox`로 인박스 항목을 심는다. 기존 테스트가 `makeClient`를 어떻게 렌더링에 물리는지 그대로 따른다.

```tsx
  it('인박스의 "대화 열기"가 그 대화를 도크에 연다', async () => {
    // 인박스 항목은 대화의 마지막 턴이다 — 도크가 열어야 하는 것은 그 뿌리다.
    const turns = [
      makeRun({ id: 'a2', rootRunId: 'a1', createdAt: 20, userPrompt: '2턴' }),
      makeRun({ id: 'a1', rootRunId: 'a1', createdAt: 10, userPrompt: '첫 지시' })
    ]
    const client = makeClient({ list: async () => turns }, { inbox: [turns[0]!] })
    renderApp(client)

    await userEvent.click(screen.getByRole('button', { name: /인박스/ }))
    await userEvent.click(screen.getByRole('button', { name: '대화 열기' }))

    // 도크가 그 대화를 열었다 — 첫 턴까지 대화록에 보인다.
    expect(await screen.findByText('첫 지시')).toBeInTheDocument()
  })

  it('확인함은 마지막 턴이 아니라 대화의 뿌리에 기록한다', async () => {
    const markReviewed = vi.fn().mockResolvedValue(undefined)
    const last = makeRun({ id: 'a2', rootRunId: 'a1', userPrompt: '2턴' })
    const client = makeClient({ markReviewed }, { inbox: [last] })
    renderApp(client)

    await userEvent.click(screen.getByRole('button', { name: /인박스/ }))
    await userEvent.click(screen.getByRole('button', { name: '확인함' }))

    // 'a2'로 찍으면 대화가 인박스에서 내려가지 않는다 — Task 5의 판정은 뿌리 기준이다.
    expect(markReviewed).toHaveBeenCalledWith('a1', 'confirmed')
  })
```

`renderApp(client)`은 이 파일이 이미 쓰는 렌더링 방식이다(`ClientProvider`로 감싸 `<App />`을 그린다). 이름이 다르면 그쪽을 따른다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- renderer/App.test.tsx`
Expected: FAIL — "대화 열기" 버튼이 없고, `markReviewed`가 `'a2'`로 불린다

- [ ] **Step 3: `App.tsx`를 고친다**

- `const [resumeFrom, setResumeFrom] = useState<Run | null>(null)` 제거
- `const [focusRun, setFocusRun] = useState<Run | null>(null)` → `const [focusConversationId, setFocusConversationId] = useState<string | null>(null)`
- `openLog`와 `startResume`을 하나로 합친다

```tsx
  /**
   * 인박스 항목을 그 대화로 데려간다.
   *
   * 항목은 대화의 마지막 턴이므로 여는 것은 그 뿌리다. 대화창이 대화록과
   * 입력을 함께 주므로 "로그 보기"와 "이어서 실행"이 하나로 합쳐졌다 (설계 §5).
   */
  function openConversation(run: Run) {
    goToRun(run)
    setDraftPrompt('')
    setDraftCwd(null)
    setFocusConversationId(conversationIdOf(run))
  }
```

- `restart`에서 `setResumeFrom(null)`을 지우고 `setFocusRun(null)` → `setFocusConversationId(null)`
- `review`는 그대로 두되 **호출부가 뿌리를 넘긴다** — `InboxPanel`의 `onReview` 호출을 바꾸는 대신 여기서 감싼다

```tsx
  function reviewConversation(run: Run, kind: 'confirmed' | 'archived') {
    // 인박스 항목은 마지막 턴이다. 확인 표시는 뿌리에 남아야 대화가 내려간다.
    review(conversationIdOf(run), kind)
  }
```

- `makeIssue`의 `review(run.id, 'archived')`도 `review(conversationIdOf(run), 'archived')`로 바꾼다
- `InboxPanel`과 `Dock`에 내려보내는 prop을 맞춘다

```tsx
          <InboxPanel
            items={inboxItems}
            workspaces={workspaces}
            error={inboxActionError ?? inboxError}
            onReview={reviewConversation}
            onOpenConversation={openConversation}
            onRestart={restart}
            onCloseIssue={closeIssue}
            onMakeIssue={makeIssue}
          />
```

```tsx
            <Dock
              runs={runs}
              /* ... 기존 그대로 ... */
              draftPrompt={draftPrompt}
              draftCwd={draftCwd}
              focusConversationId={focusConversationId}
              // 담은 맥락은 그 턴에만 적용된다. 다음 턴은 빈 상태에서 시작한다.
              onRunStarted={() => { setChips([]); setDraftPrompt(''); setDraftCwd(null) }}
            />
```

`import { conversationIdOf } from './conversation'`을 더한다.

- [ ] **Step 4: `InboxPanel`을 고친다**

- prop `onOpenLog`, `onResume` → `onOpenConversation: (run: Run) => void`
- `onReview: (runId: string, kind: ...) => void` → `onReview: (run: Run, kind: ...) => void`
- 버튼 둘을 하나로 바꾼다

```tsx
                  <button type="button" onClick={() => onOpenConversation(run)}>
                    대화 열기
                  </button>
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm test -- renderer/App.test.tsx renderer/components/InboxPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: 배선 변이를 돌린다**

**세 가지를 하나씩 망가뜨리고 매번 테스트가 빨간지 확인한다.** 하나라도 초록이면 그 자리는 무방비다 — 테스트를 보강한 뒤 다음으로 넘어간다.

1. `Dock`의 `focusConversationId={focusConversationId}` 줄을 지운다 → "대화 열기" 테스트가 실패해야 한다
2. `reviewConversation`을 `review(run.id, kind)`로 되돌린다 → "뿌리에 기록한다" 테스트가 실패해야 한다
3. `InboxPanel`의 `onReview={reviewConversation}`을 `onReview={() => {}}`로 바꾼다 → 같은 테스트가 실패해야 한다

- [ ] **Step 7: 전체 검증과 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
grep -rn "window.oneDesk" renderer/ | grep -v main.tsx   # 출력 없어야 함
grep -rn "from 'electron'" core/                          # 출력 없어야 함
git add renderer/App.tsx renderer/App.test.tsx renderer/components/InboxPanel.tsx \
        renderer/components/InboxPanel.test.tsx
git commit -m "feat: open conversations from the inbox with a single action"
```

---

### Task 10: e2e — 3턴 대화

**Files:**
- Create: `e2e/conversation.e2e.ts`
- Modify: `e2e/inbox.e2e.ts` (대화 단위 기대값)

**Interfaces:**
- Consumes: 앞의 모든 태스크. `e2e/driver.ts`의 기존 헬퍼와 `core/runner/fixtures/fake-claude.mjs`를 쓴다.

- [ ] **Step 1: 시나리오를 쓴다**

`e2e/conversation.e2e.ts`를 만든다. `launchApp()`은 `onTestFinished`로 정리를 스스로 예약하므로 **테스트가 직접 닫지 않는다**. workspace·repo 준비는 `e2e/core-loop.e2e.ts`의 1~2단계를 그대로 따른다.

가짜 CLI는 `ONE_DESK_FAKE_DELAY_MS`로 지연을 낼 수 있다(`core/runner/fixtures/fake-claude.mjs:39`). 1턴이 도는 동안 2턴을 칠 시간을 만들려면 `launchApp()`에 그 환경변수를 실어야 한다 — `LaunchOptions`에 통로가 없으면 더한다.

```ts
import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

describe('대화', () => {
  it('한 세션에서 세 턴을 주고받고 인박스에는 한 줄만 남는다', async () => {
    const app = await launchApp({ env: { ONE_DESK_FAKE_DELAY_MS: '1500' } })
    const page = app.page

    // workspace와 repo 준비 (core-loop.e2e.ts의 1~2단계와 같다)
    await page.getByPlaceholder('새 workspace 이름…').fill('conv-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: 'conv-ws' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    const prompt = page.getByRole('textbox', { name: /지시/ })
    const send = page.getByRole('button', { name: '실행' })

    // 1턴
    await prompt.fill('첫 지시')
    await send.click()
    await expect(page.getByText('첫 지시')).toBeVisible()

    // 2턴 — 1턴이 도는 중에 보낸다. 예약 버블이 생기고 전송이 잠긴다.
    await prompt.fill('둘째 지시')
    await send.click()
    await expect(page.getByText('대기 중')).toBeVisible()
    await expect(send).toBeDisabled()

    // 1턴이 끝나면 2턴이 자동으로 뜬다.
    await expect(page.getByText('대기 중')).toBeHidden({ timeout: 20_000 })
    await expect(send).toBeEnabled({ timeout: 20_000 })

    // 3턴
    await prompt.fill('셋째 지시')
    await send.click()
    await expect(page.getByText('셋째 지시')).toBeVisible()

    // 대화록에 턴이 셋, 도크 탭은 하나다.
    await expect(page.locator('.turn')).toHaveCount(3, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: /첫 지시/ })).toHaveCount(1)

    // 인박스에는 대화가 한 줄이다.
    await page.getByRole('button', { name: /인박스/ }).click()
    await expect(page.locator('.inbox-list > li')).toHaveCount(1, { timeout: 20_000 })

    // 확인하면 내려간다.
    await page.getByRole('button', { name: '확인함' }).click()
    await expect(page.locator('.inbox-list > li')).toHaveCount(0)
  })
})
```

셀렉터(`.turn`, `.inbox-list > li`, `실행` 버튼 이름)는 Task 7~9에서 실제로 만든 것과 맞춘다. 어긋나면 **테스트가 아니라 기대값을 코드에 맞춘다** — 다만 역할·이름으로 잡을 수 있으면 클래스보다 그쪽을 쓴다.

- [ ] **Step 2: 화면을 벗어나지 않고 확인한다**

**2~5번은 인박스로 갔다 오지 않고 확인한다.** 다른 화면에 갔다 오면 도크가 재마운트돼 구독이 죽어도 통과해 버린다 — `e2e/mcp.e2e.ts`가 같은 이유로 그렇게 쓰여 있다. 6~7번만 인박스로 이동한다.

- [ ] **Step 3: 돌린다**

Run: `pnpm test:e2e`
Expected: PASS

**`pnpm dev`가 떠 있으면 먼저 끈다** — `test:e2e`의 빌드가 dev의 `out/`을 갈아끼운다.

- [ ] **Step 4: 기존 e2e를 맞춘다**

`e2e/inbox.e2e.ts`가 run 단위 기대값을 갖고 있으면 대화 단위로 고친다. `e2e/queue.e2e.ts`도 도크 탭 수를 세고 있으면 함께 본다.

- [ ] **Step 5: 전체 검증과 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm test:e2e
git add e2e/
git commit -m "test: cover a three-turn conversation end to end"
```

---

## 마무리

- [ ] **CLAUDE.md를 갱신한다.** 현재 상태 절에 대화 기능을 더하고, "밟으면 조용히 깨지는 것들"에 두 줄을 더한다:
  - **같은 대화의 두 턴은 동시에 뜨면 안 된다** — `claude --resume`은 이전 프로세스가 끝나야 한다. `RunQueue`의 `groupKey`가 막고 있다.
  - **`root_run_id`를 NOT NULL로 "고치지" 말 것** — SQLite에서 그러려면 테이블을 다시 만들어야 하고, 그 `DROP TABLE run`이 `run_context_item`의 cascade를 태워 모든 맥락 기록을 지운다. 마이그레이션의 `PRAGMA foreign_keys=OFF`는 트랜잭션 안이라 무시된다.
- [ ] **문서 표에 새 설계와 계획을 더한다.**
- [ ] **`--resume`이 같은 `session_id`를 돌려주는지 실측하고** `docs/superpowers/specs/2026-08-07-implementation-notes.md`의 Q31·Q32에 남긴다 (설계 §8).
