# 이슈·메모 본문 편집 구현 계획

> **에이전트 작업자에게:** 필수 하위 스킬 — `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 태스크 단위로 실행한다. 각 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 이슈와 메모의 본문을 사람이 보고 고칠 수 있게 만들고, 선택한 패널이 커지는 동적 3컬럼과 agent 동시 편집을 막는 낙관적 잠금을 붙인다.

**아키텍처:** 아래층은 이미 준비돼 있다 — `body`·`update`·`remove`가 DB·IPC·클라이언트에 다 있고 `assemblePrompt`도 본문을 보낸다. core에 들어가는 것은 저장소의 `updateIfUnchanged` 하나뿐이고 **마이그레이션은 없다.** 나머지는 전부 렌더러다. 확장 상태는 `App.tsx`가 하나만 들고 세 패널에 내려보낸다.

**기술 스택:** React 19, Vitest 4.1.10(renderer=jsdom), @testing-library/react, drizzle-orm + better-sqlite3, playwright-core(e2e).

**설계 문서:** `docs/superpowers/specs/2026-08-14-issue-memo-body-design.md`

**시작 시점 기준선:** 테스트 297개 / 35파일, e2e 6개 전부 초록. `pnpm typecheck`·`pnpm lint` 깨끗.

---

## Global Constraints

프로젝트 전역 요구사항이다. **모든 태스크의 요구사항에 이 절이 암묵적으로 포함된다.**

- **패키지 매니저는 pnpm이다.** `pnpm test <경로>`로 한 파일만 돌린다 — `--`를 붙이면 필터가 먹지 않고 전체가 돈다.
- **`core/`는 `electron`을 import하지 않는다.** **`renderer/`는 `core/`를 import하지 않는다** — `window.oneDesk` 참조는 `renderer/main.tsx` 한 곳뿐이고 컴포넌트는 `useClient()`를 쓴다. **`e2e/`는 `core/`와 `shared/`를 import하지 않는다.**
- **IPC 핸들러는 얇다** — core 메서드 호출만 하고 로직을 넣지 않는다.
- **의도된 중복 — 합치지 말 것.** `issue.ts`↔`memo.ts`, `useIssues.ts`↔`useMemos.ts`, 그리고 이번에 생기는 `IssuePanel`↔`MemoPanel`·`IssueDetail`↔`MemoDetail`은 거의 같은 코드다. **사용자가 명시적으로 승인한 설계 결정이다** — 이슈에는 앞으로 상태 전이와 run 연결이 붙고 메모에는 붙지 않는다. 공통 헬퍼로 추출하지 말 것. **대신 두 쌍을 항상 대칭으로 유지한다.** 한쪽에만 있는 가드·메시지·테스트는 진짜 결함이다.
- 들여쓰기 2칸. 함수명 camelCase, 상수 UPPER_SNAKE_CASE.
- `verbatimModuleSyntax: true` — 타입 전용 import는 반드시 `import type`.
- **주석과 오류 메시지는 한국어.**
- **시각은 epoch milliseconds 정수.** `Date.now()`로 명시 삽입한다. id는 `randomUUID()`. **쓰기는 트랜잭션으로 감싼다.**
- **`closedAt`은 `status`에서 파생된다.** 호출자가 따로 넘기지 않는다.
- **TDD.** 실패를 먼저 확인하고 구현한다. 회귀 테스트를 추가할 때는 **대상 코드를 잠시 망가뜨려 그 테스트가 실제로 실패하는지 확인한다.**
- 커밋 메시지는 영어, 명령형.
- **`pnpm test:e2e`와 `pnpm dev`를 동시에 돌리지 않는다.** 산출물 디렉토리가 같아 dev 앱의 main/preload가 갈아끼워진다.

### 이 계획의 핵심 불변식

- **`updatedAt`은 단조 증가한다.** `Math.max(Date.now(), previousUpdatedAt + 1)`. 같은 밀리초에 두 번 쓰면 값이 같아져 낙관적 잠금이 조용히 통과한다.
- **성공한 모든 쓰기는 보유 중인 기대값을 갱신한다.** 안 하면 두 번째 자동 저장이 자기 자신과 충돌한다.
- **MCP의 `update_issue`·`update_memo`는 잠금을 쓰지 않는다.** agent가 사람의 편집 상태 때문에 막히면 헤드리스에서 작업을 접는다.
- **충돌은 던지지 않고 값으로 돌려준다.** `electron/preload.ts`가 IPC 오류의 클래스를 벗겨 메시지만 남기므로, 예외로 만들면 렌더러가 문자열 매칭을 해야 한다.

---

## 파일 구조

### 새로 만드는 파일

| 파일 | 책임 |
|---|---|
| `renderer/components/IssueDetail.tsx` | 이슈 상세 — 제목·본문 편집, 상태, 삭제, 낙관적 잠금 |
| `renderer/components/MemoDetail.tsx` | 위와 대칭 (상태 없음) |
| `renderer/components/ConflictBanner.tsx` | 공용 — 충돌 배너. 도메인 없음 |
| `renderer/components/ConfirmButton.tsx` | 공용 — 2단계 확인 버튼. 도메인 없음 |
| `renderer/hooks/useDebouncedSave.ts` | 공용 — 타이머와 flush만. 도메인 없음 |
| 각각의 `.test.tsx` | 위 다섯의 테스트 |
| `e2e/body.e2e.ts` | 본문 왕복과 담기 분리 |

### 고치는 파일

| 파일 | 무엇을 |
|---|---|
| `shared/models.ts` | `Guarded*Input`, `*UpdateResult` 타입 |
| `shared/channels.ts` | 채널 둘 |
| `shared/client.ts` | `updateIfUnchanged` 둘 |
| `electron/preload.ts` | 얇은 배선 둘 |
| `electron/ipc/issues.ts`, `memos.ts` | 얇은 핸들러 둘 |
| `core/db/repositories/issue.ts`, `memo.ts` | `buildPatch`, `updateIfUnchanged`, 단조 `updatedAt` |
| `renderer/App.tsx` | `openItem` 상태와 배선 |
| `renderer/components/Panel.tsx` | `expanded` prop, `aria-label` |
| `renderer/components/IssuePanel.tsx`, `MemoPanel.tsx` | 확장 모드, 담기 토글 분리 |
| `renderer/index.css` | flex 비율, 분할 레이아웃 |
| `e2e/core-loop.e2e.ts` | 이슈 클릭 → 담기 토글로 |

---

## Task 1: 저장소 — `updateIfUnchanged`와 단조 `updatedAt`

**Files:**
- Modify: `shared/models.ts`
- Modify: `core/db/repositories/issue.ts`, `core/db/repositories/memo.ts`
- Test: `core/db/repositories/issue.test.ts`, `core/db/repositories/memo.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `shared/models.ts` → `interface GuardedUpdateIssueInput extends UpdateIssueInput { expectedUpdatedAt: number }`, `type IssueUpdateResult = { ok: true; issue: Issue } | { ok: false; current: Issue }`, 그리고 memo 대칭 (`GuardedUpdateMemoInput`, `MemoUpdateResult`)
  - `issueRepository.updateIfUnchanged(input: GuardedUpdateIssueInput): IssueUpdateResult`
  - `memoRepository.updateIfUnchanged(input: GuardedUpdateMemoInput): MemoUpdateResult`

- [ ] **Step 1: `shared/models.ts`에 타입을 더한다**

`UpdateIssueInput` 바로 아래에 넣는다.

```ts
/**
 * 낙관적 잠금을 쓰는 갱신 (설계 §6). 사람의 편집 화면만 쓴다.
 * agent(MCP)는 잠기지 않는 `update`를 그대로 쓴다.
 */
export interface GuardedUpdateIssueInput extends UpdateIssueInput {
  /** 화면이 마지막으로 읽은 updatedAt. 이것과 다르면 저장하지 않는다. */
  expectedUpdatedAt: number
}

/** 충돌은 던지지 않고 값으로 온다 — preload가 오류 클래스를 벗겨내기 때문이다. */
export type IssueUpdateResult =
  | { ok: true; issue: Issue }
  | { ok: false; current: Issue }
```

`UpdateMemoInput` 아래에 대칭으로 넣는다.

```ts
export interface GuardedUpdateMemoInput extends UpdateMemoInput {
  expectedUpdatedAt: number
}

export type MemoUpdateResult =
  | { ok: true; memo: Memo }
  | { ok: false; current: Memo }
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`core/db/repositories/issue.test.ts` 끝에 더한다. 파일 상단의 기존 헬퍼(`makeTestDb`, workspace 생성)를 그대로 쓴다.

```ts
describe('updateIfUnchanged', () => {
  it('기대값이 맞으면 갱신하고 새 updatedAt을 돌려준다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })

    const result = issues.updateIfUnchanged({
      id: created.id, body: '고침', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issue.body).toBe('고침')
    expect(result.issue.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  it('그 사이 바뀌었으면 거부하고 최신 행을 돌려준다', () => {
    // agent가 MCP로 본문을 바꾼 상황. 화면의 낡은 버퍼가 덮어쓰면 안 된다.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })
    issues.update({ id: created.id, body: 'agent가 쓴 것' })

    const result = issues.updateIfUnchanged({
      id: created.id, body: '사람이 쓴 것', expectedUpdatedAt: created.updatedAt
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.current.body).toBe('agent가 쓴 것')
  })

  it('거부된 저장은 DB를 바꾸지 않는다', () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: '원본' })
    issues.update({ id: created.id, body: 'agent가 쓴 것' })

    issues.updateIfUnchanged({
      id: created.id, title: '사람이 바꾼 제목', expectedUpdatedAt: created.updatedAt
    })

    // 제목도 함께 롤백돼야 한다. 트랜잭션 밖에서 검사하면 여기서 새어나간다.
    expect(issues.get(created.id).title).toBe('제목')
  })

  it('없는 id면 NotFoundError를 던진다', () => {
    const db = makeTestDb()
    expect(() => createIssueRepository(db).updateIfUnchanged({
      id: '없는-id', body: 'x', expectedUpdatedAt: 1
    })).toThrow(/찾을 수 없습니다/)
  })

  it('같은 밀리초에 두 번 써도 updatedAt이 달라진다', () => {
    // updatedAt이 잠금의 버전 노릇을 한다. 값이 같아지면 "그 사이 바뀌었다"를
    // 놓쳐서, 이 기능이 막으려던 덮어쓰기가 그대로 일어난다.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId, title: '제목', body: 'a' })

    const first = issues.update({ id: created.id, body: 'b' })
    const second = issues.update({ id: created.id, body: 'c' })

    expect(first.updatedAt).toBeGreaterThan(created.updatedAt)
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
  })

  it('repoIds도 함께 갱신하고, 다른 workspace의 repo는 거부한다', () => {
    const db = makeTestDb()
    const workspaces = createWorkspaceRepository(db)
    const wsA = workspaces.create({ name: 'A' }).id
    const wsB = workspaces.create({ name: 'B' }).id
    const repos = createRepoRepository(db)
    const repoA = repos.create({ workspaceId: wsA, name: 'api', path: '/tmp/a' }).id
    const repoB = repos.create({ workspaceId: wsB, name: 'web', path: '/tmp/b' }).id
    const issues = createIssueRepository(db)
    const created = issues.create({ workspaceId: wsA, title: '제목' })

    const ok = issues.updateIfUnchanged({
      id: created.id, repoIds: [repoA], expectedUpdatedAt: created.updatedAt
    })
    expect(ok.ok).toBe(true)
    expect(issues.get(created.id).repoIds).toEqual([repoA])

    expect(() => issues.updateIfUnchanged({
      id: created.id, repoIds: [repoB], expectedUpdatedAt: issues.get(created.id).updatedAt
    })).toThrow(/속하지 않는 repo/)
  })
})
```

`core/db/repositories/memo.test.ts`에도 **대칭으로** 같은 여섯 개를 쓴다. memo에는 `status`가 없으므로 상태 관련 단언만 빼고, `title`/`body`/`repoIds`로 같은 성질을 검증한다.

Run: `pnpm test core/db/repositories/issue.test.ts`
Expected: FAIL — `updateIfUnchanged is not a function`

- [ ] **Step 3: `core/db/repositories/issue.ts`를 고친다**

파일 상단, `createIssueRepository` 바깥에 심볼을 둔다.

```ts
/** 충돌을 트랜잭션 밖으로 알리는 신호. 오류가 아니라 예상된 결과다. */
const CONFLICT = Symbol('conflict')
```

`createIssueRepository` 안, `getById` 아래에 패치 조립을 뽑는다.

```ts
  /**
   * UpdateIssueInput을 SET 절로 바꾼다. update와 updateIfUnchanged가 함께 쓴다.
   *
   * updatedAt은 낙관적 잠금의 버전 노릇도 한다 (설계 §6). 같은 밀리초에 두 번 쓰면
   * 값이 같아져 "그 사이 바뀌었다"를 놓치므로 반드시 이전 값보다 크게 만든다.
   */
  function buildPatch(input: UpdateIssueInput, previousUpdatedAt: number): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      updatedAt: Math.max(Date.now(), previousUpdatedAt + 1)
    }
    if (input.title !== undefined) patch['title'] = input.title
    if (input.body !== undefined) patch['body'] = input.body
    if (input.status !== undefined) {
      patch['status'] = input.status
      // closedAt은 status에서 파생된다. 호출자가 따로 관리하면 둘이 어긋난다.
      patch['closedAt'] = input.status === 'done' ? Date.now() : null
    }
    return patch
  }
```

기존 `update`를 아래로 바꾼다. `owner` 조회에 `updatedAt`이 추가됐다.

```ts
    update(input: UpdateIssueInput): Issue {
      const owner = db
        .select({ workspaceId: issue.workspaceId, updatedAt: issue.updatedAt })
        .from(issue)
        .where(eq(issue.id, input.id))
        .get()
      if (!owner) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${input.id}`)

      const patch = buildPatch(input, owner.updatedAt)

      db.transaction((tx) => {
        tx.update(issue).set(patch).where(eq(issue.id, input.id)).run()
        if (input.repoIds !== undefined) {
          assertReposInWorkspace(tx, owner.workspaceId, input.repoIds)
          replaceTags(tx, input.id, input.repoIds)
        }
      })
      return getById(input.id)
    },
```

바로 아래에 새 메서드를 더한다.

```ts
    /**
     * 내가 읽은 뒤로 바뀌지 않았을 때만 갱신한다 (설계 §6).
     *
     * 읽고 나서 쓰는데도 경합이 없다 — better-sqlite3는 동기이고 커넥션이 하나뿐이라
     * db.transaction 안에서는 다른 JS가 끼어들 수 없다. 조건부 UPDATE의 영향 행 수를
     * 세는 방법도 되지만, 읽는 쪽이 분명하고 충돌 시 돌려줄 최신 행이 이미 손에 있다.
     */
    updateIfUnchanged(input: GuardedUpdateIssueInput): IssueUpdateResult {
      try {
        db.transaction((tx) => {
          const row = tx
            .select({ workspaceId: issue.workspaceId, updatedAt: issue.updatedAt })
            .from(issue)
            .where(eq(issue.id, input.id))
            .get()
          if (!row) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${input.id}`)
          // 던져야 트랜잭션이 롤백된다. 여기서 return하면 앞선 쓰기가 남는다.
          if (row.updatedAt !== input.expectedUpdatedAt) throw CONFLICT

          tx.update(issue).set(buildPatch(input, row.updatedAt))
            .where(eq(issue.id, input.id)).run()
          if (input.repoIds !== undefined) {
            assertReposInWorkspace(tx, row.workspaceId, input.repoIds)
            replaceTags(tx, input.id, input.repoIds)
          }
        })
      } catch (err) {
        if (err === CONFLICT) return { ok: false, current: getById(input.id) }
        throw err
      }
      return { ok: true, issue: getById(input.id) }
    },
```

import에 타입을 더한다.

```ts
import type {
  Issue, CreateIssueInput, UpdateIssueInput, ListQuery,
  GuardedUpdateIssueInput, IssueUpdateResult
} from '@shared/models'
```

- [ ] **Step 4: `core/db/repositories/memo.ts`를 대칭으로 고친다**

같은 구조다. `CONFLICT` 심볼, `buildPatch`(status 없음), `update`의 `owner`에 `updatedAt` 추가, `updateIfUnchanged`. 오류 메시지는 `메모를 찾을 수 없습니다: ${...}`.

**두 파일을 합치지 않는다.** 이슈에는 `status`/`closedAt`이 있고 메모에는 없으며, 이슈에는 앞으로 run 연결이 붙는다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `pnpm test core/db/repositories/issue.test.ts` 그리고 `pnpm test core/db/repositories/memo.test.ts`
Expected: 전부 PASS. 기존 테스트도 그대로 통과해야 한다 — 메시지를 바꾸지 않았다.

- [ ] **Step 6: 변이로 확인한다**

세 가지를 하나씩 망가뜨리고 되돌린다.

1. `if (row.updatedAt !== input.expectedUpdatedAt) throw CONFLICT`를 지운다 → `그 사이 바뀌었으면 거부하고…`가 FAIL
2. `throw CONFLICT`를 `return`으로 바꾼다 → `거부된 저장은 DB를 바꾸지 않는다`가 FAIL (롤백이 안 돼 제목이 바뀐다)
3. `Math.max(Date.now(), previousUpdatedAt + 1)`을 `Date.now()`로 되돌린다 → `같은 밀리초에 두 번 써도…`가 FAIL

각각 어느 테스트가 빨개졌는지 보고서에 적는다.

- [ ] **Step 7: 커밋**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A
git commit -m "feat: add optimistic locking to issue and memo updates"
```

---

## Task 2: 전송 계층

**Files:**
- Modify: `shared/channels.ts`, `shared/client.ts`, `electron/preload.ts`
- Modify: `electron/ipc/issues.ts`, `electron/ipc/memos.ts`

**Interfaces:**
- Consumes: Task 1의 `GuardedUpdateIssueInput`, `IssueUpdateResult`, `GuardedUpdateMemoInput`, `MemoUpdateResult`, 저장소의 `updateIfUnchanged`
- Produces: `client.issues.updateIfUnchanged(input): Promise<IssueUpdateResult>`, `client.memos.updateIfUnchanged(input): Promise<MemoUpdateResult>`

- [ ] **Step 1: 채널을 더한다**

`shared/channels.ts`의 `issuesUpdate` 바로 뒤, `memosUpdate` 바로 뒤에 각각 넣는다.

```ts
  issuesUpdateIfUnchanged: 'issues:updateIfUnchanged',
```

```ts
  memosUpdateIfUnchanged: 'memos:updateIfUnchanged',
```

- [ ] **Step 2: 클라이언트 인터페이스를 넓힌다**

`shared/client.ts`의 `issues` 블록에 더한다.

```ts
  issues: {
    list(query: ListQuery): Promise<Issue[]>
    create(input: CreateIssueInput): Promise<Issue>
    update(input: UpdateIssueInput): Promise<Issue>
    /**
     * 낙관적 잠금 갱신 (설계 §6). 충돌은 던지지 않고 `{ ok: false, current }`로 온다 —
     * preload가 IPC 오류의 클래스를 벗겨내 메시지만 남기므로 예외로는 가려낼 수 없다.
     */
    updateIfUnchanged(input: GuardedUpdateIssueInput): Promise<IssueUpdateResult>
    remove(id: string): Promise<void>
  }
```

`memos`에도 대칭으로 넣는다. import에 새 타입 넷을 더한다.

- [ ] **Step 3: preload를 배선한다**

```ts
  issues: {
    list: (query) => call<Issue[]>(CHANNELS.issuesList, query),
    create: (input) => call<Issue>(CHANNELS.issuesCreate, input),
    update: (input) => call<Issue>(CHANNELS.issuesUpdate, input),
    updateIfUnchanged: (input) =>
      call<IssueUpdateResult>(CHANNELS.issuesUpdateIfUnchanged, input),
    remove: (id) => call<void>(CHANNELS.issuesRemove, id)
  },
```

memo도 대칭. import에 `IssueUpdateResult`, `MemoUpdateResult`를 `import type`으로 더한다.

- [ ] **Step 4: IPC 핸들러를 더한다**

`electron/ipc/issues.ts`:

```ts
  ipcMain.handle(
    CHANNELS.issuesUpdateIfUnchanged,
    (_e, i: GuardedUpdateIssueInput) => core.issues.updateIfUnchanged(i)
  )
```

`electron/ipc/memos.ts`도 대칭. **핸들러는 얇게 — core 호출만 한다.**

- [ ] **Step 5: 타입과 린트를 확인한다**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 전부 통과. 새 테스트는 없다 — 이 태스크는 배선이고, 실제로 도는지는 Task 5의 렌더러 테스트와 Task 7의 e2e가 증명한다.

**`core/index.ts`는 손대지 않는다.** `issues`/`memos`가 저장소를 그대로 내보내므로 새 메서드가 자동으로 따라간다. 확인만 하고 넘어간다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: expose updateIfUnchanged across the ipc boundary"
```

---

## Task 3: 패널 확장과 맥락 담기 분리

**Files:**
- Modify: `renderer/App.tsx`, `renderer/components/Panel.tsx`
- Modify: `renderer/components/IssuePanel.tsx`, `renderer/components/MemoPanel.tsx`
- Modify: `renderer/index.css`
- Modify: `e2e/core-loop.e2e.ts`
- Test: `renderer/App.test.tsx`

**Interfaces:**
- Consumes: 없음 (렌더러만)
- Produces:
  - `App.tsx` → `openItem: { panel: 'issue' | 'memo'; id: string } | null`
  - `IssuePanel`/`MemoPanel`의 새 prop: `expanded: boolean`, `openId: string | null`, `onOpen: (id: string) => void`
  - `Panel`의 새 prop: `expanded?: boolean`
  - CSS 클래스 `panel-expanded`, `panel-split`, `panel-split-list`, `panel-split-detail`, `item-pick`

**이 태스크가 이 계획에서 가장 조용히 깨지는 자리다.** `App.tsx`가 자식에게 내려보내는 prop 한 줄이 3a·3b에서 두 번 다 새어나간 자리다. Step 6의 변이 확인을 반드시 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`renderer/App.test.tsx`에 더한다. 기존 `makeClient` 헬퍼에 이슈·메모 목록이 없으면 `Seed`에 추가한다 — `issues?: Issue[]`, `memos?: Memo[]`를 더하고 `issues.list`/`memos.list`가 그 배열을 돌려주게 한다.

```ts
describe('패널 확장', () => {
  it('이슈를 클릭하면 그 패널이 확장되고 상세가 뜬다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))

    expect(screen.getByRole('region', { name: 'Issues' })).toHaveClass('panel-expanded')
    expect(screen.getByRole('region', { name: 'Memos' })).not.toHaveClass('panel-expanded')
  })

  it('메모를 열면 이슈 상세가 닫힌다', async () => {
    // 한 번에 한 패널만 확장된다. 상태를 각 패널이 따로 들면 둘 다 열린다.
    renderApp(makeClient({}, {
      issues: [makeIssue({ id: 'i1', title: '토큰 만료' })],
      memos: [makeMemo({ id: 'm1', title: '배포 메모' })]
    }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    await userEvent.click(await screen.findByRole('button', { name: '배포 메모' }))

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
    expect(screen.getByRole('region', { name: 'Memos' })).toHaveClass('panel-expanded')
  })

  it('같은 항목을 다시 클릭하면 접힌다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    const title = await screen.findByRole('button', { name: '토큰 만료' })
    await userEvent.click(title)
    await userEvent.click(title)

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
  })

  it('Esc로 접는다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))
    await userEvent.keyboard('{Escape}')

    expect(screen.getByRole('region', { name: 'Issues' })).not.toHaveClass('panel-expanded')
  })

  it('항목 클릭은 맥락에 담지 않는다', async () => {
    // 본문이 생기면 "열어본다"가 주된 행동이 된다. 담기는 별도 토글로 옮겼다.
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료' }))

    expect(screen.queryByRole('button', { name: /토큰 만료 ✕/ })).toBeNull()
  })

  it('담기 토글이 맥락 칩을 만든다', async () => {
    renderApp(makeClient({}, { issues: [makeIssue({ id: 'i1', title: '토큰 만료' })] }))
    await selectWorkspace()

    await userEvent.click(await screen.findByRole('button', { name: '토큰 만료 맥락에 담기' }))

    expect(screen.getByRole('button', { name: /토큰 만료 ✕/ })).toBeInTheDocument()
  })
})
```

칩 제거 버튼의 접근 가능한 이름은 `RunPanel.tsx:207`의 `{chip.label} ✕`에서 온다. 위 정규식이 그것과 맞는지 확인한다.

`makeIssue`/`makeMemo` 헬퍼를 파일 상단에 더한다.

```ts
function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'w1', title: '이슈', body: '', status: 'open',
    repoIds: [], createdAt: 0, updatedAt: 0, closedAt: null, ...over
  }
}

function makeMemo(over: Partial<Memo> = {}): Memo {
  return {
    id: 'm1', workspaceId: 'w1', title: '메모', body: '',
    repoIds: [], createdAt: 0, updatedAt: 0, ...over
  }
}
```

Run: `pnpm test renderer/App.test.tsx`
Expected: FAIL

- [ ] **Step 2: `Panel`에 `expanded`와 접근 가능한 이름을 준다**

```tsx
export function Panel({ title, action, expanded, children }: {
  title: string
  action?: ReactNode
  /** 확장된 패널은 .columns 안에서 flex 비율이 커진다 (설계 §4) */
  expanded?: boolean
  children: ReactNode
}) {
  return (
    // aria-label이 있어야 section이 region 역할을 얻는다. 테스트가 패널을
    // 이름으로 집을 수 있고, 스크린 리더에도 이름이 생긴다.
    <section className={expanded ? 'panel panel-expanded' : 'panel'} aria-label={title}>
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
```

- [ ] **Step 3: `App.tsx`에 상태와 배선을 넣는다**

기존 `useState` 묶음 아래에 더한다.

```tsx
  // 확장된 패널과 그 안에서 열린 항목. **한 번에 하나뿐이다.**
  // 각 패널이 따로 들면 둘 다 열린 상태가 만들어지고, 컬럼 비율을 누가 정하는지도
  // 흐려진다. useRepos·useWorkspaces를 자식이 각자 부르다 두 번 사고가 났다.
  const [openItem, setOpenItem] = useState<{ panel: 'issue' | 'memo'; id: string } | null>(null)
```

토글 함수를 더한다.

```tsx
  /** 같은 항목을 다시 누르면 접는다. 다른 패널을 누르면 그쪽으로 옮겨간다. */
  function openIn(panel: 'issue' | 'memo', id: string) {
    setOpenItem((prev) => (prev?.panel === panel && prev.id === id ? null : { panel, id }))
  }
```

Esc는 `useEffect`로 문서에 건다.

```tsx
  // Esc로 접는다. 상세 안의 삭제 확인은 자기가 먼저 Esc를 삼키므로(설계 §5)
  // 여기까지 올라오지 않는다.
  useEffect(() => {
    if (!openItem) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenItem(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [openItem])
```

workspace를 바꿀 때 접는다. `selectWorkspace` 안에 한 줄 더한다.

```tsx
    setChips([])      // 맥락도 마찬가지다. 다른 workspace의 항목은 실행 시 거부된다
    setOpenItem(null) // 다른 workspace의 항목을 열어둔 채로 둘 수 없다
```

두 패널에 내려보낸다. **이 세 줄이 변이 대상이다.**

```tsx
              <IssuePanel
                workspaceId={workspaceId}
                repoId={repoId}
                chipKeys={chipKeys}
                onToggleContext={toggleChip}
                expanded={openItem?.panel === 'issue'}
                openId={openItem?.panel === 'issue' ? openItem.id : null}
                onOpen={(id) => openIn('issue', id)}
              />
              <MemoPanel
                workspaceId={workspaceId}
                repoId={repoId}
                chipKeys={chipKeys}
                onToggleContext={toggleChip}
                expanded={openItem?.panel === 'memo'}
                openId={openItem?.panel === 'memo' ? openItem.id : null}
                onOpen={(id) => openIn('memo', id)}
              />
```

- [ ] **Step 4: `IssuePanel`을 고친다**

prop 셋을 받고, 항목 줄을 셋으로 나누고, 확장 모드에서 좌우로 쪼갠다. 상세 자리는 Task 5까지 빈 껍데기다.

```tsx
export function IssuePanel({
  workspaceId, repoId, chipKeys, onToggleContext, expanded, openId, onOpen
}: {
  workspaceId: string
  repoId: string | null
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
  expanded: boolean
  openId: string | null
  onOpen: (id: string) => void
}) {
```

목록 부분을 함수로 빼서 두 모드가 함께 쓴다.

```tsx
  const list = (
    <>
      <AddForm placeholder="새 이슈 제목…" onSubmit={addIssue} />
      {!listError && issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}
      <ul className="item-list">
        {issues.map((i) => {
          const picked = chipKeys.has(chipKey({ type: 'issue', id: i.id }))
          return (
            <li key={i.id} className="item">
              {/* 클릭은 "열어본다"다. 맥락에 담는 것은 옆 토글이 맡는다 (설계 §5). */}
              <button
                type="button"
                className={openId === i.id ? 'item-title item-open' : 'item-title'}
                onClick={() => onOpen(i.id)}
              >
                {i.title}
              </button>
              <button
                type="button"
                className={picked ? 'item-pick item-picked' : 'item-pick'}
                aria-label={`${i.title} 맥락에 담기`}
                aria-pressed={picked}
                onClick={() => onToggleContext({ type: 'issue', id: i.id, label: i.title })}
              >
                ＋
              </button>
              <button
                type="button"
                className={`status status-${i.status}`}
                onClick={() => cycleStatus(i.id, i.status)}
              >
                {i.status}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )

  return (
    <Panel title="Issues" expanded={expanded}>
      {shown && <div role="alert" className="form-error">{shown}</div>}
      {expanded ? (
        <div className="panel-split">
          <div className="panel-split-list">{list}</div>
          <div className="panel-split-detail">{/* Task 5에서 IssueDetail이 들어온다 */}</div>
        </div>
      ) : list}
    </Panel>
  )
```

`MemoPanel`도 **대칭으로** 같게 고친다. 상태 버튼만 없다.

- [ ] **Step 5: CSS를 더한다**

`renderer/index.css`의 `.panel` 규칙 근처에 넣는다.

```css
/* 선택한 패널이 커지고 나머지가 줄어든다 (설계 §4). JS로 픽셀을 계산하지 않는다. */
.columns > .panel-expanded { flex: 3; }
.panel-split { display: flex; gap: 8px; height: 100%; min-height: 0; }
.panel-split-list { flex: 0 0 200px; overflow-y: auto; min-width: 0; }
.panel-split-detail { flex: 1; min-width: 0; overflow-y: auto; }
.item-pick { flex: 0 0 auto; border: 0; background: transparent; cursor: pointer; opacity: .45; font-size: 12px; }
.item-pick.item-picked { opacity: 1; color: #1d4ed8; }
.item-open { font-weight: 700; }
```

`.item-title`이 지금 `overflow: hidden`만 갖고 있으므로 `flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; cursor: pointer; font: inherit;`가 필요하면 함께 넣는다. 기존 렌더링이 깨지지 않는지 눈으로 확인한다.

- [ ] **Step 5b: 이제 틀린 안내 문구를 고친다**

`renderer/components/RunPanel.tsx:199`가 맥락이 비었을 때 **"왼쪽에서 항목을 눌러 맥락을 담으세요"**라고 안내한다. 이제 항목을 누르면 열리고 담기지 않으므로 사실과 다르다. 새 조작에 맞게 고친다 — 예: `왼쪽 항목의 ＋를 눌러 맥락을 담으세요`.

- [ ] **Step 6: 배선 변이를 확인한다**

세 줄을 하나씩 지우고 되돌린다.

1. `App.tsx`의 `<IssuePanel openId={…}>` 한 줄 → `이슈를 클릭하면 그 패널이 확장되고…`가 FAIL해야 한다
2. `<MemoPanel openId={…}>` 한 줄 → `메모를 열면 이슈 상세가 닫힌다`가 FAIL해야 한다
3. `<IssuePanel expanded={…}>` 한 줄 → 확장 클래스 단언이 FAIL해야 한다

**하나라도 초록으로 남으면 그 테스트가 무력한 것이다.** 어느 테스트가 빨개졌는지 보고서에 적고, 안 빨개진 것이 있으면 테스트를 고친 뒤 다시 확인한다.

- [ ] **Step 7: 기존 e2e를 고친다**

`e2e/core-loop.e2e.ts:34-38`이 이슈 제목을 클릭해 맥락에 담는 것을 검증한다. 이제 제목 클릭은 여는 동작이므로 담기 토글을 누르도록 바꾼다.

```ts
    // 4. 담기 토글을 눌러 맥락에 담는다 — 칩에는 제거 표시가 함께 붙는다
    await page.getByRole('button', { name: `${ISSUE} 맥락에 담기` }).click()
```

Run: `pnpm test && pnpm test:e2e`
Expected: 전부 PASS. **`pnpm dev`가 떠 있으면 먼저 끈다.**

- [ ] **Step 8: 커밋**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: expand the selected panel and split opening from context picking"
```

---

## Task 4: 공용 부품

**Files:**
- Create: `renderer/components/ConflictBanner.tsx`, `renderer/components/ConfirmButton.tsx`
- Create: `renderer/hooks/useDebouncedSave.ts`
- Test: `renderer/components/ConfirmButton.test.tsx`, `renderer/hooks/useDebouncedSave.test.tsx`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `<ConflictBanner onReload={() => void} onOverwrite={() => void} />`
  - `<ConfirmButton label={string} confirmLabel={string} onConfirm={() => void} />`
  - `useDebouncedSave(save: (value: string) => Promise<void>, delayMs?: number)` → `{ schedule(value: string): void; flush(): Promise<void>; cancel(): void }`

**이 셋만 공용이다.** 셋 다 도메인이 없다 — 배너는 문자열과 콜백 둘, 확인 버튼은 두 번 눌러야 부르는 버튼, 훅은 타이머다. **낙관적 잠금의 기대값 관리는 각 Detail이 직접 들고 있는다** (Task 5·6). 그쪽은 도메인이므로 이슈와 메모가 갈라질 수 있다.

- [ ] **Step 1: `ConfirmButton` 테스트를 쓴다**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmButton } from './ConfirmButton'

describe('ConfirmButton', () => {
  it('한 번 눌러서는 부르지 않는다', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '정말 삭제?' })).toBeInTheDocument()
  })

  it('두 번 누르면 부른다', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Esc는 확인만 끄고 위로 새어나가지 않는다', async () => {
    // App이 Esc로 패널을 접는다. 삭제를 물리려다 편집 화면까지 닫히면 안 된다 (설계 §5).
    const onConfirm = vi.fn()
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={onConfirm} />
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
    expect(outer).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('포커스가 빠지면 확인이 풀린다', async () => {
    render(
      <>
        <ConfirmButton label="삭제" confirmLabel="정말 삭제?" onConfirm={vi.fn()} />
        <button>다른 곳</button>
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '다른 곳' }))
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
  })
})
```

Run: `pnpm test renderer/components/ConfirmButton.test.tsx`
Expected: FAIL — 모듈이 없다

- [ ] **Step 2: `ConfirmButton`을 구현한다**

```tsx
import { useState, type KeyboardEvent } from 'react'

/**
 * 두 번 눌러야 실행되는 버튼. 되돌릴 수 없는 동작에 쓴다.
 *
 * 이 앱에는 모달이 없고 SlotIndicator가 이미 인라인 확인 패턴을 쓴다 (설계 §5).
 */
export function ConfirmButton({ label, confirmLabel, onConfirm }: {
  label: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !armed) return
    // Esc는 안쪽부터 푼다. 여기서 멈추지 않으면 App의 Esc 핸들러가 패널까지 접는다.
    e.stopPropagation()
    setArmed(false)
  }

  return (
    <button
      type="button"
      className={armed ? 'confirm-button confirm-armed' : 'confirm-button'}
      onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}
      onBlur={() => setArmed(false)}
      onKeyDown={handleKeyDown}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
```

**주의:** App의 Esc 리스너는 `document`에 붙어 있으므로 React의 `stopPropagation`만으로는 막히지 않는다. 테스트가 그것을 잡으면 App 쪽 리스너를 `document` 대신 캡처 순서가 뒤인 곳으로 옮기거나, 여기서 `e.nativeEvent.stopImmediatePropagation()`을 함께 부른다. **어느 쪽을 골랐든 보고서에 적고, 테스트로 고정한다.**

- [ ] **Step 3: `ConflictBanner`를 만든다**

테스트는 Task 5의 `IssueDetail` 테스트가 함께 덮는다 — 여기서는 마크업만 둔다.

```tsx
/** agent와 사람이 같은 항목을 고쳤을 때 뜬다 (설계 §7). */
export function ConflictBanner({ onReload, onOverwrite }: {
  onReload: () => void
  onOverwrite: () => void
}) {
  return (
    <div role="alert" className="conflict-banner">
      <span>이 항목이 그 사이 바뀌었습니다.</span>
      <button type="button" onClick={onReload}>다시 불러오기</button>
      <button type="button" onClick={onOverwrite}>덮어쓰기</button>
    </div>
  )
}
```

- [ ] **Step 4: `useDebouncedSave` 테스트를 쓴다**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedSave } from './useDebouncedSave'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useDebouncedSave', () => {
  it('입력이 멎어야 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))

    act(() => { result.current.schedule('a') })
    act(() => { result.current.schedule('ab') })
    expect(save).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('ab')
  })

  it('flush는 대기 중인 저장을 즉시 실행한다', async () => {
    // 패널을 접거나 항목을 옮길 때 부른다. 없으면 타이머가 도는 도중에 내용이 날아간다.
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))

    act(() => { result.current.schedule('ab') })
    await act(async () => { await result.current.flush() })
    expect(save).toHaveBeenCalledWith('ab')

    // 이미 비웠으므로 타이머가 지나도 다시 부르지 않는다
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('대기 중인 것이 없으면 flush가 아무것도 하지 않는다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))
    await act(async () => { await result.current.flush() })
    expect(save).not.toHaveBeenCalled()
  })

  it('cancel은 대기 중인 저장을 버린다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))
    act(() => { result.current.schedule('ab') })
    act(() => { result.current.cancel() })
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).not.toHaveBeenCalled()
  })

  it('언마운트되면 대기 중인 저장을 흘려보낸다', () => {
    // 패널을 접거나 다른 항목으로 옮기면 상세가 언마운트된다. 여기서 버리면
    // 디바운스가 끝나기 전에 친 내용이 그대로 날아간다.
    // 결과를 받을 컴포넌트가 없어 오류는 관측되지 않지만, 쓰기를 잃는 쪽이 더 나쁘다.
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useDebouncedSave(save, 600))
    act(() => { result.current.schedule('ab') })
    unmount()
    expect(save).toHaveBeenCalledWith('ab')
  })

  it('대기 중인 것이 없으면 언마운트가 저장하지 않는다', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useDebouncedSave(save, 600))
    unmount()
    expect(save).not.toHaveBeenCalled()
  })
})
```

Run: `pnpm test renderer/hooks/useDebouncedSave.test.tsx`
Expected: FAIL

- [ ] **Step 5: `useDebouncedSave`를 구현한다**

```ts
import { useCallback, useEffect, useRef } from 'react'

const DEFAULT_DELAY_MS = 600

/**
 * 입력이 멎으면 저장한다. 타이머만 담고 도메인은 모른다.
 *
 * flush는 패널을 접거나 다른 항목으로 옮길 때 부른다 — 대기 중인 저장을 잃지 않기
 * 위해서다 (설계 §5). save가 던지면 그대로 올려보내 호출자가 화면에 띄운다.
 */
export function useDebouncedSave(
  save: (value: string) => Promise<void>,
  delayMs: number = DEFAULT_DELAY_MS
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  // save가 매 렌더 새 함수여도 타이머를 다시 걸지 않게 최신 것만 들고 있는다.
  const latestSave = useRef(save)
  latestSave.current = save

  const clear = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const flush = useCallback(async () => {
    clear()
    const value = pending.current
    if (value === null) return
    pending.current = null
    await latestSave.current(value)
  }, [clear])

  const schedule = useCallback((value: string) => {
    pending.current = value
    clear()
    timer.current = setTimeout(() => { void flush() }, delayMs)
  }, [clear, flush, delayMs])

  const cancel = useCallback(() => { clear(); pending.current = null }, [clear])

  // 언마운트되면 대기 중인 저장을 흘려보낸다. 패널을 접거나 다른 항목으로 옮기면
  // 상세가 언마운트되는데, 여기서 버리면 디바운스가 끝나기 전에 친 내용이 날아간다.
  // 결과를 받을 컴포넌트가 없어 오류는 관측되지 않지만 쓰기를 잃는 쪽이 더 나쁘다.
  // ref만 읽으므로 이 effect는 마운트/언마운트에만 돈다.
  useEffect(() => () => { void flush() }, [flush])

  return { schedule, flush, cancel }
}
```

**주의:** `flush`가 `useCallback`으로 안정적이어야 이 effect가 매 렌더 재등록되지 않는다. 위 구현의 의존성(`clear`)이 안정적이므로 성립한다. 재등록되면 렌더마다 flush가 돌아 저장이 폭주하므로, 위 두 테스트가 초록인지 반드시 확인한다.

- [ ] **Step 6: 테스트 통과와 변이 확인**

Run: `pnpm test renderer/hooks/useDebouncedSave.test.tsx renderer/components/ConfirmButton.test.tsx`
Expected: PASS

변이: `flush`의 `clear()` 호출을 지운다 → `flush는 대기 중인 저장을 즉시 실행한다`의 마지막 단언(한 번만 불린다)이 FAIL해야 한다. 되돌린다.

- [ ] **Step 7: 커밋**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A
git commit -m "feat: add shared confirm button, conflict banner and debounced save"
```

---

## Task 5: `IssueDetail`

**Files:**
- Create: `renderer/components/IssueDetail.tsx`, `renderer/components/IssueDetail.test.tsx`
- Modify: `renderer/components/IssuePanel.tsx` (상세 자리를 채운다)
- Modify: `renderer/index.css`

**Interfaces:**
- Consumes: Task 2의 `client.issues.updateIfUnchanged`, Task 4의 `ConflictBanner`·`ConfirmButton`·`useDebouncedSave`
- Produces: `<IssueDetail issue={Issue} onChanged={() => void} onDeleted={() => void} />`

`IssuePanel`은 열린 이슈를 목록에서 찾아 넘긴다. 상세는 자기 안에서 편집 버퍼와 기대 `updatedAt`을 들고 있는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`renderer/components/IssueDetail.test.tsx`. `ClientProvider`로 감싸 가짜 클라이언트를 주입한다 — 다른 컴포넌트 테스트가 쓰는 방식과 같다.

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { IssueDetail } from './IssueDetail'
import type { Issue } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'w1', title: '토큰 만료', body: '원본', status: 'open',
    repoIds: [], createdAt: 0, updatedAt: 100, closedAt: null, ...over
  }
}

/** updateIfUnchanged와 update만 가진 최소 클라이언트. 나머지는 부르지 않는다. */
function makeClient(over: Partial<OneDeskClient['issues']> = {}): OneDeskClient {
  return {
    issues: {
      list: vi.fn(), create: vi.fn(),
      update: vi.fn(async (i) => makeIssue({ ...i, updatedAt: 200 })),
      updateIfUnchanged: vi.fn(async (i) => ({
        ok: true as const, issue: makeIssue({ ...i, updatedAt: 200 })
      })),
      remove: vi.fn(),
      ...over
    }
  } as unknown as OneDeskClient
}

function renderDetail(client: OneDeskClient, issue = makeIssue(), over = {}) {
  const props = { issue, onChanged: vi.fn(), onDeleted: vi.fn(), ...over }
  render(
    <ClientProvider client={client}>
      <IssueDetail {...props} />
    </ClientProvider>
  )
  return props
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers() })

describe('IssueDetail', () => {
  it('제목과 본문을 보여준다', () => {
    renderDetail(makeClient())
    expect(screen.getByDisplayValue('토큰 만료')).toBeInTheDocument()
    expect(screen.getByDisplayValue('원본')).toBeInTheDocument()
  })

  it('본문을 고치면 기대 updatedAt과 함께 저장한다', async () => {
    const client = makeClient()
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(client.issues.updateIfUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', body: '원본!', expectedUpdatedAt: 100 })
    )
  })

  it('성공한 저장이 기대값을 갱신해 두 번째 저장이 충돌하지 않는다', async () => {
    // 갱신을 빠뜨리면 두 번째 자동 저장이 자기 자신과 충돌한다 (설계 §6).
    const client = makeClient()
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), 'a')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.type(screen.getByLabelText('본문'), 'b')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })

    const calls = vi.mocked(client.issues.updateIfUnchanged).mock.calls
    expect(calls[0]![0].expectedUpdatedAt).toBe(100)
    expect(calls[1]![0].expectedUpdatedAt).toBe(200)
  })

  it('충돌하면 배너를 띄우고 자동 저장을 멈춘다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.getByRole('alert')).toHaveTextContent('그 사이 바뀌었습니다')

    // 배너가 떠 있는 동안은 더 쳐도 저장하지 않는다 — 재시도하면 결국 덮어쓰기가 된다
    await userEvent.type(screen.getByLabelText('본문'), '?')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(client.issues.updateIfUnchanged).toHaveBeenCalledTimes(1)
  })

  it('다시 불러오기가 최신 본문을 띄운다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(screen.getByLabelText('본문')).toHaveValue('agent가 쓴 것')
    expect(screen.queryByText('그 사이 바뀌었습니다')).toBeNull()
  })

  it('덮어쓰기가 잠금 없는 update를 부른다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => ({
        ok: false as const, current: makeIssue({ body: 'agent가 쓴 것', updatedAt: 300 })
      }))
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await userEvent.click(screen.getByRole('button', { name: '덮어쓰기' }))
    expect(client.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', body: '원본!' })
    )
  })

  it('저장이 실패하면 화면에 띄운다', async () => {
    const client = makeClient({
      updateIfUnchanged: vi.fn(async () => { throw new Error('DB가 잠겼습니다') })
    })
    renderDetail(client)
    await userEvent.type(screen.getByLabelText('본문'), '!')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.getByText('DB가 잠겼습니다')).toBeInTheDocument()
  })

  it('삭제는 두 번 눌러야 하고, 지워지면 알린다', async () => {
    const client = makeClient()
    const props = renderDetail(client)
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(client.issues.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '정말 삭제?' }))
    expect(client.issues.remove).toHaveBeenCalledWith('i1')
    expect(props.onDeleted).toHaveBeenCalled()
  })
})
```

Run: `pnpm test renderer/components/IssueDetail.test.tsx`
Expected: FAIL

- [ ] **Step 2: `IssueDetail`을 구현한다**

핵심 규칙 넷을 지킨다.

1. 편집 버퍼(`title`, `body`)와 **기대 `updatedAt`을 이 컴포넌트가 들고 있는다**
2. **성공한 저장은 돌려받은 행의 `updatedAt`으로 기대값을 갱신한다**
3. 충돌 배너가 떠 있으면 자동 저장을 멈춘다
4. **다른 항목으로 옮기면 이 컴포넌트가 통째로 다시 마운트된다** — `IssuePanel`이 `key={open.id}`를 준다 (Step 3)

4번을 `issue.id`를 보는 effect로 하지 않는 이유가 있다. React는 새 `issue`로 렌더한 **뒤에** 이전 effect의 정리를 돌리므로, 그 시점의 저장 콜백은 이미 **새 이슈**를 붙잡고 있다. 옛 항목의 대기 중인 본문이 새 항목에 저장되는 진짜 결함이 된다. `key`로 다시 마운트하면 옛 컴포넌트가 자기 클로저를 그대로 들고 언마운트되므로 `useDebouncedSave`의 flush가 올바른 대상에 쓴다.

```tsx
import { useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { ConflictBanner } from './ConflictBanner'
import { ConfirmButton } from './ConfirmButton'
import type { Issue, IssueStatus } from '@shared/models'

export function IssueDetail({ issue, onChanged, onDeleted }: {
  issue: Issue
  /** 목록을 다시 읽게 한다 */
  onChanged: () => void
  onDeleted: () => void
}) {
  const client = useClient()
  const [title, setTitle] = useState(issue.title)
  const [body, setBody] = useState(issue.body)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Issue | null>(null)
  // 낙관적 잠금의 기대값. **성공한 모든 쓰기가 이것을 갱신한다** (설계 §6).
  //
  // 초기값은 마운트 때 한 번만 읽는다. 항목이 바뀌면 IssuePanel의 key가 이 컴포넌트를
  // 통째로 다시 마운트하므로 여기서 issue를 다시 볼 일이 없다 — 오히려 목록이 갱신될
  // 때마다 버퍼를 초기화하면 타이핑 중에 글자가 되돌아간다.
  const expected = useRef(issue.updatedAt)

  async function persist(patch: { title?: string; body?: string; status?: IssueStatus }) {
    setError(null)
    const result = await client.issues.updateIfUnchanged({
      id: issue.id, ...patch, expectedUpdatedAt: expected.current
    })
    if (!result.ok) { setConflict(result.current); return }
    expected.current = result.issue.updatedAt
    onChanged()
  }

  const bodySave = useDebouncedSave(async (value) => {
    // 배너가 떠 있으면 멈춘다. 계속 재시도하면 결국 덮어쓰기가 되어 잠금이 무의미해진다.
    if (conflict) return
    try { await persist({ body: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  // 제목도 같은 규칙을 쓴다. 훅을 따로 걸어 본문 타이머와 섞이지 않게 한다.
  const titleSave = useDebouncedSave(async (value) => {
    if (conflict) return
    try { await persist({ title: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  return (
    <div className="detail">
      {conflict && (
        <ConflictBanner
          onReload={() => {
            setTitle(conflict.title)
            setBody(conflict.body)
            expected.current = conflict.updatedAt
            setConflict(null)
            onChanged()
          }}
          onOverwrite={() => {
            void (async () => {
              try {
                const saved = await client.issues.update({ id: issue.id, title, body })
                expected.current = saved.updatedAt
                setConflict(null)
                onChanged()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            })()
          }}
        />
      )}
      {error && <div className="form-error">{error}</div>}

      <input
        aria-label="제목"
        className="detail-title"
        value={title}
        onChange={(e) => { setTitle(e.target.value); titleSave.schedule(e.target.value) }}
        onBlur={() => { void titleSave.flush() }}
      />
      <textarea
        aria-label="본문"
        className="detail-body"
        value={body}
        onChange={(e) => { setBody(e.target.value); bodySave.schedule(e.target.value) }}
        onBlur={() => { void bodySave.flush() }}
      />

      <div className="detail-actions">
        <ConfirmButton
          label="삭제"
          confirmLabel="정말 삭제?"
          onConfirm={() => {
            void (async () => {
              try { await client.issues.remove(issue.id); onDeleted() }
              catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            })()
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `IssuePanel`이 상세를 그리게 한다**

Task 3에서 비워 둔 자리를 채운다.

```tsx
  const open = openId ? issues.find((i) => i.id === openId) ?? null : null

  // 열린 항목이 목록에서 사라졌으면(지워졌거나 필터가 바뀌었으면) 접는다.
  // 존재하지 않는 항목의 상세를 그리지 않는다 (설계 §8).
  useEffect(() => {
    if (openId && !open) onOpen(openId)
  }, [openId, open, onOpen])
```

`onOpen(openId)`는 같은 id를 다시 눌러 접는 것과 같은 동작이다. 상세 자리를 이렇게 채운다.

```tsx
          <div className="panel-split-detail">
            {open && (
              <IssueDetail
                // key가 핵심이다. 다른 이슈로 옮기면 상세를 통째로 다시 마운트해,
                // 옛 컴포넌트가 자기 클로저를 들고 언마운트되며 대기 중인 저장을
                // 올바른 이슈에 흘려보낸다 (Step 2의 설명).
                key={open.id}
                issue={open}
                onChanged={() => { void refresh() }}
                onDeleted={() => { onOpen(open.id); void refresh() }}
              />
            )}
          </div>
```

- [ ] **Step 4: CSS를 더한다**

```css
.detail { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.detail-title { padding: 5px 8px; border: 1px solid #e4e4e7; border-radius: 5px; font: inherit; font-size: 14px; font-weight: 600; }
.detail-body { flex: 1; min-height: 120px; padding: 7px 9px; border: 1px solid #e4e4e7; border-radius: 5px; font: inherit; font-size: 13px; resize: none; }
.detail-actions { display: flex; justify-content: flex-end; }
.confirm-button { border: 1px solid #e4e4e7; border-radius: 5px; background: #fff; cursor: pointer; font: inherit; font-size: 11px; padding: 3px 9px; }
.confirm-button.confirm-armed { border-color: #fca5a5; color: #991b1b; }
.conflict-banner { display: flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: 5px; background: #fef3c7; font-size: 12px; }
.conflict-banner button { border: 1px solid #e4e4e7; border-radius: 5px; background: #fff; cursor: pointer; font: inherit; font-size: 11px; padding: 2px 7px; }
```

- [ ] **Step 5: 테스트와 변이 확인**

Run: `pnpm test renderer/components/IssueDetail.test.tsx`
Expected: PASS

변이 셋을 하나씩 확인한다.

1. `expected.current = result.issue.updatedAt`을 지운다 → `성공한 저장이 기대값을 갱신해…`가 FAIL
2. `if (conflict) return`을 지운다 → `충돌하면 배너를 띄우고 자동 저장을 멈춘다`가 FAIL
3. `onReload`의 `expected.current = conflict.updatedAt`을 지운다 → 다시 불러온 뒤 저장이 또 충돌한다. 이 성질을 보는 테스트가 없으면 **하나 더 쓴다**

- [ ] **Step 5b: 항목 전환이 옛 항목에 저장하는지 확인한다**

`key={open.id}`가 없으면 대기 중이던 본문이 **새로 연 이슈에 저장된다.** 단위 테스트가 잡지 못하는 자리이므로 `renderer/App.test.tsx`에 하나 더 쓴다.

```tsx
it('다른 이슈로 옮기면 대기 중이던 본문이 원래 이슈에 저장된다', async () => {
  // key가 없으면 React가 상세를 재사용하고, 정리 시점의 저장 콜백은 이미 새
  // 이슈를 붙잡고 있어 옛 내용이 엉뚱한 이슈에 저장된다.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const client = makeClient({}, {
    issues: [
      makeIssue({ id: 'i1', title: '첫째', updatedAt: 100 }),
      makeIssue({ id: 'i2', title: '둘째', updatedAt: 100 })
    ]
  })
  renderApp(client)
  await selectWorkspace()

  await userEvent.click(await screen.findByRole('button', { name: '첫째' }))
  await userEvent.type(screen.getByLabelText('본문'), '첫째의 메모')
  await userEvent.click(screen.getByRole('button', { name: '둘째' }))

  expect(client.issues.updateIfUnchanged).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'i1', body: '첫째의 메모' })
  )
  vi.useRealTimers()
})
```

`makeClient`의 `issues.updateIfUnchanged`가 `vi.fn()`으로 기록되도록 `Seed`에 맞춰 보강한다.

변이: `IssuePanel`의 `key={open.id}`를 지운다 → 이 테스트가 FAIL해야 한다. 되돌린다.

- [ ] **Step 6: 커밋**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A
git commit -m "feat: add the issue detail view with optimistic locking"
```

---

## Task 6: `MemoDetail`

**Files:**
- Create: `renderer/components/MemoDetail.tsx`, `renderer/components/MemoDetail.test.tsx`
- Modify: `renderer/components/MemoPanel.tsx`

**Interfaces:**
- Consumes: Task 5의 `IssueDetail` 구조, `client.memos.updateIfUnchanged`
- Produces: `<MemoDetail memo={Memo} onChanged={() => void} onDeleted={() => void} />`

**`IssueDetail`을 그대로 옮기되 합치지 않는다.** 차이는 `status`가 없다는 것 하나다. 이슈에는 앞으로 상태 전이와 run 연결이 붙고 메모에는 붙지 않는다.

- [ ] **Step 1: `MemoDetail.test.tsx`를 쓴다**

`IssueDetail.test.tsx`와 **한 개도 빠짐없이 대칭**이어야 한다. 아래 여덟 개를 그대로 옮기되, 픽스처를 `Memo`로 바꾸고(`status`·`closedAt` 없음), `updateIfUnchanged`의 성공 응답이 `{ ok: true, memo }`이며, 클라이언트가 `client.memos`인 것에 맞춘다. 본문·제목의 접근 가능한 이름(`본문`, `제목`)은 같다.

1. `제목과 본문을 보여준다`
2. `본문을 고치면 기대 updatedAt과 함께 저장한다`
3. `성공한 저장이 기대값을 갱신해 두 번째 저장이 충돌하지 않는다`
4. `충돌하면 배너를 띄우고 자동 저장을 멈춘다`
5. `다시 불러오기가 최신 본문을 띄운다`
6. `덮어쓰기가 잠금 없는 update를 부른다`
7. `저장이 실패하면 화면에 띄운다`
8. `삭제는 두 번 눌러야 하고, 지워지면 알린다`

픽스처는 이렇게 시작한다.

```tsx
function makeMemo(over: Partial<Memo> = {}): Memo {
  return {
    id: 'm1', workspaceId: 'w1', title: '배포 절차', body: '원본',
    repoIds: [], createdAt: 0, updatedAt: 100, ...over
  }
}

function makeClient(over: Partial<OneDeskClient['memos']> = {}): OneDeskClient {
  return {
    memos: {
      list: vi.fn(), create: vi.fn(),
      update: vi.fn(async (i) => makeMemo({ ...i, updatedAt: 200 })),
      updateIfUnchanged: vi.fn(async (i) => ({
        ok: true as const, memo: makeMemo({ ...i, updatedAt: 200 })
      })),
      remove: vi.fn(),
      ...over
    }
  } as unknown as OneDeskClient
}
```

Run: `pnpm test renderer/components/MemoDetail.test.tsx`
Expected: FAIL

- [ ] **Step 2: `MemoDetail`을 구현한다**

`IssueDetail`과 같은 구조. `IssueStatus` import가 없고 `persist`의 patch에 `status`가 없다. 결과 필드가 `result.memo`다.

- [ ] **Step 3: `MemoPanel`이 상세를 그리게 한다**

Task 5의 Step 3과 대칭.

- [ ] **Step 4: 두 파일이 대칭인지 눈으로 확인한다**

```bash
diff <(sed 's/Issue/Memo/g; s/issue/memo/g' renderer/components/IssueDetail.tsx) renderer/components/MemoDetail.tsx
```

차이가 `status` 관련 줄뿐이어야 한다. **다른 차이가 있으면 그것이 결함이다** — 어느 쪽이 맞는지 정하고 양쪽을 맞춘다. 같은 방법으로 두 테스트 파일도 비교한다.

- [ ] **Step 5: 테스트와 커밋**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A
git commit -m "feat: add the memo detail view mirroring the issue one"
```

---

## Task 7: e2e

**Files:**
- Create: `e2e/body.e2e.ts`

**Interfaces:**
- Consumes: Task 3~6의 완성된 화면, `e2e/driver.ts`의 `launchApp()`
- Produces: 없음 (마지막 태스크)

- [ ] **Step 1: e2e를 쓴다**

```ts
import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const ISSUE = '토큰 만료 버그'
const BODY = '재현: 로그인 후 24시간 대기'

describe('이슈 본문', () => {
  it('본문을 쓰고 접었다 열면 그대로 있다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-body')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /e2e-body/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')
    const title = page.getByRole('button', { name: ISSUE, exact: true })
    await title.waitFor({ state: 'visible', timeout: 10_000 })

    // 클릭은 여는 동작이다 — 맥락에 담기지 않는다
    await title.click()
    const body = page.getByLabel('본문')
    await body.waitFor({ state: 'visible', timeout: 5_000 })
    await body.fill(BODY)

    // 접으면 대기 중인 저장이 flush된다
    await page.keyboard.press('Escape')
    await body.waitFor({ state: 'detached', timeout: 5_000 })

    await title.click()
    await expect(page.getByLabel('본문')).toHaveValue(BODY)
  })

  it('담기 토글만 맥락 칩을 만든다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-pick')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /e2e-pick/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')
    const title = page.getByRole('button', { name: ISSUE, exact: true })
    await title.waitFor({ state: 'visible', timeout: 10_000 })

    await title.click()
    // 제목을 눌러도 도크에 칩이 생기지 않는다
    expect(await page.getByRole('button', { name: new RegExp(`${ISSUE}.*✕`) }).count()).toBe(0)

    await page.getByRole('button', { name: `${ISSUE} 맥락에 담기` }).click()
    await page.getByRole('button', { name: new RegExp(`${ISSUE}.*✕`) })
      .waitFor({ state: 'visible', timeout: 5_000 })
  })
})
```

칩 제거 버튼의 접근 가능한 이름은 `RunPanel.tsx:207`의 `{chip.label} ✕`에서 온다.

Run: `pnpm test:e2e`
Expected: 8 PASS (기존 6 + 새 2). **`pnpm dev`가 떠 있으면 먼저 끈다.**

- [ ] **Step 2: 저장 배선을 변이로 확인한다**

`IssueDetail`의 `<textarea onBlur={() => { void bodySave.flush() }}>`와 Esc 경로 중 하나를 지운다. `본문을 쓰고 접었다 열면 그대로 있다`가 FAIL해야 한다 — 디바운스가 끝나기 전에 접히므로 저장이 날아간다. 되돌린다.

**여기서 안 잡히면** flush 배선이 e2e로도 무방비인 것이다. 그 경우 접기 전 대기 시간을 줄이거나(본문을 채우자마자 Esc) 단위 테스트로 대신 고정하고 보고서에 적는다.

- [ ] **Step 3: 커밋**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
git add -A
git commit -m "test: cover the issue body round trip end to end"
```

---

## 마무리 점검

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e

# 경계 — 출력이 없어야 한다
grep -rn "from 'electron'" core/
grep -rn "window.oneDesk" renderer/ | grep -v main.tsx
grep -rn "from '@core\|from '@shared" e2e/

# 고아 프로세스와 임시 디렉토리
ps aux | grep -i "[e]lectron.*one-desk"
ls /tmp | grep one-desk
```

`CLAUDE.md`의 현재 상태 줄을 갱신하고, 문서 표에 이번 설계 문서와 계획 문서를 더한다. 새로 생긴 함정이 있으면 "밟으면 조용히 깨지는 것들"에 더한다 — 특히 **`updatedAt`이 단조 증가해야 낙관적 잠금이 성립한다**는 것과 **성공한 저장이 기대값을 갱신하지 않으면 두 번째 저장이 자기 자신과 충돌한다**는 것은 다시 밟기 쉬운 자리다.

남은 B·C·D(마크다운 렌더링, 검색·필터·정렬, run 완료 구독)는 이 스펙 밖이다. A를 실제로 써 본 뒤 우선순위를 정한다.
