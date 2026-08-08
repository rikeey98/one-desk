# 1단계 보강 (2단계 선행 작업) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1단계 브랜치 리뷰에서 나온 선행 작업 6가지를 처리해, 2단계(agent 실행 파이프라인)가 올라갈 토대를 단단히 한다.

**Architecture:** 기존 구조를 바꾸지 않는다. 리포지토리 계층에 트랜잭션과 workspace 경계 검증을 넣고, 렌더러에 오류 표시 경로를 만들고, main 프로세스에 생명주기 훅을 건다.

**Tech Stack:** 기존과 동일 — pnpm / TypeScript 5.9.3 / Electron 43.3.0 / better-sqlite3 13.0.3 / drizzle-orm 0.45.2 / React 19.2 / Vitest 4.1.10

**참조:** `docs/superpowers/specs/2026-08-08-stage2-handoff.md`

## Global Constraints

- **`core/`는 `electron`을 import하지 않는다.** ESLint가 강제한다.
- **`renderer/`는 `core/`를 import하지 않고, `window.oneDesk` 참조는 `renderer/main.tsx` 한 곳뿐이다.**
- **IPC 핸들러는 얇다** — core 메서드 호출만.
- **`issue.ts`↔`memo.ts`, `useIssues.ts`↔`useMemos.ts`의 중복은 의도된 것이다.** 공통 헬퍼로 추출하지 말고, **양쪽을 대칭으로 고친다.** 한쪽만 고치면 드리프트가 생긴다.
- **시각은 epoch milliseconds 정수.** id는 `randomUUID()`.
- 들여쓰기 2칸, camelCase 함수명, `verbatimModuleSyntax`(타입 전용 import는 `import type`).
- 현재 테스트 26개 통과 상태에서 시작한다.

## 선행 작업 6가지와 태스크 대응

| 핸드오프 항목 | 태스크 |
|---|---|
| 3. 트랜잭션 부재 | Task 1 |
| 4. workspace 경계 미검증 | Task 2 |
| 6. 렌더러 오류 표시 없음 | Task 3 |
| 1. 윈도우 참조 없음 / 2. 생명주기 훅 없음 | Task 4 |
| 5. `run_context_item` cascade 판단 | Task 5 (문서) |
| 이월 minor 정리 | Task 5 |

---

## Task 1: 리포지토리 트랜잭션

`create`와 `update`가 본문 INSERT/UPDATE와 태그 조작을 원자적으로 처리하게 한다.

**Files:**
- Modify: `core/db/repositories/issue.ts`, `core/db/repositories/memo.ts`
- Modify: `core/db/repositories/issue.test.ts`, `core/db/repositories/memo.test.ts`

**Interfaces:**
- Consumes: `Database` (`core/db/open.ts`), `issue`/`issueRepo`/`memo`/`memoRepo` (`core/db/schema.ts`)
- Produces: 동작 변경만. 공개 시그니처는 그대로

- [ ] **Step 1: 실패하는 테스트 작성**

`core/db/repositories/issue.test.ts`의 `describe` 안에 추가:

```ts
it('태그 삽입이 실패하면 이슈 본문도 저장되지 않는다', () => {
  expect(() =>
    issues.create({ workspaceId, title: '고아 이슈', repoIds: ['존재하지-않는-repo'] })
  ).toThrow()

  expect(issues.list({ workspaceId })).toHaveLength(0)
})
```

`core/db/repositories/memo.test.ts`에도 같은 형태로 추가:

```ts
it('태그 삽입이 실패하면 메모 본문도 저장되지 않는다', () => {
  expect(() =>
    memos.create({ workspaceId, title: '고아 메모', repoIds: ['존재하지-않는-repo'] })
  ).toThrow()

  expect(memos.list({ workspaceId })).toHaveLength(0)
})
```

`.toThrow()`만으로는 부족하다 — 두 번째 단언이 핵심이다. 예외는 지금도 던져지지만(외래키 위반), **본문 행이 남는 것**이 결함이다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- core/db/repositories/issue.test.ts core/db/repositories/memo.test.ts`
Expected: 새 테스트 2개 FAIL — `expected [ {...} ] to have a length of 0 but got 1`. 예외는 던져지지만 본문이 남아 두 번째 단언에서 실패한다.

- [ ] **Step 3: `issue.ts` 구현**

파일 상단 import에 `Database` 타입이 이미 있다. 그 아래에 runner 타입을 추가한다:

```ts
/** db.transaction()의 콜백이 받는 runner. db와 같은 쿼리 빌더 API를 갖는다. */
type Runner = Parameters<Parameters<Database['transaction']>[0]>[0]
```

`replaceTags`를 runner를 받도록 바꾼다:

```ts
function replaceTags(runner: Runner, issueId: string, repoIds: string[]) {
  runner.delete(issueRepo).where(eq(issueRepo.issueId, issueId)).run()
  if (repoIds.length > 0) {
    runner.insert(issueRepo).values(repoIds.map((repoId) => ({ issueId, repoId }))).run()
  }
}
```

`create`와 `update`를 트랜잭션으로 감싼다:

```ts
create(input: CreateIssueInput): Issue {
  const id = randomUUID()
  const now = Date.now()
  db.transaction((tx) => {
    tx.insert(issue).values({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      body: input.body ?? '',
      createdAt: now,
      updatedAt: now
    }).run()
    replaceTags(tx, id, input.repoIds ?? [])
  })
  return getById(id)
},

update(input: UpdateIssueInput): Issue {
  const patch: Record<string, unknown> = { updatedAt: Date.now() }
  if (input.title !== undefined) patch['title'] = input.title
  if (input.body !== undefined) patch['body'] = input.body
  if (input.status !== undefined) {
    patch['status'] = input.status
    // closedAt은 status에서 파생된다. 호출자가 따로 관리하면 둘이 어긋난다.
    patch['closedAt'] = input.status === 'done' ? Date.now() : null
  }

  db.transaction((tx) => {
    tx.update(issue).set(patch).where(eq(issue.id, input.id)).run()
    if (input.repoIds !== undefined) replaceTags(tx, input.id, input.repoIds)
  })
  return getById(input.id)
},
```

`getById`는 트랜잭션 밖에 둔다. 커밋된 결과를 읽는 것이 맞다.

- [ ] **Step 4: `memo.ts` 구현**

같은 변경을 대칭으로 적용한다. `Runner` 타입 선언, `replaceTags(runner, memoId, repoIds)`, `create`/`update`의 트랜잭션 래핑. `memo`에는 `status`/`closedAt`이 없으므로 `update`의 patch가 더 단순하다:

```ts
update(input: UpdateMemoInput): Memo {
  const patch: Record<string, unknown> = { updatedAt: Date.now() }
  if (input.title !== undefined) patch['title'] = input.title
  if (input.body !== undefined) patch['body'] = input.body

  db.transaction((tx) => {
    tx.update(memo).set(patch).where(eq(memo.id, input.id)).run()
    if (input.repoIds !== undefined) replaceTags(tx, input.id, input.repoIds)
  })
  return getById(input.id)
},
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test`
Expected: 28개 통과 (기존 26 + 새 2개)

- [ ] **Step 6: 커밋**

```bash
pnpm typecheck && pnpm lint
git add core/db/repositories/
git commit -m "fix: wrap issue and memo writes in transactions"
```

---

## Task 2: workspace 경계 검증

태그로 붙이는 repo가 같은 workspace에 속하는지 확인한다.

**Files:**
- Modify: `core/db/repositories/issue.ts`, `core/db/repositories/memo.ts`
- Modify: `core/db/repositories/issue.test.ts`, `core/db/repositories/memo.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Runner` 타입과 트랜잭션 구조
- Produces: 동작 변경만

- [ ] **Step 1: 실패하는 테스트 작성**

`issue.test.ts`에 추가:

```ts
it('다른 workspace의 repo는 태그로 붙일 수 없다', () => {
  const other = createWorkspaceRepository(db).create({ name: 'other' })
  const otherRepo = createRepoRepository(db)
    .create({ workspaceId: other.id, name: '남의repo', path: '/tmp/other' })

  expect(() =>
    issues.create({ workspaceId, title: '경계 침범', repoIds: [otherRepo.id] })
  ).toThrow(/workspace/)

  expect(issues.list({ workspaceId })).toHaveLength(0)
})

it('같은 repo를 중복해서 넘겨도 거부하지 않는다', () => {
  const created = issues.create({
    workspaceId, title: '중복 태그', repoIds: [apiRepoId, apiRepoId]
  })
  expect(created.repoIds).toEqual([apiRepoId])
})
```

두 번째 테스트가 중요하다. 검증을 "찾은 개수 == 요청 개수"로 짜면 중복 입력에서 잘못 실패한다. 중복 제거를 강제하는 테스트다.

`memo.test.ts`에도 대칭으로 추가한다(`memos.create`, `memos.list`, "메모" 문구로).

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- core/db/repositories/issue.test.ts core/db/repositories/memo.test.ts`
Expected: 경계 테스트 2개 FAIL — 예외가 던져지지 않아 `toThrow`에서 실패한다. 중복 테스트는 이미 통과할 수도 있다(조인 테이블 복합키가 중복을 흡수).

- [ ] **Step 3: `issue.ts` 구현**

import에 `and`, `inArray`를 추가하고(이미 있으면 그대로), 스키마에서 `repo`를 가져온다:

```ts
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm'
import { issue, issueRepo, repo } from '../schema'
```

검증 헬퍼를 추가한다:

```ts
/**
 * 태그로 붙이려는 repo가 전부 같은 workspace 소속인지 확인한다.
 * 외래키는 repo의 존재만 보장하고 소속은 보지 않으므로, 이 검증이 없으면
 * 다른 workspace의 repo id를 그대로 붙일 수 있다 (설계 §8의 보안 경계).
 */
function assertReposInWorkspace(runner: Runner, workspaceId: string, repoIds: string[]) {
  if (repoIds.length === 0) return
  const found = runner
    .select({ id: repo.id })
    .from(repo)
    .where(and(eq(repo.workspaceId, workspaceId), inArray(repo.id, repoIds)))
    .all()
  const known = new Set(found.map((r) => r.id))
  const outside = repoIds.filter((id) => !known.has(id))
  if (outside.length > 0) {
    throw new Error(`이 workspace에 속하지 않는 repo입니다: ${outside.join(', ')}`)
  }
}
```

**개수 비교가 아니라 집합 차집합으로 판정한다.** `found.length !== repoIds.length`로 짜면 중복 입력(`['a','a']`)에서 잘못 실패한다.

`replaceTags`에서 중복을 제거한다:

```ts
function replaceTags(runner: Runner, issueId: string, repoIds: string[]) {
  const unique = [...new Set(repoIds)]
  runner.delete(issueRepo).where(eq(issueRepo.issueId, issueId)).run()
  if (unique.length > 0) {
    runner.insert(issueRepo).values(unique.map((repoId) => ({ issueId, repoId }))).run()
  }
}
```

`create`의 트랜잭션 안에서 검증을 부른다:

```ts
db.transaction((tx) => {
  assertReposInWorkspace(tx, input.workspaceId, input.repoIds ?? [])
  tx.insert(issue).values({ /* 그대로 */ }).run()
  replaceTags(tx, id, input.repoIds ?? [])
})
```

`update`는 대상 이슈의 workspace를 먼저 조회해야 한다:

```ts
update(input: UpdateIssueInput): Issue {
  const owner = db
    .select({ workspaceId: issue.workspaceId })
    .from(issue)
    .where(eq(issue.id, input.id))
    .get()
  if (!owner) throw new Error(`이슈를 찾을 수 없습니다: ${input.id}`)

  const patch: Record<string, unknown> = { updatedAt: Date.now() }
  if (input.title !== undefined) patch['title'] = input.title
  if (input.body !== undefined) patch['body'] = input.body
  if (input.status !== undefined) {
    patch['status'] = input.status
    patch['closedAt'] = input.status === 'done' ? Date.now() : null
  }

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

- [ ] **Step 4: `memo.ts` 구현**

같은 변경을 대칭으로 적용한다. 오류 메시지도 동일하게 `이 workspace에 속하지 않는 repo입니다: ...`를 쓴다. `update`의 소유자 조회에서 없을 때 메시지는 `메모를 찾을 수 없습니다: ${input.id}`.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test`
Expected: 32개 통과 (Task 1 후 28 + 새 4개)

- [ ] **Step 6: 커밋**

```bash
pnpm typecheck && pnpm lint
git add core/db/repositories/
git commit -m "fix: reject repo tags from another workspace"
```

---

## Task 3: 렌더러 오류 표시

지금은 `create`가 거부되면 사용자에게 아무것도 안 보이고 콘솔에 unhandled rejection만 남는다.

**Files:**
- Modify: `renderer/components/AddForm.tsx`, `renderer/components/AddRepoForm.tsx`, `renderer/components/IssuePanel.tsx`
- Modify: `renderer/index.css`
- Create: `renderer/components/AddForm.test.tsx`

**Interfaces:**
- Consumes: `useClient()`
- Produces: 컴포넌트 동작 변경만

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// renderer/components/AddForm.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddForm } from './AddForm'

describe('AddForm', () => {
  it('제출이 실패하면 오류를 화면에 보여주고 입력값을 유지한다', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('저장할 수 없습니다'))
    render(<AddForm placeholder="새 항목" onSubmit={onSubmit} />)

    const input = screen.getByPlaceholderText('새 항목')
    await userEvent.type(input, '실패할 항목{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('저장할 수 없습니다')
    expect(input).toHaveValue('실패할 항목')
  })

  it('제출이 성공하면 입력값을 비우고 오류를 남기지 않는다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AddForm placeholder="새 항목" onSubmit={onSubmit} />)

    const input = screen.getByPlaceholderText('새 항목')
    await userEvent.type(input, '성공할 항목{Enter}')

    expect(input).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
```

**입력값 유지가 핵심이다.** 실패했는데 입력을 지워버리면 사용자가 다시 타이핑해야 한다.

`toHaveTextContent`와 `toHaveValue`는 jest-dom 매처다. 설치하고 setup에 연결한다:

```bash
pnpm add -D @testing-library/jest-dom@6.6.3
```

`renderer/vitest.setup.ts`에 추가:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- renderer/components/AddForm.test.tsx`
Expected: 첫 테스트 FAIL — `Unable to find role="alert"`. 현재 AddForm은 오류를 표시하지 않는다.

- [ ] **Step 3: `AddForm` 구현**

```tsx
// renderer/components/AddForm.tsx
import { useState, type FormEvent } from 'react'

export function AddForm({ placeholder, onSubmit }: {
  placeholder: string
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      setValue('')
    } catch (err) {
      // 입력값은 지우지 않는다. 실패했는데 지우면 다시 타이핑해야 한다.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="add-form">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={busy}
      />
      {error && <div role="alert" className="form-error">{error}</div>}
    </form>
  )
}
```

- [ ] **Step 4: `AddRepoForm` 구현**

같은 패턴을 적용한다. `catch`에서 `setError`, `finally`에서 `setBusy(false)`, 성공 시에만 입력 초기화, 오류를 `<div role="alert" className="form-error">`로 표시.

- [ ] **Step 5: `IssuePanel`의 상태 토글 오류 처리**

`IssuePanel`에 패널 수준 오류 상태를 둔다:

```tsx
const [error, setError] = useState<string | null>(null)

async function addIssue(title: string) {
  await client.issues.create({
    workspaceId,
    title,
    repoIds: repoId ? [repoId] : []
  })
  await refresh()
}

async function cycleStatus(id: string, current: IssueStatus) {
  const next = current === 'open' ? 'doing' : current === 'doing' ? 'done' : 'open'
  setError(null)
  try {
    await client.issues.update({ id, status: next })
    await refresh()
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}
```

`addIssue`는 오류를 잡지 않는다 — `AddForm`이 잡아서 표시한다. 두 곳에서 잡으면 오류가 두 번 보인다.

패널 본문 맨 위에 오류를 렌더링한다:

```tsx
{error && <div role="alert" className="form-error">{error}</div>}
```

`IssueStatus` 타입은 `@shared/models`에서 import한다.

- [ ] **Step 6: 스타일 추가**

`renderer/index.css`에 추가:

```css
.form-error { margin-top: 5px; padding: 5px 8px; border-radius: 4px; font-size: 11px; background: #fee2e2; color: #991b1b; }
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm test`
Expected: 34개 통과 (Task 2 후 32 + 새 2개)

- [ ] **Step 8: 커밋**

```bash
pnpm typecheck && pnpm lint
git add renderer/ package.json pnpm-lock.yaml
git commit -m "feat: surface write failures in the renderer"
```

---

## Task 4: 윈도우 참조와 생명주기 훅

**Files:**
- Modify: `core/index.ts`, `electron/main.ts`

**Interfaces:**
- Produces: `Core.close(): void`

- [ ] **Step 1: `core/index.ts`에 `close` 추가**

```ts
export function createCore(opts: CoreOptions) {
  const db = openDb({
    file: join(opts.dataDir, 'one-desk.db'),
    migrationsDir: opts.migrationsDir
  })

  return {
    workspaces: createWorkspaceRepository(db),
    repos: createRepoRepository(db),
    issues: createIssueRepository(db),
    memos: createMemoRepository(db),

    /**
     * DB 연결을 닫는다. better-sqlite3는 마지막 연결이 정상적으로 닫힐 때
     * WAL을 체크포인트하므로, 이걸 부르면 종료 시점의 데이터가 메인 DB 파일에
     * 반영된다. 백업(openDb의 backupIfNeeded)이 온전한 상태를 복사하게 된다.
     */
    close(): void {
      db.$client.close()
    }
  }
}
```

- [ ] **Step 2: `electron/main.ts`에 모듈 스코프 참조와 훅 추가**

```ts
import { app, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createCore, type Core } from '@core/index'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let core: Core | null = null

function resolveMigrationsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}

/**
 * 실행 중인 창. 2단계에서 run 이벤트를 webContents.send로 흘릴 때 쓴다.
 * 창이 닫히면 null이 되므로 호출자는 항상 존재 여부를 확인해야 한다.
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  try {
    core = createCore({
      dataDir: app.getPath('userData'),
      migrationsDir: resolveMigrationsDir()
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('one-desk를 시작할 수 없습니다', message)
    app.quit()
    return
  }

  registerIpc(core)
  createWindow()

  app.on('activate', () => {
    // macOS에서 dock 아이콘을 눌렀을 때. 창이 살아 있으면 새로 만들지 않고 포커스만 준다.
    const existing = getMainWindow()
    if (existing) {
      existing.focus()
    } else {
      createWindow()
    }
  })
})

// 종료 직전에 DB를 닫는다. 2단계에서는 여기에 실행 중인 agent 프로세스 정리도 붙는다.
app.on('before-quit', () => {
  core?.close()
  core = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

창 크기를 900×670에서 1440×900으로 키운다. 3컬럼 레이아웃이 900px에서는 각 패널이 250px 남짓이라 이슈 제목이 잘린다.

- [ ] **Step 3: 검증**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 전부 통과, 테스트 34개 유지

Run: `pnpm dev`
Expected: 창이 뜨고 3컬럼이 보인다. 앱을 종료한 뒤 `~/Library/Application Support/one-desk/`에 `one-desk.db-wal`이 **남아 있지 않은지** 확인한다. 남아 있지 않으면 `close()`가 체크포인트를 실행한 것이다.

```bash
ls -la ~/Library/Application\ Support/one-desk/
```

- [ ] **Step 4: 커밋**

```bash
git add core/index.ts electron/main.ts
git commit -m "feat: add window reference and close db on quit"
```

---

## Task 5: 이월 minor 정리와 cascade 결정 기록

**Files:**
- Modify: `core/db/repositories/memo.test.ts`, `core/db/repositories/testing.ts`
- Modify: `package.json`
- Delete: `resources/icon.png`
- Modify: `docs/superpowers/specs/2026-08-07-one-desk-design.md`

- [ ] **Step 1: `memo.test.ts`에 빠진 대칭 테스트 추가**

`issue.test.ts`에는 있고 `memo.test.ts`에는 없는 테스트다. 의도된 중복 쌍이므로 테스트도 대칭이어야 드리프트를 잡는다.

```ts
it('repoIds를 갱신하면 기존 태그를 대체한다', () => {
  const created = memos.create({ workspaceId, title: 'x', repoIds: [apiRepoId] })
  const updated = memos.update({ id: created.id, repoIds: [webRepoId] })
  expect(updated.repoIds).toEqual([webRepoId])
})
```

`webRepoId`가 `beforeEach`에 없으면 추가한다:

```ts
webRepoId = repos.create({ workspaceId, name: 'web', path: '/tmp/web' }).id
```

- [ ] **Step 2: `testing.ts`의 상대 경로를 절대 경로로**

```ts
// core/db/repositories/testing.ts
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { openDb, type Database } from '../open'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(HERE, '../../../drizzle')

export function makeTestDb(): Database {
  return openDb({ file: ':memory:', migrationsDir: MIGRATIONS_DIR })
}
```

지금은 vitest가 항상 루트에서 돌아 `'drizzle'`이 통하지만, 실행 위치에 묶여 있다. 파일 위치 기준으로 바꾸면 어디서 돌려도 같다.

- [ ] **Step 3: 잔재 파일 정리와 prettier 활성화**

```bash
git rm resources/icon.png
```

`build/icon.png`가 electron-builder가 실제로 쓰는 파일이고, `resources/icon.png`는 어디서도 참조되지 않는다.

prettier 설정 파일 3종(`.prettierrc.yaml`, `.prettierignore`, `.vscode/settings.json`)은 있는데 prettier가 설치되어 있지 않아 무효 상태다. 설정을 지우는 대신 도구를 설치해 살린다:

```bash
pnpm add -D prettier@3.4.2
```

`package.json`의 scripts에 추가:

```json
"format": "prettier --write ."
```

**이 태스크에서 `pnpm format`을 실행하지는 않는다.** 전체 포맷팅 diff가 이 커밋에 섞이면 리뷰가 불가능해진다. 도구와 스크립트만 준비하고, 실제 적용은 별도 커밋에서 사용자가 판단한다.

- [ ] **Step 4: cascade 결정을 설계 문서에 기록**

`docs/superpowers/specs/2026-08-07-one-desk-design.md`의 섹션 5, `run_context_item` 설명 근처에 다음을 추가한다:

```markdown
#### `run_context_item`에는 cascade를 적용하지 않는다

1단계의 외래키는 전부 `ON DELETE cascade`다. workspace를 지우면 그 안의 repo·issue·memo가 함께 사라지는 것이 맞기 때문이다.

**`run_context_item`은 예외다.** 같은 관례를 적용하면 이슈를 지웠을 때 그 이슈를 첨부했던 과거 run의 기록이 조용히 사라진다. run 기록은 "무엇을 근거로 이 작업을 시켰는가"의 증거이고, 근거가 된 항목이 지워졌다고 증거까지 지울 이유가 없다.

`ON DELETE SET NULL`로 두고 `item_id`를 nullable로 만든다. 화면에서는 "삭제된 이슈"로 표시한다. 무엇이 첨부됐었는지는 `item_type`과 run의 `assembled_prompt`에 남아 있다.
```

- [ ] **Step 5: 검증과 커밋**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: 35개 통과 (Task 3 후 34 + memo 대칭 테스트 1개)

```bash
git add -A
git commit -m "chore: symmetric memo test, absolute migrations path, prettier setup"
```

---

## 완료 기준

- [ ] `pnpm test` — 35개 통과
- [ ] `pnpm typecheck` — 통과
- [ ] `pnpm lint` — 통과
- [ ] `grep -rn "window.oneDesk" renderer/ | grep -v "main.tsx"` — 출력 없음
- [ ] `grep -rn "from 'electron'" core/` — 출력 없음
- [ ] `pnpm dev`로 앱이 뜨고, 종료 후 `one-desk.db-wal`이 남지 않음
- [ ] 다른 workspace의 repo를 태그로 붙이려 하면 화면에 오류가 표시됨
