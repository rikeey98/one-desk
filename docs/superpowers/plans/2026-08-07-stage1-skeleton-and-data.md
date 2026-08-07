# one-desk 1단계 (뼈대와 데이터) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron + Vite + React 셸 위에 SQLite 데이터 계층과 IPC 배선을 올려, agent 없이도 쓸 수 있는 workspace / repo / issue / memo 관리 앱을 완성한다.

**Architecture:** Electron main 프로세스가 단일 백엔드로서 SQLite를 소유한다. `core/`는 Electron에 의존하지 않는 순수 Node 모듈이고, 렌더러는 `shared/`에 정의된 `OneDeskClient` 인터페이스만 알며 전송 계층(현재는 IPC)을 모른다. 이 두 경계는 tsconfig와 ESLint로 컴파일 단계에서 강제한다.

**Tech Stack:** pnpm 10 / Node 22.16 / TypeScript 5.9.3 / Electron 43.3.0 / electron-vite 5.0.0 / Vite 7.3.6 / React 19.2 / better-sqlite3 13.0.3 / drizzle-orm 0.45.2 / Vitest 4.1.10

**참조 문서:**
- 설계: `docs/superpowers/specs/2026-08-07-one-desk-design.md`
- 구현 노트(Q&A 42개): `docs/superpowers/specs/2026-08-07-implementation-notes.md`

## Global Constraints

- **`core/`는 `electron`을 import하지 않는다.** 설계 §4 규칙 1. 위반 시 자율 실행 단계에서 전면 재작성이 필요해진다. tsconfig + ESLint로 강제한다.
- **`renderer/`는 `core/`를 import하지 않는다.** 설계 §4 규칙 2. 렌더러는 `shared/`와 `window.oneDesk`만 안다.
- **`shared/`에는 타입과 순수 상수만 넣는다.** `fs`를 쓰는 함수가 하나라도 들어가면 렌더러 번들이 깨진다.
- **`@vitejs/plugin-react`는 `5.2.0`으로 고정한다.** 6.0.x의 peer는 `vite ^8`인데 electron-vite 5.0.0의 peer는 `vite ^5||^6||^7`이다. 최신으로 두면 `pnpm install`이 실패한다.
- **TypeScript는 5.9.3.** 7.x는 생태계 호환이 검증되지 않았다.
- **시각은 전부 epoch milliseconds 정수로 저장한다.** SQLite에 날짜 타입이 없고, 정수는 정렬·비교가 단순하며 IPC 구조화 복제를 문제없이 통과한다.
- **id는 애플리케이션이 생성한다.** `crypto.randomUUID()`. 자동증가 정수를 쓰면 나중에 데이터 병합이나 동기화가 필요해질 때 충돌한다.
- 들여쓰기 2칸, 함수명 camelCase, 상수 UPPER_SNAKE_CASE.

## 이번 단계의 스키마 범위

`workspace` / `repo` / `issue` / `memo` / `issue_repo` / `memo_repo` / `app_setting` **일곱 개만** 만든다.

`run`, `run_context_item`, `run_file_change`, `asset`은 각각 2·5단계에서 마이그레이션으로 추가한다. 지금 만들면 쓰지 않는 테이블을 상대로 스키마 결정을 확정하게 되는데, 그 결정들은 실제 실행 파이프라인을 만들어보기 전에는 검증할 수 없다. 마이그레이션이 존재하는 이유가 이것이다.

## File Structure

```
one-desk/
├─ electron/
│  ├─ main.ts                  앱 생명주기, 윈도우 생성, core 부트스트랩
│  ├─ preload.ts               contextBridge로 window.oneDesk 노출
│  └─ ipc/
│     ├─ index.ts              모든 핸들러 등록 진입점
│     ├─ workspaces.ts         workspace 채널 핸들러
│     ├─ repos.ts              repo 채널 핸들러
│     ├─ issues.ts             issue 채널 핸들러
│     └─ memos.ts              memo 채널 핸들러
├─ core/
│  ├─ index.ts                 createCore() — core의 유일한 공개 진입점
│  ├─ db/
│  │  ├─ schema.ts             Drizzle 테이블 정의
│  │  ├─ open.ts               DB 열기, 마이그레이션 적용, 백업
│  │  └─ repositories/
│  │     ├─ workspace.ts
│  │     ├─ repo.ts
│  │     ├─ issue.ts
│  │     └─ memo.ts
├─ renderer/
│  ├─ index.html
│  ├─ main.tsx                 React 진입점
│  ├─ App.tsx                  최상위 레이아웃
│  ├─ client/
│  │  └─ ClientProvider.tsx    OneDeskClient를 Context로 주입
│  ├─ hooks/
│  │  └─ useWorkspaces.ts      데이터 조회 훅
│  └─ components/
│     ├─ Sidebar.tsx           workspace 목록
│     ├─ RepoStrip.tsx         repo 가로 스트립
│     ├─ Panel.tsx             컬럼 패널 공통 껍데기
│     ├─ IssuePanel.tsx
│     ├─ MemoPanel.tsx
│     └─ AssetPanel.tsx        1단계에서는 빈 상태만
├─ shared/
│  ├─ client.ts                OneDeskClient 인터페이스
│  ├─ models.ts                Workspace / Repo / Issue / Memo 타입
│  ├─ channels.ts              IPC 채널명 상수
│  └─ global.d.ts              window.oneDesk 전역 선언
├─ drizzle/                    생성된 마이그레이션 SQL
├─ tsconfig.json               루트 (프로젝트 참조만)
├─ tsconfig.base.json          공통 컴파일러 옵션
├─ tsconfig.node.json          electron + core + shared
├─ tsconfig.web.json           renderer + shared  ← core가 없다. 이게 경계다
├─ electron.vite.config.ts
├─ drizzle.config.ts
├─ vitest.config.ts
└─ eslint.config.js
```

**파일 분할 기준:** IPC 핸들러와 리포지토리를 도메인별로 쪼갠 이유는, 이 두 계층이 도메인이 늘어날 때마다 함께 커지기 때문이다. 한 파일에 모으면 2단계에서 run 관련 채널이 들어올 때 파일이 감당 못 할 크기가 된다. 반대로 컴포넌트는 화면 구조를 그대로 따라간다.

---

## Task 1: 스캐폴딩과 경계 설정

템플릿으로 시작해 즉시 우리 구조로 바꾸고, 두 경계 규칙을 컴파일 단계에서 강제한다. **이 태스크가 끝나면 흰 창이 뜨고 `typecheck`와 `lint`가 통과한다.**

**Files:**
- Create: `tsconfig.json`, `tsconfig.base.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `eslint.config.js`, `electron.vite.config.ts`
- Modify: `package.json`
- Move: 템플릿 구조 → 설계 §4 구조

- [ ] **Step 1: 템플릿 생성**

```bash
cd /Users/yonghyun-kwon/WorkSpace
pnpm create electron-vite
# Project name: one-desk-tmp
# Framework: React
# Variant: TypeScript
```

`one-desk`가 이미 존재하므로 임시 이름으로 만든 뒤 내용물만 옮긴다. `docs/`와 `.superpowers/`를 덮어쓰지 않기 위해서다.

```bash
cd one-desk-tmp
rm -rf .git node_modules pnpm-lock.yaml dev-app-update.yml
cp -R . /Users/yonghyun-kwon/WorkSpace/one-desk/
cd /Users/yonghyun-kwon/WorkSpace/one-desk
rm -rf /Users/yonghyun-kwon/WorkSpace/one-desk-tmp
```

- [ ] **Step 2: 구조 이동**

```bash
mkdir -p electron/ipc core/db/repositories renderer/{client,hooks,components} shared drizzle

mv src/main/index.ts electron/main.ts
mv src/preload/index.ts electron/preload.ts
mv src/renderer/index.html renderer/index.html
mv src/renderer/src/* renderer/
rm -rf src
```

- [ ] **Step 3: package.json 교체**

```json
{
  "name": "one-desk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --build --force",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "pack": "electron-vite build && electron-builder --dir",
    "postinstall": "electron-rebuild -f -w better-sqlite3"
  },
  "dependencies": {
    "better-sqlite3": "13.0.3",
    "drizzle-orm": "0.45.2"
  },
  "devDependencies": {
    "@electron/rebuild": "4.2.0",
    "@types/better-sqlite3": "7.6.13",
    "@types/node": "22.10.2",
    "@types/react": "19.2.2",
    "@types/react-dom": "19.2.2",
    "@vitejs/plugin-react": "5.2.0",
    "drizzle-kit": "0.31.10",
    "electron": "43.3.0",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "eslint": "9.18.0",
    "jsdom": "26.0.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "typescript": "5.9.3",
    "typescript-eslint": "8.20.0",
    "vite": "7.3.6",
    "vitest": "4.1.10"
  }
}
```

`@vitejs/plugin-react`가 `5.2.0`인 것을 확인하라. 6.x는 vite 8을 요구해서 electron-vite와 충돌한다.

- [ ] **Step 4: tsconfig 4개 작성**

```jsonc
// tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

```jsonc
// tsconfig.node.json
{
  "extends": "./tsconfig.base.json",
  "include": ["electron/**/*", "core/**/*", "shared/**/*", "*.config.ts"],
  "compilerOptions": {
    "composite": true,
    "lib": ["ES2023"],
    "types": ["node", "electron"],
    "baseUrl": ".",
    "paths": {
      "@core/*": ["core/*"],
      "@shared/*": ["shared/*"]
    }
  }
}
```

```jsonc
// tsconfig.web.json
{
  "extends": "./tsconfig.base.json",
  "include": ["renderer/**/*", "shared/**/*"],
  "compilerOptions": {
    "composite": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [],
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"],
      "@renderer/*": ["renderer/*"]
    }
  }
}
```

`tsconfig.web.json`에 `@core/*`가 **없다는 것**이 경계다. 렌더러에서 `@core/db`를 import하면 `Cannot find module` 컴파일 에러가 난다. `types: []`는 렌더러에서 `process`, `__dirname`, `Buffer`를 없앤다.

- [ ] **Step 5: ESLint 경계 규칙**

tsconfig의 path alias는 상대경로 우회(`../../core/db`)를 막지 못한다. lint로 한 번 더 잠근다.

```js
// eslint.config.js
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'drizzle/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'electron', message: 'core/는 electron에 의존하지 않는다 (설계 §4 규칙 1).' }
        ],
        patterns: [
          { group: ['**/electron/**'], message: 'core/는 electron/ 코드를 참조하지 않는다.' }
        ]
      }]
    }
  },
  {
    files: ['renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/core/**', '@core/*'], message: 'renderer/는 core/를 직접 쓰지 않는다. window.oneDesk를 통해라 (설계 §4 규칙 2).' },
          { group: ['electron', 'node:*', 'fs', 'path'], message: 'renderer/에서 Node API를 쓸 수 없다.' }
        ]
      }]
    }
  }
)
```

- [ ] **Step 6: electron.vite.config.ts**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const alias = {
  '@core': resolve('core'),
  '@shared': resolve('shared'),
  '@renderer': resolve('renderer')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('electron/preload.ts') } } }
  },
  renderer: {
    root: 'renderer',
    plugins: [react()],
    resolve: { alias: { '@shared': alias['@shared'], '@renderer': alias['@renderer'] } },
    build: { rollupOptions: { input: { index: resolve('renderer/index.html') } } }
  }
})
```

`externalizeDepsPlugin()`은 `better-sqlite3` 같은 네이티브 모듈을 번들에 넣지 않고 런타임에 `require`하게 만든다. 이게 없으면 빌드가 실패한다. renderer의 alias에 `@core`가 없는 것도 의도적이다.

- [ ] **Step 7: 설치 및 확인**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm dev
```

Expected: `pnpm install`이 peer 충돌 없이 끝나고, typecheck와 lint가 통과하며, `pnpm dev`로 흰 창이 뜬다. `postinstall`의 `electron-rebuild`가 better-sqlite3를 Electron ABI에 맞춰 다시 빌드한다 — 이걸 건너뛰면 나중에 `NODE_MODULE_VERSION` 불일치 에러가 난다.

- [ ] **Step 8: 경계가 실제로 막는지 확인**

`renderer/App.tsx` 맨 위에 임시로 다음 줄을 넣고 `pnpm typecheck`를 실행한다.

```ts
import { openDb } from '@core/db/open'
```

Expected: `Cannot find module '@core/db/open'` 에러. 확인했으면 이 줄을 지운다. **경계는 테스트해보기 전까지 작동한다고 믿지 않는다.**

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "chore: scaffold electron-vite app with core/renderer boundaries"
```

---

## Task 2: shared/ 계약 정의

렌더러와 main이 공유할 타입을 확정한다. 이후 모든 태스크가 이 파일들을 참조하므로 이름과 시그니처를 여기서 못박는다.

**Files:**
- Create: `shared/models.ts`, `shared/client.ts`, `shared/channels.ts`, `shared/global.d.ts`

**Interfaces:**
- Produces: `Workspace`, `Repo`, `Issue`, `Memo` 타입 / `OneDeskClient` 인터페이스 / `CHANNELS` 상수

- [ ] **Step 1: 도메인 타입**

```ts
// shared/models.ts
export type AgentKind = 'claude-code' | 'opencode'
export type Permission = 'read_only' | 'edit' | 'full'
export type IssueStatus = 'open' | 'doing' | 'done'

export interface Workspace {
  id: string
  name: string
  description: string | null
  defaultAgentKind: AgentKind
  defaultModelClaude: string | null
  defaultModelOpencode: string | null
  defaultPermission: Permission
  claudePath: string | null
  opencodePath: string | null
  createdAt: number
  updatedAt: number
}

export interface Repo {
  id: string
  workspaceId: string
  name: string
  path: string
  description: string | null
  sortOrder: number
  createdAt: number
}

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
}

export interface Memo {
  id: string
  workspaceId: string
  title: string
  body: string
  repoIds: string[]
  createdAt: number
  updatedAt: number
}

export interface CreateWorkspaceInput {
  name: string
  description?: string | null
}

export interface CreateRepoInput {
  workspaceId: string
  name: string
  path: string
  description?: string | null
}

export interface CreateIssueInput {
  workspaceId: string
  title: string
  body?: string
  repoIds?: string[]
}

export interface UpdateIssueInput {
  id: string
  title?: string
  body?: string
  status?: IssueStatus
  repoIds?: string[]
}

export interface CreateMemoInput {
  workspaceId: string
  title: string
  body?: string
  repoIds?: string[]
}

export interface UpdateMemoInput {
  id: string
  title?: string
  body?: string
  repoIds?: string[]
}

/** repoId가 주어지면 그 repo에 태그된 항목 + 태그가 없는 공통 항목을 함께 반환한다 (설계 §9). */
export interface ListQuery {
  workspaceId: string
  repoId?: string
}
```

`Issue.repoIds`가 모델에 들어 있는 이유는, 조인 결과를 별도 호출로 가져오게 만들면 화면마다 N+1 조회가 생기기 때문이다. 리포지토리가 조립해서 넘긴다.

- [ ] **Step 2: 클라이언트 인터페이스**

```ts
// shared/client.ts
import type {
  Workspace, Repo, Issue, Memo,
  CreateWorkspaceInput, CreateRepoInput,
  CreateIssueInput, UpdateIssueInput,
  CreateMemoInput, UpdateMemoInput,
  ListQuery
} from './models'

export interface OneDeskClient {
  workspaces: {
    list(): Promise<Workspace[]>
    create(input: CreateWorkspaceInput): Promise<Workspace>
    remove(id: string): Promise<void>
  }
  repos: {
    list(workspaceId: string): Promise<Repo[]>
    create(input: CreateRepoInput): Promise<Repo>
    remove(id: string): Promise<void>
  }
  issues: {
    list(query: ListQuery): Promise<Issue[]>
    create(input: CreateIssueInput): Promise<Issue>
    update(input: UpdateIssueInput): Promise<Issue>
    remove(id: string): Promise<void>
  }
  memos: {
    list(query: ListQuery): Promise<Memo[]>
    create(input: CreateMemoInput): Promise<Memo>
    update(input: UpdateMemoInput): Promise<Memo>
    remove(id: string): Promise<void>
  }
}
```

모든 메서드가 `Promise`를 반환한다. 지금 구현체는 IPC라 실제로 비동기이고, 나중에 HTTP 구현체로 바꿔도 시그니처가 변하지 않는다.

- [ ] **Step 3: 채널 상수**

```ts
// shared/channels.ts
export const CHANNELS = {
  workspacesList: 'workspaces:list',
  workspacesCreate: 'workspaces:create',
  workspacesRemove: 'workspaces:remove',
  reposList: 'repos:list',
  reposCreate: 'repos:create',
  reposRemove: 'repos:remove',
  issuesList: 'issues:list',
  issuesCreate: 'issues:create',
  issuesUpdate: 'issues:update',
  issuesRemove: 'issues:remove',
  memosList: 'memos:list',
  memosCreate: 'memos:create',
  memosUpdate: 'memos:update',
  memosRemove: 'memos:remove'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
```

문자열을 양쪽에서 직접 쓰면 오타가 런타임까지 살아남는다. 상수로 두면 컴파일러가 잡는다.

- [ ] **Step 4: 전역 선언**

```ts
// shared/global.d.ts
import type { OneDeskClient } from './client'

declare global {
  interface Window {
    oneDesk: OneDeskClient
  }
}

export {}
```

- [ ] **Step 5: 확인 및 커밋**

```bash
pnpm typecheck
git add shared/
git commit -m "feat: define shared models and OneDeskClient contract"
```

Expected: typecheck 통과.

---

## Task 3: Drizzle 스키마와 마이그레이션

**Files:**
- Create: `core/db/schema.ts`, `drizzle.config.ts`
- Generated: `drizzle/0000_*.sql`

**Interfaces:**
- Consumes: `shared/models.ts`의 enum 값들
- Produces: `workspace`, `repo`, `issue`, `memo`, `issueRepo`, `memoRepo`, `appSetting` 테이블 객체

- [ ] **Step 1: 스키마 작성**

```ts
// core/db/schema.ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const nowMs = () => sql`(unixepoch() * 1000)`

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  defaultAgentKind: text('default_agent_kind', { enum: ['claude-code', 'opencode'] })
    .notNull().default('claude-code'),
  defaultModelClaude: text('default_model_claude'),
  defaultModelOpencode: text('default_model_opencode'),
  defaultPermission: text('default_permission', { enum: ['read_only', 'edit', 'full'] })
    .notNull().default('edit'),
  claudePath: text('claude_path'),
  opencodePath: text('opencode_path'),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs())
})

export const repo = sqliteTable('repo', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(nowMs())
}, (t) => [index('repo_workspace_idx').on(t.workspaceId)])

export const issue = sqliteTable('issue', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  status: text('status', { enum: ['open', 'doing', 'done'] }).notNull().default('open'),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs()),
  closedAt: integer('closed_at')
}, (t) => [index('issue_workspace_status_idx').on(t.workspaceId, t.status)])

export const memo = sqliteTable('memo', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: integer('created_at').notNull().default(nowMs()),
  updatedAt: integer('updated_at').notNull().default(nowMs())
}, (t) => [index('memo_workspace_idx').on(t.workspaceId)])

export const issueRepo = sqliteTable('issue_repo', {
  issueId: text('issue_id').notNull().references(() => issue.id, { onDelete: 'cascade' }),
  repoId: text('repo_id').notNull().references(() => repo.id, { onDelete: 'cascade' })
}, (t) => [
  primaryKey({ columns: [t.issueId, t.repoId] }),
  index('issue_repo_repo_idx').on(t.repoId)
])

export const memoRepo = sqliteTable('memo_repo', {
  memoId: text('memo_id').notNull().references(() => memo.id, { onDelete: 'cascade' }),
  repoId: text('repo_id').notNull().references(() => repo.id, { onDelete: 'cascade' })
}, (t) => [
  primaryKey({ columns: [t.memoId, t.repoId] }),
  index('memo_repo_repo_idx').on(t.repoId)
])

export const appSetting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
```

조인 테이블의 `repoId` 인덱스는 "이 repo에 달린 이슈들"을 역방향으로 조회할 때 쓴다. 복합 기본키의 첫 컬럼만으로는 이 방향이 커버되지 않는다.

- [ ] **Step 2: drizzle.config.ts**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './core/db/schema.ts',
  out: './drizzle'
})
```

- [ ] **Step 3: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `drizzle/0000_<이름>.sql`과 `drizzle/meta/`가 생성된다. SQL 파일을 열어 일곱 개 테이블의 `CREATE TABLE`이 모두 있는지 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add core/db/schema.ts drizzle.config.ts drizzle/
git commit -m "feat: add drizzle schema for workspace, repo, issue, memo"
```

**마이그레이션 SQL은 반드시 커밋한다.** 생성물이지만, 이미 배포된 DB를 어떤 순서로 변경했는지가 이 파일들에만 남는다.

---

## Task 4: DB 열기와 마이그레이션 적용

**Files:**
- Create: `core/db/open.ts`, `core/db/open.test.ts`, `vitest.config.ts`

**Interfaces:**
- Consumes: `core/db/schema.ts`
- Produces: `openDb(opts: OpenDbOptions): Database` — `Database`는 `drizzle-orm/better-sqlite3`의 `BetterSQLite3Database<typeof schema>`

- [ ] **Step 1: vitest 설정**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('core'),
      '@shared': resolve('shared'),
      '@renderer': resolve('renderer')
    }
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'core', environment: 'node', include: ['core/**/*.test.ts'] }
      },
      {
        extends: true,
        test: { name: 'renderer', environment: 'jsdom', include: ['renderer/**/*.test.tsx'] }
      }
    ]
  }
})
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// core/db/open.test.ts
import { describe, it, expect } from 'vitest'
import { openDb } from './open'
import { workspace } from './schema'

describe('openDb', () => {
  it('인메모리 DB에 마이그레이션을 적용하고 테이블을 만든다', () => {
    const db = openDb({ file: ':memory:', migrationsDir: 'drizzle' })
    const rows = db.select().from(workspace).all()
    expect(rows).toEqual([])
  })

  it('외래키 제약을 켠다', () => {
    const db = openDb({ file: ':memory:', migrationsDir: 'drizzle' })
    const [row] = db.$client.pragma('foreign_keys') as Array<{ foreign_keys: number }>
    expect(row?.foreign_keys).toBe(1)
  })
})
```

두 번째 테스트가 중요하다. **better-sqlite3는 외래키를 기본으로 끄고 시작한다.** 켜지 않으면 `onDelete: 'cascade'` 선언이 아무 효과가 없고, workspace를 지워도 그 안의 issue가 고아로 남는다. 스키마에 써놨다고 동작하는 게 아니다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test -- core/db/open.test.ts`
Expected: FAIL — `Cannot find module './open'`

- [ ] **Step 4: 구현**

```ts
// core/db/open.ts
import { existsSync, copyFileSync } from 'node:fs'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export interface OpenDbOptions {
  /** DB 파일 경로. ':memory:'면 인메모리. */
  file: string
  /** 생성된 마이그레이션 디렉토리 */
  migrationsDir: string
}

export type Database = ReturnType<typeof openDb>

export function openDb(opts: OpenDbOptions) {
  backupIfNeeded(opts.file)

  const sqlite = new BetterSqlite3(opts.file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: opts.migrationsDir })
  return db
}

/**
 * 마이그레이션 적용 전에 DB를 복제해둔다 (설계 §11).
 * 로컬 SQLite 하나에 모든 기록이 들어 있으므로 여기는 타협하지 않는다.
 */
function backupIfNeeded(file: string) {
  if (file === ':memory:' || !existsSync(file)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(file, `${file}.${stamp}.bak`)
}
```

`migrate()`는 drizzle-orm 0.45의 better-sqlite3 드라이버에서 **동기 함수**다. `await`를 붙이지 않는다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test -- core/db/open.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add core/db/open.ts core/db/open.test.ts vitest.config.ts
git commit -m "feat: open sqlite with migrations, WAL, and foreign keys"
```

---

## Task 5: WorkspaceRepository

**Files:**
- Create: `core/db/repositories/workspace.ts`, `core/db/repositories/workspace.test.ts`
- Create: `core/db/repositories/testing.ts` (테스트 헬퍼)

**Interfaces:**
- Consumes: `openDb`, `schema.workspace`
- Produces: `createWorkspaceRepository(db): { list, create, remove }` — 반환 타입은 `shared/models.ts`의 `Workspace`

- [ ] **Step 1: 테스트 헬퍼**

```ts
// core/db/repositories/testing.ts
import { openDb, type Database } from '../open'

export function makeTestDb(): Database {
  return openDb({ file: ':memory:', migrationsDir: 'drizzle' })
}
```

인메모리 DB는 연결이 닫히면 사라지므로 테스트 간 격리가 자동으로 된다. 정리 코드가 필요 없다.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// core/db/repositories/workspace.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import type { Database } from '../open'

describe('WorkspaceRepository', () => {
  let db: Database
  let repo: ReturnType<typeof createWorkspaceRepository>

  beforeEach(() => {
    db = makeTestDb()
    repo = createWorkspaceRepository(db)
  })

  it('생성한 workspace를 목록에서 찾을 수 있다', () => {
    const created = repo.create({ name: '사내 플랫폼' })
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('사내 플랫폼')
    expect(created.defaultPermission).toBe('edit')

    const all = repo.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.id).toBe(created.id)
  })

  it('이름순으로 정렬해서 반환한다', () => {
    repo.create({ name: '하나' })
    repo.create({ name: '가나' })
    repo.create({ name: '나나' })
    expect(repo.list().map((w) => w.name)).toEqual(['가나', '나나', '하나'])
  })

  it('삭제하면 목록에서 사라진다', () => {
    const w = repo.create({ name: '지울것' })
    repo.remove(w.id)
    expect(repo.list()).toHaveLength(0)
  })
})
```

기본 권한이 `'edit'`인지 확인하는 단언이 들어 있다. 설계 §7이 정한 기본값이고, 스키마의 `.default('edit')`이 실제로 먹는지 여기서 검증된다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test -- core/db/repositories/workspace.test.ts`
Expected: FAIL — `Cannot find module './workspace'`

- [ ] **Step 4: 구현**

```ts
// core/db/repositories/workspace.ts
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { workspace } from '../schema'
import type { Workspace, CreateWorkspaceInput } from '@shared/models'

export function createWorkspaceRepository(db: Database) {
  return {
    list(): Workspace[] {
      return db.select().from(workspace).orderBy(asc(workspace.name)).all()
    },

    create(input: CreateWorkspaceInput): Workspace {
      const [row] = db
        .insert(workspace)
        .values({
          id: randomUUID(),
          name: input.name,
          description: input.description ?? null
        })
        .returning()
        .all()
      if (!row) throw new Error('workspace 생성에 실패했습니다')
      return row
    },

    remove(id: string): void {
      db.delete(workspace).where(eq(workspace.id, id)).run()
    }
  }
}
```

`.returning()`으로 삽입된 행을 그대로 받는다. 별도 SELECT를 하면 `default` 값이 채워진 실제 행과 우리가 만든 객체가 어긋날 수 있다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test -- core/db/repositories/workspace.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add core/db/repositories/
git commit -m "feat: add workspace repository"
```

---

## Task 6: 수직 슬라이스 — core 진입점부터 렌더러 호출까지

**이 태스크가 1단계의 분수령이다.** 렌더러에서 `window.oneDesk.workspaces.list()`가 실제로 DB까지 갔다 오면, 남은 도메인은 같은 패턴의 반복이다. **여기 도달하기 전에 UI를 다듬는 데 시간을 쓰지 않는다.**

**Files:**
- Create: `core/index.ts`, `electron/ipc/index.ts`, `electron/ipc/workspaces.ts`
- Modify: `electron/main.ts`, `electron/preload.ts`, `renderer/App.tsx`

**Interfaces:**
- Consumes: `createWorkspaceRepository`, `openDb`, `CHANNELS`
- Produces: `createCore(opts): Core` — `Core`는 `{ workspaces, repos, issues, memos }` 리포지토리 묶음

- [ ] **Step 1: core 진입점**

```ts
// core/index.ts
import { join } from 'node:path'
import { openDb } from './db/open'
import { createWorkspaceRepository } from './db/repositories/workspace'

export interface CoreOptions {
  /** DB와 로그를 둘 디렉토리. Electron의 userData 경로를 main이 넘긴다. */
  dataDir: string
  /** 마이그레이션 디렉토리 (패키징 시 위치가 달라진다) */
  migrationsDir: string
}

export function createCore(opts: CoreOptions) {
  const db = openDb({
    file: join(opts.dataDir, 'one-desk.db'),
    migrationsDir: opts.migrationsDir
  })

  return {
    workspaces: createWorkspaceRepository(db)
  }
}

export type Core = ReturnType<typeof createCore>
```

**`dataDir`를 인자로 받는 것이 규칙 1의 실체다.** `core/`가 `app.getPath('userData')`를 직접 부르면 electron에 묶여서 데몬으로 떼어낼 수 없고 테스트도 못 한다. 경로를 아는 것은 main의 책임이다.

- [ ] **Step 2: IPC 핸들러**

```ts
// electron/ipc/workspaces.ts
import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateWorkspaceInput } from '@shared/models'

export function registerWorkspaceHandlers(core: Core) {
  ipcMain.handle(CHANNELS.workspacesList, () => core.workspaces.list())
  ipcMain.handle(CHANNELS.workspacesCreate, (_e, input: CreateWorkspaceInput) =>
    core.workspaces.create(input))
  ipcMain.handle(CHANNELS.workspacesRemove, (_e, id: string) =>
    core.workspaces.remove(id))
}
```

```ts
// electron/ipc/index.ts
import type { Core } from '@core/index'
import { registerWorkspaceHandlers } from './workspaces'

export function registerIpc(core: Core) {
  registerWorkspaceHandlers(core)
}
```

핸들러는 얇게 유지한다. 로직이 여기 들어가기 시작하면 `core/`를 떼어낼 때 함께 옮겨야 할 코드가 electron 쪽에 남는다.

- [ ] **Step 3: preload**

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { OneDeskClient } from '@shared/client'

const client: OneDeskClient = {
  workspaces: {
    list: () => ipcRenderer.invoke(CHANNELS.workspacesList),
    create: (input) => ipcRenderer.invoke(CHANNELS.workspacesCreate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.workspacesRemove, id)
  },
  repos: {
    list: (workspaceId) => ipcRenderer.invoke(CHANNELS.reposList, workspaceId),
    create: (input) => ipcRenderer.invoke(CHANNELS.reposCreate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.reposRemove, id)
  },
  issues: {
    list: (query) => ipcRenderer.invoke(CHANNELS.issuesList, query),
    create: (input) => ipcRenderer.invoke(CHANNELS.issuesCreate, input),
    update: (input) => ipcRenderer.invoke(CHANNELS.issuesUpdate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.issuesRemove, id)
  },
  memos: {
    list: (query) => ipcRenderer.invoke(CHANNELS.memosList, query),
    create: (input) => ipcRenderer.invoke(CHANNELS.memosCreate, input),
    update: (input) => ipcRenderer.invoke(CHANNELS.memosUpdate, input),
    remove: (id) => ipcRenderer.invoke(CHANNELS.memosRemove, id)
  }
}

contextBridge.exposeInMainWorld('oneDesk', client)
```

preload에서 `OneDeskClient` 전체를 한 번에 구현한다. Task 7~9에서 핸들러만 채우면 되고 preload는 다시 건드리지 않는다. **`contextBridge`는 렌더러의 격리된 컨텍스트에 객체를 복사해 넣는다** — 함수는 호출 가능한 프록시로 전달되고, 인자와 반환값은 구조화 복제를 거친다. 그래서 클래스 인스턴스나 함수를 인자로 넘길 수 없고, 우리 모델이 전부 평범한 객체인 이유가 이것이다.

- [ ] **Step 4: main 부트스트랩**

```ts
// electron/main.ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createCore } from '@core/index'
import { registerIpc } from './ipc'

function resolveMigrationsDir() {
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(app.getAppPath(), 'drizzle')
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const core = createCore({
    dataDir: app.getPath('userData'),
    migrationsDir: resolveMigrationsDir()
  })
  registerIpc(core)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`nodeIntegration: false`와 `contextIsolation: true`가 규칙 2의 런타임 방어선이다. 마이그레이션 경로가 패키징 여부에 따라 갈리는 것에 주의하라 — `asar` 안에서는 drizzle 폴더를 읽을 수 없어서 `extraResources`로 빼내야 한다(Task 12).

**⚠️ `__dirname` 확인이 필요하다.** `package.json`에 `"type": "module"`이 있으면 electron-vite가 main을 ESM으로 빌드할 수 있고, 순수 ESM에는 `__dirname`이 없다. electron-vite가 shim을 넣어주는 버전도 있어서 동작 여부가 갈린다. **위 코드를 그대로 실행해보고 `__dirname is not defined`가 나오면** 다음으로 바꾼다.

```ts
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// join(__dirname, …) → join(here, …) 로 치환
```

둘 중 어느 쪽이 맞는지는 실행해봐야 안다. 추측하지 말고 `pnpm dev`를 돌려서 확인하라 — 이 한 줄 때문에 창이 아예 안 뜨는 것이 1단계에서 가장 흔한 막힘 지점이다.

- [ ] **Step 5: electron-builder에 마이그레이션 포함**

```yaml
# electron-builder.yml 에 추가
extraResources:
  - from: drizzle
    to: drizzle
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
```

네이티브 모듈은 `asar` 안에서 로드할 수 없다. `asarUnpack` 없이 패키징하면 개발 중에는 되던 앱이 배포판에서만 죽는다.

- [ ] **Step 6: 렌더러에서 호출**

```tsx
// renderer/App.tsx
import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/models'

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.oneDesk.workspaces.list()
      .then(setWorkspaces)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>one-desk</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <p>workspace {workspaces.length}개</p>
      <button onClick={() => {
        window.oneDesk.workspaces.create({ name: `테스트 ${Date.now()}` })
          .then(() => window.oneDesk.workspaces.list())
          .then(setWorkspaces)
      }}>workspace 추가</button>
      <ul>{workspaces.map((w) => <li key={w.id}>{w.name}</li>)}</ul>
    </div>
  )
}
```

- [ ] **Step 7: 종단 확인**

Run: `pnpm dev`
Expected: 창이 뜨고 "workspace 0개"가 보인다. **"workspace 추가"를 누르면 목록에 항목이 늘어난다. 앱을 껐다 켜도 그 항목이 남아 있다.** 남아 있지 않으면 DB가 인메모리로 열렸거나 마이그레이션 경로가 틀린 것이다.

`app.getPath('userData')` 아래에 `one-desk.db` 파일이 실제로 생겼는지도 확인한다.

```bash
ls -la ~/Library/Application\ Support/one-desk/
```

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: wire renderer to sqlite through preload and ipc"
```

---

## Task 7: RepoRepository와 IPC

**Files:**
- Create: `core/db/repositories/repo.ts`, `core/db/repositories/repo.test.ts`, `electron/ipc/repos.ts`
- Modify: `core/index.ts`, `electron/ipc/index.ts`

**Interfaces:**
- Consumes: `Database`, `schema.repo`, `CHANNELS`
- Produces: `createRepoRepository(db): { list, create, remove }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// core/db/repositories/repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import type { Database } from '../open'

describe('RepoRepository', () => {
  let db: Database
  let repos: ReturnType<typeof createRepoRepository>
  let workspaceId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    repos = createRepoRepository(db)
  })

  it('workspace에 속한 repo만 반환한다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' })
    repos.create({ workspaceId, name: 'api-server', path: '/tmp/api' })
    repos.create({ workspaceId: other.id, name: '남의것', path: '/tmp/x' })

    const list = repos.list(workspaceId)
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('api-server')
  })

  it('sortOrder, name 순으로 정렬한다', () => {
    repos.create({ workspaceId, name: 'zulu', path: '/tmp/z' })
    repos.create({ workspaceId, name: 'alpha', path: '/tmp/a' })
    expect(repos.list(workspaceId).map((r) => r.name)).toEqual(['alpha', 'zulu'])
  })

  it('workspace를 지우면 repo도 함께 사라진다', () => {
    repos.create({ workspaceId, name: 'api-server', path: '/tmp/api' })
    createWorkspaceRepository(db).remove(workspaceId)
    expect(repos.list(workspaceId)).toHaveLength(0)
  })
})
```

세 번째 테스트가 Task 4에서 켠 외래키 제약이 실제로 동작하는지를 확인한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- core/db/repositories/repo.test.ts`
Expected: FAIL — `Cannot find module './repo'`

- [ ] **Step 3: 구현**

```ts
// core/db/repositories/repo.ts
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { repo } from '../schema'
import type { Repo, CreateRepoInput } from '@shared/models'

export function createRepoRepository(db: Database) {
  return {
    list(workspaceId: string): Repo[] {
      return db.select().from(repo)
        .where(eq(repo.workspaceId, workspaceId))
        .orderBy(asc(repo.sortOrder), asc(repo.name))
        .all()
    },

    create(input: CreateRepoInput): Repo {
      const [row] = db.insert(repo).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        path: input.path,
        description: input.description ?? null
      }).returning().all()
      if (!row) throw new Error('repo 생성에 실패했습니다')
      return row
    },

    remove(id: string): void {
      db.delete(repo).where(eq(repo.id, id)).run()
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- core/db/repositories/repo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: core와 IPC에 연결**

```ts
// core/index.ts — createCore의 return에 추가
import { createRepoRepository } from './db/repositories/repo'
// ...
  return {
    workspaces: createWorkspaceRepository(db),
    repos: createRepoRepository(db)
  }
```

```ts
// electron/ipc/repos.ts
import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateRepoInput } from '@shared/models'

export function registerRepoHandlers(core: Core) {
  ipcMain.handle(CHANNELS.reposList, (_e, workspaceId: string) =>
    core.repos.list(workspaceId))
  ipcMain.handle(CHANNELS.reposCreate, (_e, input: CreateRepoInput) =>
    core.repos.create(input))
  ipcMain.handle(CHANNELS.reposRemove, (_e, id: string) =>
    core.repos.remove(id))
}
```

`electron/ipc/index.ts`의 `registerIpc`에 `registerRepoHandlers(core)`를 추가한다.

- [ ] **Step 6: 커밋**

```bash
pnpm test && pnpm typecheck
git add -A
git commit -m "feat: add repo repository and ipc handlers"
```

---

## Task 8: IssueRepository — N:M 태그와 공통 항목 필터

가장 까다로운 리포지토리다. 설계 §9의 "repo 필터는 공통 항목도 함께 보여준다"는 규칙이 여기 구현된다.

**Files:**
- Create: `core/db/repositories/issue.ts`, `core/db/repositories/issue.test.ts`, `electron/ipc/issues.ts`
- Modify: `core/index.ts`, `electron/ipc/index.ts`

**Interfaces:**
- Consumes: `Database`, `schema.issue`, `schema.issueRepo`
- Produces: `createIssueRepository(db): { list, create, update, remove }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// core/db/repositories/issue.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createIssueRepository } from './issue'
import type { Database } from '../open'

describe('IssueRepository', () => {
  let db: Database
  let issues: ReturnType<typeof createIssueRepository>
  let workspaceId: string
  let apiRepoId: string
  let webRepoId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const repos = createRepoRepository(db)
    apiRepoId = repos.create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    webRepoId = repos.create({ workspaceId, name: 'web', path: '/tmp/web' }).id
    issues = createIssueRepository(db)
  })

  it('생성 시 repoIds를 함께 저장하고 다시 읽어온다', () => {
    const created = issues.create({
      workspaceId, title: '토큰 버그', repoIds: [apiRepoId, webRepoId]
    })
    expect(created.repoIds.sort()).toEqual([apiRepoId, webRepoId].sort())

    const [fetched] = issues.list({ workspaceId })
    expect(fetched?.repoIds.sort()).toEqual([apiRepoId, webRepoId].sort())
  })

  it('repo 필터는 그 repo의 항목과 태그 없는 공통 항목을 함께 반환한다', () => {
    issues.create({ workspaceId, title: 'api 전용', repoIds: [apiRepoId] })
    issues.create({ workspaceId, title: 'web 전용', repoIds: [webRepoId] })
    issues.create({ workspaceId, title: '공통', repoIds: [] })

    const titles = issues.list({ workspaceId, repoId: apiRepoId })
      .map((i) => i.title).sort()
    expect(titles).toEqual(['api 전용', '공통'])
  })

  it('status를 done으로 바꾸면 closedAt이 채워진다', () => {
    const created = issues.create({ workspaceId, title: '끝낼것' })
    expect(created.closedAt).toBeNull()

    const updated = issues.update({ id: created.id, status: 'done' })
    expect(updated.status).toBe('done')
    expect(updated.closedAt).toBeTypeOf('number')
  })

  it('done에서 open으로 되돌리면 closedAt이 지워진다', () => {
    const created = issues.create({ workspaceId, title: '되돌릴것' })
    issues.update({ id: created.id, status: 'done' })
    const reopened = issues.update({ id: created.id, status: 'open' })
    expect(reopened.closedAt).toBeNull()
  })

  it('repoIds를 갱신하면 기존 태그를 대체한다', () => {
    const created = issues.create({ workspaceId, title: 'x', repoIds: [apiRepoId] })
    const updated = issues.update({ id: created.id, repoIds: [webRepoId] })
    expect(updated.repoIds).toEqual([webRepoId])
  })
})
```

두 번째 테스트가 설계 §9의 규칙이다. `innerJoin`으로 짜면 공통 항목이 사라져서 이 테스트가 실패한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- core/db/repositories/issue.test.ts`
Expected: FAIL — `Cannot find module './issue'`

- [ ] **Step 3: 구현**

```ts
// core/db/repositories/issue.ts
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm'
import type { Database } from '../open'
import { issue, issueRepo } from '../schema'
import type { Issue, CreateIssueInput, UpdateIssueInput, ListQuery } from '@shared/models'

export function createIssueRepository(db: Database) {
  /** 여러 이슈의 repoIds를 한 번의 쿼리로 모아온다 (N+1 방지). */
  function loadRepoIds(issueIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (issueIds.length === 0) return map
    const rows = db.select().from(issueRepo)
      .where(inArray(issueRepo.issueId, issueIds)).all()
    for (const row of rows) {
      const list = map.get(row.issueId) ?? []
      list.push(row.repoId)
      map.set(row.issueId, list)
    }
    return map
  }

  function replaceTags(issueId: string, repoIds: string[]) {
    db.delete(issueRepo).where(eq(issueRepo.issueId, issueId)).run()
    if (repoIds.length > 0) {
      db.insert(issueRepo).values(repoIds.map((repoId) => ({ issueId, repoId }))).run()
    }
  }

  function getById(id: string): Issue {
    const row = db.select().from(issue).where(eq(issue.id, id)).get()
    if (!row) throw new Error(`이슈를 찾을 수 없습니다: ${id}`)
    return { ...row, repoIds: loadRepoIds([id]).get(id) ?? [] }
  }

  return {
    list(query: ListQuery): Issue[] {
      // repo 필터: 그 repo에 태그된 것 + 어디에도 태그되지 않은 공통 항목 (설계 §9)
      const taggedWithRepo = db.select({ id: issueRepo.issueId }).from(issueRepo)
        .where(eq(issueRepo.repoId, query.repoId ?? ''))
      const taggedWithAny = db.select({ id: issueRepo.issueId }).from(issueRepo)

      const where = query.repoId
        ? and(
            eq(issue.workspaceId, query.workspaceId),
            or(inArray(issue.id, taggedWithRepo), notInArray(issue.id, taggedWithAny))
          )
        : eq(issue.workspaceId, query.workspaceId)

      const rows = db.select().from(issue).where(where)
        .orderBy(desc(issue.updatedAt)).all()

      const tagMap = loadRepoIds(rows.map((r) => r.id))
      return rows.map((r) => ({ ...r, repoIds: tagMap.get(r.id) ?? [] }))
    },

    create(input: CreateIssueInput): Issue {
      const id = randomUUID()
      db.insert(issue).values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body ?? ''
      }).run()
      replaceTags(id, input.repoIds ?? [])
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

      db.update(issue).set(patch).where(eq(issue.id, input.id)).run()
      if (input.repoIds !== undefined) replaceTags(input.id, input.repoIds)
      return getById(input.id)
    },

    remove(id: string): void {
      db.delete(issue).where(eq(issue.id, id)).run()
    }
  }
}
```

`closedAt`을 `status`에서 파생시키는 것이 핵심이다. 호출자가 둘을 따로 넘기게 하면 "done인데 closedAt이 없는" 행이 언젠가 반드시 생긴다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- core/db/repositories/issue.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: core와 IPC에 연결**

```ts
// electron/ipc/issues.ts
import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateIssueInput, UpdateIssueInput, ListQuery } from '@shared/models'

export function registerIssueHandlers(core: Core) {
  ipcMain.handle(CHANNELS.issuesList, (_e, q: ListQuery) => core.issues.list(q))
  ipcMain.handle(CHANNELS.issuesCreate, (_e, i: CreateIssueInput) => core.issues.create(i))
  ipcMain.handle(CHANNELS.issuesUpdate, (_e, i: UpdateIssueInput) => core.issues.update(i))
  ipcMain.handle(CHANNELS.issuesRemove, (_e, id: string) => core.issues.remove(id))
}
```

`core/index.ts`의 `createCore` 반환에 `issues: createIssueRepository(db)`를, `registerIpc`에 `registerIssueHandlers(core)`를 추가한다.

- [ ] **Step 6: 커밋**

```bash
pnpm test && pnpm typecheck
git add -A
git commit -m "feat: add issue repository with repo tags and common-item filter"
```

---

## Task 9: MemoRepository와 IPC

Issue와 같은 구조에서 `status`/`closedAt`만 빠진다. **Task 8의 코드를 재사용하지 말고 별도로 작성한다** — 지금은 비슷해 보이지만 이슈에는 앞으로 상태 전이와 run 연결이 붙고 메모에는 안 붙는다. 성급하게 추상화하면 그때 되돌리는 비용이 더 크다.

**Files:**
- Create: `core/db/repositories/memo.ts`, `core/db/repositories/memo.test.ts`, `electron/ipc/memos.ts`
- Modify: `core/index.ts`, `electron/ipc/index.ts`

**Interfaces:**
- Produces: `createMemoRepository(db): { list, create, update, remove }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// core/db/repositories/memo.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import { createRepoRepository } from './repo'
import { createMemoRepository } from './memo'
import type { Database } from '../open'

describe('MemoRepository', () => {
  let db: Database
  let memos: ReturnType<typeof createMemoRepository>
  let workspaceId: string
  let apiRepoId: string

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    apiRepoId = createRepoRepository(db)
      .create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    memos = createMemoRepository(db)
  })

  it('repoIds와 함께 저장하고 읽어온다', () => {
    const created = memos.create({
      workspaceId, title: '배포 절차', body: '내용', repoIds: [apiRepoId]
    })
    expect(created.repoIds).toEqual([apiRepoId])
    expect(created.body).toBe('내용')
  })

  it('repo 필터는 공통 메모도 함께 반환한다', () => {
    memos.create({ workspaceId, title: 'api 메모', repoIds: [apiRepoId] })
    memos.create({ workspaceId, title: '공통 메모', repoIds: [] })
    const titles = memos.list({ workspaceId, repoId: apiRepoId })
      .map((m) => m.title).sort()
    expect(titles).toEqual(['api 메모', '공통 메모'])
  })

  it('제목을 수정하면 updatedAt이 커진다', async () => {
    const created = memos.create({ workspaceId, title: '전' })
    await new Promise((r) => setTimeout(r, 5))
    const updated = memos.update({ id: created.id, title: '후' })
    expect(updated.title).toBe('후')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- core/db/repositories/memo.test.ts`
Expected: FAIL — `Cannot find module './memo'`

- [ ] **Step 3: 구현**

```ts
// core/db/repositories/memo.ts
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm'
import type { Database } from '../open'
import { memo, memoRepo } from '../schema'
import type { Memo, CreateMemoInput, UpdateMemoInput, ListQuery } from '@shared/models'

export function createMemoRepository(db: Database) {
  function loadRepoIds(memoIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (memoIds.length === 0) return map
    const rows = db.select().from(memoRepo)
      .where(inArray(memoRepo.memoId, memoIds)).all()
    for (const row of rows) {
      const list = map.get(row.memoId) ?? []
      list.push(row.repoId)
      map.set(row.memoId, list)
    }
    return map
  }

  function replaceTags(memoId: string, repoIds: string[]) {
    db.delete(memoRepo).where(eq(memoRepo.memoId, memoId)).run()
    if (repoIds.length > 0) {
      db.insert(memoRepo).values(repoIds.map((repoId) => ({ memoId, repoId }))).run()
    }
  }

  function getById(id: string): Memo {
    const row = db.select().from(memo).where(eq(memo.id, id)).get()
    if (!row) throw new Error(`메모를 찾을 수 없습니다: ${id}`)
    return { ...row, repoIds: loadRepoIds([id]).get(id) ?? [] }
  }

  return {
    list(query: ListQuery): Memo[] {
      const taggedWithRepo = db.select({ id: memoRepo.memoId }).from(memoRepo)
        .where(eq(memoRepo.repoId, query.repoId ?? ''))
      const taggedWithAny = db.select({ id: memoRepo.memoId }).from(memoRepo)

      const where = query.repoId
        ? and(
            eq(memo.workspaceId, query.workspaceId),
            or(inArray(memo.id, taggedWithRepo), notInArray(memo.id, taggedWithAny))
          )
        : eq(memo.workspaceId, query.workspaceId)

      const rows = db.select().from(memo).where(where)
        .orderBy(desc(memo.updatedAt)).all()
      const tagMap = loadRepoIds(rows.map((r) => r.id))
      return rows.map((r) => ({ ...r, repoIds: tagMap.get(r.id) ?? [] }))
    },

    create(input: CreateMemoInput): Memo {
      const id = randomUUID()
      db.insert(memo).values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body ?? ''
      }).run()
      replaceTags(id, input.repoIds ?? [])
      return getById(id)
    },

    update(input: UpdateMemoInput): Memo {
      const patch: Record<string, unknown> = { updatedAt: Date.now() }
      if (input.title !== undefined) patch['title'] = input.title
      if (input.body !== undefined) patch['body'] = input.body
      db.update(memo).set(patch).where(eq(memo.id, input.id)).run()
      if (input.repoIds !== undefined) replaceTags(input.id, input.repoIds)
      return getById(input.id)
    },

    remove(id: string): void {
      db.delete(memo).where(eq(memo.id, id)).run()
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- core/db/repositories/memo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: core와 IPC에 연결**

```ts
// electron/ipc/memos.ts
import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { CreateMemoInput, UpdateMemoInput, ListQuery } from '@shared/models'

export function registerMemoHandlers(core: Core) {
  ipcMain.handle(CHANNELS.memosList, (_e, q: ListQuery) => core.memos.list(q))
  ipcMain.handle(CHANNELS.memosCreate, (_e, i: CreateMemoInput) => core.memos.create(i))
  ipcMain.handle(CHANNELS.memosUpdate, (_e, i: UpdateMemoInput) => core.memos.update(i))
  ipcMain.handle(CHANNELS.memosRemove, (_e, id: string) => core.memos.remove(id))
}
```

`createCore`에 `memos: createMemoRepository(db)`, `registerIpc`에 `registerMemoHandlers(core)`를 추가한다. **이제 `Core`가 `OneDeskClient`의 네 도메인을 모두 채운다.**

- [ ] **Step 6: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: add memo repository and complete ipc surface"
```

---

## Task 10: ClientProvider와 사이드바

렌더러가 `window.oneDesk`를 직접 부르지 않고 Context를 통해 받게 만든다. 테스트에서 목으로 바꿔 끼우기 위해서다.

**Files:**
- Create: `renderer/client/ClientProvider.tsx`, `renderer/hooks/useWorkspaces.ts`, `renderer/components/Sidebar.tsx`, `renderer/components/Sidebar.test.tsx`
- Modify: `renderer/App.tsx`, `renderer/main.tsx`

**Interfaces:**
- Consumes: `OneDeskClient`
- Produces: `<ClientProvider client>`, `useClient()`, `useWorkspaces()`

- [ ] **Step 1: Provider**

```tsx
// renderer/client/ClientProvider.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { OneDeskClient } from '@shared/client'

const ClientContext = createContext<OneDeskClient | null>(null)

export function ClientProvider({ client, children }: {
  client: OneDeskClient
  children: ReactNode
}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function useClient(): OneDeskClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('ClientProvider 안에서만 사용할 수 있습니다')
  return client
}
```

`window.oneDesk`를 컴포넌트에서 직접 참조하면 렌더링 테스트를 할 때마다 전역을 조작해야 하고, 나중에 전송 계층을 바꿀 때 참조 지점을 전부 찾아다녀야 한다. **주입 지점을 하나로 두는 것이 요점이다.**

- [ ] **Step 2: 조회 훅**

```ts
// renderer/hooks/useWorkspaces.ts
import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Workspace } from '@shared/models'

export function useWorkspaces() {
  const client = useClient()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setWorkspaces(await client.workspaces.list())
    setLoading(false)
  }, [client])

  useEffect(() => { void refresh() }, [refresh])

  return { workspaces, loading, refresh }
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

```tsx
// renderer/components/Sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { Sidebar } from './Sidebar'
import type { OneDeskClient } from '@shared/client'
import type { Workspace } from '@shared/models'

function makeWorkspace(name: string, id: string): Workspace {
  return {
    id, name, description: null,
    defaultAgentKind: 'claude-code',
    defaultModelClaude: null, defaultModelOpencode: null,
    defaultPermission: 'edit',
    claudePath: null, opencodePath: null,
    createdAt: 0, updatedAt: 0
  }
}

function makeClient(workspaces: Workspace[]): OneDeskClient {
  return {
    workspaces: { list: vi.fn().mockResolvedValue(workspaces), create: vi.fn(), remove: vi.fn() },
    repos: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    issues: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    memos: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }
  } as unknown as OneDeskClient
}

describe('Sidebar', () => {
  it('workspace 목록을 보여준다', async () => {
    const client = makeClient([makeWorkspace('사내 플랫폼', 'w1'), makeWorkspace('one-desk', 'w2')])
    render(
      <ClientProvider client={client}>
        <Sidebar selectedId={null} onSelect={vi.fn()} />
      </ClientProvider>
    )
    expect(await screen.findByText('사내 플랫폼')).toBeTruthy()
    expect(screen.getByText('one-desk')).toBeTruthy()
  })

  it('workspace를 클릭하면 onSelect가 그 id로 불린다', async () => {
    const onSelect = vi.fn()
    const client = makeClient([makeWorkspace('사내 플랫폼', 'w1')])
    render(
      <ClientProvider client={client}>
        <Sidebar selectedId={null} onSelect={onSelect} />
      </ClientProvider>
    )
    await userEvent.click(await screen.findByText('사내 플랫폼'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('w1'))
  })
})
```

테스트 의존성을 추가한다:

```bash
pnpm add -D @testing-library/react@16.1.0 @testing-library/user-event@14.5.2
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm test -- renderer/components/Sidebar.test.tsx`
Expected: FAIL — `Cannot find module './Sidebar'`

- [ ] **Step 5: 구현**

```tsx
// renderer/components/Sidebar.tsx
import { useWorkspaces } from '../hooks/useWorkspaces'

export function Sidebar({ selectedId, onSelect }: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { workspaces, loading } = useWorkspaces()

  return (
    <nav className="sidebar">
      <div className="sidebar-label">Workspaces</div>
      {loading && <div className="sidebar-empty">불러오는 중…</div>}
      {!loading && workspaces.length === 0 && (
        <div className="sidebar-empty">workspace가 없습니다</div>
      )}
      <ul>
        {workspaces.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              className={w.id === selectedId ? 'ws ws-selected' : 'ws'}
              onClick={() => onSelect(w.id)}
            >
              {w.name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm test -- renderer/components/Sidebar.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 7: main.tsx에서 실제 클라이언트 주입**

```tsx
// renderer/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientProvider } from './client/ClientProvider'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider client={window.oneDesk}>
      <App />
    </ClientProvider>
  </StrictMode>
)
```

**`window.oneDesk`를 참조하는 곳은 이 한 줄뿐이다.**

- [ ] **Step 8: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: inject OneDeskClient via context and add workspace sidebar"
```

---

## Task 11: repo 스트립과 3컬럼 레이아웃

설계 §9의 화면을 완성한다.

**Files:**
- Create: `renderer/components/RepoStrip.tsx`, `renderer/components/Panel.tsx`, `renderer/components/IssuePanel.tsx`, `renderer/components/MemoPanel.tsx`, `renderer/components/AssetPanel.tsx`
- Create: `renderer/hooks/useRepos.ts`, `renderer/hooks/useIssues.ts`, `renderer/hooks/useMemos.ts`
- Create: `renderer/components/RepoStrip.test.tsx`
- Modify: `renderer/App.tsx`, `renderer/index.css`

**Interfaces:**
- Consumes: `useClient()`, `Repo`, `Issue`, `Memo`
- Produces: `<RepoStrip>`, `<Panel>`, `<IssuePanel>`, `<MemoPanel>`, `<AssetPanel>`

- [ ] **Step 1: 조회 훅 3개**

```ts
// renderer/hooks/useRepos.ts
import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Repo } from '@shared/models'

export function useRepos(workspaceId: string | null) {
  const client = useClient()
  const [repos, setRepos] = useState<Repo[]>([])

  const refresh = useCallback(async () => {
    if (!workspaceId) { setRepos([]); return }
    setRepos(await client.repos.list(workspaceId))
  }, [client, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  return { repos, refresh }
}
```

```ts
// renderer/hooks/useIssues.ts
import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Issue } from '@shared/models'

export function useIssues(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [issues, setIssues] = useState<Issue[]>([])

  const refresh = useCallback(async () => {
    if (!workspaceId) { setIssues([]); return }
    setIssues(await client.issues.list({
      workspaceId,
      ...(repoId ? { repoId } : {})
    }))
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])
  return { issues, refresh }
}
```

```ts
// renderer/hooks/useMemos.ts
import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Memo } from '@shared/models'

export function useMemos(workspaceId: string | null, repoId: string | null) {
  const client = useClient()
  const [memos, setMemos] = useState<Memo[]>([])

  const refresh = useCallback(async () => {
    if (!workspaceId) { setMemos([]); return }
    setMemos(await client.memos.list({
      workspaceId,
      ...(repoId ? { repoId } : {})
    }))
  }, [client, workspaceId, repoId])

  useEffect(() => { void refresh() }, [refresh])
  return { memos, refresh }
}
```

`repoId`를 조건부 스프레드로 넣는 이유는 `exactOptionalPropertyTypes` 없이도 `undefined`가 IPC 구조화 복제를 타고 넘어가지 않게 하기 위해서다. `{ repoId: undefined }`를 넘기면 main 쪽에서 `query.repoId`가 존재하는 것으로 읽힐 여지가 생긴다.

- [ ] **Step 2: 실패하는 테스트 작성**

```tsx
// renderer/components/RepoStrip.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { RepoStrip } from './RepoStrip'
import type { OneDeskClient } from '@shared/client'
import type { Repo } from '@shared/models'

const repos: Repo[] = [
  { id: 'r1', workspaceId: 'w1', name: 'api-server', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 },
  { id: 'r2', workspaceId: 'w1', name: 'web-client', path: '/tmp/web', description: null, sortOrder: 0, createdAt: 0 }
]

const client = {
  repos: { list: vi.fn().mockResolvedValue(repos), create: vi.fn(), remove: vi.fn() }
} as unknown as OneDeskClient

describe('RepoStrip', () => {
  it('repo 카드를 모두 보여준다', async () => {
    render(
      <ClientProvider client={client}>
        <RepoStrip workspaceId="w1" selectedRepoId={null} onSelect={vi.fn()} />
      </ClientProvider>
    )
    expect(await screen.findByText('api-server')).toBeTruthy()
    expect(screen.getByText('web-client')).toBeTruthy()
  })

  it('선택된 repo를 다시 클릭하면 선택이 해제된다', async () => {
    const onSelect = vi.fn()
    render(
      <ClientProvider client={client}>
        <RepoStrip workspaceId="w1" selectedRepoId="r1" onSelect={onSelect} />
      </ClientProvider>
    )
    await userEvent.click(await screen.findByText('api-server'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
  })
})
```

두 번째 테스트가 중요하다. repo 필터를 켰다가 **끄는 방법이 없으면 사용자가 갇힌다.** 같은 카드를 다시 누르면 전체 보기로 돌아온다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test -- renderer/components/RepoStrip.test.tsx`
Expected: FAIL — `Cannot find module './RepoStrip'`

- [ ] **Step 4: 구현**

```tsx
// renderer/components/RepoStrip.tsx
import { useRepos } from '../hooks/useRepos'

export function RepoStrip({ workspaceId, selectedRepoId, onSelect }: {
  workspaceId: string
  selectedRepoId: string | null
  onSelect: (repoId: string | null) => void
}) {
  const { repos } = useRepos(workspaceId)

  return (
    <div className="repo-strip">
      {repos.map((r) => (
        <button
          key={r.id}
          type="button"
          className={r.id === selectedRepoId ? 'repo-card repo-card-selected' : 'repo-card'}
          onClick={() => onSelect(r.id === selectedRepoId ? null : r.id)}
        >
          <span className="repo-name">{r.name}</span>
          <span className="repo-path">{r.path}</span>
        </button>
      ))}
      {repos.length === 0 && <div className="repo-empty">등록된 repo가 없습니다</div>}
    </div>
  )
}
```

```tsx
// renderer/components/Panel.tsx
import type { ReactNode } from 'react'

export function Panel({ title, action, children }: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
```

```tsx
// renderer/components/IssuePanel.tsx
import { Panel } from './Panel'
import { useIssues } from '../hooks/useIssues'

export function IssuePanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const { issues } = useIssues(workspaceId, repoId)

  return (
    <Panel title="Issues">
      {issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}
      <ul className="item-list">
        {issues.map((i) => (
          <li key={i.id} className="item">
            <span className="item-title">{i.title}</span>
            <span className={`status status-${i.status}`}>{i.status}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
```

```tsx
// renderer/components/MemoPanel.tsx
import { Panel } from './Panel'
import { useMemos } from '../hooks/useMemos'

export function MemoPanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const { memos } = useMemos(workspaceId, repoId)

  return (
    <Panel title="Memos">
      {memos.length === 0 && <div className="panel-empty">메모가 없습니다</div>}
      <ul className="item-list">
        {memos.map((m) => (
          <li key={m.id} className="item">
            <span className="item-title">{m.title}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
```

`AssetPanel.tsx`는 1단계에서 빈 상태만 보여준다:

```tsx
// renderer/components/AssetPanel.tsx
import { Panel } from './Panel'

export function AssetPanel() {
  return (
    <Panel title="Skills / Agents">
      <div className="panel-empty">5단계에서 추가됩니다</div>
    </Panel>
  )
}
```

- [ ] **Step 5: App 조립**

```tsx
// renderer/App.tsx
import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { RepoStrip } from './components/RepoStrip'
import { IssuePanel } from './components/IssuePanel'
import { MemoPanel } from './components/MemoPanel'
import { AssetPanel } from './components/AssetPanel'

export default function App() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)

  function selectWorkspace(id: string) {
    setWorkspaceId(id)
    setRepoId(null)   // workspace가 바뀌면 이전 repo 필터는 무의미하다
  }

  return (
    <div className="app">
      <Sidebar selectedId={workspaceId} onSelect={selectWorkspace} />
      <main className="main">
        {!workspaceId && <div className="blank">왼쪽에서 workspace를 선택하세요</div>}
        {workspaceId && (
          <>
            <RepoStrip workspaceId={workspaceId} selectedRepoId={repoId} onSelect={setRepoId} />
            <div className="columns">
              <IssuePanel workspaceId={workspaceId} repoId={repoId} />
              <MemoPanel workspaceId={workspaceId} repoId={repoId} />
              <AssetPanel />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
```

`selectWorkspace`에서 `repoId`를 비우는 것을 빠뜨리면, workspace를 바꿔도 남의 repo 필터가 걸린 채로 빈 목록이 보인다.

- [ ] **Step 6: 스타일**

```css
/* renderer/index.css 에 추가 */
.app { display: flex; height: 100vh; font-family: system-ui, sans-serif; }
.sidebar { flex: 0 0 180px; background: #f4f4f5; border-right: 1px solid #e4e4e7; padding: 12px 10px; }
.sidebar-label { font-size: 10px; letter-spacing: .07em; text-transform: uppercase; opacity: .55; font-weight: 700; margin-bottom: 8px; }
.sidebar ul { list-style: none; margin: 0; padding: 0; }
.ws { display: block; width: 100%; text-align: left; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; font-size: 13px; }
.ws:hover { background: #e4e4e7; }
.ws-selected { background: #dbeafe; font-weight: 700; }
.main { flex: 1; display: flex; flex-direction: column; padding: 12px; gap: 10px; min-width: 0; }
.repo-strip { display: flex; gap: 8px; }
.repo-card { flex: 1; text-align: left; padding: 8px 11px; border: 1px solid #e4e4e7; border-radius: 7px; background: #fafafa; cursor: pointer; }
.repo-card-selected { border-color: #60a5fa; background: #eff6ff; }
.repo-name { display: block; font-weight: 600; font-size: 13px; }
.repo-path { display: block; font-family: ui-monospace, monospace; font-size: 10px; opacity: .55; }
.columns { flex: 1; display: flex; gap: 8px; min-height: 0; }
.panel { flex: 1; display: flex; flex-direction: column; border: 1px solid #e4e4e7; border-radius: 7px; background: #fafafa; min-width: 0; }
.panel-header { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-bottom: 1px solid #e4e4e7; }
.panel-title { font-size: 10px; letter-spacing: .07em; text-transform: uppercase; opacity: .58; font-weight: 700; }
.panel-body { flex: 1; overflow-y: auto; padding: 7px; }
.panel-empty, .repo-empty, .sidebar-empty, .blank { font-size: 12px; opacity: .5; padding: 10px; }
.item-list { list-style: none; margin: 0; padding: 0; }
.item { display: flex; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 5px; margin-bottom: 3px; background: #f4f4f5; font-size: 13px; }
.item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { font-size: 10px; padding: 1px 7px; border-radius: 9px; background: #e4e4e7; flex: 0 0 auto; }
.status-doing { background: #fef3c7; }
.status-done { background: #d1fae5; }
```

- [ ] **Step 7: 테스트와 화면 확인**

Run: `pnpm test && pnpm dev`
Expected: 테스트가 모두 통과하고, 앱에서 workspace를 고르면 repo 스트립과 3컬럼이 보인다. repo 카드를 클릭하면 이슈/메모가 필터링되고, 다시 클릭하면 전체로 돌아온다.

- [ ] **Step 8: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: add repo strip and three-column workspace layout"
```

---

## Task 12: 생성 폼과 패키징 확인

데이터를 넣을 수단을 만들고, 배포 가능한 형태로 묶이는지 확인한다.

**Files:**
- Create: `renderer/components/AddForm.tsx`
- Modify: `renderer/components/Sidebar.tsx`, `RepoStrip.tsx`, `IssuePanel.tsx`, `MemoPanel.tsx`
- Modify: `electron-builder.yml`

- [ ] **Step 1: 공통 입력 폼**

```tsx
// renderer/components/AddForm.tsx
import { useState, type FormEvent } from 'react'

export function AddForm({ placeholder, onSubmit }: {
  placeholder: string
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onSubmit(trimmed)
      setValue('')
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
    </form>
  )
}
```

`busy` 가드가 있어야 엔터를 연타했을 때 같은 항목이 여러 개 생기지 않는다.

- [ ] **Step 2: 각 패널에 연결**

`IssuePanel`을 예로 든다. 나머지도 같은 방식이다.

```tsx
// renderer/components/IssuePanel.tsx — 수정
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { useIssues } from '../hooks/useIssues'
import { useClient } from '../client/ClientProvider'

export function IssuePanel({ workspaceId, repoId }: {
  workspaceId: string
  repoId: string | null
}) {
  const client = useClient()
  const { issues, refresh } = useIssues(workspaceId, repoId)

  async function addIssue(title: string) {
    await client.issues.create({
      workspaceId,
      title,
      repoIds: repoId ? [repoId] : []
    })
    await refresh()
  }

  return (
    <Panel title="Issues">
      <AddForm placeholder="새 이슈 제목…" onSubmit={addIssue} />
      {issues.length === 0 && <div className="panel-empty">이슈가 없습니다</div>}
      <ul className="item-list">
        {issues.map((i) => (
          <li key={i.id} className="item">
            <span className="item-title">{i.title}</span>
            <button
              type="button"
              className={`status status-${i.status}`}
              onClick={async () => {
                const next = i.status === 'open' ? 'doing' : i.status === 'doing' ? 'done' : 'open'
                await client.issues.update({ id: i.id, status: next })
                await refresh()
              }}
            >
              {i.status}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
```

**repo 필터가 켜진 상태에서 만든 이슈는 그 repo에 자동으로 태그된다.** 그렇게 하지 않으면 방금 만든 항목이 현재 필터에서 사라져 보여서 사용자가 혼란스러워진다.

`MemoPanel`에도 같은 방식으로 `AddForm`을 붙인다 — `client.memos.create({ workspaceId, title, repoIds: repoId ? [repoId] : [] })`를 부르고 `refresh()`한다. 상태 배지가 없으므로 이슈보다 단순하다.

`RepoStrip`은 이름과 경로 두 칸이 필요해서 `AddForm`을 쓸 수 없다. 별도 폼을 만든다:

```tsx
// renderer/components/AddRepoForm.tsx
import { useState, type FormEvent } from 'react'
import { useClient } from '../client/ClientProvider'

export function AddRepoForm({ workspaceId, onAdded }: {
  workspaceId: string
  onAdded: () => Promise<void>
}) {
  const client = useClient()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !path.trim() || busy) return
    setBusy(true)
    try {
      await client.repos.create({ workspaceId, name: name.trim(), path: path.trim() })
      setName('')
      setPath('')
      await onAdded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="add-repo-form">
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="repo 이름" disabled={busy} />
      <input value={path} onChange={(e) => setPath(e.target.value)}
        placeholder="/절대/경로" disabled={busy} />
      <button type="submit" disabled={busy}>추가</button>
    </form>
  )
}
```

`RepoStrip`에서 `useRepos`의 `refresh`를 `onAdded`로 넘겨 연결한다. 경로는 나중에 디렉토리 선택 다이얼로그(`dialog.showOpenDialog`)로 바꾸되, 그건 IPC 채널이 하나 더 필요하므로 1단계에서는 텍스트 입력으로 둔다.

- [ ] **Step 3: 스타일 추가**

```css
.add-form { margin-bottom: 7px; }
.add-form input { width: 100%; padding: 6px 9px; border: 1px solid #e4e4e7; border-radius: 5px; font-size: 12px; font-family: inherit; }
.add-form input:disabled { opacity: .5; }
button.status { border: 0; cursor: pointer; font-family: inherit; }
```

- [ ] **Step 4: 손으로 전체 흐름 확인**

Run: `pnpm dev`

순서대로 확인한다:
1. workspace를 만들고 선택한다
2. repo를 두 개 등록한다
3. 이슈를 세 개 만든다 — 하나는 repo 필터를 켠 상태에서, 둘은 필터 없이
4. repo 카드를 클릭한다 → 그 repo의 이슈 + 공통 이슈가 보인다
5. 상태 배지를 클릭한다 → `open → doing → done`으로 순환한다
6. 메모도 같은 방식으로 만든다
7. **앱을 완전히 종료했다가 다시 켠다 → 모든 데이터가 남아 있다**

- [ ] **Step 5: 패키징 확인**

```bash
pnpm pack
```

Expected: `dist/` 아래에 앱이 만들어진다. 그 앱을 직접 실행해서 **workspace를 만들 수 있는지** 확인한다.

이 단계가 중요한 이유는 개발 모드에서는 드러나지 않는 두 문제가 여기서만 나타나기 때문이다. `better-sqlite3`가 `asar` 안에 갇혀 로드에 실패하거나, `drizzle/` 마이그레이션 폴더를 못 찾아 앱이 시작하자마자 죽는다. Step 1에서 `asarUnpack`과 `extraResources`를 넣어둔 것이 이 두 가지에 대한 대비다.

실패하면 `electron-builder.yml`을 확인한다:

```yaml
extraResources:
  - from: drizzle
    to: drizzle
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
```

- [ ] **Step 6: 최종 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: add creation forms and verify packaged build"
```

---

## 1단계 완료 기준

아래가 전부 참이어야 2단계로 넘어간다.

- [ ] `pnpm test` — core 리포지토리 테스트와 렌더러 컴포넌트 테스트가 모두 통과
- [ ] `pnpm typecheck` — 통과
- [ ] `pnpm lint` — 통과
- [ ] `renderer/`에서 `@core/*`를 import하면 컴파일 에러가 난다 (Task 1 Step 8로 확인)
- [ ] `core/`에서 `electron`을 import하면 lint 에러가 난다
- [ ] 앱을 껐다 켜도 데이터가 남는다
- [ ] `pnpm pack`으로 만든 **패키징된 앱**에서 workspace를 만들 수 있다
- [ ] `window.oneDesk`를 참조하는 코드가 `renderer/main.tsx` 한 곳뿐이다

마지막 항목이 가장 쉽게 무너진다. 확인:

```bash
grep -rn "window.oneDesk" renderer/ | grep -v "main.tsx"
```

출력이 없어야 한다.

---

## 2단계로 넘길 때 남는 것

1단계는 의도적으로 다음을 만들지 않는다.

- `run` 관련 테이블 — 2단계에서 마이그레이션으로 추가
- `asset` 테이블과 파일 스캔 — 5단계
- 항목 삭제 UI — 리포지토리에 `remove`는 있으나 화면에는 노출하지 않는다. 실수로 지웠을 때 되돌릴 방법이 아직 없어서, 확인 절차를 제대로 설계할 수 있을 때 붙이는 편이 낫다
- 이슈/메모 본문 편집 — 제목과 상태만 다룬다. 본문 편집기는 2단계에서 맥락 조립을 만들 때 함께 설계한다
