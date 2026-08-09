# UI 자동화 드라이버 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 빌드된 Electron 앱을 Playwright로 띄워 실제로 클릭하고, 핵심 한 바퀴(맥락 담기 → 실행 → 로그 → 완료)를 사람 없이 검증한다.

**Architecture:** `pnpm build`로 만든 `out/`을 `_electron.launch`로 띄운다. 앱에는 이음매 둘을 심는다 — `ONE_DESK_USER_DATA`로 데이터 디렉토리를 임시 경로로 돌리고(이때 단일 인스턴스 잠금은 건너뛴다), `ONE_DESK_AGENT_PATH`로 진짜 `claude` 대신 가짜 CLI를 spawn한다. 테스트는 화면만 보고 단언하며 `@core`를 import하지 않는다.

**Tech Stack:** 기존과 동일 — pnpm / TypeScript 5.9.3 / Electron 43.3.0 / Vitest 4.1.10. 추가는 `playwright-core` 하나.

**참조:**
- 설계: `docs/superpowers/specs/2026-08-10-e2e-ui-driver-design.md`
- 앱 전체 설계 §4(경계)·§12(테스트 전략): `docs/superpowers/specs/2026-08-07-one-desk-design.md`

## Global Constraints

- **`core/`는 `electron`을 import하지 않는다.** ESLint가 강제한다.
- **`e2e/`는 `@core`를 import하지 않는다.** 가짜 CLI는 **경로 문자열**로만 가리킨다.
- **`page.evaluate`를 쓰지 않는다.** locator API만 쓴다 (DOM lib 없이 타입이 맞는다).
- **`expect(locator).toBeVisible()` 같은 web-first 단언은 없다.** 러너가 vitest이고 `@playwright/test`를 쓰지 않기 때문이다. 기다릴 때는 `await locator.waitFor({ state: 'visible', timeout })`, 값을 볼 때는 vitest의 `expect(await locator.textContent())`를 쓴다.
- **`_electron.launch`의 `env`는 물려받는 것이 아니라 교체한다.** 항상 `{ ...process.env, ... }`로 넘긴다. `PATH`가 사라지면 preflight가 실패한다.
- **`pnpm test`에 e2e가 섞이면 안 된다.** 기존 개수 **125개**가 그대로여야 한다.
- 들여쓰기 2칸, camelCase 함수명, `verbatimModuleSyntax` (타입 전용 import는 `import type`).
- 주석과 오류 메시지는 한국어.
- 시작 시점: 테스트 125개 통과.

## File Structure

```
e2e/
├─ driver.ts            launchApp() — Electron 실행, 임시 디렉토리, 실패 시 스크린샷
├─ harness.e2e.ts       러너와 빌드 산출물이 살아 있는지 확인하는 최소 테스트
├─ smoke.e2e.ts         드라이버가 앱을 띄우고 격리된 데이터로 뜨는지
└─ core-loop.e2e.ts     핵심 한 바퀴

vitest.e2e.config.ts    e2e 전용 (include: e2e/**/*.e2e.ts)

core/runner/agentPath.ts       실행 파일 경로 우선순위 (환경변수 → workspace → PATH)
core/runner/agentPath.test.ts
core/runner/fixtures.test.ts   가짜 CLI가 실행 가능한 상태인지

수정:
  electron/main.ts                    데이터 디렉토리 교체 + 조건부 잠금
  core/index.ts                       resolveAgentPath 사용
  core/runner/fixtures/fake-claude.mjs shebang, 실행 권한, 지연 옵션
  package.json                        playwright-core, test:e2e
  tsconfig.node.json                  include에 e2e
  .gitignore                          e2e/artifacts/
```

---

## Task 1: 가짜 agent를 환경변수로 주입할 수 있게 한다

앱이 `claude` 대신 가짜 CLI를 실행할 수 있어야 e2e가 결정적이 된다. 설계 §12가 정한 방식이다.

**Files:**
- Create: `core/runner/agentPath.ts`, `core/runner/agentPath.test.ts`, `core/runner/fixtures.test.ts`
- Modify: `core/index.ts`, `core/runner/fixtures/fake-claude.mjs`

**Interfaces:**
- Produces: `resolveAgentPath(agentKind, workspace, env?): string | null`
- Produces: 실행 가능한 `core/runner/fixtures/fake-claude.mjs` (환경변수 `ONE_DESK_FAKE_DELAY_MS` 지원)

- [ ] **Step 1: 실패하는 테스트 작성 — 경로 우선순위**

```ts
// core/runner/agentPath.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAgentPath } from './agentPath'

const ws = { claudePath: '/ws/claude', opencodePath: '/ws/opencode' }

describe('resolveAgentPath', () => {
  it('환경변수가 workspace 설정보다 우선한다', () => {
    expect(resolveAgentPath('claude-code', ws, { ONE_DESK_AGENT_PATH: '/tmp/fake' }))
      .toBe('/tmp/fake')
  })

  it('환경변수가 없으면 workspace의 claudePath를 쓴다', () => {
    expect(resolveAgentPath('claude-code', ws, {})).toBe('/ws/claude')
  })

  it('opencode는 opencodePath를 쓴다', () => {
    expect(resolveAgentPath('opencode', ws, {})).toBe('/ws/opencode')
  })

  it('아무것도 없으면 null이다 — 어댑터가 PATH를 뒤진다', () => {
    expect(resolveAgentPath('claude-code', null, {})).toBeNull()
    expect(resolveAgentPath('claude-code', { claudePath: null, opencodePath: null }, {}))
      .toBeNull()
  })

  it('빈 문자열 환경변수는 없는 것으로 본다', () => {
    // 셸에서 ONE_DESK_AGENT_PATH= 로 지우면 빈 문자열이 들어온다.
    // 이걸 경로로 쓰면 preflight가 빈 경로로 access를 부른다.
    expect(resolveAgentPath('claude-code', ws, { ONE_DESK_AGENT_PATH: '' }))
      .toBe('/ws/claude')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- core/runner/agentPath.test.ts`
Expected: FAIL — `Cannot find module './agentPath'`

- [ ] **Step 3: 구현**

```ts
// core/runner/agentPath.ts
import type { AgentKind, Workspace } from '@shared/models'

type PathSource = Pick<Workspace, 'claudePath' | 'opencodePath'>

/**
 * 어댑터 preflight에 넘길 명시 경로를 고른다.
 * 우선순위: 환경변수 → workspace 설정 → null(어댑터가 PATH를 뒤진다).
 *
 * 환경변수는 e2e가 가짜 CLI를 물리는 통로다. 실행 파일 경로만 바꿀 뿐
 * 권한 플래그는 그대로 적용되므로 새로 생기는 능력은 없다.
 */
export function resolveAgentPath(
  agentKind: AgentKind,
  workspace: PathSource | null,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const override = env['ONE_DESK_AGENT_PATH']
  if (override) return override
  const configured = agentKind === 'claude-code'
    ? workspace?.claudePath
    : workspace?.opencodePath
  return configured ?? null
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- core/runner/agentPath.test.ts`
Expected: PASS (5개)

- [ ] **Step 5: `core/index.ts`가 이 함수를 쓰게 한다**

`resolveExecutable`을 다음으로 바꾼다.

```ts
    resolveExecutable: async (agentKind, workspaceId) => {
      const ws = workspaces.list().find((w) => w.id === workspaceId) ?? null
      return adapters[agentKind].preflight(resolveAgentPath(agentKind, ws))
    },
```

파일 위쪽에 `import { resolveAgentPath } from './runner/agentPath'`를 추가한다.

- [ ] **Step 6: 실패하는 테스트 작성 — 가짜 CLI가 실행 가능한가**

```ts
// core/runner/fixtures.test.ts
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(HERE, 'fixtures/fake-claude.mjs')

describe('fake-claude.mjs', () => {
  it('실행 권한을 갖는다', () => {
    // 앱은 이 파일을 executable로 spawn한다. preflight의 access(X_OK)가 먼저 막는다.
    expect(statSync(FAKE).mode & 0o111).toBeGreaterThan(0)
  })

  it('직접 실행하면 stream-json을 낸다', () => {
    const out = execFileSync(FAKE, [], { input: '', encoding: 'utf8' })
    const lines = out.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'system', subtype: 'init' })
  })

  it('ONE_DESK_FAKE_DELAY_MS만큼 결과를 늦춘다', () => {
    // e2e가 running 상태를 관찰하려면 즉시 끝나면 안 된다.
    const started = Date.now()
    execFileSync(FAKE, [], {
      input: '', encoding: 'utf8',
      env: { ...process.env, ONE_DESK_FAKE_DELAY_MS: '300' }
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm test -- core/runner/fixtures.test.ts`
Expected: FAIL — 실행 권한이 없고(`mode & 0o111`이 0), 지연 옵션도 없다.

- [ ] **Step 8: 픽스처 수정**

`core/runner/fixtures/fake-claude.mjs`의 **첫 줄**에 shebang을 넣는다.

```js
#!/usr/bin/env node
// 인자로 받은 시나리오대로 stream-json을 흉내낸다.
```

`success` 분기를 지연 가능하게 바꾼다. 파일 아래쪽의 `else { … }` 블록을 다음으로 교체한다.

```js
} else {
  // e2e가 running 상태를 관찰할 수 있도록 결과를 늦출 수 있다. 기본은 0(즉시).
  const delayMs = Number(process.env.ONE_DESK_FAKE_DELAY_MS ?? 0)
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '작업 중' }] } })
  setTimeout(() => {
    emit({ type: 'result', subtype: 'success', is_error: false, result: '끝남', session_id: 'fake-session' })
    finish(0)
  }, delayMs)
}
```

실행 권한을 준다.

```bash
chmod +x core/runner/fixtures/fake-claude.mjs
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm test`
Expected: 133개 통과 (125 + 5 + 3)

- [ ] **Step 10: 커밋**

```bash
pnpm typecheck && pnpm lint
git add core/ && git commit -m "feat: allow overriding the agent executable with an env var"
```

---

## Task 2: 데이터 디렉토리를 갈아끼울 수 있게 한다

e2e가 실제 사용자 데이터를 건드리지 않게 하고, `pnpm dev`가 떠 있어도 돌 수 있게 한다.

**Files:**
- Modify: `electron/main.ts`

이 이음매는 자동 테스트가 없다. `electron/main.ts`는 최상위 부수효과를 가진 진입점이라 단위 테스트 대상이 아니고, 실제 검증은 Task 4의 스모크 e2e가 한다. 이 태스크에서는 **손으로 한 번 확인하고 넘어간다.**

- [ ] **Step 1: 잠금 요청 앞에 데이터 디렉토리 교체를 넣는다**

`electron/main.ts`에서 단일 인스턴스 잠금 블록을 다음으로 교체한다.

```ts
// e2e와 개발용으로 데이터 디렉토리를 갈아끼운다. app 이벤트 등록보다 먼저 해야 한다.
const testDataDir = process.env['ONE_DESK_USER_DATA']
if (testDataDir) app.setPath('userData', testDataDir)

// 두 인스턴스가 같은 SQLite를 열면 서로의 종료 정리가 상대를 덮어쓰고,
// 같은 run을 두 번 spawn하는 문제까지 생긴다.
// 데이터 디렉토리를 따로 지정했다면 공유 자체가 없으므로 잠금을 건너뛴다 —
// 이 분기가 없으면 pnpm dev가 떠 있는 동안 e2e가 즉시 종료된다.
if (!testDataDir && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 이하 기존 초기화 전체 (second-instance, whenReady, will-quit, window-all-closed)
}
```

`second-instance` 핸들러는 `else` 안에 그대로 둔다. 잠금을 얻지 못한 경우에만 도달하지 않으면 되고, 잠금을 건너뛴 경우에는 애초에 발화하지 않는다.

- [ ] **Step 2: 빌드하고 임시 디렉토리로 띄워 확인**

Run:

```bash
pnpm build && ONE_DESK_USER_DATA=/tmp/one-desk-seam-check ./node_modules/.bin/electron out/main/index.js
```

Expected: 앱 창이 뜨고 **workspace 목록이 비어 있다** (실제 데이터가 아니라는 뜻). 창을 닫고 확인:

```bash
ls /tmp/one-desk-seam-check/one-desk.db
```

Expected: 파일이 존재한다.

- [ ] **Step 3: dev와 동시에 뜨는지 확인**

한쪽 터미널에서 `pnpm dev`를 띄워둔 채, 다른 쪽에서 Step 2의 명령을 다시 실행한다.

Expected: **두 창이 동시에 떠 있다.** 즉시 종료되면 잠금 분기가 잘못된 것이다.

확인 후 정리:

```bash
rm -rf /tmp/one-desk-seam-check
```

- [ ] **Step 4: 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add electron/main.ts
git commit -m "feat: allow redirecting the user data directory for tests"
```

Expected: 테스트 133개 유지

---

## Task 3: e2e 하네스를 배선하고 러너가 실제로 도는지 확인한다

2단계에서 vitest include 패턴이 안 맞아 **테스트 9개가 없는 채로 성공 보고된 적이 있다**(실측 93 vs 102). 새 config에서 같은 사고가 반복될 수 있으므로, **일부러 실패시켜 실패가 보고되는지부터 본다.**

**Files:**
- Create: `vitest.e2e.config.ts`, `e2e/harness.e2e.ts`
- Modify: `package.json`, `tsconfig.node.json`, `.gitignore`

**Interfaces:**
- Produces: `pnpm test:e2e` — 빌드 후 `e2e/**/*.e2e.ts`를 실행한다

- [ ] **Step 1: playwright-core 설치와 확인**

```bash
pnpm add -D playwright-core
node -e "console.log(typeof require('playwright-core')._electron)"
```

Expected: `object`

`undefined`가 나오면 `playwright-core`가 Electron API를 노출하지 않는 버전이다. 그때는 아래로 바꾼다.

```bash
pnpm remove playwright-core && pnpm add -D playwright
```

이 경우 이후 모든 파일에서 `from 'playwright-core'`를 `from 'playwright'`로 읽는다.

- [ ] **Step 2: e2e 전용 config 작성**

```ts
// vitest.e2e.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    // Electron 창이 여러 개 동시에 뜨면 서로 방해한다
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
```

- [ ] **Step 3: 스크립트와 설정 배선**

`package.json`의 `scripts`에 추가한다.

```json
    "test:e2e": "electron-vite build && vitest run --config vitest.e2e.config.ts",
```

`tsconfig.node.json`의 `include`에 `e2e/**/*`를 추가한다.

```json
  "include": ["electron/**/*", "core/**/*", "shared/**/*", "e2e/**/*", "*.config.ts"],
```

`.gitignore`에 추가한다.

```
e2e/artifacts/
```

- [ ] **Step 4: 일부러 실패하는 테스트를 넣는다**

```ts
// e2e/harness.e2e.ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('e2e 하네스', () => {
  it('빌드 산출물이 있다', () => {
    expect(existsSync(resolve('out/main/index.js'))).toBe(true)
    expect(existsSync(resolve('out/preload/index.mjs'))).toBe(true)
    expect(existsSync(resolve('out/renderer/index.html'))).toBe(true)
  })

  it('일부러 실패한다 — 이 줄은 다음 스텝에서 지운다', () => {
    expect(1).toBe(2)
  })
})
```

- [ ] **Step 5: 실패가 실제로 보고되는지 확인**

Run: `pnpm test:e2e`
Expected: **FAIL** — `일부러 실패한다` 하나가 실패하고, `빌드 산출물이 있다`는 통과한다. 아무것도 실행되지 않고 성공으로 끝나면 include 패턴이 잘못된 것이다.

- [ ] **Step 6: 일부러 실패하는 테스트를 지운다**

`e2e/harness.e2e.ts`에서 두 번째 `it` 블록을 통째로 삭제한다.

Run: `pnpm test:e2e`
Expected: PASS (1개)

- [ ] **Step 7: 기존 테스트에 섞이지 않았는지 확인**

Run: `pnpm test`
Expected: **125개** — 개수가 늘었다면 e2e가 기본 스위트에 섞인 것이다.

Run: `pnpm typecheck && pnpm lint`
Expected: 통과 (`e2e/`도 typecheck 대상이다)

- [ ] **Step 8: 커밋**

```bash
git add package.json pnpm-lock.yaml tsconfig.node.json .gitignore vitest.e2e.config.ts e2e/
git commit -m "test: add an e2e harness that runs against the built app"
```

---

## Task 4: 드라이버와 스모크 테스트

**Files:**
- Create: `e2e/driver.ts`, `e2e/smoke.e2e.ts`

**Interfaces:**
- Consumes: `ONE_DESK_USER_DATA`, `ONE_DESK_AGENT_PATH`, `ONE_DESK_FAKE_DELAY_MS` (Task 1·2)
- Produces: `launchApp(): Promise<AppSession>` — `{ page, dataDir, repoDir, close() }`

- [ ] **Step 1: 실패하는 테스트 작성 — 앱이 격리된 데이터로 뜬다**

```ts
// e2e/smoke.e2e.ts
import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

describe('드라이버', () => {
  it('앱을 띄우고 빈 데이터로 시작한다', async () => {
    const app = await launchApp()
    try {
      const blank = app.page.getByText('왼쪽에서 workspace를 선택하세요')
      await blank.waitFor({ state: 'visible', timeout: 10_000 })

      // 실제 사용자 데이터였다면 workspace가 하나라도 있다.
      // 비어 있다는 것이 ONE_DESK_USER_DATA가 먹혔다는 증거다.
      const empty = app.page.getByText('workspace가 없습니다')
      await empty.waitFor({ state: 'visible', timeout: 5_000 })
      expect(await empty.textContent()).toBe('workspace가 없습니다')
    } finally {
      await app.close()
    }
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test:e2e`
Expected: FAIL — `Cannot find module './driver'`

- [ ] **Step 3: 드라이버 구현**

```ts
// e2e/driver.ts
import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { onTestFailed } from 'vitest'

const MAIN = resolve('out/main/index.js')
const FAKE_AGENT = resolve('core/runner/fixtures/fake-claude.mjs')
const ARTIFACTS = resolve('e2e/artifacts')

/** e2e가 running 상태를 관찰할 수 있을 만큼만 결과를 늦춘다. */
const FAKE_DELAY_MS = '1500'

export interface AppSession {
  page: Page
  /** 이 세션의 임시 데이터 디렉토리 */
  dataDir: string
  /** repo로 등록할 임시 작업 디렉토리 */
  repoDir: string
  close(): Promise<void>
}

export async function launchApp(): Promise<AppSession> {
  const dataDir = mkdtempSync(join(tmpdir(), 'one-desk-e2e-data-'))
  const repoDir = mkdtempSync(join(tmpdir(), 'one-desk-e2e-repo-'))

  const app: ElectronApplication = await _electron.launch({
    args: [MAIN],
    // env는 물려받는 것이 아니라 교체된다. PATH가 사라지면 preflight가 claude를
    // 찾지 못해 모든 run이 프리플라이트 실패로 끝난다.
    env: {
      ...process.env,
      ONE_DESK_USER_DATA: dataDir,
      ONE_DESK_AGENT_PATH: FAKE_AGENT,
      ONE_DESK_FAKE_DELAY_MS: FAKE_DELAY_MS
    } as Record<string, string>
  })

  const page = await app.firstWindow()

  // 화면을 볼 수 없으면 디버깅이 되지 않는다.
  onTestFailed(async () => {
    mkdirSync(ARTIFACTS, { recursive: true })
    await page.screenshot({ path: join(ARTIFACTS, `fail-${Date.now()}.png`) })
  })

  return {
    page,
    dataDir,
    repoDir,
    // 빠뜨리면 Electron 프로세스와 임시 디렉토리가 쌓인다.
    // 고아 프로세스 하나가 다음 실행을 통째로 막은 적이 있다.
    async close() {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(repoDir, { recursive: true, force: true })
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test:e2e`
Expected: PASS (2개 — harness 1, smoke 1)

- [ ] **Step 5: 실패 시 스크린샷이 남는지 확인**

`e2e/smoke.e2e.ts`의 마지막 단언을 잠시 `expect(await empty.textContent()).toBe('없는 문구')`로 바꾼다.

Run: `pnpm test:e2e`
Expected: FAIL, 그리고 `ls e2e/artifacts/`에 `fail-*.png`가 있다. 열어보면 앱 화면이 찍혀 있다.

단언을 원래대로 되돌리고 `rm -rf e2e/artifacts`로 정리한다.

- [ ] **Step 6: 프로세스가 남지 않는지 확인**

Run: `pnpm test:e2e && pgrep -fl "Electron.app/Contents/MacOS/Electron"`
Expected: 테스트 통과 후 출력 없음

- [ ] **Step 7: 커밋**

```bash
pnpm typecheck && pnpm lint
git add e2e/
git commit -m "test: add an electron driver with isolated data and failure screenshots"
```

---

## Task 5: 핵심 한 바퀴

**Files:**
- Create: `e2e/core-loop.e2e.ts`

**Interfaces:**
- Consumes: `launchApp()` (Task 4)

- [ ] **Step 1: 테스트 작성**

```ts
// e2e/core-loop.e2e.ts
import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const ISSUE = '토큰 만료 버그'
const PROMPT = '파일 목록 알려줘'

describe('핵심 한 바퀴', () => {
  it('맥락을 담아 실행하면 도크에 탭이 즉시 생기고 로그가 흐른다', async () => {
    const app = await launchApp()
    const page = app.page
    try {
      // 1. workspace 만들고 고른다
      await page.getByPlaceholder('새 workspace 이름…').fill('e2e-ws')
      await page.getByPlaceholder('새 workspace 이름…').press('Enter')
      const wsButton = page.getByRole('button', { name: 'e2e-ws' })
      await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
      await wsButton.click()

      // 2. repo 등록 — cwd로 쓰이므로 실제로 존재하는 디렉토리여야 한다
      await page.getByPlaceholder('repo 이름').fill('샘플')
      await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
      await page.getByRole('button', { name: '추가' }).click()
      // repo 이름은 카드와 작업 디렉토리 select 양쪽에 나온다. getByText('샘플')은
      // 두 개를 잡아 strict mode 위반이 된다. 카드에만 있는 aria-label로 기다린다.
      await page.getByRole('button', { name: '샘플 맥락에 담기' })
        .waitFor({ state: 'visible', timeout: 10_000 })

      // 3. 이슈 만들기
      await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
      await page.getByPlaceholder('새 이슈 제목…').press('Enter')
      const issueButton = page.getByRole('button', { name: ISSUE, exact: true })
      await issueButton.waitFor({ state: 'visible', timeout: 10_000 })

      // 4. 이슈를 눌러 맥락에 담는다 — 칩에는 제거 표시가 함께 붙는다
      await issueButton.click()
      const chip = page.getByRole('button', { name: `${ISSUE} ✕` })
      await chip.waitFor({ state: 'visible', timeout: 5_000 })

      // 5. 권한을 읽기 전용으로
      await page.getByLabel('권한').selectOption('read_only')
      expect(await page.getByLabel('권한').inputValue()).toBe('read_only')

      // 6. 지시를 넣고 실행
      await page.getByPlaceholder(/무엇을 시킬지/).fill(PROMPT)
      await page.getByRole('button', { name: '▶ 실행' }).click()

      // 7. 탭이 즉시 생긴다.
      //    execution.start()가 완료를 기다리지 않는다는 계약을 화면에서 고정한다 —
      //    종료까지 await했다면 여기서 몇 분을 기다리다 실패한다.
      const runningTab = page.getByRole('button', { name: new RegExp(`running.*${PROMPT}`) })
      await runningTab.waitFor({ state: 'visible', timeout: 5_000 })

      // 8. 로그가 흐른다
      await page.getByText('작업 중').waitFor({ state: 'visible', timeout: 10_000 })

      // 9. 완료되면 배지가 바뀌고 결과가 보인다
      const doneTab = page.getByRole('button', { name: new RegExp(`succeeded.*${PROMPT}`) })
      await doneTab.waitFor({ state: 'visible', timeout: 20_000 })
      await page.getByText('끝남').waitFor({ state: 'visible', timeout: 5_000 })
    } finally {
      await app.close()
    }
  })
})
```

- [ ] **Step 2: 실행하고 통과 확인**

Run: `pnpm test:e2e`
Expected: PASS (3개 — harness, smoke, core-loop)

실패하면 `e2e/artifacts/fail-*.png`를 열어 어느 단계에서 멈췄는지 본다. 흔한 원인 둘:
- **실행 버튼이 비활성**: repo가 등록되지 않아 `cwd`가 비었다. 2번 단계의 repo 카드 확인이 통과했는지 본다.
- **run이 failed로 끝난다**: 가짜 CLI에 실행 권한이 없거나(Task 1) `env`에서 `PATH`가 빠졌다(Task 4).

- [ ] **Step 3: 7번 단언이 실제로 계약을 지키는지 확인**

`core/execution.ts`의 `start`에서 `return started`를 잠시 다음으로 바꾼다.

```ts
    await new Promise((r) => setTimeout(r, 5_000))
    return started
```

Run: `pnpm test:e2e`
Expected: **FAIL** — 7번(`running` 탭)이 5초 타임아웃에 걸린다. 실패하지 않으면 이 단언이 계약을 지키지 못하는 것이므로 타임아웃을 줄여야 한다.

`core/execution.ts`를 원래대로 되돌리고 다시 통과를 확인한다.

- [ ] **Step 4: 전체 검증**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 133개 통과, typecheck·lint 통과

Run: `pnpm test:e2e`
Expected: 3개 통과

Run: `pgrep -fl "Electron.app/Contents/MacOS/Electron"`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add e2e/
git commit -m "test: cover the core loop end to end in the real app"
```

---

## 완료 기준

- [ ] `pnpm test:e2e`가 3개 통과한다
- [ ] 일부러 실패시킨 e2e가 실제로 실패로 보고되는 것을 확인했다 (Task 3 Step 5)
- [ ] `execution.start()`에 지연을 넣으면 핵심 한 바퀴가 실패하는 것을 확인했다 (Task 5 Step 3)
- [ ] `pnpm test`가 133개다 — e2e가 섞이지 않았다
- [ ] `pnpm typecheck`, `pnpm lint` 통과, `e2e/`도 대상에 든다
- [ ] `pnpm dev`가 떠 있는 상태에서 `pnpm test:e2e`가 돈다
- [ ] 실패 시 `e2e/artifacts/`에 스크린샷이 남는 것을 확인했다
- [ ] 테스트 후 Electron 프로세스와 임시 디렉토리가 남지 않는다

## 다음으로 넘기는 것

- 취소·프리플라이트 실패·재시작 재현 경로 — 드라이버가 있으므로 파일 하나씩 추가하면 된다
- 시각 회귀 비교, CI 통합
- 제어용 HTTP API와 CLI — 설계 §14의 자율 실행과 함께 별도 스펙으로 다룬다
