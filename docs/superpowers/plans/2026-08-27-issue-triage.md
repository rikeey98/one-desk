# 이슈 훑기 구현 계획

> **에이전트 작업자에게:** 필수 하위 스킬 — `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 태스크 단위로 실행한다. 각 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 이슈를 제목 한 줄로 던져 넣고 분류는 나중에 몰아서 하게 만든다. 목록은 축으로 묶고 접되 개수는 늘 보이며, 그룹 안은 **안 본 순**으로 뒤집는다.

**아키텍처:** `issue`에 다섯 칸을 더한다 — 분류 축 셋(`source`·`kind`·`priority`)과 `triagedAt`·`seenAt`. `triagedAt`은 `closedAt`처럼 **저장소가 파생**한다. `seenAt`은 `updatedAt`과 분리된 별도 경로(`markSeen`)로만 쓰이는데, `updatedAt`은 agent도 MCP로 올리기 때문이다. 훑기 UI는 새 화면이 아니라 `IssuePanel`의 상세 자리를 빌려 쓰므로 `App.tsx`의 계약이 바뀌지 않는다. 그룹핑·`done` 분리·방치 판정은 순수 함수(`renderer/issueGroups.ts`)로 떼어 렌더 없이 검증한다.

**기술 스택:** React 19, Vitest 4.1.10(core=node, renderer=jsdom), @testing-library/react, drizzle-orm + better-sqlite3, drizzle-kit, zod(MCP), playwright-core(e2e).

**설계 문서:** `docs/superpowers/specs/2026-08-27-issue-triage-design.md`

**시작 시점 기준선:** 테스트 **528개 통과 / 1개 skip, 48파일**. `pnpm typecheck`·`pnpm lint` 깨끗. 브랜치 `feature/issue-triage`(스펙 커밋 `706e0b0`).

---

## Global Constraints

프로젝트 전역 요구사항이다. **모든 태스크의 요구사항에 이 절이 암묵적으로 포함된다.**

- **패키지 매니저는 pnpm이다.** `pnpm test <경로>`로 한 파일만 돌린다 — `--`를 붙이면 필터가 먹지 않고 전체가 돈다.
- **`core/`는 `electron`을 import하지 않는다.** **`renderer/`는 `core/`를 import하지 않는다** — `window.oneDesk` 참조는 `renderer/main.tsx` 한 곳뿐이고 컴포넌트는 `useClient()`를 쓴다. **`e2e/`는 `core/`와 `shared/`를 import하지 않는다.**
- **IPC 핸들러는 얇다** — core 메서드 호출만 하고 로직을 넣지 않는다.
- 들여쓰기 2칸. 함수명 camelCase, 상수 UPPER_SNAKE_CASE.
- `verbatimModuleSyntax: true` — 타입 전용 import는 반드시 `import type`.
- **주석과 오류 메시지는 한국어.**
- **시각은 epoch milliseconds 정수.** `Date.now()`로 명시 삽입한다. id는 `randomUUID()`. **쓰기는 트랜잭션으로 감싼다.**
- **파생 필드를 호출자가 넘기지 않는다.** `closedAt`은 `status`에서, **`triagedAt`은 축 셋에서** 파생된다.
- **TDD.** 실패를 먼저 확인하고 구현한다. 회귀 테스트를 추가할 때는 **대상 코드를 잠시 망가뜨려 그 테스트가 실제로 실패하는지 확인한다.**
- **테스트가 연 DB는 반드시 닫는다** — `db.$client.close()`. Windows는 열린 핸들이 있는 파일을 지우지 못해 릴리스 CI에서만 `EBUSY`로 터진다.
- 커밋 메시지는 영어, 명령형. 매 태스크 끝에 커밋한다.
- **`pnpm test:e2e`와 `pnpm dev`를 동시에 돌리지 않는다.** 산출물 디렉토리가 같아 dev 앱의 main/preload가 갈아끼워진다.

### 이 계획의 핵심 불변식

- **`markSeen`은 `updatedAt`을 건드리지 않는다.** 건드리면 열려 있는 `IssueDetail`의 `expected.current`가 즉시 낡아, 다음 자동 저장이 사용자 자신의 열람을 agent의 편집으로 착각해 유령 충돌 배너를 띄운다.
- **`markSeen`은 목록을 다시 읽게 하지 않는다.** 정렬이 `seenAt` 오래된 순이라, 읽으면 방금 클릭한 항목이 눈앞에서 맨 아래로 도망간다.
- **훑기는 `seenAt`을 찍지 않는다.** 분류와 열람은 다른 행위다.
- **마이그레이션은 컬럼을 더하기만 한다.** SQLite에서 제약을 바꾸려면 테이블을 다시 만들어야 하고, 그 `DROP TABLE issue`가 `issue_repo`의 cascade를 태워 모든 repo 태그를 지운다.
- **"정리 안 됨"(`triagedAt IS NULL`)과 "미지정"(그 축이 null)은 다른 말이다.** 화면에서 절대 섞어 쓰지 않는다.
- **대칭 규칙은 이슈/메모 공통 필드에서 끝난다.** 축·`triagedAt`·`seenAt`·훑기를 `memo.ts`에 옮기지 않는다 (Task 9에서 CLAUDE.md에 못박는다).

### 스펙이 정하지 않아 이 계획이 정한 것

세 가지가 스펙에 빠져 있어 여기서 정한다. **결정이지 추측이 아니다 — 바꾸려면 스펙을 먼저 고친다.**

1. **repo 축으로 묶으면 이슈가 여러 그룹에 나타난다.** `issue_repo`가 다대다이기 때문이다. 그래서 repo 축에서는 그룹 개수의 합이 전체 개수보다 클 수 있다. 중복을 없애려면 "첫 repo만" 같은 임의 규칙이 필요한데, 그건 화면에서 설명할 수 없다.
2. **기본 접힘은 `완료` 그룹 하나뿐이다.** 나머지는 펼친 채로 시작한다. 스펙 §5의 핵심 약속이 "묻히지 않는다"인데 기본으로 접으면 앱이 스스로 묻는 셈이 된다. 접는 것은 사용자가 한다.
3. **훑기 대기열은 `triagedAt === null && status !== 'done'`이다.** 정리되지 않은 채 끝난 이슈를 이제 와서 분류하라고 요구할 이유가 없다.

---

## 파일 구조

### 새로 만드는 파일

| 파일 | 책임 |
|---|---|
| `drizzle/0003_*.sql` | 컬럼 다섯 + `triaged_at` 백필 |
| `core/db/migrations.test.ts` | 백필이 실제로 도는지 — 0002 상태에서 0003으로 올린다 |
| `renderer/issueAxes.ts` | 축 코드 ↔ 한국어 라벨, 그룹 순서, 방치 임계값. 도메인 상수만 |
| `renderer/issueAxes.test.ts` | 라벨 표가 타입과 어긋나지 않는지 |
| `renderer/issueGroups.ts` | 이슈 배열 → 그룹 배열. `done` 분리·배지 판정. **정렬은 안 한다** |
| `renderer/issueGroups.test.ts` | 그룹 순서·미지정 위치·done 분리·배지 임계값 |
| `renderer/components/TriageCard.tsx` | 훑기 카드 한 장 |
| `renderer/components/TriageCard.test.tsx` | 축 선택·버튼 활성 조건 |
| `renderer/components/IssuePanel.test.tsx` | **지금 없다.** 배너·그룹·접기·훑기 흐름 |
| `e2e/triage.e2e.ts` | 던지기 → 배너 → 훑기 → 그룹에 나타남 |

### 고치는 파일

| 파일 | 무엇을 |
|---|---|
| `core/db/schema.ts` | `issue`에 컬럼 다섯 |
| `core/db/repositories/issue.ts` | 축 create/update, `triagedAt` 파생, `markSeen`, 정렬 역전 |
| `core/db/repositories/issue.test.ts` | 위의 테스트 |
| `shared/models.ts` | `IssueSource`·`IssueKind`·`IssuePriority`, `Issue`와 두 Input에 필드 |
| `shared/channels.ts` | `issuesMarkSeen` |
| `shared/client.ts` | `issues.markSeen` |
| `electron/ipc/issues.ts` | `markSeen` 핸들러 |
| `electron/preload.ts` | `markSeen` 브리지 |
| `core/mcp/tools.ts` | `create_issue`·`update_issue`에 축 셋 |
| `core/mcp/tools.test.ts` | 위의 테스트 |
| `renderer/components/IssuePanel.tsx` | 배너·축 드롭다운·그룹 렌더·접기·`triaging` |
| `renderer/components/IssueDetail.tsx` | 축 편집 + 마운트 시 `markSeen` |
| `renderer/components/IssueDetail.test.tsx` | 위의 테스트 |
| `renderer/index.css` | 그룹 헤더·칩·배너·훑기 카드 |
| `CLAUDE.md` | 대칭 규칙의 끝, 새 함정 |

---

## Task 1: 스키마와 마이그레이션

**Files:**
- Modify: `core/db/schema.ts:33-43`
- Create: `drizzle/0003_*.sql` (drizzle-kit이 이름을 정한다)
- Create: `core/db/migrations.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `issue` 테이블의 `source`·`kind`·`priority`·`triaged_at`·`seen_at` 컬럼. 전부 nullable.

- [ ] **Step 1: 스키마에 컬럼 다섯을 더한다**

`core/db/schema.ts`의 `issue` 정의에서 `closedAt` 아래에 넣는다.

```ts
export const issue = sqliteTable('issue', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  status: text('status', { enum: ['open', 'doing', 'done'] }).notNull().default('open'),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs()),
  closedAt: integer('closed_at'),
  // 분류 축 셋. 전부 nullable인 것이 핵심이다 — "아직 안 정해졌다"가 정상 상태다.
  source: text('source', { enum: ['customer', 'plan', 'meeting', 'dev'] }),
  kind: text('kind', { enum: ['bug', 'feature', 'refactor', 'docs', 'research'] }),
  // 순서가 있다. 나열 순서가 곧 급한 순서다.
  priority: text('priority', { enum: ['urgent', 'week', 'someday'] }),
  // 축 셋이 모두 채워지면 저장소가 찍는다. 호출자가 넘기지 않는다 (closedAt과 같은 모양).
  triagedAt: integer('triaged_at'),
  // 사람이 상세를 연 시각. updatedAt과 분리한다 — updatedAt은 agent도 MCP로 올리므로
  // 그것으로 방치를 판정하면 agent가 건드린 이슈일수록 조용해진다.
  seenAt: integer('seen_at')
}, (t) => [
  index('issue_workspace_status_idx').on(t.workspaceId, t.status),
  index('issue_triaged_idx').on(t.workspaceId, t.triagedAt)
])
```

- [ ] **Step 2: 마이그레이션을 생성한다**

```bash
pnpm db:generate
```

`drizzle/0003_*.sql`이 생기고 `drizzle/meta/_journal.json`에 idx 3 항목이 붙는다. 파일 이름은 drizzle-kit이 무작위로 정하므로 그대로 둔다.

- [ ] **Step 3: 생성된 SQL에 백필을 손으로 더한다**

`drizzle/0003_*.sql`의 맨 아래에 붙인다. **이 줄이 없으면 앱을 켜자마자 "정리 안 됨 50건"이 뜬다.**

```sql
--> statement-breakpoint
-- 이미 쓰고 있던 이슈를 훑기 대기열로 쏟아붓지 않는다. 축은 비어 있는 채로
-- triaged_at만 채운다 — 설계 §3이 인정한 유일한 예외이고, 그 이슈의 축을
-- 처음 건드리는 순간 파생 규칙이 적용돼 예외가 스스로 사라진다.
UPDATE `issue` SET `triaged_at` = `created_at` WHERE `triaged_at` IS NULL;
```

`--> statement-breakpoint`는 drizzle이 문장을 나누는 구분자다. 생성된 파일의 기존 문장들 사이에 이미 있으니 형식을 그대로 따른다.

- [ ] **Step 4: 백필 회귀 테스트를 쓴다 (실패해야 한다)**

`core/db/migrations.test.ts`를 새로 만든다. 0002까지만 적용한 DB에 이슈를 넣고, 그 다음 전체 마이그레이션으로 열어 `triaged_at`이 채워졌는지 본다.

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './open'

/** drizzle 디렉토리를 idx <= untilIdx 까지만 담은 임시 복사본으로 만든다. */
function migrationsUpTo(untilIdx: number, dir: string) {
  const journal = JSON.parse(readFileSync(join('drizzle', 'meta', '_journal.json'), 'utf8'))
  const kept = journal.entries.filter((e: { idx: number }) => e.idx <= untilIdx)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  for (const entry of kept) {
    copyFileSync(join('drizzle', `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
    copyFileSync(
      join('drizzle', 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`),
      join(dir, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`)
    )
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: kept })
  )
  return dir
}

describe('0003 마이그레이션', () => {
  it('기존 이슈를 triaged_at = created_at 으로 백필한다', () => {
    const work = mkdtempSync(join(tmpdir(), 'one-desk-mig-'))
    try {
      const file = join(work, 'test.db')
      const old = migrationsUpTo(2, join(work, 'old-migrations'))

      // 0002 시점의 앱이 만든 것처럼 이슈를 하나 넣는다.
      const before = openDb({ file, migrationsDir: old })
      before.$client.exec(`
        INSERT INTO workspace (id, name, created_at, updated_at)
        VALUES ('ws', 'ws', 1000, 1000);
        INSERT INTO issue (id, workspace_id, title, created_at, updated_at)
        VALUES ('i1', 'ws', '옛 이슈', 1234, 1234);
      `)
      before.$client.close()

      // 이제 진짜 마이그레이션 디렉토리로 연다 — 0003이 여기서 돈다.
      const after = openDb({ file, migrationsDir: 'drizzle' })
      const row = after.$client
        .prepare('SELECT triaged_at as triagedAt FROM issue WHERE id = ?')
        .get('i1') as { triagedAt: number | null }
      after.$client.close()

      expect(row.triagedAt).toBe(1234)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 5: 테스트를 돌려 실패를 확인한다**

Run: `pnpm test core/db/migrations.test.ts`

이 시점에서는 Step 3의 백필이 이미 들어가 있으므로 **통과할 것이다.** 그러면 테스트가 진짜인지 확인해야 한다 — `drizzle/0003_*.sql`의 `UPDATE` 문장을 주석 처리하고 다시 돌린다.

Expected: `expected null to be 1234`로 FAIL.

확인했으면 주석을 되돌린다.

- [ ] **Step 6: 전체 테스트를 돌린다**

Run: `pnpm test && pnpm typecheck`
Expected: 529개 통과(528 + 새 테스트 1), typecheck 깨끗.

- [ ] **Step 7: 커밋**

```bash
git add core/db/schema.ts drizzle core/db/migrations.test.ts
git commit -m "feat(db): add triage axes, triagedAt and seenAt to issue"
```

---

## Task 2: 저장소 — 파생, markSeen, 정렬 역전

**Files:**
- Modify: `core/db/repositories/issue.ts`
- Modify: `shared/models.ts:11` (타입만 — 이 태스크가 저장소보다 먼저 필요하다)
- Test: `core/db/repositories/issue.test.ts`

**Interfaces:**
- Consumes: Task 1의 컬럼 다섯
- Produces:
  - `type IssueSource = 'customer' | 'plan' | 'meeting' | 'dev'`
  - `type IssueKind = 'bug' | 'feature' | 'refactor' | 'docs' | 'research'`
  - `type IssuePriority = 'urgent' | 'week' | 'someday'`
  - `Issue`에 `source: IssueSource | null` · `kind: IssueKind | null` · `priority: IssuePriority | null` · `triagedAt: number | null` · `seenAt: number | null`
  - `CreateIssueInput`·`UpdateIssueInput`에 `source?`·`kind?`·`priority?`
  - `issueRepository.markSeen(id: string): void`

- [ ] **Step 1: `shared/models.ts`에 타입을 더한다**

`IssueStatus` 선언 바로 아래에 넣는다.

```ts
export type IssueStatus = 'open' | 'doing' | 'done'
/** 이슈가 어디서 왔는가 */
export type IssueSource = 'customer' | 'plan' | 'meeting' | 'dev'
/** 무슨 일인가 */
export type IssueKind = 'bug' | 'feature' | 'refactor' | 'docs' | 'research'
/** 얼마나 급한가. **나열 순서가 곧 급한 순서다** — 그룹 순서가 여기서 나온다. */
export type IssuePriority = 'urgent' | 'week' | 'someday'
```

`Issue`·`CreateIssueInput`·`UpdateIssueInput`을 고친다.

```ts
export interface Issue {
  id: string
  workspaceId: string
  title: string
  body: string
  status: IssueStatus
  repoIds: string[]
  createdAt: number
  updatedAt: number
  closedAt: number | null
  source: IssueSource | null
  kind: IssueKind | null
  priority: IssuePriority | null
  /** 축 셋이 다 채워진 시각. null이면 훑기 대기열이다. **저장소가 파생한다.** */
  triagedAt: number | null
  /** 사람이 상세를 연 시각. updatedAt과 분리돼 있다 — agent는 이것을 못 올린다. */
  seenAt: number | null
}

export interface CreateIssueInput {
  workspaceId: string
  title: string
  body?: string
  repoIds?: string[]
  source?: IssueSource
  kind?: IssueKind
  priority?: IssuePriority
}

export interface UpdateIssueInput {
  id: string
  title?: string
  body?: string
  status?: IssueStatus
  repoIds?: string[]
  source?: IssueSource
  kind?: IssueKind
  priority?: IssuePriority
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`core/db/repositories/issue.test.ts`의 **바깥 `describe('IssueRepository', …)` 안, 닫는 괄호 바로 위**에 붙인다. `db`·`issues`·`workspaceId`가 그 스코프의 `beforeEach`(`:15-22`)에서 만들어지므로 **파일 맨 아래(바깥)에 붙이면 전부 undefined다.**

```ts
describe('분류 축과 triagedAt 파생', () => {
  it('축 셋이 다 있으면 triagedAt이 찍힌다', () => {
    const created = issues.create({
      workspaceId, title: '결제 취소 API 응답 지연',
      source: 'customer', kind: 'bug', priority: 'urgent'
    })
    expect(created.triagedAt).not.toBeNull()
    expect(created.source).toBe('customer')
  })

  it('축이 하나라도 비면 triagedAt은 null이다', () => {
    const created = issues.create({
      workspaceId, title: '회원 탈퇴 플로우 문의', source: 'meeting'
    })
    expect(created.triagedAt).toBeNull()
  })

  it('나중에 나머지 축을 채우면 triagedAt이 찍힌다', () => {
    const created = issues.create({ workspaceId, title: '이미지 업로드 용량 제한' })
    expect(created.triagedAt).toBeNull()

    issues.update({ id: created.id, source: 'customer', kind: 'feature' })
    expect(issues.get(created.id).triagedAt).toBeNull()

    issues.update({ id: created.id, priority: 'week' })
    expect(issues.get(created.id).triagedAt).not.toBeNull()
  })

  it('백필된 이슈(축 없이 triagedAt만 있음)의 축을 건드리면 대기열로 돌아온다', () => {
    // 마이그레이션 0003이 만드는 유일한 예외 상태다 (설계 §3). 축을 처음 건드리는
    // 순간 파생 규칙이 적용돼 예외가 스스로 사라진다.
    const created = issues.create({ workspaceId, title: '옛 이슈' })
    db.$client.prepare('UPDATE issue SET triaged_at = created_at WHERE id = ?').run(created.id)
    expect(issues.get(created.id).triagedAt).not.toBeNull()

    issues.update({ id: created.id, source: 'dev' })
    expect(issues.get(created.id).triagedAt).toBeNull()
  })

  it('축을 건드리지 않는 갱신은 triagedAt을 바꾸지 않는다', () => {
    const created = issues.create({
      workspaceId, title: '알림 메일 오타',
      source: 'dev', kind: 'docs', priority: 'someday'
    })
    const stamped = created.triagedAt
    issues.update({ id: created.id, body: '본문만 고친다' })
    expect(issues.get(created.id).triagedAt).toBe(stamped)
  })
})

describe('markSeen', () => {
  it('seenAt을 찍는다', () => {
    const created = issues.create({ workspaceId, title: '배포 스크립트 문서화' })
    expect(created.seenAt).toBeNull()
    issues.markSeen(created.id)
    expect(issues.get(created.id).seenAt).not.toBeNull()
  })

  it('updatedAt을 건드리지 않는다', () => {
    // 이것이 핵심이다. 올리면 열려 있는 IssueDetail의 기대값이 낡아
    // 다음 자동 저장이 사용자 자신의 열람을 agent의 편집으로 착각한다.
    const created = issues.create({ workspaceId, title: '로그인 리다이렉트' })
    issues.markSeen(created.id)
    expect(issues.get(created.id).updatedAt).toBe(created.updatedAt)
  })

  it('없는 이슈면 NotFoundError를 던진다', () => {
    expect(() => issues.markSeen('없는-id')).toThrow(NotFoundError)
  })
})

describe('목록 정렬', () => {
  it('안 본 것이 먼저 온다', () => {
    const a = issues.create({ workspaceId, title: 'A' })
    const b = issues.create({ workspaceId, title: 'B' })
    const c = issues.create({ workspaceId, title: 'C' })

    // A와 B는 봤고 C는 한 번도 안 봤다. C가 맨 위여야 한다.
    issues.markSeen(a.id)
    issues.markSeen(b.id)

    const titles = issues.list({ workspaceId }).map((i) => i.title)
    expect(titles[0]).toBe('C')
    // A를 B보다 먼저 봤으므로 A가 더 오래됐다 → A가 B보다 위
    expect(titles.indexOf('A')).toBeLessThan(titles.indexOf('B'))
  })

  it('updatedAt이 올라가도 순서가 바뀌지 않는다', () => {
    // agent가 MCP로 본문을 고쳐도 목록 맨 위로 올라오면 안 된다.
    const a = issues.create({ workspaceId, title: 'A' })
    const b = issues.create({ workspaceId, title: 'B' })
    issues.markSeen(a.id)
    issues.markSeen(b.id)

    issues.update({ id: a.id, body: 'agent가 쓴 것' })

    const titles = issues.list({ workspaceId }).map((i) => i.title)
    expect(titles).toEqual(['A', 'B'])
  })
})
```

`NotFoundError`가 아직 import되어 있지 않으면 파일 상단에 더한다: `import { NotFoundError } from '../../errors'`.

⚠️ `markSeen`을 연달아 부르면 같은 밀리초에 떨어질 수 있다. `'안 본 것이 먼저 온다'`의 A/B 비교가 흔들리면 `createdAt ASC` 3차 정렬이 받아주므로 결과는 같지만, 확실히 하려면 두 `markSeen` 사이에 `vi.setSystemTime`으로 시각을 벌린다. 기존 테스트가 이미 그렇게 하고 있으면 그 방식을 따른다.

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `pnpm test core/db/repositories/issue.test.ts`
Expected: `issues.markSeen is not a function` 등으로 FAIL.

- [ ] **Step 4: `buildPatch`를 파생까지 하도록 고친다**

`core/db/repositories/issue.ts:71-83`을 통째로 바꾼다.

```ts
  /** buildPatch가 파생을 계산하려면 현재 축 값이 필요하다. */
  type Previous = {
    updatedAt: number
    source: IssueSource | null
    kind: IssueKind | null
    priority: IssuePriority | null
  }

  /**
   * UpdateIssueInput을 SET 절로 바꾼다. update와 updateIfUnchanged가 함께 쓴다.
   *
   * updatedAt은 낙관적 잠금의 버전 노릇도 한다 (본문 편집 설계 §6). 같은 밀리초에
   * 두 번 쓰면 값이 같아져 "그 사이 바뀌었다"를 놓치므로 반드시 이전 값보다 크게 만든다.
   */
  function buildPatch(input: UpdateIssueInput, previous: Previous): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      updatedAt: Math.max(Date.now(), previous.updatedAt + 1)
    }
    if (input.title !== undefined) patch['title'] = input.title
    if (input.body !== undefined) patch['body'] = input.body
    if (input.status !== undefined) {
      patch['status'] = input.status
      // closedAt은 status에서 파생된다. 호출자가 따로 관리하면 둘이 어긋난다.
      patch['closedAt'] = input.status === 'done' ? Date.now() : null
    }

    // triagedAt도 파생이다 (설계 §3). **축을 건드리는 갱신에서만 다시 계산한다** —
    // 매번 계산하면 본문만 고쳐도 triagedAt이 새 시각으로 덮여, "언제 정리했나"가
    // 아무 뜻도 없는 값이 된다.
    const touchesAxes =
      input.source !== undefined || input.kind !== undefined || input.priority !== undefined
    if (touchesAxes) {
      const source = input.source ?? previous.source
      const kind = input.kind ?? previous.kind
      const priority = input.priority ?? previous.priority
      if (input.source !== undefined) patch['source'] = source
      if (input.kind !== undefined) patch['kind'] = kind
      if (input.priority !== undefined) patch['priority'] = priority
      patch['triagedAt'] = source && kind && priority ? Date.now() : null
    }
    return patch
  }
```

`IssueSource` 등을 파일 상단의 타입 import에 더한다.

- [ ] **Step 5: `update`와 `updateIfUnchanged`가 축까지 읽게 한다**

두 곳의 `select({...})`에 축 셋을 더한다. `:128-132`:

```ts
      const owner = db
        .select({
          workspaceId: issue.workspaceId,
          updatedAt: issue.updatedAt,
          source: issue.source,
          kind: issue.kind,
          priority: issue.priority
        })
        .from(issue)
        .where(eq(issue.id, input.id))
        .get()
      if (!owner) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${input.id}`)

      const patch = buildPatch(input, owner)
```

`:157-166`도 같은 모양으로 고치고 `buildPatch(input, row)`로 넘긴다.

- [ ] **Step 6: `create`가 축을 받고 파생하게 한다**

`:109-125`를 고친다.

```ts
    create(input: CreateIssueInput): Issue {
      const id = randomUUID()
      const now = Date.now()
      const { source = null, kind = null, priority = null } = input
      db.transaction((tx) => {
        assertReposInWorkspace(tx, input.workspaceId, input.repoIds ?? [])
        tx.insert(issue).values({
          id,
          workspaceId: input.workspaceId,
          title: input.title,
          body: input.body ?? '',
          source,
          kind,
          priority,
          // 만들 때도 파생 규칙은 같다. agent가 MCP로 축까지 주면 훑기를 건너뛴다.
          triagedAt: source && kind && priority ? now : null,
          createdAt: now,
          updatedAt: now
        }).run()
        replaceTags(tx, id, input.repoIds ?? [])
      })
      return getById(id)
    },
```

- [ ] **Step 7: `markSeen`을 더한다**

`remove` 바로 위에 넣는다.

```ts
    /**
     * 사람이 이슈를 열었다는 사실만 기록한다.
     *
     * **buildPatch를 타지 않는다.** updatedAt을 올리면 열려 있는 IssueDetail의
     * 낙관적 잠금 기대값이 즉시 낡아, 다음 자동 저장이 사용자 자신의 열람을 agent의
     * 편집으로 착각해 유령 충돌 배너를 띄운다.
     */
    markSeen(id: string): void {
      const result = db.update(issue)
        .set({ seenAt: Date.now() })
        .where(eq(issue.id, id))
        .run()
      if (result.changes === 0) throw new NotFoundError(`이슈를 찾을 수 없습니다: ${id}`)
    },
```

- [ ] **Step 8: 정렬을 뒤집는다**

`:102-103`을 고친다. `asc`를 `drizzle-orm` import에 더하고 `desc`가 다른 곳에서 안 쓰이면 뺀다.

```ts
      // 안 본 것이 위로 온다. seenAt이 null인 것(한 번도 안 연 것)이 가장 위다.
      // 예전의 updatedAt DESC는 정확히 반대로 돌았다 — 안 볼수록 아래로 밀었고,
      // agent가 MCP로 건드린 이슈를 사람이 본 것처럼 맨 위로 올렸다.
      const rows = db.select().from(issue).where(where)
        .orderBy(sql`(${issue.seenAt} is null) desc`, asc(issue.seenAt), asc(issue.createdAt))
        .all()
```

`sql`은 `drizzle-orm`에서 import한다.

- [ ] **Step 9: 테스트를 돌려 통과를 확인한다**

Run: `pnpm test core/db/repositories/issue.test.ts`
Expected: 전부 PASS.

- [ ] **Step 10: 회귀 테스트가 진짜인지 확인한다**

`markSeen`의 `.set({ seenAt: Date.now() })`를 `.set({ seenAt: Date.now(), updatedAt: Date.now() })`로 잠시 바꾸고 돌린다.

Run: `pnpm test core/db/repositories/issue.test.ts`
Expected: `'updatedAt을 건드리지 않는다'`가 FAIL.

확인했으면 되돌린다.

- [ ] **Step 11: 전체 테스트**

Run: `pnpm test && pnpm typecheck`

⚠️ **`Issue` 객체 리터럴을 만드는 기존 테스트 팩토리가 전부 타입 오류를 낸다.** 필드 다섯이 필수(nullable이지만 `| null`이라 생략 불가)이기 때문이다. 최소 `renderer/components/IssueDetail.test.tsx:9-14`의 `makeIssue`가 걸린다 — `grep -rn "closedAt: null" renderer/ core/ e2e/`로 전부 찾아 다섯 줄을 더한다.

```ts
    source: null, kind: null, priority: null, triagedAt: null, seenAt: null,
```

⚠️ `updatedAt DESC`를 기대하던 기존 테스트가 있으면 여기서 빨개진다. **그 테스트는 고치는 것이 맞다** — 정렬을 뒤집는 것이 이 작업의 목적이다. 다만 고칠 때 "무엇을 검증하던 테스트였는지"를 보고 새 정렬로 같은 성질을 검증하게 바꾼다. 그냥 지우지 않는다.

- [ ] **Step 12: 커밋**

```bash
git add core/db/repositories/issue.ts core/db/repositories/issue.test.ts shared/models.ts
git commit -m "feat(db): derive triagedAt from axes, add markSeen, sort by seenAt"
```

---

## Task 3: IPC와 클라이언트 배선

**Files:**
- Modify: `shared/channels.ts:10-14`, `shared/client.ts:31-41`
- Modify: `electron/ipc/issues.ts`, `electron/preload.ts:37-43`

**Interfaces:**
- Consumes: Task 2의 `issues.markSeen(id)`
- Produces: `client.issues.markSeen(id: string): Promise<void>` — 렌더러에서 부를 수 있다

- [ ] **Step 1: 채널을 더한다**

`shared/channels.ts`의 `issuesRemove` 아래.

```ts
  issuesRemove: 'issues:remove',
  issuesMarkSeen: 'issues:markSeen',
```

- [ ] **Step 2: 클라이언트 인터페이스를 더한다**

`shared/client.ts`의 `issues` 블록에서 `remove` 아래.

```ts
    remove(id: string): Promise<void>
    /**
     * 사람이 이 이슈를 열었다고 기록한다. **updatedAt을 올리지 않는다** —
     * 올리면 열려 있는 상세의 낙관적 잠금 기대값이 낡는다.
     *
     * 부르는 쪽은 이 호출 뒤에 목록을 다시 읽지 않는다. 정렬이 seenAt 오래된
     * 순이라, 읽으면 방금 클릭한 항목이 눈앞에서 맨 아래로 도망간다.
     */
    markSeen(id: string): Promise<void>
```

- [ ] **Step 3: IPC 핸들러를 더한다**

`electron/ipc/issues.ts`의 `issuesRemove` 아래. **얇게 — core 호출만 한다.**

```ts
  ipcMain.handle(CHANNELS.issuesMarkSeen, (_e, id: string) => core.issues.markSeen(id))
```

- [ ] **Step 4: preload 브리지를 더한다**

`electron/preload.ts`의 `issues` 블록.

```ts
    remove: (id) => call<void>(CHANNELS.issuesRemove, id),
    markSeen: (id) => call<void>(CHANNELS.issuesMarkSeen, id)
```

- [ ] **Step 5: 타입체크와 전체 테스트**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: 전부 깨끗. 새 테스트는 없다 — 이 태스크는 배선뿐이고, 실제 검증은 Task 8의 `IssueDetail` 테스트와 Task 9의 e2e가 한다.

- [ ] **Step 6: 커밋**

```bash
git add shared/channels.ts shared/client.ts electron/ipc/issues.ts electron/preload.ts
git commit -m "feat(ipc): wire issues.markSeen through IPC and preload"
```

---

## Task 4: MCP가 축을 받는다

**Files:**
- Modify: `core/mcp/tools.ts:75-87`(enum 정의), `:128-152`(두 도구)
- Test: `core/mcp/tools.test.ts`

**Interfaces:**
- Consumes: Task 2의 `CreateIssueInput`·`UpdateIssueInput`의 축 필드
- Produces: `create_issue`·`update_issue`가 `source`·`kind`·`priority`를 옵션으로 받는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`core/mcp/tools.test.ts`에 더한다. **이 파일에는 바깥 스코프의 `issues`도 `wsA`도 없다** — 전부 `beforeEach` 안의 지역 변수이고, 밖에서 볼 수 있는 것은 픽스처 객체 `f`뿐이다(`:15-26`). 도구를 부르는 헬퍼 이름도 `callTool`이 아니라 **`call`**이다(`:63`).

**먼저 픽스처에 `issues` 저장소를 노출한다.** `Fixture` 인터페이스(`:15`)에 한 줄:

```ts
  issues: ReturnType<typeof createIssueRepository>
```

그리고 `beforeEach`의 `f = { db, dir, wsA, wsB, repoA, ... }` 객체 리터럴에 `issues,`를 더한다. `issues`는 그 위(`:33`)에서 이미 만들어져 있다.

이제 테스트를 더한다.

```ts
describe('분류 축', () => {
  it('create_issue가 축을 받고 triagedAt이 파생된다', async () => {
    await call(f.wsA, 'edit', 'create_issue', {
      title: '회의에서 나온 것', source: 'meeting', kind: 'feature', priority: 'week'
    })
    // beforeEach가 이미 wsA에 이슈 하나('A의 이슈')를 만들어 둔다.
    // 인덱스로 집으면 그것을 집으므로 반드시 제목으로 찾는다.
    const created = f.issues.list({ workspaceId: f.wsA })
      .find((i) => i.title === '회의에서 나온 것')
    expect(created?.source).toBe('meeting')
    expect(created?.triagedAt).not.toBeNull()
  })

  it('축을 안 주면 정리 안 된 채로 들어간다', async () => {
    await call(f.wsA, 'edit', 'create_issue', { title: '축 없이' })
    const created = f.issues.list({ workspaceId: f.wsA }).find((i) => i.title === '축 없이')
    expect(created?.triagedAt).toBeNull()
  })

  it('update_issue로 나머지 축을 채우면 triagedAt이 찍힌다', async () => {
    const made = f.issues.create({ workspaceId: f.wsA, title: '나중에 분류', source: 'dev' })
    await call(f.wsA, 'edit', 'update_issue', {
      id: made.id, kind: 'refactor', priority: 'someday'
    })
    expect(f.issues.get(made.id).triagedAt).not.toBeNull()
  })
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `pnpm test core/mcp/tools.test.ts`
Expected: `expected undefined to be 'meeting'`으로 FAIL — zod가 모르는 키를 버리기 때문이다.

- [ ] **Step 3: zod enum을 더한다**

`core/mcp/tools.ts:87`의 `const ISSUE_STATUS = z.enum(issueStatusValues)` **바로 아래에** 붙인다. 기존 `AssertIssueStatusExhaustive` 트릭(`:82-85`)은 **enum 값이 `@shared/models`의 타입과 어긋나면 컴파일이 깨지게** 하는 장치다 — 원소가 타입 밖이면 제네릭 제약이, 타입 쪽이 더 많으면 조건부 타입이 `never`가 되어 잡는다. 새 축 셋도 같은 보호를 받아야 하므로 **그 형태를 그대로 복제한다.**

```ts
const ISSUE_SOURCE_VALUES = ['customer', 'plan', 'meeting', 'dev'] as const
const ISSUE_KIND_VALUES = ['bug', 'feature', 'refactor', 'docs', 'research'] as const
const ISSUE_PRIORITY_VALUES = ['urgent', 'week', 'someday'] as const

/** ISSUE_STATUS와 같은 장치다 — 축이 추가·개명되면 이 줄에서 타입 오류가 난다. */
type AssertSourceExhaustive<T extends readonly IssueSource[]> =
  IssueSource extends T[number] ? T : never
type AssertKindExhaustive<T extends readonly IssueKind[]> =
  IssueKind extends T[number] ? T : never
type AssertPriorityExhaustive<T extends readonly IssuePriority[]> =
  IssuePriority extends T[number] ? T : never

const issueSourceValues: AssertSourceExhaustive<typeof ISSUE_SOURCE_VALUES> = ISSUE_SOURCE_VALUES
const issueKindValues: AssertKindExhaustive<typeof ISSUE_KIND_VALUES> = ISSUE_KIND_VALUES
const issuePriorityValues: AssertPriorityExhaustive<typeof ISSUE_PRIORITY_VALUES> = ISSUE_PRIORITY_VALUES

const ISSUE_SOURCE = z.enum(issueSourceValues)
const ISSUE_KIND = z.enum(issueKindValues)
const ISSUE_PRIORITY = z.enum(issuePriorityValues)
```

`IssueSource`·`IssueKind`·`IssuePriority`를 `@shared/models`에서 `import type`으로 가져온다(`IssueStatus`가 이미 그렇게 들어와 있다).

- [ ] **Step 4: 두 도구에 축을 더한다**

`create_issue`(`:128`):

```ts
  server.registerTool('create_issue', {
    description: '이 workspace에 이슈를 만든다',
    inputSchema: {
      title: z.string().min(1),
      body: z.string().default(''),
      repoIds: z.array(z.string()).optional().describe('태그할 repo. 같은 workspace여야 한다'),
      source: ISSUE_SOURCE.optional().describe('어디서 온 이슈인가'),
      kind: ISSUE_KIND.optional().describe('무슨 성격의 일인가'),
      priority: ISSUE_PRIORITY.optional().describe('얼마나 급한가')
    }
  }, async ({ title, body, repoIds, source, kind, priority }) => reply(() => deps.issues.create({
    workspaceId: ctx.workspaceId, title, body,
    ...(repoIds ? { repoIds } : {}),
    // 셋을 다 주면 triagedAt이 파생돼 사람의 훑기를 건너뛴다 (설계 §6).
    ...(source ? { source } : {}),
    ...(kind ? { kind } : {}),
    ...(priority ? { priority } : {})
  })))
```

`update_issue`(`:139`):

```ts
  server.registerTool('update_issue', {
    description: '이슈의 상태·본문·분류를 고친다',
    inputSchema: {
      id: z.string(),
      status: ISSUE_STATUS.optional(),
      body: z.string().optional(),
      source: ISSUE_SOURCE.optional(),
      kind: ISSUE_KIND.optional(),
      priority: ISSUE_PRIORITY.optional()
    }
  }, async ({ id, status, body, source, kind, priority }) => reply(() => {
    // 소속 확인이 먼저다. 저장소의 update는 id만 보므로 여기서 막지 않으면
    // 다른 workspace의 이슈가 고쳐진다.
    loadIssue(deps, ctx, id)
    return deps.issues.update({
      id,
      ...(status ? { status } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(source ? { source } : {}),
      ...(kind ? { kind } : {}),
      ...(priority ? { priority } : {})
    })
  }))
```

⚠️ **축을 지우는 길은 만들지 않는다** (설계 §6). `.optional()`은 "안 줬다"와 "null로 지워라"를 구분하지 못한다. 지우는 것은 사람이 상세에서 한다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `pnpm test core/mcp/tools.test.ts`
Expected: 전부 PASS.

- [ ] **Step 6: 전체 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 7: 커밋**

```bash
git add core/mcp/tools.ts core/mcp/tools.test.ts
git commit -m "feat(mcp): accept triage axes in create_issue and update_issue"
```

---

## Task 5: 순수 함수 — 라벨과 그룹핑

**Files:**
- Create: `renderer/issueAxes.ts`, `renderer/issueAxes.test.ts`
- Create: `renderer/issueGroups.ts`, `renderer/issueGroups.test.ts`

**Interfaces:**
- Consumes: `Issue`·`IssueSource`·`IssueKind`·`IssuePriority`·`Repo` (`@shared/models`)
- Produces:
  - `SOURCE_LABELS: Record<IssueSource, string>` · `KIND_LABELS` · `PRIORITY_LABELS`
  - `SOURCE_ORDER: readonly IssueSource[]` · `KIND_ORDER` · `PRIORITY_ORDER`
  - `AXIS_LABELS: Record<GroupAxis, string>`
  - `STALE_MS: number`
  - `type GroupAxis = 'priority' | 'source' | 'kind' | 'repo'`
  - `interface IssueGroup { key: string; label: string; issues: Issue[] }`
  - `groupIssues(issues: Issue[], axis: GroupAxis, repos: Repo[]): IssueGroup[]`
  - `isStale(issue: Issue, now: number): boolean`
  - `untriagedCount(issues: Issue[]): number`

- [ ] **Step 1: `issueAxes.ts`를 쓴다**

라벨과 순서만 담는다. 로직은 없다.

```ts
import type { IssueSource, IssueKind, IssuePriority } from '@shared/models'

/** 묶는 축. 목록의 드롭다운이 고른다. */
export type GroupAxis = 'priority' | 'source' | 'kind' | 'repo'

export const AXIS_LABELS: Record<GroupAxis, string> = {
  priority: '급함',
  source: '출처',
  kind: '성격',
  repo: 'repo'
}

/** 각 축의 그룹 순서. **나열 순서가 곧 화면 순서다.** */
export const PRIORITY_ORDER = ['urgent', 'week', 'someday'] as const satisfies readonly IssuePriority[]
export const SOURCE_ORDER = ['customer', 'plan', 'meeting', 'dev'] as const satisfies readonly IssueSource[]
export const KIND_ORDER = ['bug', 'feature', 'refactor', 'docs', 'research'] as const satisfies readonly IssueKind[]

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: '긴급',
  week: '이번주',
  someday: '언젠가'
}

export const SOURCE_LABELS: Record<IssueSource, string> = {
  customer: '고객',
  plan: '기획',
  meeting: '회의',
  dev: '개발중'
}

export const KIND_LABELS: Record<IssueKind, string> = {
  bug: '버그',
  feature: '기능',
  refactor: '리팩',
  docs: '문서',
  research: '조사'
}

/**
 * 축 값이 비어 있는 그룹의 이름.
 *
 * **"정리 안 됨"과 다른 말이다** (설계 §3). "정리 안 됨"은 훑기 대기열
 * (`triagedAt === null`)이고, "미지정"은 지금 묶은 축의 값이 없다는 뜻이다.
 * 마이그레이션으로 백필된 이슈는 정리는 됐지만 축이 비어 있어 두 값이 갈린다.
 */
export const UNSET_LABEL = '미지정'
export const DONE_LABEL = '완료'

/** 이만큼 안 보면 방치로 친다. */
export const STALE_MS = 14 * 24 * 60 * 60 * 1000
```

- [ ] **Step 2: `issueAxes.test.ts`를 쓴다**

라벨 표에 구멍이 없는지만 본다. `Record<T, string>`이 컴파일 타임에 강제하지만, 순서 배열은 강제하지 않는다.

```ts
import { describe, it, expect } from 'vitest'
import {
  PRIORITY_ORDER, SOURCE_ORDER, KIND_ORDER,
  PRIORITY_LABELS, SOURCE_LABELS, KIND_LABELS
} from './issueAxes'

describe('축 라벨', () => {
  it('순서 배열이 라벨 표의 키를 빠짐없이 담는다', () => {
    expect([...PRIORITY_ORDER].sort()).toEqual(Object.keys(PRIORITY_LABELS).sort())
    expect([...SOURCE_ORDER].sort()).toEqual(Object.keys(SOURCE_LABELS).sort())
    expect([...KIND_ORDER].sort()).toEqual(Object.keys(KIND_LABELS).sort())
  })

  it('급함은 급한 순서다', () => {
    expect(PRIORITY_ORDER).toEqual(['urgent', 'week', 'someday'])
  })
})
```

- [ ] **Step 3: 돌려서 통과를 확인한다**

Run: `pnpm test renderer/issueAxes.test.ts`
Expected: PASS. (상수만 있는 파일이라 실패 단계가 없다 — 이 테스트는 나중에 축을 늘릴 때 한쪽만 고치는 것을 잡는 장치다.)

- [ ] **Step 4: `issueGroups.test.ts`를 먼저 쓴다 (실패해야 한다)**

```ts
import { describe, it, expect } from 'vitest'
import { groupIssues, isStale, untriagedCount } from './issueGroups'
import { STALE_MS } from './issueAxes'
import type { Issue, Repo } from '@shared/models'

const NOW = 1_800_000_000_000

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'ws', title: '제목', body: '', status: 'open',
    repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: null, seenAt: null,
    ...over
  }
}

describe('groupIssues', () => {
  it('미지정이 첫 그룹이다', () => {
    const groups = groupIssues([
      makeIssue({ id: 'a', priority: 'urgent' }),
      makeIssue({ id: 'b', priority: null })
    ], 'priority', [])
    expect(groups[0]?.key).toBe('unset')
    expect(groups[0]?.label).toBe('미지정')
  })

  it('축 순서대로 묶는다', () => {
    const groups = groupIssues([
      makeIssue({ id: 'a', priority: 'someday' }),
      makeIssue({ id: 'b', priority: 'urgent' }),
      makeIssue({ id: 'c', priority: 'week' })
    ], 'priority', [])
    expect(groups.map((g) => g.key)).toEqual(['urgent', 'week', 'someday'])
  })

  it('빈 그룹은 만들지 않는다', () => {
    const groups = groupIssues([makeIssue({ priority: 'urgent' })], 'priority', [])
    expect(groups).toHaveLength(1)
  })

  it('저장소가 준 순서를 그룹 안에서 보존한다', () => {
    // 정렬은 저장소가 한다 (설계 §5). 여기서 다시 정렬하면 규칙이 두 벌이 된다.
    const groups = groupIssues([
      makeIssue({ id: 'first', priority: 'urgent' }),
      makeIssue({ id: 'second', priority: 'urgent' })
    ], 'priority', [])
    expect(groups[0]?.issues.map((i) => i.id)).toEqual(['first', 'second'])
  })

  it('done은 축 그룹에서 빠지고 맨 아래 완료 그룹으로 간다', () => {
    const groups = groupIssues([
      makeIssue({ id: 'a', priority: 'urgent' }),
      makeIssue({ id: 'z', priority: 'urgent', status: 'done' })
    ], 'priority', [])
    expect(groups[0]?.issues.map((i) => i.id)).toEqual(['a'])
    const last = groups[groups.length - 1]
    expect(last?.key).toBe('done')
    expect(last?.label).toBe('완료')
    expect(last?.issues.map((i) => i.id)).toEqual(['z'])
  })

  it('done이 없으면 완료 그룹도 없다', () => {
    const groups = groupIssues([makeIssue({ priority: 'urgent' })], 'priority', [])
    expect(groups.some((g) => g.key === 'done')).toBe(false)
  })

  it('repo 축은 repo 이름으로 묶고, 태그가 여럿이면 여러 그룹에 나타난다', () => {
    const repos: Repo[] = [
      { id: 'r1', workspaceId: 'ws', name: 'api', path: '/a', description: null, sortOrder: 0, createdAt: 0 },
      { id: 'r2', workspaceId: 'ws', name: 'web', path: '/b', description: null, sortOrder: 1, createdAt: 0 }
    ]
    const groups = groupIssues([
      makeIssue({ id: 'both', repoIds: ['r1', 'r2'] }),
      makeIssue({ id: 'none', repoIds: [] })
    ], 'repo', repos)
    expect(groups.map((g) => g.key)).toEqual(['unset', 'r1', 'r2'])
    expect(groups[1]?.label).toBe('api')
    expect(groups[1]?.issues.map((i) => i.id)).toEqual(['both'])
    expect(groups[2]?.issues.map((i) => i.id)).toEqual(['both'])
    expect(groups[0]?.issues.map((i) => i.id)).toEqual(['none'])
  })
})

describe('isStale', () => {
  it('seenAt이 임계값보다 오래되면 방치다', () => {
    expect(isStale(makeIssue({ seenAt: NOW - STALE_MS - 1 }), NOW)).toBe(true)
    expect(isStale(makeIssue({ seenAt: NOW - 1000 }), NOW)).toBe(false)
  })

  it('한 번도 안 본 이슈는 createdAt으로 판정한다', () => {
    // 폴백이 없으면 가장 잊히기 쉬운 것이 영원히 배지를 못 받는다.
    expect(isStale(makeIssue({ seenAt: null, createdAt: NOW - STALE_MS - 1 }), NOW)).toBe(true)
    expect(isStale(makeIssue({ seenAt: null, createdAt: NOW }), NOW)).toBe(false)
  })

  it('done에는 붙지 않는다', () => {
    expect(isStale(makeIssue({ status: 'done', seenAt: NOW - STALE_MS - 1 }), NOW)).toBe(false)
  })
})

describe('untriagedCount', () => {
  it('triagedAt이 없는 것만 센다', () => {
    expect(untriagedCount([
      makeIssue({ id: 'a', triagedAt: null }),
      makeIssue({ id: 'b', triagedAt: NOW })
    ])).toBe(1)
  })

  it('done은 세지 않는다', () => {
    // 정리되지 않은 채 끝난 이슈를 이제 와서 분류하라고 요구하지 않는다.
    expect(untriagedCount([makeIssue({ triagedAt: null, status: 'done' })])).toBe(0)
  })
})
```

- [ ] **Step 5: 돌려서 실패를 확인한다**

Run: `pnpm test renderer/issueGroups.test.ts`
Expected: `Failed to resolve import "./issueGroups"`로 FAIL.

- [ ] **Step 6: `issueGroups.ts`를 쓴다**

```ts
import type { Issue, Repo } from '@shared/models'
import {
  PRIORITY_ORDER, SOURCE_ORDER, KIND_ORDER,
  PRIORITY_LABELS, SOURCE_LABELS, KIND_LABELS,
  UNSET_LABEL, DONE_LABEL, STALE_MS,
  type GroupAxis
} from './issueAxes'

export interface IssueGroup {
  /** 접기 상태의 키. 'unset' · 축 값 · repo id · 'done' */
  key: string
  label: string
  issues: Issue[]
}

/** 축 값이 비어 있는 그룹의 키. repo id와 겹치지 않게 예약어로 쓴다. */
const UNSET_KEY = 'unset'

/** 오래 안 본 이슈인가. done에는 붙이지 않는다. */
export function isStale(issue: Issue, now: number): boolean {
  if (issue.status === 'done') return false
  // seenAt이 null이면 createdAt으로 떨어진다. 폴백이 없으면 한 번도 안 연 이슈가
  // 영원히 방치로 잡히지 않는다 — 가장 잊히기 쉬운 것이 배지를 못 받는다.
  return now - (issue.seenAt ?? issue.createdAt) > STALE_MS
}

/** 훑기 대기열의 크기. 배너가 이 값을 쓴다. */
export function untriagedCount(issues: Issue[]): number {
  return issues.filter((i) => i.triagedAt === null && i.status !== 'done').length
}

/**
 * 이슈를 그룹으로 나눈다.
 *
 * **정렬은 하지 않는다** (설계 §5). 저장소가 `seenAt` 오래된 순으로 이미 정렬해서
 * 주고, 이 함수는 그 순서를 보존하는 **안정 분할**만 한다. 양쪽에서 정렬하면
 * 규칙이 두 벌이 되고 어긋났을 때 어느 쪽이 옳은지 판정할 곳이 없어진다.
 *
 * **빈 그룹은 만들지 않는다.** 개수 0인 헤더는 화면의 잡음일 뿐이다.
 */
export function groupIssues(issues: Issue[], axis: GroupAxis, repos: Repo[]): IssueGroup[] {
  const live = issues.filter((i) => i.status !== 'done')
  const done = issues.filter((i) => i.status === 'done')

  const groups: IssueGroup[] = []

  function push(key: string, label: string, members: Issue[]) {
    if (members.length > 0) groups.push({ key, label, issues: members })
  }

  if (axis === 'repo') {
    // repo는 다대다다. 태그가 여럿이면 **이슈가 여러 그룹에 나타난다** —
    // 그래서 그룹 개수의 합이 전체보다 클 수 있다. "첫 repo만" 같은 규칙으로
    // 중복을 없앨 수는 있지만, 그건 화면에서 설명할 수 없다.
    push(UNSET_KEY, UNSET_LABEL, live.filter((i) => i.repoIds.length === 0))
    const ordered = [...repos].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const repo of ordered) {
      push(repo.id, repo.name, live.filter((i) => i.repoIds.includes(repo.id)))
    }
  } else {
    const order = axis === 'priority' ? PRIORITY_ORDER
      : axis === 'source' ? SOURCE_ORDER
      : KIND_ORDER
    const labels: Record<string, string> = axis === 'priority' ? PRIORITY_LABELS
      : axis === 'source' ? SOURCE_LABELS
      : KIND_LABELS

    // 미지정이 맨 위다. 아래에 두면 그것이 정확히 이 기능이 없애려는 "묻힘"이 된다.
    push(UNSET_KEY, UNSET_LABEL, live.filter((i) => i[axis] === null))
    for (const value of order) {
      push(value, labels[value] ?? value, live.filter((i) => i[axis] === value))
    }
  }

  push('done', DONE_LABEL, done)
  return groups
}
```

- [ ] **Step 7: 돌려서 통과를 확인한다**

Run: `pnpm test renderer/issueGroups.test.ts`
Expected: 전부 PASS.

- [ ] **Step 8: 회귀 테스트가 진짜인지 확인한다**

`isStale`의 `?? issue.createdAt`을 `?? now`로 잠시 바꾸고 돌린다.
Expected: `'한 번도 안 본 이슈는 createdAt으로 판정한다'`가 FAIL.

되돌린 뒤, `groupIssues`의 미지정 `push`를 반복문 아래로 잠시 옮기고 돌린다.
Expected: `'미지정이 첫 그룹이다'`가 FAIL.

둘 다 확인했으면 되돌린다.

- [ ] **Step 9: 전체 테스트와 린트**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 10: 커밋**

```bash
git add renderer/issueAxes.ts renderer/issueAxes.test.ts renderer/issueGroups.ts renderer/issueGroups.test.ts
git commit -m "feat(renderer): add issue axis labels and pure grouping helpers"
```

---

## Task 6: 목록 — 배너, 축 드롭다운, 그룹, 접기

**Files:**
- Modify: `renderer/components/IssuePanel.tsx`
- Create: `renderer/components/IssuePanel.test.tsx`
- Modify: `renderer/index.css`

**Interfaces:**
- Consumes: Task 5의 `groupIssues`·`isStale`·`untriagedCount`·`AXIS_LABELS`·라벨 표
- Produces: 그룹으로 그려지는 이슈 목록. Task 7이 여기에 훑기를 얹는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`renderer/components/IssuePanel.test.tsx`를 새로 만든다. `IssueDetail.test.tsx:16-40`의 목 패턴을 그대로 따른다 — 진짜 `ClientProvider`에 `as unknown as OneDeskClient`로 캐스팅한 부분 목을 주입한다.

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { IssuePanel } from './IssuePanel'
import type { Issue, Repo } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

const NOW = Date.now()

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'ws', title: '제목', body: '', status: 'open',
    repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: NOW, seenAt: NOW,
    ...over
  }
}

interface PanelMocks {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  markSeen: ReturnType<typeof vi.fn>
}

function renderPanel(issues: Issue[], over: {
  openId?: string | null
  expanded?: boolean
  onOpen?: (id: string) => void
  repos?: Repo[]
} = {}): PanelMocks {
  const mocks: PanelMocks = {
    list: vi.fn(async () => issues),
    create: vi.fn(),
    update: vi.fn(async (i: { id: string }) => makeIssue({ id: i.id })),
    markSeen: vi.fn(async () => {})
  }
  const client = {
    issues: {
      ...mocks,
      updateIfUnchanged: vi.fn(),
      remove: vi.fn()
    },
    // useIssues가 run 완료를 구독한다. 해제 함수를 돌려주지 않으면 언마운트가 터진다.
    events: { onRunUpdate: () => () => {} }
  } as unknown as OneDeskClient

  render(
    <ClientProvider client={client}>
      <IssuePanel
        workspaceId="ws"
        repoId={null}
        repos={over.repos ?? []}
        chipKeys={new Set()}
        onToggleContext={() => {}}
        expanded={over.expanded ?? false}
        openId={over.openId ?? null}
        onOpen={over.onOpen ?? (() => {})}
      />
    </ClientProvider>
  )
  return mocks
}

describe('IssuePanel 그룹', () => {
  it('그룹 헤더에 개수를 보여준다', async () => {
    renderPanel([
      makeIssue({ id: 'a', title: 'A', priority: 'urgent' }),
      makeIssue({ id: 'b', title: 'B', priority: 'urgent' })
    ])
    expect(await screen.findByRole('button', { name: /긴급 \(2\)/ })).toBeInTheDocument()
  })

  it('접어도 개수는 계속 보인다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'someday' })])
    const header = await screen.findByRole('button', { name: /언젠가 \(1\)/ })
    await userEvent.click(header)
    expect(screen.queryByRole('button', { name: 'A', exact: true })).not.toBeInTheDocument()
    // 접힌 뒤에도 개수는 남아야 한다. 이것이 A안을 고른 이유 자체다.
    expect(screen.getByRole('button', { name: /언젠가 \(1\)/ })).toBeInTheDocument()
  })

  it('완료 그룹은 처음부터 접혀 있다', async () => {
    renderPanel([makeIssue({ id: 'z', title: 'Z', status: 'done' })])
    expect(await screen.findByRole('button', { name: /완료 \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Z', exact: true })).not.toBeInTheDocument()
  })

  it('축을 바꾸면 다시 묶는다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'urgent', source: 'customer' })])
    await screen.findByRole('button', { name: /긴급 \(1\)/ })
    await userEvent.selectOptions(screen.getByLabelText('묶기'), 'source')
    expect(await screen.findByRole('button', { name: /고객 \(1\)/ })).toBeInTheDocument()
  })

  it('정리 안 된 이슈가 있으면 배너가 뜬다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: null })])
    expect(await screen.findByText(/정리 안 됨 \(1\)/)).toBeInTheDocument()
  })

  it('정리 안 된 이슈가 없으면 배너가 없다', async () => {
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: NOW })])
    await screen.findByRole('button', { name: 'A', exact: true })
    expect(screen.queryByText(/정리 안 됨/)).not.toBeInTheDocument()
  })

  it('오래 안 본 이슈에 방치 배지가 붙는다', async () => {
    const old = NOW - 20 * 24 * 60 * 60 * 1000
    renderPanel([makeIssue({ id: 'a', title: 'A', priority: 'urgent', seenAt: old })])
    expect(await screen.findByLabelText('오래 방치됨')).toBeInTheDocument()
  })
})
```

⚠️ `repos` prop은 Task 6에서 새로 추가하는 것이다(아래 Step 3). `useIssues`가 `client.events.onRunUpdate`를 구독하므로 목에 반드시 넣는다 — 없으면 렌더 자체가 터진다.

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test renderer/components/IssuePanel.test.tsx`
Expected: 그룹 헤더를 못 찾아 FAIL.

- [ ] **Step 3: `IssuePanel`에 `repos` prop을 더한다**

repo 축으로 묶으려면 repo 이름이 필요하다. `App.tsx`는 이미 `useRepos`를 공통 부모에서 부르고 있으므로(`App.tsx:38-42` 주석) 그 값을 내려보낸다.

`renderer/App.tsx`의 `<IssuePanel ... />`에 한 줄 더한다.

```tsx
              <IssuePanel
                workspaceId={workspaceId}
                repoId={repoId}
                repos={repos}
                chipKeys={chipKeys}
                onToggleContext={toggleContext}
                expanded={openItem?.panel === 'issue'}
                openId={openItem?.panel === 'issue' ? openItem.id : null}
                onOpen={openIssue}
              />
```

⚠️ **이 한 줄은 그 자체로 되돌릴 수 있는 변이다.** CLAUDE.md가 두 단계 연속으로 경고한 자리가 정확히 이것이다. Step 1의 `'축을 바꾸면 다시 묶는다'` 테스트는 `repos={[]}`로도 통과하므로 이 prop을 지켜주지 못한다 — **Task 9의 e2e가 repo 축을 실제로 눌러 이름을 확인하는 이유다.**

⚠️ `repos`라는 이름의 변수가 `App.tsx`에 실제로 있는지 확인한다. 없으면 `useRepos`가 돌려주는 이름을 따른다.

- [ ] **Step 4: `IssuePanel`을 고친다**

`renderer/components/IssuePanel.tsx`의 `list` 변수를 그룹 렌더로 바꾼다. 나머지(확장 분할, `IssueDetail` 마운트, `key`)는 **건드리지 않는다.**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { IssueDetail } from './IssueDetail'
import { useIssues } from '../hooks/useIssues'
import { useClient } from '../client/ClientProvider'
import { chipKey, type ContextChip } from '../context'
import { groupIssues, isStale, untriagedCount } from '../issueGroups'
import { AXIS_LABELS, SOURCE_LABELS, KIND_LABELS, type GroupAxis } from '../issueAxes'
import type { Issue, Repo } from '@shared/models'

const AXES: GroupAxis[] = ['priority', 'source', 'kind', 'repo']

/** 이슈 한 줄에 붙는 축 칩. 표시 전용이다 — 목록에서는 못 고친다 (설계 §5). */
function AxisChips({ issue }: { issue: Issue }) {
  return (
    <>
      {issue.kind && <span className="chip">{KIND_LABELS[issue.kind]}</span>}
      {issue.source && <span className="chip">{SOURCE_LABELS[issue.source]}</span>}
    </>
  )
}

export function IssuePanel({
  workspaceId, repoId, repos, chipKeys, onToggleContext, expanded, openId, onOpen
}: {
  workspaceId: string
  repoId: string | null
  repos: Repo[]
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
  expanded: boolean
  openId: string | null
  onOpen: (id: string) => void
}) {
  const client = useClient()
  const { issues, error: listError, refresh } = useIssues(workspaceId, repoId)
  const [axis, setAxis] = useState<GroupAxis>('priority')
  // 접힌 그룹의 키. **완료만 기본으로 접는다** — 나머지를 접으면 앱이 스스로 묻는 셈이
  // 되어 이 기능의 목적과 반대로 간다. 접는 것은 사용자가 한다.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['done']))

  const open = openId ? issues.find((i) => i.id === openId) ?? null : null

  // 열린 항목이 목록에서 사라졌으면(지워졌거나 필터가 바뀌었으면) 접는다.
  useEffect(() => {
    if (openId && !open) onOpen(openId)
  }, [openId, open, onOpen])

  const now = Date.now()
  const groups = useMemo(() => groupIssues(issues, axis, repos), [issues, axis, repos])
  const untriaged = untriagedCount(issues)

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function addIssue(title: string) {
    // **던질 땐 제목만이다.** 축을 요구하는 순간 회의 중에 못 던진다.
    await client.issues.create({
      workspaceId,
      title,
      repoIds: repoId ? [repoId] : []
    })
    await refresh()
  }

  const list = (
    <>
      <AddForm placeholder="새 이슈 제목…" onSubmit={addIssue} />

      {untriaged > 0 && (
        // 0건일 때는 그리지 않는다 — 상주하는 잔소리가 된다 (설계 §4).
        <div className="triage-banner">
          <span>⚠ 정리 안 됨 ({untriaged})</span>
        </div>
      )}

      <label className="group-axis">
        묶기
        <select
          aria-label="묶기"
          value={axis}
          onChange={(e) => setAxis(e.target.value as GroupAxis)}
        >
          {AXES.map((a) => <option key={a} value={a}>{AXIS_LABELS[a]}</option>)}
        </select>
      </label>

      {!listError && issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="issue-group">
            <button
              type="button"
              className="group-header"
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(group.key)}
            >
              {/* 개수는 접혀도 남는다. 안 보여도 있다는 것은 알아야 한다. */}
              {isCollapsed ? '▸' : '▾'} {group.label} ({group.issues.length})
            </button>
            {!isCollapsed && (
              <ul className="item-list">
                {group.issues.map((i) => {
                  const picked = chipKeys.has(chipKey({ type: 'issue', id: i.id }))
                  return (
                    <li key={i.id} className="item">
                      <button
                        type="button"
                        className={picked ? 'item-pick item-picked' : 'item-pick'}
                        aria-label={`${i.title} 맥락에 담기`}
                        aria-pressed={picked}
                        onClick={() => onToggleContext({ type: 'issue', id: i.id, label: i.title })}
                      >
                        {picked ? '✓' : ''}
                      </button>
                      <button
                        type="button"
                        className={openId === i.id ? 'item-title item-open' : 'item-title'}
                        onClick={() => onOpen(i.id)}
                      >
                        {i.title}
                      </button>
                      <AxisChips issue={i} />
                      {isStale(i, now) && (
                        <span className="chip chip-stale" aria-label="오래 방치됨">⚠</span>
                      )}
                      {/* 목록의 상태와 축은 읽기 전용이다. 편집은 상세가 맡는다.
                          여기서 잠기지 않은 update로 쓰면 그 쓰기가 updatedAt을 올려
                          열려 있는 상세의 기대값만 낡게 만들고, 다음 자동 저장이
                          사용자 자신의 클릭을 agent의 편집으로 착각한다. */}
                      <span className={`status status-${i.status}`}>{i.status}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </>
  )
  // 아래의 return 문은 그대로 둔다.
```

- [ ] **Step 5: CSS를 더한다**

`renderer/index.css` 맨 아래.

```css
/* 훑기 배너 — 정리 안 된 이슈가 있을 때만 뜬다 */
.triage-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin: 6px 0;
  border: 1px solid rgba(224, 108, 0, 0.5);
  background: rgba(224, 108, 0, 0.12);
  border-radius: 6px;
  font-size: 12px;
}

.group-axis {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.8;
  margin: 6px 0;
}

.group-header {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  margin-top: 4px;
  border: none;
  background: rgba(128, 128, 128, 0.12);
  border-radius: 5px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}

.chip {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 99px;
  border: 1px solid rgba(128, 128, 128, 0.4);
  opacity: 0.8;
  white-space: nowrap;
}

.chip-stale {
  border-color: rgba(224, 108, 0, 0.6);
  background: rgba(224, 108, 0, 0.15);
  opacity: 1;
}
```

- [ ] **Step 6: 돌려서 통과를 확인한다**

Run: `pnpm test renderer/components/IssuePanel.test.tsx`
Expected: 전부 PASS.

- [ ] **Step 7: 회귀 테스트가 진짜인지 확인한다**

그룹 헤더의 `({group.issues.length})`를 잠시 지우고 돌린다.
Expected: `'접어도 개수는 계속 보인다'`가 FAIL.

되돌린 뒤, `collapsed` 초기값을 `new Set()`으로 잠시 바꾸고 돌린다.
Expected: `'완료 그룹은 처음부터 접혀 있다'`가 FAIL.

둘 다 확인했으면 되돌린다.

- [ ] **Step 8: 전체 테스트와 린트**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 9: 커밋**

```bash
git add renderer/components/IssuePanel.tsx renderer/components/IssuePanel.test.tsx renderer/App.tsx renderer/index.css
git commit -m "feat(renderer): group issues by axis with collapsible headers and stale badges"
```

---

## Task 7: 훑기 카드와 흐름

**Files:**
- Create: `renderer/components/TriageCard.tsx`, `renderer/components/TriageCard.test.tsx`
- Modify: `renderer/components/IssuePanel.tsx`, `renderer/components/IssuePanel.test.tsx`
- Modify: `renderer/index.css`

**Interfaces:**
- Consumes: Task 5의 라벨 표, Task 6의 `IssuePanel` 구조
- Produces: `TriageCard` — `{ issue, position, total, onDone, onSkip }`

- [ ] **Step 1: `TriageCard.test.tsx`를 쓴다 (실패해야 한다)**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TriageCard } from './TriageCard'
import type { Issue } from '@shared/models'

const NOW = Date.now()

function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'i1', workspaceId: 'ws', title: '회원 탈퇴 플로우 문의', body: '', status: 'open',
    repoIds: [], createdAt: NOW, updatedAt: NOW, closedAt: null,
    source: null, kind: null, priority: null, triagedAt: null, seenAt: null,
    ...over
  }
}

describe('TriageCard', () => {
  it('이슈 제목과 위치를 보여준다', () => {
    render(
      <TriageCard issue={makeIssue()} position={1} total={6}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    expect(screen.getByText('회원 탈퇴 플로우 문의')).toBeInTheDocument()
    expect(screen.getByText(/6건 중 1번째/)).toBeInTheDocument()
  })

  it('축이 덜 찍히면 다음 버튼이 막혀 있다', async () => {
    render(
      <TriageCard issue={makeIssue()} position={1} total={1}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    const next = screen.getByRole('button', { name: '다음', exact: true })
    expect(next).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '회의', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '기능', exact: true }))
    // 두 축만 찍었다. 아직 막혀 있어야 한다 — 부분 저장은 triagedAt을 찍지 못해
    // 그 이슈가 대기열에 남고, 사용자는 왜 다시 나오는지 알 수 없다.
    expect(next).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '이번주', exact: true }))
    expect(next).toBeEnabled()
  })

  it('다음을 누르면 고른 축을 넘긴다', async () => {
    const onDone = vi.fn()
    render(
      <TriageCard issue={makeIssue()} position={1} total={1}
        onDone={onDone} onSkip={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '고객', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '버그', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '긴급', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '다음', exact: true }))

    expect(onDone).toHaveBeenCalledWith({ source: 'customer', kind: 'bug', priority: 'urgent' })
  })

  it('건너뛰기는 아무것도 저장하지 않는다', async () => {
    const onDone = vi.fn()
    const onSkip = vi.fn()
    render(
      <TriageCard issue={makeIssue()} position={1} total={2}
        onDone={onDone} onSkip={onSkip} />
    )
    await userEvent.click(screen.getByRole('button', { name: '고객', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기', exact: true }))

    expect(onSkip).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('이미 찍힌 축을 미리 골라둔다', () => {
    render(
      <TriageCard issue={makeIssue({ source: 'dev' })} position={1} total={1}
        onDone={vi.fn()} onSkip={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: '개발중', exact: true }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test renderer/components/TriageCard.test.tsx`
Expected: `Failed to resolve import "./TriageCard"`로 FAIL.

- [ ] **Step 3: `TriageCard.tsx`를 쓴다**

```tsx
import { useState } from 'react'
import {
  SOURCE_ORDER, KIND_ORDER, PRIORITY_ORDER,
  SOURCE_LABELS, KIND_LABELS, PRIORITY_LABELS
} from '../issueAxes'
import type { Issue, IssueSource, IssueKind, IssuePriority } from '@shared/models'

export interface TriagePick {
  source: IssueSource
  kind: IssueKind
  priority: IssuePriority
}

/**
 * 훑기 카드 한 장. 이슈 상세를 여는 바로 그 자리에 뜬다 (설계 §4).
 *
 * **seenAt을 찍지 않는다.** 분류와 열람은 다른 행위다 — 훑어서 `언젠가`로 분류한
 * 이슈는 분류는 됐지만 손대지는 않은 상태이고, 방치 시계는 계속 가야 한다.
 * 축을 찍었다는 이유로 시계가 리셋되면 훑기가 방치를 감추는 도구가 된다.
 */
export function TriageCard({ issue, position, total, onDone, onSkip }: {
  issue: Issue
  /** 1부터 센다 */
  position: number
  total: number
  onDone: (pick: TriagePick) => void
  onSkip: () => void
}) {
  const [source, setSource] = useState<IssueSource | null>(issue.source)
  const [kind, setKind] = useState<IssueKind | null>(issue.kind)
  const [priority, setPriority] = useState<IssuePriority | null>(issue.priority)

  // 셋이 다 찍혀야 넘어간다. 부분만 찍고 넘어가면 triagedAt이 안 찍혀
  // 그 이슈가 대기열에 그대로 남는다 (설계 §3의 파생 규칙과 짝을 이룬다).
  const complete = source !== null && kind !== null && priority !== null

  return (
    <div className="triage-card">
      <div className="triage-position">{total}건 중 {position}번째</div>
      <h3 className="triage-title">{issue.title}</h3>

      <AxisRow label="출처" values={SOURCE_ORDER} labels={SOURCE_LABELS}
        picked={source} onPick={setSource} />
      <AxisRow label="성격" values={KIND_ORDER} labels={KIND_LABELS}
        picked={kind} onPick={setKind} />
      <AxisRow label="급함" values={PRIORITY_ORDER} labels={PRIORITY_LABELS}
        picked={priority} onPick={setPriority} />

      <div className="triage-actions">
        <button type="button" onClick={onSkip}>건너뛰기</button>
        <button
          type="button"
          disabled={!complete}
          onClick={() => { if (complete) onDone({ source, kind, priority }) }}
        >
          다음
        </button>
      </div>
    </div>
  )
}

function AxisRow<T extends string>({ label, values, labels, picked, onPick }: {
  label: string
  values: readonly T[]
  labels: Record<T, string>
  picked: T | null
  onPick: (value: T) => void
}) {
  return (
    <div className="triage-row">
      <span className="triage-row-label">{label}</span>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={picked === value ? 'triage-pick triage-picked' : 'triage-pick'}
          aria-pressed={picked === value}
          onClick={() => onPick(value)}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 돌려서 통과를 확인한다**

Run: `pnpm test renderer/components/TriageCard.test.tsx`
Expected: 전부 PASS.

- [ ] **Step 5: `IssuePanel`에 훑기 흐름을 얹는다**

Task 6의 `IssuePanel`에 더한다.

상태와 도우미:

```tsx
  // 훑기 상태는 IssuePanel이 갖는다 — App.tsx에 올리지 않는다.
  // 다른 컴포넌트가 이 상태를 쓰지 않으므로 App의 openItem 계약이 그대로 남고,
  // 부수적으로 "App이 내려보내는 prop 한 줄"이라는 변이 취약점이 늘지 않는다.
  const [triaging, setTriaging] = useState(false)

  /** 훑기 대기열. 저장소가 준 순서를 그대로 쓴다. */
  const queue = useMemo(
    () => issues.filter((i) => i.triagedAt === null && i.status !== 'done'),
    [issues]
  )

  function startTriage() {
    const first = queue[0]
    if (!first) return
    setTriaging(true)
    if (openId !== first.id) onOpen(first.id)
  }

  /** 다음 대기 항목으로. 없으면 훑기를 끝낸다. */
  function advance(fromId: string) {
    const rest = queue.filter((i) => i.id !== fromId)
    const next = rest[0]
    if (!next) {
      setTriaging(false)
      if (openId) onOpen(openId)   // 같은 id로 부르면 App의 토글이 접는다
      return
    }
    onOpen(next.id)
  }

  async function saveTriage(id: string, pick: TriagePick) {
    // 잠기지 않은 update를 쓴다. 훑기는 본문을 건드리지 않으므로 사람과 agent가
    // 같은 글자를 다툴 일이 없고, 여기서 잠그면 agent가 방금 본문을 채운 이슈를
    // 분류조차 못 한다.
    await client.issues.update({ id, ...pick })
    await refresh()
  }
```

상세 자리의 분기(Task 6에서 건드리지 않은 `return` 문 안):

```tsx
        {expanded && (
          <div className="panel-split-detail">
            {open && triaging && (
              <TriageCard
                key={open.id}
                issue={open}
                position={queue.findIndex((i) => i.id === open.id) + 1}
                total={queue.length}
                onDone={(pick) => {
                  void (async () => {
                    try {
                      await saveTriage(open.id, pick)
                      advance(open.id)
                    } catch (err) {
                      // 충돌하면 그 한 건에서 멈춘다. 자동으로 넘어가면 사용자가
                      // 방금 찍은 축이 어디로 갔는지 모른 채 대기열만 줄어든다.
                      setTriageError(err instanceof Error ? err.message : String(err))
                    }
                  })()
                }}
                onSkip={() => advance(open.id)}
              />
            )}
            {open && !triaging && (
              <IssueDetail
                key={open.id}
                issue={open}
                onChanged={() => { void refresh() }}
                onDeleted={() => { onOpen(open.id); void refresh() }}
                onRequestClose={() => { onOpen(open.id) }}
              />
            )}
          </div>
        )}
```

배너에 버튼을 더한다:

```tsx
      {untriaged > 0 && (
        <div className="triage-banner">
          <span>⚠ 정리 안 됨 ({untriaged})</span>
          <button type="button" onClick={startTriage}>훑어보기</button>
        </div>
      )}
```

목록에서 다른 이슈를 클릭하면 훑기를 끝낸다 — `item-title` 버튼의 `onClick`을 바꾼다:

```tsx
                        onClick={() => { setTriaging(false); onOpen(i.id) }}
```

오류 상태를 더한다: `const [triageError, setTriageError] = useState<string | null>(null)`. `listError` 바로 아래에 같은 방식으로 그린다.

`TriageCard`와 `TriagePick`을 import한다.

- [ ] **Step 6: `IssuePanel.test.tsx`에 훑기 테스트를 더한다**

```tsx
describe('IssuePanel 훑기', () => {
  it('훑어보기를 누르면 첫 대기 항목이 열린다', async () => {
    const onOpen = vi.fn()
    renderPanel([makeIssue({ id: 'a', title: 'A', triagedAt: null })], { onOpen })
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기', exact: true }))
    expect(onOpen).toHaveBeenCalledWith('a')
  })

  it('축 셋을 찍고 다음을 누르면 저장한다', async () => {
    const mocks = renderPanel(
      [makeIssue({ id: 'a', title: 'A', triagedAt: null })],
      { openId: 'a', expanded: true }
    )
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '회의', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '버그', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '긴급', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '다음', exact: true }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
      id: 'a', source: 'meeting', kind: 'bug', priority: 'urgent'
    }))
  })

  it('훑기는 seenAt을 찍지 않는다', async () => {
    // 분류와 열람은 다른 행위다. 축을 찍었다는 이유로 방치 시계가 리셋되면
    // 훑기가 방치를 감추는 도구가 된다 (설계 §3 ③).
    const mocks = renderPanel(
      [makeIssue({ id: 'a', title: 'A', triagedAt: null })],
      { openId: 'a', expanded: true }
    )
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '회의', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '버그', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '긴급', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '다음', exact: true }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalled())
    expect(mocks.markSeen).not.toHaveBeenCalled()
  })

  it('건너뛴 이슈는 대기열에 남는다', async () => {
    const mocks = renderPanel(
      [
        makeIssue({ id: 'a', title: 'A', triagedAt: null }),
        makeIssue({ id: 'b', title: 'B', triagedAt: null })
      ],
      { openId: 'a', expanded: true }
    )
    await userEvent.click(await screen.findByRole('button', { name: '훑어보기', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기', exact: true }))

    expect(mocks.update).not.toHaveBeenCalled()
    expect(screen.getByText(/정리 안 됨 \(2\)/)).toBeInTheDocument()
  })
})
```

⚠️ `'훑기는 seenAt을 찍지 않는다'`는 지금 구조상 자동으로 통과한다 — `TriageCard`는 클라이언트를 아예 받지 않기 때문이다. **그 구조적 보장이 이 테스트의 요점이다.** 나중에 누군가 `startTriage`에 `markSeen`을 끼워 넣으면 여기서 빨개진다.

- [ ] **Step 7: CSS를 더한다**

```css
.triage-card { padding: 12px; }
.triage-position { font-size: 11px; opacity: 0.6; }
.triage-title { margin: 8px 0 16px; font-size: 15px; }
.triage-row { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.triage-row-label { width: 40px; font-size: 12px; opacity: 0.7; }
.triage-pick {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid rgba(128, 128, 128, 0.4);
  background: transparent;
  cursor: pointer;
}
.triage-picked { border-color: currentColor; background: rgba(128, 128, 128, 0.2); font-weight: 600; }
.triage-actions { display: flex; justify-content: space-between; margin-top: 18px; }
```

- [ ] **Step 8: 돌려서 통과를 확인한다**

Run: `pnpm test renderer/components/`
Expected: 전부 PASS.

- [ ] **Step 9: 회귀 테스트가 진짜인지 확인한다**

`TriageCard`의 `disabled={!complete}`를 `disabled={false}`로 잠시 바꾸고 돌린다.
Expected: `'축이 덜 찍히면 다음 버튼이 막혀 있다'`가 FAIL.

되돌린 뒤, `onSkip`을 `onDone`처럼 저장하게 잠시 바꾸고 돌린다.
Expected: `'건너뛰기는 아무것도 저장하지 않는다'`가 FAIL.

둘 다 확인했으면 되돌린다.

- [ ] **Step 10: 전체 테스트와 린트**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 11: 커밋**

```bash
git add renderer/components/TriageCard.tsx renderer/components/TriageCard.test.tsx renderer/components/IssuePanel.tsx renderer/components/IssuePanel.test.tsx renderer/index.css
git commit -m "feat(renderer): add triage card and flow in the issue detail slot"
```

---

## Task 8: 상세의 축 편집과 markSeen

**Files:**
- Modify: `renderer/components/IssueDetail.tsx`
- Modify: `renderer/components/IssueDetail.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `client.issues.markSeen`, Task 5의 라벨 표
- Produces: 없음 (마지막 UI 조각)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`renderer/components/IssueDetail.test.tsx`의 기존 헬퍼 `makeClient(over)`(`:17`)와 `renderDetail(client, issue, over)`(`:31`)를 그대로 쓴다.

**먼저 `makeClient`의 기본 목에 `markSeen`을 더한다** — 이것이 없으면 이 파일의 **기존 테스트가 전부** `markSeen is not a function`으로 죽는다.

```ts
      remove: vi.fn(),
      markSeen: vi.fn(async () => {}),
      ...over
```

그리고 테스트를 더한다.

```tsx
describe('IssueDetail 열람 기록', () => {
  it('마운트하면 markSeen을 부른다', async () => {
    const markSeen = vi.fn(async () => {})
    renderDetail(makeClient({ markSeen }), makeIssue({ id: 'i1' }))
    await waitFor(() => expect(markSeen).toHaveBeenCalledWith('i1'))
  })

  it('markSeen이 실패해도 화면은 멀쩡하다', async () => {
    // 열람 기록은 부수적이다. 이슈를 여는 행위가 이것 때문에 실패하면 안 된다.
    const markSeen = vi.fn(async () => { throw new Error('DB 실패') })
    renderDetail(makeClient({ markSeen }), makeIssue({ id: 'i1' }))
    await waitFor(() => expect(markSeen).toHaveBeenCalled())
    expect(await screen.findByLabelText('본문')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('markSeen은 목록을 다시 읽게 하지 않는다', async () => {
    // 정렬이 seenAt 오래된 순이라, 읽으면 방금 클릭한 항목이 눈앞에서 도망간다.
    const markSeen = vi.fn(async () => {})
    const props = renderDetail(makeClient({ markSeen }), makeIssue({ id: 'i1' }))
    await waitFor(() => expect(markSeen).toHaveBeenCalled())
    expect(props.onChanged).not.toHaveBeenCalled()
  })
})

describe('IssueDetail 축 편집', () => {
  it('축을 고르면 잠긴 경로로 저장한다', async () => {
    const updateIfUnchanged = vi.fn(async (i: { id: string }) => ({
      ok: true as const, issue: makeIssue({ id: i.id, updatedAt: 600 })
    }))
    renderDetail(
      makeClient({ updateIfUnchanged }),
      makeIssue({ id: 'i1', updatedAt: 500 })
    )
    await userEvent.selectOptions(await screen.findByLabelText('급함'), 'urgent')

    await waitFor(() => expect(updateIfUnchanged).toHaveBeenCalledWith({
      id: 'i1', priority: 'urgent', expectedUpdatedAt: 500
    }))
  })
})
```

⚠️ `makeClient`의 `over` 타입이 `Partial<OneDeskClient['issues']>`이므로, `markSeen`을 `OneDeskClient`(Task 3)에 먼저 더해두지 않으면 여기서 타입 오류가 난다. Task 3이 앞에 있는 이유다.

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `pnpm test renderer/components/IssueDetail.test.tsx`
Expected: `markSeen is not a function` 또는 호출되지 않아 FAIL.

- [ ] **Step 3: `markSeen` 호출을 더한다**

`IssueDetail` 안, `expected` ref 선언 아래에 넣는다.

```tsx
  /**
   * 사람이 이 이슈를 열었다는 기록. **마운트 때 한 번만이다.**
   *
   * - 실패해도 삼킨다. 열람 기록은 부수적이고, 이슈를 여는 행위가 이것 때문에
   *   실패하면 안 된다.
   * - **onChanged를 부르지 않는다.** 목록 정렬이 seenAt 오래된 순이라, 여기서
   *   목록을 다시 읽으면 방금 클릭한 항목이 눈앞에서 맨 아래로 도망간다.
   *   반영은 다음 마운트로 미룬다.
   * - issue.id가 바뀌면 IssuePanel의 key가 이 컴포넌트를 통째로 다시 마운트하므로
   *   의존성 배열은 마운트 한 번을 뜻한다.
   */
  useEffect(() => {
    void client.issues.markSeen(issue.id).catch(() => {})
  }, [client, issue.id])
```

`useEffect`를 react import에 더한다.

- [ ] **Step 4: 축 편집 UI를 더한다**

상태 `<select>` 옆에 셋을 나란히 놓는다. **`changeStatus`와 같은 경로(`persist`)를 탄다** — 잠기지 않은 `update`로 쓰면 이 화면의 기대값만 낡아 유령 충돌이 난다.

```tsx
  function changeAxis(patch: { source?: IssueSource; kind?: IssueKind; priority?: IssuePriority }) {
    void (async () => {
      try { await persist(patch) }
      catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    })()
  }
```

`persist`의 patch 타입에 축 셋을 더한다.

```tsx
  async function persist(patch: {
    title?: string; body?: string; status?: IssueStatus
    source?: IssueSource; kind?: IssueKind; priority?: IssuePriority
  }) {
```

렌더:

```tsx
      <label>
        급함
        <select
          aria-label="급함"
          value={priority ?? ''}
          onChange={(e) => {
            const next = e.target.value as IssuePriority | ''
            if (!next) return   // 축을 지우는 길은 만들지 않는다 (설계 §6)
            setPriority(next)
            changeAxis({ priority: next })
          }}
        >
          <option value="">미지정</option>
          {PRIORITY_ORDER.map((v) => (
            <option key={v} value={v}>{PRIORITY_LABELS[v]}</option>
          ))}
        </select>
      </label>
```

`출처`(`source`/`SOURCE_ORDER`/`SOURCE_LABELS`)와 `성격`(`kind`/`KIND_ORDER`/`KIND_LABELS`)도 같은 모양으로 만든다. **셋 다 `useState(issue.<축>)`으로 로컬 상태를 둔다** — `status`가 이미 그렇게 하고 있다.

import를 더한다.

```ts
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  PRIORITY_ORDER, SOURCE_ORDER, KIND_ORDER,
  PRIORITY_LABELS, SOURCE_LABELS, KIND_LABELS
} from '../issueAxes'
import type {
  Issue, IssueStatus, IssueSource, IssueKind, IssuePriority
} from '@shared/models'
```

- [ ] **Step 5: 돌려서 통과를 확인한다**

Run: `pnpm test renderer/components/IssueDetail.test.tsx`
Expected: 전부 PASS.

- [ ] **Step 6: 회귀 테스트가 진짜인지 확인한다**

Step 3의 `useEffect`에 `.then(() => onChanged())`를 잠시 붙이고 돌린다.
Expected: `'markSeen은 목록을 다시 읽게 하지 않는다'`가 FAIL.

되돌린 뒤, `changeAxis`를 `client.issues.update`(잠기지 않은 경로)로 잠시 바꾸고 돌린다.
Expected: `'축을 고르면 잠긴 경로로 저장한다'`가 FAIL.

둘 다 확인했으면 되돌린다.

- [ ] **Step 7: 전체 테스트와 린트**

Run: `pnpm test && pnpm typecheck && pnpm lint`

- [ ] **Step 8: 커밋**

```bash
git add renderer/components/IssueDetail.tsx renderer/components/IssueDetail.test.tsx
git commit -m "feat(renderer): edit triage axes in issue detail and record seenAt"
```

---

## Task 9: e2e와 문서

**Files:**
- Create: `e2e/triage.e2e.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 전부
- Produces: 없음

- [ ] **Step 1: e2e를 쓴다**

`e2e/body.e2e.ts`의 구조를 그대로 따른다. **화면을 벗어나지 않는다** — 다른 화면에 갔다 오면 패널이 다시 마운트돼 구독이 죽어도 통과해 버린다.

```ts
import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const ISSUE = '회원 탈퇴 플로우 문의'

describe('이슈 훑기', () => {
  it('던지고 훑으면 해당 그룹에 나타난다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-triage')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-triage$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    // 던질 땐 제목만이다
    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')

    const banner = page.getByText('⚠ 정리 안 됨 (1)')
    await banner.waitFor({ state: 'visible', timeout: 10_000 })

    // 훑기는 상세 자리를 빌려 쓴다 — 패널이 확장되면서 카드가 뜬다
    await page.getByRole('button', { name: '훑어보기', exact: true }).click()
    const next = page.getByRole('button', { name: '다음', exact: true })
    await next.waitFor({ state: 'visible', timeout: 5_000 })

    // 축이 덜 찍힌 동안은 막혀 있다
    expect(await next.isDisabled()).toBe(true)

    await page.getByRole('button', { name: '회의', exact: true }).click()
    await page.getByRole('button', { name: '조사', exact: true }).click()
    await page.getByRole('button', { name: '이번주', exact: true }).click()
    expect(await next.isDisabled()).toBe(false)
    await next.click()

    // 대기열이 비면 배너가 사라진다 — 0건을 그리지 않는다
    await banner.waitFor({ state: 'detached', timeout: 5_000 })

    // 그리고 그 이슈가 '이번주' 그룹 안에 있다
    const group = page.getByRole('button', { name: /이번주 \(1\)/ })
    await group.waitFor({ state: 'visible', timeout: 5_000 })

    // 축을 바꾸면 다시 묶인다 — App.tsx가 repos를 안 내려보내면 여기서 깨진다
    await page.getByLabel('묶기').selectOption('kind')
    await page.getByRole('button', { name: /조사 \(1\)/ })
      .waitFor({ state: 'visible', timeout: 5_000 })

    await app.close()
  })
})
```

⚠️ `getByRole('button', { name: … })`은 substring 매칭이 기본이다. `'다음'`·`'회의'`처럼 짧은 라벨은 **반드시 `exact: true`**를 붙인다 — 도크 토글이나 다른 버튼과 strict mode 위반이 난다.

⚠️ `app.close()`의 이름과 `launchApp`의 반환 모양은 `e2e/driver.ts`를 보고 맞춘다.

- [ ] **Step 2: e2e를 돌린다**

Run: `pnpm test:e2e`
Expected: 기존 e2e 전부 + 새 것 통과.

⚠️ **`pnpm dev`가 떠 있으면 먼저 끈다.** `test:e2e`가 `electron-vite build`로 시작하는데 산출물 디렉토리가 dev의 `out/`과 같아 실행 중인 dev 앱이 갈아끼워진다.

- [ ] **Step 3: `CLAUDE.md`의 대칭 규칙 절을 고친다**

"## 의도된 중복 — 합치지 말 것" 절 맨 아래에 붙인다. **이것은 선택이 아니다** (설계 §9).

```markdown
**대칭은 공통 필드에서 끝난다 (2026-08-27).** `title`·`body`·`repoIds`·삭제·낙관적 잠금은 계속 대칭으로 유지한다. 그러나 **분류 축(`source`·`kind`·`priority`)·`triagedAt`·`seenAt`·훑기는 이슈 전용이고, 메모에 옮기지 않는다.** 이 절이 예고한 갈림길("이슈에는 앞으로 상태 전이, run 연결이 붙지만 메모에는 붙지 않는다")에 실제로 도착한 것이다 — 메모는 *적어두는 것*이고 이슈는 *처리해야 하는 것*이라, 분류·우선순위·방치 판정은 전부 처리에 딸린 개념이다. **어긋난 것을 "고치려" 하지 말 것.** 설계 `2026-08-27-issue-triage-design.md` §9.
```

- [ ] **Step 4: `CLAUDE.md`에 새 함정을 더한다**

"## 밟으면 조용히 깨지는 것들"에 붙인다.

```markdown
**`updatedAt`으로 "사람이 마지막으로 본 시각"을 판정하면 안 된다.** agent가 MCP `update_issue`로 본문을 고쳐도 `updatedAt`이 올라가므로, 사람이 그 이슈를 본 적이 없는데 "방금 본 것"이 된다. **agent가 건드린 이슈일수록 조용해진다** — 정확히 거꾸로다. 그래서 `seenAt`이 따로 있고, `markSeen`은 `buildPatch`를 타지 않는다. 이슈 목록 정렬은 `updatedAt DESC`가 아니라 **`seenAt` 오래된 순**이다(안 본 것이 위로). 되돌리지 말 것.

**`markSeen` 뒤에 목록을 다시 읽으면 안 된다.** 정렬이 `seenAt` 오래된 순이라, 이슈를 여는 순간 목록을 갱신하면 **방금 클릭한 항목이 눈앞에서 맨 아래로 점프한다.** `IssueDetail`의 `markSeen` effect가 `onChanged`를 부르지 않는 이유다.

**"정리 안 됨"과 "미지정"은 다른 말이다.** 전자는 훑기 대기열(`triagedAt IS NULL`), 후자는 지금 묶은 축의 값이 비었다는 뜻이다. 마이그레이션 `0003`이 백필한 이슈는 `triagedAt`은 있는데 축이 비어 있어 두 값이 갈린다 — 같은 단어로 쓰면 "정리 안 됨 0건인데 미분류 그룹에 3개"라는 화면이 나온다.
```

- [ ] **Step 5: `CLAUDE.md`의 현재 상태와 문서 표를 갱신한다**

문서 표에 두 줄을 더한다.

```markdown
| `docs/superpowers/specs/2026-08-27-issue-triage-design.md` | 이슈 훑기 설계 — 분류 축, `triagedAt` 파생(§3), `seenAt`과 방치(§3), 훑기 UI(§4), 대칭 규칙의 끝(§9) |
| `docs/superpowers/plans/2026-08-27-issue-triage.md` | 이슈 훑기 구현 계획 (9개 태스크) |
```

맨 위 "**현재 상태:**" 문단에 한 문단을 더한다.

```markdown
**이슈 훑기**가 붙었다(설계 `2026-08-27-issue-triage-design.md`, 계획 `2026-08-27-issue-triage.md`). **첫 실행에 마이그레이션 `0003`이 돈다** — 컬럼 다섯 추가 + 기존 이슈의 `triaged_at` 백필. 이슈를 제목 한 줄로 던져 넣고 분류는 나중에 훑기로 몰아서 한다. 목록은 축(급함·출처·성격·repo)으로 묶고 접되 **접혀도 개수는 보이며**, 그룹 안은 `seenAt` 오래된 순이다. MCP `create_issue`가 축을 받으므로 agent가 회의 메모를 이슈로 쪼개며 분류까지 끝낼 수 있다.
```

- [ ] **Step 6: 마지막 확인**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: 전부 초록.

- [ ] **Step 7: 커밋**

```bash
git add e2e/triage.e2e.ts CLAUDE.md
git commit -m "test(e2e): cover throw-then-triage round trip; document the axis split"
```

---

## 마무리

모든 태스크가 끝나면 `superpowers:finishing-a-development-branch`로 `main` 병합 여부를 정한다. 병합 전에 확인할 것:

- `grep -rn "from 'electron'" core/` — 출력 없어야 함
- `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없어야 함
- `pnpm test:e2e`가 초록 (마이그레이션 `0003`이 실제 앱에서 도는 것을 이것만이 확인한다)
