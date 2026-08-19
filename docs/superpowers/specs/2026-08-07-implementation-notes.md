# one-desk 구현 온보딩 노트

작성일: 2026-08-07 · 대상: 설계 문서(`2026-08-07-one-desk-design.md`)를 읽고 구현을 시작하는 개발자

이 문서는 질문 리스트(`2026-08-07-onboarding-questions.md`)의 42개 질문에 1:1로 답한다. 위에서부터 읽을 필요는 없지만 **`## 0. 먼저 이해할 것 세 가지`만은 먼저 읽어라.** 나머지 41개 답이 전부 그 세 가지 위에 얹힌다. 코드 블록은 전부 그대로 붙여넣어 동작하도록 썼고, 값을 지어내지 않았다. 실제로 실행해 확인한 것은 **`[확인함]`**, 확인하지 못한 것은 **`[확인 필요]`** 로 표시하고 검증 방법을 함께 적었다. 표시가 없는 곳은 일반적인 Node/TypeScript 지식으로 확실한 부분이다.

이 문서의 사실 확인은 로컬에 설치된 `claude` **2.1.224**, `@modelcontextprotocol/sdk` **1.30.0**, `drizzle-orm` **0.45.2** 에 대해 수행했다.

---

## 0. 먼저 이해할 것 세 가지

### (1) Electron 프로세스 모델 — 프로세스가 둘이고, 서로 메모리를 공유하지 않는다

Electron 앱은 **최소 두 개의 OS 프로세스**로 돌아간다.

| | main 프로세스 | renderer 프로세스 |
|---|---|---|
| 실체 | Node.js 런타임 | Chromium 탭 하나 |
| 개수 | 앱당 1개 | 창(BrowserWindow)당 1개 |
| 할 수 있는 것 | `fs`, `child_process`, `better-sqlite3`, 네트워크 서버 | DOM, React |
| 할 수 없는 것 | DOM 조작 | `require('fs')` (우리 설정에서는 구조적으로 불가) |

핵심은 **둘이 별개의 OS 프로세스라서 변수를 공유할 수 없다**는 것이다. renderer에서 `db.query(...)`를 부를 방법은 없다. 오직 **IPC(프로세스 간 통신)** 로 메시지를 주고받을 뿐이며, 그 메시지는 **구조화 복제(structured clone)** 로 직렬화된다. 함수, 클래스 인스턴스, `Date` 아닌 커스텀 객체는 못 넘어간다.

여기에 세 번째 조각이 붙는다. **preload 스크립트**다. renderer 프로세스 안에서, 그러나 페이지 JS와 **분리된 컨텍스트**에서, 페이지 로드 직전에 실행되는 스크립트다. Node API에 접근할 수 있는 유일한 renderer 측 코드이며, 그래서 "다리" 역할을 한다 (Q2 참고).

웹 개발에 익숙하다면 이렇게 대응시켜라.

```
renderer  ≈ 브라우저의 프론트엔드 코드
preload   ≈ 프론트엔드에 주입되는 SDK (fetch를 감싼 api 클라이언트)
main      ≈ 백엔드 서버
IPC       ≈ HTTP (단, 로컬이고 직렬화 규칙이 다름)
```

### (2) 이 앱의 데이터 흐름 — 요청은 왕복하고, 로그는 한 방향으로 흐른다

두 흐름을 **절대 섞지 마라.** 이걸 섞으면 나중에 반드시 꼬인다.

**흐름 A — 요청/응답 (renderer가 시작, 왕복)**

```
renderer: client.workspaces.list()
  → preload: ipcRenderer.invoke('workspaces.list')
    → main: ipcMain.handle('workspaces.list', …)
      → core/db: workspaceRepo.list()   ← SQLite 동기 호출
    ← Workspace[] 반환
  ← Promise resolve
```

**흐름 B — 이벤트 푸시 (main이 시작, 단방향)**

```
agent 프로세스 stdout (JSONL)
  → core/runner: 파싱 → 정규화 RunEvent
      ├→ logs/<run_id>/stream.jsonl 에 append   (영속화)
      ├→ EventEmitter.emit('runEvent', e)
      └→ before/ 스냅샷 (파일 수정 도구 감지 시)
  → electron/ipc: webContents.send('run:event', e)
    → preload: ipcRenderer.on('run:event', …)
      → renderer: 구독 콜백 → 배치 → setState
```

**흐름 B는 renderer로 되돌아오지 않는다.** renderer는 오직 구독만 한다. 취소 같은 "명령"은 흐름 A(`runs.cancel(id)`)로 간다. 이 규칙이 설계 문서 §4의 "단방향으로 흐른다"의 실제 의미다.

### (3) 왜 `core/`가 분리되는가 — "나중에"가 아니라 "지금"의 문제다

설계 문서는 자율 실행(데몬화)을 이유로 들지만, 주니어 입장에서 **당장 체감되는 이유는 테스트**다.

`core/`가 `electron`을 import하는 순간, 그 파일을 테스트하려면 Electron 런타임을 띄워야 한다. Electron을 띄우면 테스트 한 번에 수 초가 걸리고, `app.getPath()`를 부르려면 `app.whenReady()`를 기다려야 하고, CI에서는 헤드리스 디스플레이가 필요해진다. 반면 `core/`가 순수 Node면 `vitest run`이 밀리초 단위로 끝난다.

그래서 규칙은 이렇게 굳는다.

> **`core/`의 모든 함수는 필요한 것을 "인자로 받는다".** 스스로 찾아 나서지 않는다.

```ts
// ✗ 규칙 위반 — core가 Electron을 안다
import { app } from 'electron'
export function openDb() {
  return new Database(path.join(app.getPath('userData'), 'one-desk.db'))
}

// ✓ 올바름 — 경로는 밖에서 주입된다
export function openDb(dbPath: string) {
  return new Database(dbPath)
}
```

그리고 `electron/main.ts`가 조립을 담당한다.

```ts
// electron/main.ts — Electron을 아는 유일한 곳
import { app } from 'electron'
import { createCore } from '../core'

const core = createCore({
  dbPath: path.join(app.getPath('userData'), 'one-desk.db'),
  logsDir: path.join(app.getPath('userData'), 'logs')
})
```

이 패턴의 이름은 **의존성 주입(Dependency Injection)** 이고, 이 앱에서는 `createCore()`라는 함수 하나가 그 역할을 전부 한다 (Q7, Q18 참고).

---

## 영역 1. Electron 기본 구조 (main / renderer / preload / IPC / contextIsolation)

### Q1. 렌더러에서 `workspaces.list()`를 호출하면 실제로 어떤 경로를 거쳐 메인 프로세스까지 도달하나요? — B

호출 체인은 **4단계**다. 아래 네 파일을 순서대로 보면 전부다.

**① `shared/client.ts` — 계약(타입)만 정의. 구현 없음.**

```ts
// shared/client.ts
export interface Workspace {
  id: string
  name: string
  description: string | null
  defaultAgentKind: AgentKind
  defaultModel: string | null
  defaultPermission: Permission
  createdAt: number
  updatedAt: number
}

export interface OneDeskClient {
  workspaces: {
    list(): Promise<Workspace[]>
    create(input: { name: string; description?: string }): Promise<Workspace>
  }
  runs: {
    start(spec: RunSpec): Promise<Run>
    cancel(id: string): Promise<void>
  }
  events: {
    onRunEvent(cb: (e: RunEvent) => void): Unsubscribe
  }
}

export type Unsubscribe = () => void
```

**② `electron/preload.ts` — 다리를 놓는다.**

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces.list'),
    create: (input: unknown) => ipcRenderer.invoke('workspaces.create', input)
  },
  runs: {
    start: (spec: unknown) => ipcRenderer.invoke('runs.start', spec),
    cancel: (id: string) => ipcRenderer.invoke('runs.cancel', id)
  },
  events: {
    onRunEvent: (cb: (e: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on('run:event', listener)
      return () => ipcRenderer.removeListener('run:event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('oneDesk', api)
```

**③ `electron/ipc/workspaces.ts` — main 쪽 수신부. `core`를 부르는 얇은 껍데기.**

```ts
// electron/ipc/workspaces.ts
import { ipcMain } from 'electron'
import type { Core } from '../../core'

export function registerWorkspaceHandlers(core: Core) {
  ipcMain.handle('workspaces.list', () => {
    return core.workspaces.list()
  })

  ipcMain.handle('workspaces.create', (_event, input: { name: string; description?: string }) => {
    return core.workspaces.create(input)
  })
}
```

**④ `renderer/…` — 사용.**

```ts
const workspaces = await window.oneDesk.workspaces.list()
```

전체 경로를 한 줄로 요약하면:

```
renderer  window.oneDesk.workspaces.list()
   │      (contextBridge가 만든 프록시 객체)
   ▼
preload   ipcRenderer.invoke('workspaces.list')
   │      ── 채널명 문자열로 라우팅. 여기서 프로세스 경계를 넘는다 ──
   ▼
main      ipcMain.handle('workspaces.list', handler)
   │
   ▼
core      core.workspaces.list()  →  SQLite (동기)
   │
   ▼      반환값이 구조화 복제되어 역순으로 되돌아감
renderer  Promise<Workspace[]> resolve
```

**`fetch`와 비교하면 이렇게 다르다.**

| | `fetch('/api/workspaces')` | `ipcRenderer.invoke('workspaces.list')` |
|---|---|---|
| 라우팅 키 | URL 경로 | 채널명 문자열 |
| 직렬화 | JSON (문자열) | 구조화 복제 (구조 보존) |
| 네트워크 | 있음 | 없음 (같은 머신, 프로세스 간) |
| 반환 | `Response` | 값 자체가 담긴 `Promise` |

**주의점 두 가지.**

첫째, **채널명은 문자열이라 타입 체커가 오타를 못 잡는다.** `'workspaces.list'`를 `'workspace.list'`로 쓰면 런타임에 조용히 `Error: No handler registered`가 난다. 상수로 묶어라.

```ts
// shared/channels.ts
export const CHANNELS = {
  WORKSPACES_LIST: 'workspaces.list',
  WORKSPACES_CREATE: 'workspaces.create',
  RUNS_START: 'runs.start',
  RUNS_CANCEL: 'runs.cancel',
  RUN_EVENT: 'run:event'
} as const
```

둘째, **`ipcMain.handle`의 핸들러에서 던진 예외는 renderer의 `Promise`를 reject시키지만 스택 트레이스가 뭉개진다.** 원인을 잃지 않으려면 core 쪽에서 의미 있는 에러 타입을 쓰고 ipc 계층에서 직렬화 가능한 형태로 변환해라.

```ts
// electron/ipc/wrap.ts — 모든 핸들러를 이걸로 감싼다
export function handle<T>(channel: string, fn: (...args: any[]) => T | Promise<T>) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true as const, value: await fn(...args) }
    } catch (err) {
      console.error(`[ipc] ${channel} failed`, err)
      return {
        ok: false as const,
        error: { message: err instanceof Error ? err.message : String(err) }
      }
    }
  })
}
```

그리고 preload에서 풀어준다.

```ts
async function call(channel: string, ...args: unknown[]) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res.ok) throw new Error(res.error.message)
  return res.value
}
```

이렇게 하면 renderer는 평범한 `try/catch`로 처리하면서도 main 콘솔에 원본 스택이 남는다.

### Q2. `contextBridge`가 정확히 뭘 하나요? `preload.ts`가 왜 필요한가요? — B

**한 문장으로: `contextBridge`는 "서로 격리된 두 JS 세계 사이에 읽기 전용 통로를 뚫는" API다.**

`contextIsolation: true`이면 renderer 프로세스 안에 **JS 실행 컨텍스트가 두 개** 존재한다.

```
┌─ renderer 프로세스 ─────────────────────────────────┐
│                                                     │
│  [격리 컨텍스트]              [메인 월드]            │
│   preload.ts 실행             페이지 JS (React) 실행 │
│   require() 가능              require() 없음         │
│   ipcRenderer 접근 가능       ipcRenderer 접근 불가   │
│         │                           ▲                │
│         └── contextBridge ──────────┘                │
│             (여기만 통과 가능)                        │
└─────────────────────────────────────────────────────┘
```

두 컨텍스트는 **프로토타입 체인을 공유하지 않는다.** 이게 핵심이다. 옛날 Electron(`contextIsolation: false`)에서는 두 세계가 같은 `Object.prototype`을 썼기 때문에, 웹 페이지가 로드한 악성 스크립트가 `Object.prototype`을 오염시켜 preload가 노출한 객체의 동작을 가로챌 수 있었다. 이를 **프로토타입 오염 공격**이라 한다.

`contextBridge.exposeInMainWorld(key, value)`가 하는 일은:

1. `value`를 **깊은 복사**한다 — 참조를 그대로 넘기지 않는다.
2. 복사본을 **메인 월드의 프로토타입**으로 다시 만든다.
3. 함수는 복사하지 않고 **프록시**로 감싼다 — 호출하면 격리 컨텍스트의 원본이 실행된다.
4. 결과 객체를 **freeze**한다 — 페이지 JS가 `window.oneDesk.workspaces.list = 악성함수`로 덮어쓸 수 없다.

**직접 확인해보면 이해가 빠르다.**

```ts
// preload.ts
contextBridge.exposeInMainWorld('probe', {
  plain: { a: 1 },
  fn: () => 'from preload',
  // ✗ 이건 던진다: "An object could not be cloned"
  // notClonable: new (class Foo {})()
})
```

```ts
// renderer 콘솔에서
window.probe.plain          // { a: 1 }  ← 복사본
window.probe.fn()           // 'from preload'  ← 프록시 호출
Object.isFrozen(window.probe) // true
window.probe.fn = () => 'hacked'  // 조용히 무시됨 (strict mode면 TypeError)
```

**그럼 preload는 왜 필요한가?** 세 가지를 동시에 만족하는 유일한 자리이기 때문이다.

1. **Node API에 접근할 수 있다** — `ipcRenderer`를 쓸 수 있는 renderer 측 코드는 preload뿐이다.
2. **어떤 페이지 JS보다 먼저 실행된다** — React가 마운트되기 전에 `window.oneDesk`가 준비되어 있다.
3. **노출 범위를 개발자가 정한다** — `ipcRenderer` 전체가 아니라 우리가 고른 함수 4개만 나간다.

**이게 왜 보안상 중요한가.** 만약 `ipcRenderer`를 통째로 노출하면:

```ts
// ✗ 절대 하지 마라
contextBridge.exposeInMainWorld('ipc', ipcRenderer)
```

renderer에서 실행되는 **어떤 코드든** 모든 채널을 부를 수 있게 된다. 이 앱은 agent가 만든 마크다운을 렌더링하고, 외부 repo의 SKILL.md 내용을 화면에 표시한다. 그중 하나에 XSS가 있으면 그 스크립트가 `ipc.invoke('runs.start', { permission: 'full', prompt: 'rm -rf ~' })`를 부를 수 있다. 노출 면적을 좁게 유지하는 것이 방어선이다.

**실무 규칙 — preload에는 로직을 넣지 마라.**

```ts
// ✗ preload가 두꺼워지면 테스트할 수 없는 코드가 쌓인다
onRunEvent: (cb) => {
  ipcRenderer.on('run:event', (_e, ev) => {
    if (ev.type === 'text' && ev.text.length > 1000) ev.text = ev.text.slice(0, 1000)  // ← 로직
    cb(ev)
  })
}

// ✓ preload는 배선만. 가공은 core 아니면 renderer에서.
onRunEvent: (cb) => {
  const l = (_e: unknown, ev: unknown) => cb(ev)
  ipcRenderer.on('run:event', l)
  return () => ipcRenderer.removeListener('run:event', l)
}
```

preload는 Electron 없이는 테스트가 불가능한 파일이다. 그러니 **테스트할 것이 없을 만큼 얇게** 유지하는 게 답이다.

**BrowserWindow 설정은 이렇게 된다.**

```ts
// electron/main.ts
const win = new BrowserWindow({
  width: 1400,
  height: 900,
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,   // 기본값이지만 명시한다
    nodeIntegration: false,   // 기본값이지만 명시한다
    sandbox: true
  }
})
```

> **`sandbox: true`에 주의.** 샌드박스가 켜지면 preload에서 쓸 수 있는 Node 기능이 `ipcRenderer` 등 일부 Electron 모듈로 제한된다. 우리 preload는 `ipcRenderer`만 쓰므로 문제없고, 오히려 이 제약이 preload를 얇게 유지하도록 강제해준다. 만약 preload에서 `fs`를 쓰고 싶어진다면 그건 설계가 틀어진 신호다 — main으로 옮겨라.

### Q3. `electron/ipc/`의 핸들러는 요청-응답형(`workspaces.list`)과 이벤트 스트리밍형(`events.onRunEvent`)을 각각 어떤 API로 구현하나요? — B

기준은 하나다. **"누가 먼저 말을 거는가?"**

| | renderer가 시작 (요청-응답) | main이 시작 (푸시) |
|---|---|---|
| main 측 | `ipcMain.handle(ch, fn)` | `win.webContents.send(ch, payload)` |
| preload 측 | `ipcRenderer.invoke(ch, args)` | `ipcRenderer.on(ch, listener)` |
| 반환값 | `Promise<T>` | 없음 (단방향) |
| 예 | `workspaces.list`, `runs.start` | `run:event`, `inbox:changed` |

`ipcMain.on` + `event.reply`도 존재하지만 **쓰지 마라.** `invoke`/`handle` 쌍이 나온 이유가 바로 그 패턴의 콜백 지옥과 응답 매칭 문제를 없애기 위해서였다. 이 앱에서 `ipcMain.on`을 쓸 자리는 없다.

**요청-응답형 — main 측 전체.**

```ts
// electron/ipc/index.ts
import { ipcMain } from 'electron'
import type { Core } from '../../core'
import { CHANNELS } from '../../shared/channels'

export function registerHandlers(core: Core) {
  ipcMain.handle(CHANNELS.WORKSPACES_LIST, () => core.workspaces.list())
  ipcMain.handle(CHANNELS.WORKSPACES_CREATE, (_e, input) => core.workspaces.create(input))
  ipcMain.handle(CHANNELS.RUNS_START, (_e, spec) => core.runs.start(spec))
  ipcMain.handle(CHANNELS.RUNS_CANCEL, (_e, id: string) => core.runs.cancel(id))
}
```

**푸시형 — main 측 전체.** 여기가 흐름 B의 중계 지점이다.

```ts
// electron/ipc/events.ts
import { BrowserWindow } from 'electron'
import type { Core } from '../../core'
import { CHANNELS } from '../../shared/channels'

export function bridgeRunEvents(core: Core) {
  const forward = (event: RunEvent) => {
    // 살아 있는 모든 창에 보낸다. 창이 하나뿐이어도 이 형태를 유지하면
    // 나중에 창을 늘릴 때 코드를 안 고쳐도 된다.
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(CHANNELS.RUN_EVENT, event)
    }
  }

  core.runner.on('runEvent', forward)
  return () => core.runner.off('runEvent', forward)
}
```

**세 가지 함정이 있다. 전부 실제로 겪게 된다.**

**함정 1 — 창이 준비되기 전에 `send`하면 이벤트가 사라진다.**
`webContents.send`는 렌더러가 아직 리스너를 등록하지 않았으면 그냥 버린다. 큐잉하지 않는다. 앱 시작 직후 자동으로 run을 재개하는 로직이 있다면 이벤트를 놓친다.

해결: **renderer가 준비됐다고 알린 뒤에 배선한다.**

```ts
// electron/main.ts
ipcMain.handle('renderer.ready', () => {
  // 이 시점에 renderer는 이미 onRunEvent를 등록했다
  unbridge = bridgeRunEvents(core)
  return true
})
```

```ts
// renderer 최상위에서
useEffect(() => {
  const unsub = window.oneDesk.events.onRunEvent(handleEvent)
  window.oneDesk.app.rendererReady()   // 등록 후에 알린다
  return unsub
}, [])
```

**함정 2 — 파괴된 창에 `send`하면 던진다.**
`win.isDestroyed()` 체크를 빼면 창을 닫는 순간 main이 크래시할 수 있다. 위 코드의 `if (win.isDestroyed()) continue`가 그것이다.

**함정 3 — 이벤트 페이로드는 구조화 복제를 통과해야 한다.**
`RunEvent`에 `Error` 객체나 클래스 인스턴스를 담으면 `Error: An object could not be cloned`가 난다. **`RunEvent`는 순수 데이터로만 정의해라.**

```ts
// shared/events.ts — 전부 직렬화 가능한 타입만 쓴다
export type RunEvent =
  | { type: 'session'; runId: string; sessionId: string; at: number }
  | { type: 'text'; runId: string; text: string; at: number }
  | { type: 'tool_use'; runId: string; toolUseId: string; name: string; input: unknown; at: number }
  | { type: 'tool_result'; runId: string; toolUseId: string; ok: boolean; summary: string; at: number }
  | { type: 'error'; runId: string; message: string; at: number }
  | {
      type: 'result'
      runId: string
      status: 'succeeded' | 'failed'
      resultText: string
      at: number
    }
  | { type: 'status'; runId: string; status: RunStatus; at: number }
  | { type: 'raw'; runId: string; line: string; at: number }
```

> `input: unknown`은 `JSON.parse` 결과라 항상 복제 가능하다. 하지만 `Error`는 아니다 — `message`를 문자열로 뽑아 담아라.

여기에 설계 문서의 6종 이벤트 외에 **`status`와 `raw`를 추가**했다. `status`는 `pending → running` 전이를 UI에 알리는 데 필요하고(Q21), `raw`는 §11의 "파싱 실패한 줄을 raw 텍스트로 남긴다"를 이벤트로도 흘려보내기 위해서다. 설계에 명시돼 있지 않지만 없으면 대기 큐 상태를 화면에 못 그린다 (구멍 목록 참고).

### Q4. `events.onRunEvent(cb)`가 반환하는 `Unsubscribe`는 실제로 어떻게 만드나요? — A

**`Unsubscribe`는 그냥 "등록을 되돌리는 클로저"다.** 마법은 없다.

```ts
export type Unsubscribe = () => void
```

**핵심은 `removeListener`에 넘기는 함수 참조가 `on`에 넘긴 것과 동일해야 한다는 것이다.** 이게 유일한 함정이다.

```ts
// electron/preload.ts
onRunEvent: (cb: (e: RunEvent) => void): Unsubscribe => {
  // ① listener를 변수에 담는다 — 이 참조를 나중에 그대로 써야 한다
  const listener = (_event: Electron.IpcRendererEvent, payload: RunEvent) => cb(payload)

  ipcRenderer.on(CHANNELS.RUN_EVENT, listener)

  // ② 같은 참조로 해제하는 클로저를 돌려준다
  return () => {
    ipcRenderer.removeListener(CHANNELS.RUN_EVENT, listener)
  }
}
```

```ts
// ✗ 이렇게 하면 절대 해제되지 않는다
ipcRenderer.on(CHANNELS.RUN_EVENT, (_e, p) => cb(p))
return () => ipcRenderer.removeListener(CHANNELS.RUN_EVENT, (_e, p) => cb(p))
//                                       ^^^^^^^^^^^^^^^^^^^^^^^^^ 새로 만든 다른 함수다
```

**renderer 쪽 사용 — React의 `useEffect` 정리 함수와 모양이 정확히 맞는다.**

```tsx
// renderer/hooks/useRunEvents.ts
export function useRunEvents(onEvent: (e: RunEvent) => void) {
  // 최신 콜백을 ref에 담아둔다 — 이유는 아래 설명
  const handlerRef = useRef(onEvent)
  useEffect(() => {
    handlerRef.current = onEvent
  })

  useEffect(() => {
    const unsubscribe = window.oneDesk.events.onRunEvent((e) => {
      handlerRef.current(e)
    })
    return unsubscribe   // ← useEffect의 cleanup이 곧 Unsubscribe
  }, [])                 // ← 의존성 비움: 구독은 마운트당 한 번만
}
```

**왜 `handlerRef`를 쓰는가.** 이게 이 질문의 진짜 핵심이다.

`onEvent`를 `useEffect`의 의존성 배열에 직접 넣으면, 부모가 리렌더링될 때마다 `onEvent`가 새 함수 참조가 되고 → 구독이 해제됐다 재등록된다. run이 초당 수십 개 이벤트를 뿜는 상황에서 매 이벤트마다 `setState`가 일어나고 그때마다 구독이 재생성되면 **이벤트를 놓치는 창이 생긴다.** ref로 최신 콜백만 갈아끼우면 구독은 한 번만 하고 콜백은 항상 최신이다.

**메모리 누수는 어디서 나는가 — 세 곳이다.**

**① renderer: cleanup을 빠뜨림.**
`useEffect`가 `unsubscribe`를 반환하지 않으면 컴포넌트가 언마운트돼도 리스너가 `ipcRenderer`에 남는다. 하단 도크의 run 탭을 열고 닫기를 반복하면 리스너가 계속 쌓이고, 이벤트 하나에 콜백 수십 개가 불린다. **증상은 "탭을 여닫을수록 앱이 느려진다"** 로 나타난다.

확인 방법:

```ts
// renderer 콘솔 — 리스너 수가 계속 늘어나면 누수다
// preload에서 디버그용으로 노출해두면 편하다
window.oneDesk.debug.listenerCount()   // → ipcRenderer.listenerCount('run:event')
```

**② main: `core.runner`의 리스너를 안 뗌.**
`bridgeRunEvents`가 반환한 해제 함수를 앱 종료 시 부르지 않으면, 개발 중 핫리로드로 main이 재실행될 때마다 `forward`가 중복 등록되어 **같은 이벤트가 2번, 3번씩 renderer에 도착한다.**

**③ main: `EventEmitter`의 기본 리스너 상한(10)에 걸림.**
run별로 리스너를 붙이는 구조를 만들면 11번째부터 경고가 뜬다.

```
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 runEvent listeners added.
```

**이 경고를 상한을 올려서 끄지 마라.** 그건 거의 항상 누수의 신호다. 대신 **리스너는 `RunManager` 하나에만 붙이고, run 구분은 이벤트의 `runId` 필드로 하라.** 우리 설계가 이미 그렇게 되어 있다 (`RunEvent`에 `runId`가 있는 이유).

```tsx
// renderer/state/runStore.ts — 구독은 앱 전체에서 딱 한 번
// 각 run 탭은 이 스토어를 읽기만 한다
const buffers = new Map<string, RunEvent[]>()

useRunEvents((e) => {
  const list = buffers.get(e.runId) ?? []
  list.push(e)
  buffers.set(e.runId, list)
  scheduleFlush()   // Q29의 배치 처리
})
```

### Q5. renderer는 `core`/`electron`과 같은 패키지인가요, 별도 패키지인가요? — B

**결론: 단일 패키지(single package)로 간다.** pnpm workspace로 쪼개지 마라.

`package.json` 하나, `node_modules` 하나, `pnpm-workspace.yaml` 없음. 대신 **tsconfig를 3개로 쪼개고, path alias로 경계를 만든다.**

**왜 단일 패키지인가.**

electron-vite가 이미 `main` / `preload` / `renderer` **세 개의 빌드 타깃**을 하나의 설정 파일에서 관리한다. 각 타깃은 별도 Rollup 빌드이고, 서로 다른 `target`(main은 `node22`, renderer는 `chrome138` 등)과 서로 다른 externals 규칙을 갖는다. 즉 **패키지를 쪼개서 얻으려는 "빌드 분리"를 electron-vite가 이미 제공한다.** 여기에 pnpm workspace를 얹으면 얻는 것 없이 이런 것들만 늘어난다:

- `workspace:*` 의존성 선언과 빌드 순서 관리
- 각 패키지의 `exports` 필드 정비
- Vitest가 여러 패키지를 가로지를 때의 설정 중복
- `electron-rebuild`가 어느 `node_modules`의 `better-sqlite3`를 고칠지에 대한 혼선 (Q9)

**"런타임 제약인가, import 경로가 없는 건가?"** — **둘 다다.** 정확히 구분해두자.

| | renderer가 `core/db`를 import하면 |
|---|---|
| 타입 체크 | tsconfig에서 막으면 **컴파일 에러** |
| 번들링 | Vite가 `better-sqlite3`를 브라우저용으로 번들하려다 **빌드 에러** |
| 런타임 | 설령 통과해도 `contextIsolation: true`라 **Node API 없어 실행 불가** |

세 겹 전부에서 막힌다. 하지만 **가장 먼저, 가장 친절하게 막아주는 건 tsconfig**이므로 여기에 투자해라.

**tsconfig 구성 — 파일 4개.**

```jsonc
// tsconfig.json — 루트. 프로젝트 참조만 한다.
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

```jsonc
// tsconfig.base.json — 공통 컴파일러 옵션
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
// tsconfig.node.json — main + preload + core + shared (Node 환경)
{
  "extends": "./tsconfig.base.json",
  "include": ["electron/**/*", "core/**/*", "shared/**/*", "electron.vite.config.ts"],
  "compilerOptions": {
    "composite": true,
    "lib": ["ES2023"],              // ← DOM 없음. document를 쓰면 컴파일 에러
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
// tsconfig.web.json — renderer (브라우저 환경)
{
  "extends": "./tsconfig.base.json",
  "include": ["renderer/**/*", "shared/**/*"],   // ← core가 없다. 이게 경계다.
  "compilerOptions": {
    "composite": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [],                    // ← node 타입 없음. process.env를 쓰면 컴파일 에러
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"],
      "@renderer/*": ["renderer/*"]
      // @core/* 를 여기 넣지 않는다 → renderer에서 core import 시 "Cannot find module"
    }
  }
}
```

**여기서 벌어지는 일을 정확히 이해해라.**

- `tsconfig.web.json`의 `include`에 `core/**/*`가 **없고**, `paths`에 `@core/*`가 **없다.** 그래서 renderer에서 `import { openDb } from '@core/db'`를 쓰면 `Cannot find module '@core/db'` 컴파일 에러가 난다. **상대경로(`../core/db`)로 우회하는 것은 막지 못하므로** 이건 lint로 한 번 더 잠근다 (Q6에서 같은 기법을 쓴다).

- `tsconfig.web.json`의 `types: []`가 renderer에서 `process`, `__dirname`, `Buffer`를 **컴파일 단계에서** 없앤다. 실수로 Node 코드를 renderer에 쓰는 사고를 여기서 잡는다.

- `tsconfig.node.json`의 `lib`에 `DOM`이 없어서 core/main에서 `window`, `document`, `fetch`를 쓰면 에러가 난다. (Node 22에 `fetch`가 있으므로 필요하면 `types: ["node"]`가 제공하는 `fetch`를 쓰게 된다 — 문제없다.)

**`window.oneDesk` 타입은 어떻게 renderer에 알리는가.** `shared/`에 전역 선언을 둔다.

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

`shared/`는 양쪽 tsconfig의 `include`에 모두 들어 있으므로 renderer가 이 선언을 본다. **`shared/`에는 타입과 순수 상수만 넣어라** — `fs`를 쓰는 함수가 하나라도 들어가면 renderer 번들이 깨진다 (Q8 참고).

**electron-vite 설정에서 같은 alias를 다시 선언해야 한다.** tsconfig의 `paths`는 타입 체커만 보고 번들러는 안 본다.

```ts
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve('core'),
        '@shared': resolve('shared')
      }
    },
    build: { rollupOptions: { input: resolve('electron/main.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('shared') } },
    build: { rollupOptions: { input: resolve('electron/preload.ts') } }
  },
  renderer: {
    root: resolve('renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('shared'),
        '@renderer': resolve('renderer')
      }
    },
    build: { rollupOptions: { input: resolve('renderer/index.html') } }
  }
})
```

> **`externalizeDepsPlugin()`이 중요하다.** 이게 `package.json`의 `dependencies`를 번들에서 빼고 런타임 `require`로 남긴다. `better-sqlite3` 같은 네이티브 모듈은 번들될 수 없으므로 **main과 preload에는 반드시 이 플러그인을 넣어라.** renderer에는 넣지 않는다 (renderer는 전부 번들되어야 한다).

---

## 영역 2. `core/` 분리 규칙과 프로젝트 구조

### Q6. "core/는 electron을 import하지 않는다"를 강제하는 린트 규칙은 구체적으로 뭘 쓰나요? — A

**`no-restricted-imports`로 충분하다.** 커스텀 규칙을 만들 필요 없다. 다만 **`patterns`까지 써야** 상대경로 우회를 막을 수 있다.

ESLint 9 flat config 기준으로, 디렉토리별로 다른 규칙을 거는 형태다.

```js
// eslint.config.js
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // ── 규칙 1: core/ 는 electron 을 모른다 ──
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'electron',
            message:
              'core/는 Electron에 의존하지 않는다 (설계 문서 §4 규칙 1). ' +
              '경로·설정은 createCore()의 인자로 주입받아라.'
          }
        ],
        patterns: [
          {
            group: ['electron/*', '**/electron/**', '../electron', '../../electron'],
            message: 'core/에서 electron/ 디렉토리를 참조할 수 없다. 의존 방향은 electron/ → core/ 단방향이다.'
          },
          {
            group: ['@renderer/*', '**/renderer/**'],
            message: 'core/는 renderer를 모른다.'
          }
        ]
      }]
    }
  },
  {
    // ── 규칙 2: renderer/ 는 core/ 와 node 내장 모듈을 모른다 ──
    files: ['renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@core/*', '**/core/**', '../core', '../../core'],
            message:
              'renderer는 core를 직접 부를 수 없다 (설계 문서 §4 규칙 2). ' +
              'window.oneDesk (OneDeskClient)를 사용해라.'
          },
          {
            group: ['electron', 'electron/*'],
            message: 'renderer에서 electron을 import할 수 없다. preload가 노출한 API만 쓴다.'
          },
          {
            group: ['node:*', 'fs', 'path', 'child_process', 'os', 'crypto'],
            message: 'renderer는 Node 모듈을 쓸 수 없다 (contextIsolation).'
          }
        ]
      }]
    }
  }
)
```

**`paths`와 `patterns`의 차이가 이 규칙의 성패를 가른다.**

- `paths`는 **정확히 일치하는 모듈명**만 잡는다. `import { app } from 'electron'` → 잡힘.
- `patterns`는 **glob**으로 잡는다. `import { x } from '../../electron/ipc/foo'` → `patterns` 없으면 **안 잡힌다.**

주니어가 실수하는 전형적인 경로가 후자다. 그래서 `patterns`가 필수다.

**이것만으로 부족한 구멍이 하나 있다: 동적 import와 `require`.**

```ts
// no-restricted-imports는 이걸 못 잡는다
const { app } = await import('electron')
const electron = require('electron')
```

완전히 잠그려면 `import/no-restricted-paths`(eslint-plugin-import)를 추가하거나, 더 간단하게 **CI에서 grep 한 줄로 이중 확인**해라. 실무에서는 이게 가장 비용 대비 효과가 좋다.

```json
// package.json
{
  "scripts": {
    "lint:boundaries": "! grep -rnE \"(from ['\\\"]electron['\\\"]|require\\(['\\\"]electron['\\\"]\\)|import\\(['\\\"]electron['\\\"]\\))\" core/ --include='*.ts'"
  }
}
```

> `!`로 시작하므로 **grep이 아무것도 찾지 못했을 때 exit 0**(성공)이 된다. 하나라도 찾으면 스크립트가 실패해 CI가 빨개진다.

**타입 레벨 방어도 같이 걸어라.** `core/`용 tsconfig에서 `electron` 타입 자체를 없애면 IDE가 즉시 빨간 줄을 그어준다 — lint를 돌리기 전에 알 수 있어 피드백이 훨씬 빠르다.

```jsonc
// tsconfig.core.json — 테스트/타입체크 전용 (빌드는 tsconfig.node.json이 담당)
{
  "extends": "./tsconfig.base.json",
  "include": ["core/**/*", "shared/**/*"],
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"],          // ← "electron" 없음
    "baseUrl": ".",
    "paths": { "@shared/*": ["shared/*"], "@core/*": ["core/*"] }
  }
}
```

```json
{
  "scripts": {
    "typecheck": "tsc -b tsconfig.json && tsc -p tsconfig.core.json --noEmit"
  }
}
```

**이 규칙을 어기게 되는 실제 상황과 올바른 대처를 미리 알아두자.** 세 번 정도 유혹이 온다.

| 유혹 | 왜 생기나 | 올바른 대처 |
|---|---|---|
| `app.getPath('userData')`가 필요 | DB 경로를 알아야 함 | `createCore({ dbPath, logsDir })`로 주입 (§0-(3)) |
| `dialog.showOpenDialog`로 repo 폴더 선택 | 사용자가 경로를 골라야 함 | **dialog는 electron/ipc에서 부르고**, core에는 결정된 경로 문자열만 넘긴다 |
| `webContents.send`로 이벤트 보내기 | runner가 UI에 알려야 함 | core는 `EventEmitter`로 `emit`만. 중계는 `electron/ipc/events.ts`가 (Q3) |
| `shell.openPath`로 파일 열기 | diff 뷰에서 편집기 열기 | UI 동작이므로 renderer → ipc → main. core를 거치지 않는다 |

공통 원리는 하나다. **core는 "무엇을 할지"를 결정하고, electron/은 "OS와 대화한다".**

### Q7. `core/runner`가 `core/db`를 직접 import해도 되나요, 인터페이스로 주입받나요? — B

**주입받아라. 단, 인터페이스를 새로 정의하지는 마라.** 이 둘은 다른 얘기다.

정확히는 **"타입은 직접 import, 인스턴스는 주입"** 이다.

```ts
// core/runner/RunManager.ts
import type { RunRepository } from '../db/repositories/runRepository'   // ✓ 타입만 import
import type { RunEvent, ResolvedRunSpec } from '../../shared/events'

export interface RunManagerDeps {
  runRepo: RunRepository
  logsDir: string
  adapters: Map<AgentKind, AgentAdapter>
  maxConcurrent: number
  now?: () => number          // 테스트에서 시간을 고정하기 위한 구멍
}

export class RunManager extends EventEmitter {
  private readonly deps: RunManagerDeps
  private readonly active = new Map<string, ActiveRun>()
  private readonly queue: string[] = []

  constructor(deps: RunManagerDeps) {
    super()
    this.deps = deps
  }
  // …
}
```

**왜 "직접 import"가 아니라 "주입"인가 — 이유는 순환 참조가 아니다.**

주니어가 걱정한 순환 참조(`runner → db → runner`)는 사실 **의존 방향만 지키면 애초에 생기지 않는다.** `core/db`는 `core/runner`를 절대 import하지 않으므로 사이클이 없다. 진짜 이유는 두 가지다.

**① 테스트 가능성.** `RunManager`가 내부에서 `import { runRepo } from '../db'`로 싱글톤을 끌어다 쓰면, `RunManager`를 테스트할 때마다 진짜 SQLite가 필요해진다. 주입하면 가짜를 꽂을 수 있다.

```ts
// core/runner/__tests__/RunManager.test.ts
const fakeRepo: RunRepository = {
  create: vi.fn((r) => ({ ...r, id: 'run-1' })),
  updateStatus: vi.fn(),
  findById: vi.fn(),
  listRunning: vi.fn(() => [])
}

const rm = new RunManager({
  runRepo: fakeRepo,
  logsDir: '/tmp/test-logs',
  adapters: new Map([['claude-code', fakeAdapter]]),
  maxConcurrent: 2
})
```

**② 초기화 순서.** DB는 마이그레이션이 끝난 뒤에만 쓸 수 있다. 모듈 최상위에서 `import`한 싱글톤은 "언제 초기화됐는지"를 보장할 수 없다. 생성자 주입은 "이걸 만들 때는 이미 준비돼 있다"를 타입으로 강제한다.

**하지만 인터페이스를 따로 만들지는 마라.** 이런 걸 하면 안 된다.

```ts
// ✗ 과잉 추상화 — 구현체가 하나뿐인데 인터페이스를 또 만든다
// core/runner/ports/IRunStore.ts
export interface IRunStore {
  save(run: Run): void
}
// 그리고 core/db/RunRepository가 IRunStore를 implements…
```

구현체가 영원히 하나일 것이 뻔한데 포트/어댑터를 만들면 파일만 두 배가 되고 "이 메서드가 어디서 구현됐지"를 찾아 헤매게 된다. **`RunRepository` 클래스의 타입을 그대로 주입 타입으로 써라.** 나중에 정말로 두 번째 구현이 필요해지면 그때 `interface`로 뽑아도 늦지 않다 (TypeScript는 구조적 타이핑이라 이 리팩터링이 거의 공짜다).

**전체 조립은 `core/index.ts` 한 곳에서 한다. 이게 이 앱의 "컴포지션 루트"다.**

```ts
// core/index.ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './db/schema'
import { WorkspaceRepository } from './db/repositories/workspaceRepository'
import { IssueRepository } from './db/repositories/issueRepository'
import { RunRepository } from './db/repositories/runRepository'
import { RunManager } from './runner/RunManager'
import { ClaudeCodeAdapter } from './runner/adapters/claudeCode'
import { McpServerHost } from './mcp/host'

export interface CoreOptions {
  dbPath: string
  logsDir: string
  migrationsDir: string
  maxConcurrent?: number
}

export function createCore(opts: CoreOptions) {
  // ① DB — 가장 먼저. 나머지가 전부 이걸 의존한다.
  const sqlite = new Database(opts.dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: opts.migrationsDir })   // 동기 [확인함]

  // ② 리포지토리
  const workspaces = new WorkspaceRepository(db)
  const issues = new IssueRepository(db)
  const memos = new MemoRepository(db)
  const runs = new RunRepository(db)

  // ③ MCP 호스트 — 리포지토리를 의존
  const mcp = new McpServerHost({ issues, memos, repos, workspaces })

  // ④ RunManager — 리포지토리 + MCP 호스트를 의존
  const runner = new RunManager({
    runRepo: runs,
    logsDir: opts.logsDir,
    adapters: new Map([['claude-code', new ClaudeCodeAdapter()]]),
    maxConcurrent: opts.maxConcurrent ?? 3
  })

  return {
    workspaces, issues, memos, runs, runner, mcp,
    async start() { await mcp.listen() },
    async dispose() {
      await runner.shutdown()
      await mcp.close()
      sqlite.close()
    }
  }
}

export type Core = ReturnType<typeof createCore>
```

**이 파일이 유일하게 `new`를 많이 쓰는 곳이다.** 나머지 모든 파일은 생성자로 받은 것만 쓴다. 이 구조가 §0-(3)의 규칙을 실제로 강제하는 장치다.

**의존 방향을 그림으로 굳혀두자. 화살표는 절대 역행하지 않는다.**

```
electron/main.ts
     │ createCore(...)
     ▼
core/index.ts ─────┬──────────┬──────────┐
                   ▼          ▼          ▼
              core/db   core/runner  core/mcp
                   ▲          │          │
                   └──────────┴──────────┘
                    (타입만 import, 인스턴스는 주입)
                   
core/context ← runner가 호출. context는 db 타입만 알고 인스턴스는 인자로 받음.
shared/  ← 전부가 import 가능. shared는 아무것도 import하지 않는다.
```

### Q8. `shared/`는 별도 pnpm workspace 패키지인가요, 상대경로 폴더인가요? — B

**상대경로 폴더다.** (Q5에서 정한 단일 패키지 구조의 연장) 다만 상대경로 지옥(`../../../shared/client`)을 피하려고 **`@shared/*` alias**를 쓴다.

alias는 **두 곳에 똑같이** 선언해야 한다. 하나라도 빠지면 절반만 동작한다.

| 선언 위치 | 누가 읽나 | 빠뜨리면 |
|---|---|---|
| `tsconfig.*.json`의 `paths` | `tsc`, IDE | 에디터에 빨간 줄, `typecheck` 실패 |
| `electron.vite.config.ts`의 `resolve.alias` | Vite/Rollup | 빌드 시 `Failed to resolve import` |
| `vitest.config.ts`의 `resolve.alias` | Vitest | 테스트 실행 시 모듈 못 찾음 |

(Q5에 앞의 둘, Q39에 셋째의 설정이 있다.)

**`shared/`에 무엇을 넣고 무엇을 넣지 않는가 — 이 경계가 전부다.**

`shared/`의 코드는 **renderer 번들에도 들어가고 main 번들에도 들어간다.** 따라서 여기에 Node 전용 코드가 하나라도 있으면 renderer 빌드가 깨진다.

```
shared/
├─ client.ts      ✓ OneDeskClient 인터페이스, Workspace/Issue/Run 등 DTO 타입
├─ events.ts      ✓ RunEvent 유니온 타입
├─ channels.ts    ✓ IPC 채널명 상수
├─ permissions.ts ✓ Permission 타입과 순수 함수 (Q24에서 씀)
├─ global.d.ts    ✓ Window 인터페이스 확장
└─ ✗ db/          ← 절대 금지. Drizzle 스키마는 core/db/schema.ts에.
   ✗ fs 유틸       ← 절대 금지.
```

**판별 기준을 한 문장으로:** *"이 파일이 브라우저에서 실행돼도 되는가?"* 답이 "아니오"면 `core/`로 보내라.

**타입만 있는 파일은 `export type`을 명시해라.** `verbatimModuleSyntax: true`(Q5의 base tsconfig)를 켜두면 컴파일러가 이를 강제한다.

```ts
// shared/client.ts
export type Permission = 'read_only' | 'edit' | 'full'
export type AgentKind = 'claude-code' | 'opencode'
export type RunStatus =
  | 'pending' | 'running' | 'succeeded'
  | 'failed' | 'canceled' | 'interrupted'

export interface RunSpec {
  workspaceId: string
  agentKind: AgentKind
  model: string | null
  cwd: string
  permission: Permission
  userPrompt: string
  contextItems: Array<{ type: 'repo' | 'issue' | 'memo' | 'asset'; id: string }>
  resumeSessionId?: string
  parentRunId?: string
}
```

```ts
// 소비 측 — import type을 쓰면 번들에서 완전히 사라진다
import type { RunSpec, Permission } from '@shared/client'
import { CHANNELS } from '@shared/channels'   // ← 값이므로 일반 import
```

**중복 정의를 피하는 요령 하나.** DB 스키마(core)와 DTO(shared)에 같은 필드를 두 번 쓰게 되는데, Drizzle이 스키마에서 타입을 뽑아주므로 **core 쪽에서 shared 타입과의 호환성을 컴파일 타임에 검증**할 수 있다.

```ts
// core/db/schema.ts 하단
import type { Workspace as WorkspaceDTO } from '@shared/client'

type Row = typeof workspace.$inferSelect

// 두 타입이 어긋나면 여기서 컴파일 에러가 난다.
// shared는 core를 모르지만, core는 shared를 알기 때문에 이 방향은 허용된다.
const _assertCompatible: (r: Row) => WorkspaceDTO = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  defaultAgentKind: r.defaultAgentKind,
  defaultModel: r.defaultModel,
  defaultPermission: r.defaultPermission,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
})
```

컬럼을 추가하고 DTO를 안 고치면 이 줄이 빨개진다. 런타임 비용은 0이다.

---

## 영역 3. SQLite + Drizzle ORM

### Q9. better-sqlite3가 "네이티브 모듈이라 electron-rebuild가 필요"한데, 안 하면 어떤 에러가 나나요? — A

**에러 메시지는 이것이다.**

```
Error: The module '/path/to/one-desk/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 141. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
```

**이 메시지를 정확히 읽는 법을 익혀두면 이 부류의 문제를 평생 스스로 푼다.**

`better-sqlite3`는 순수 JS가 아니라 **C++로 작성된 SQLite를 컴파일한 바이너리(`.node` 파일)** 를 포함한다. 이 바이너리는 Node의 C++ ABI(Application Binary Interface)에 맞춰 컴파일되며, ABI 버전을 **`NODE_MODULE_VERSION`** 이라는 정수로 식별한다.

문제의 뿌리는 **Electron이 자체 Node를 내장한다**는 사실이다.

| | 실행 주체 | Node 버전 | NODE_MODULE_VERSION |
|---|---|---|---|
| `pnpm install`이 컴파일한 대상 | 시스템 Node 22.16 | v22.16.0 | 127 |
| 실제 실행 환경 | Electron 43.3.0의 내장 Node | v22.x (Electron 빌드) | **141** |

> 위 숫자 중 시스템 Node 22의 `127`은 표준값이고, **Electron 43의 값은 `[확인 필요]`** 다. 확인 방법: `npx electron -e "console.log(process.versions.modules, process.versions.node, process.versions.electron)"`. 이 명령이 뱉는 첫 숫자가 정답이며, 위 에러에서 "requires" 뒤의 숫자와 일치해야 한다.

즉 **같은 v22 계열이어도 ABI가 다르다.** Electron은 V8을 자체 버전으로 올리고 Chromium과 함께 빌드하기 때문에 ABI 번호가 별도 계열을 쓴다. "Node 버전이 같으니 괜찮겠지"가 이 문제에서 가장 흔한 오해다.

**증상은 두 단계로 나타난다.**

1. `pnpm dev`로 개발 서버는 뜬다 (Vite는 문제없음).
2. main 프로세스가 `new Database(...)`를 실행하는 순간 위 에러로 **앱이 즉시 죽는다.** Electron 창은 흰 화면이거나 아예 안 뜬다.

**해결 방법 — `@electron/rebuild` 4.2.0을 쓴다.**

```json
// package.json
{
  "scripts": {
    "postinstall": "electron-rebuild -f -w better-sqlite3"
  },
  "dependencies": {
    "better-sqlite3": "13.0.3"
  },
  "devDependencies": {
    "@electron/rebuild": "4.2.0",
    "electron": "43.3.0"
  }
}
```

- `-f` (`--force`): 이미 빌드돼 있어도 다시 빌드한다.
- `-w better-sqlite3` (`--which-module`): 이 모듈만 리빌드한다. 전체를 훑으면 느리다.
- `postinstall`에 넣으면 `pnpm install` 후 자동 실행되어 팀원이 이 단계를 잊을 수 없다.

**pnpm을 쓸 때 반드시 필요한 추가 설정이 있다.** pnpm은 기본적으로 의존성의 빌드 스크립트를 실행하지 않는다(보안 기본값). `better-sqlite3`가 설치 시 `prebuild-install`을 못 돌리면 `build/Release/*.node`가 아예 생기지 않아 "Cannot find module" 계열 에러가 난다.

```yaml
# pnpm-workspace.yaml  (단일 패키지여도 이 파일 하나는 만든다)
onlyBuiltDependencies:
  - better-sqlite3
  - electron
```

> pnpm 10.x는 `package.json`의 `pnpm.onlyBuiltDependencies` 필드도 읽는다. 둘 중 편한 쪽을 쓰되 **반드시 하나는 설정해라.** 이걸 빠뜨리면 "왜 나만 안 되지"의 90%가 여기서 나온다.

**핵심 함정 — 테스트는 리빌드된 바이너리로 돌면 안 된다.**

`electron-rebuild`를 돌리면 `better_sqlite3.node`가 **Electron ABI로** 교체된다. 그 상태로 `vitest`(= 시스템 Node)를 실행하면 **정반대 방향의 같은 에러**가 난다.

```
compiled against ... NODE_MODULE_VERSION 141. This version requires 127.
```

이 앱은 `core/`를 순수 Node에서 테스트하는 것이 설계의 전제이므로(§12) 이 충돌은 반드시 일어난다. **해결책은 테스트에서 다른 SQLite 드라이버를 쓰는 것이다.** Node 22.16에는 실험적 내장 모듈 `node:sqlite`가 있고, Drizzle이 이를 지원한다.

```ts
// core/db/openDb.ts — 드라이버를 갈아끼울 수 있게 열어둔다
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export function openBetterSqlite(dbPath: string): Db {
  // 런타임(Electron)에서만 이 경로를 탄다
  const Database = require('better-sqlite3')
  const { drizzle } = require('drizzle-orm/better-sqlite3')
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}
```

**[확인 필요]** Drizzle 0.45.2에 `drizzle-orm/node-sqlite` 어댑터가 있는지는 검증하지 못했다. 확인 방법: `ls node_modules/drizzle-orm | grep -i sqlite`. 있으면 테스트용으로 그걸 쓰고, 없으면 **아래 대안이 확실하다.**

**대안(권장) — 테스트 실행 전에 시스템 Node용으로 되돌린다.** 스크립트 두 개를 나누면 헷갈릴 일이 없다.

```json
{
  "scripts": {
    "rebuild:electron": "electron-rebuild -f -w better-sqlite3",
    "rebuild:node": "pnpm rebuild better-sqlite3",
    "dev": "pnpm rebuild:electron && electron-vite dev",
    "test": "pnpm rebuild:node && vitest run",
    "test:watch": "vitest"
  }
}
```

`test:watch`에 리빌드를 넣지 않은 것은 매번 30초씩 기다리지 않기 위해서다. 워치 모드를 시작하기 전에 `pnpm rebuild:node`를 한 번만 수동으로 돌려라.

### Q10. Drizzle 마이그레이션은 어떤 파일을 만들고 앱이 언제 적용하나요? — B

**전체 그림부터.** Drizzle의 마이그레이션은 세 조각으로 이루어진다.

```
core/db/schema.ts          ← ① 당신이 손으로 쓰는 것 (TypeScript)
        │  pnpm db:generate
        ▼
drizzle/                   ← ② drizzle-kit이 생성하는 것 (건드리지 마라)
├─ 0000_init.sql
├─ 0001_add_run_timeout.sql
└─ meta/
   ├─ _journal.json        ← 적용 순서와 해시
   └─ 0000_snapshot.json   ← 스키마 스냅샷 (다음 diff의 기준)
        │  앱 시작 시 migrate()
        ▼
<userData>/one-desk.db     ← ③ 실제 DB. __drizzle_migrations 테이블이 생긴다.
```

**① 설정 파일.**

```ts
// drizzle.config.ts (프로젝트 루트)
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './core/db/schema.ts',
  out: './drizzle',
  // 개발 중 DB를 직접 들여다볼 때만 쓰인다.
  // 앱 런타임 경로(userData)와 무관하다 — 헷갈리지 마라.
  dbCredentials: { url: './.dev/one-desk.dev.db' },
  strict: true,
  verbose: true
})
```

**② 생성 명령.**

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:studio": "drizzle-kit studio",
    "db:check": "drizzle-kit check"
  }
}
```

`pnpm db:generate`를 돌리면 `schema.ts`와 마지막 스냅샷을 비교해 **차분(diff)만** 담은 SQL 파일을 만든다.

```
$ pnpm db:generate
5 tables
workspace 8 columns 0 indexes 0 fks
repo 7 columns 1 indexes 1 fks
...
[✓] Your SQL migration file ➜ drizzle/0000_init.sql
```

**생성된 SQL은 반드시 열어서 읽어라.** 특히 컬럼 이름을 바꿨을 때, drizzle-kit은 "삭제 후 추가"인지 "이름 변경"인지 판단하지 못해 대화형으로 물어본다. 잘못 답하면 **데이터가 날아가는 SQL이 생성된다.** 생성 후 `git diff`로 확인하는 습관을 들여라.

**③ 앱이 적용하는 시점 — main 프로세스 시작 직후, 창을 만들기 전.**

```ts
// electron/main.ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { createCore } from '../core'

let core: Core

async function bootstrap() {
  await app.whenReady()

  const userData = app.getPath('userData')
  const dbPath = path.join(userData, 'one-desk.db')

  // §11 "DB 마이그레이션: 적용 전 DB 파일 백업"
  backupBeforeMigrate(dbPath)

  core = createCore({
    dbPath,
    logsDir: path.join(userData, 'logs'),
    // 패키징되면 asar 안에 들어간다 — 경로 분기가 필요하다
    migrationsDir: app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(app.getAppPath(), 'drizzle')
  })

  await core.start()
  registerHandlers(core)
  createWindow()
}

bootstrap().catch((err) => {
  dialog.showErrorBox('one-desk 시작 실패', String(err))
  app.exit(1)
})
```

`createCore` 안에서 `migrate()`가 불린다 (Q7 코드 참고).

**[확인함] `migrate()`는 동기 함수다.** `drizzle-orm@0.45.2`의 타입 정의가 `declare function migrate<...>(db, config): void` — `Promise`가 아니다. better-sqlite3가 동기 드라이버이기 때문이다. `await migrate(...)`를 써도 동작은 하지만(await은 non-promise를 통과시킨다) 불필요하다.

**백업 구현 — §11의 요구사항.**

```ts
// electron/backup.ts
import fs from 'node:fs'
import path from 'node:path'

const MAX_BACKUPS = 5

export function backupBeforeMigrate(dbPath: string) {
  if (!fs.existsSync(dbPath)) return   // 최초 실행이면 백업할 것이 없다

  const dir = path.join(path.dirname(dbPath), 'backups')
  fs.mkdirSync(dir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(dbPath, path.join(dir, `one-desk-${stamp}.db`))

  // 오래된 것부터 정리
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    fs.unlinkSync(path.join(dir, f))
  }
}
```

> **WAL 모드 주의.** `journal_mode = WAL`을 쓰면 `-wal`, `-shm` 파일이 함께 생긴다. 위처럼 `.db`만 복사하면 아직 체크포인트되지 않은 트랜잭션을 놓칠 수 있다. **마이그레이션 직전에는 아직 DB를 열기 전이므로 안전하지만**, 다른 시점에 백업한다면 `sqlite.backup(dest)` (better-sqlite3 내장 API)를 써라. 그게 WAL을 올바르게 처리한다.

**개발 중 자주 겪는 상황과 대처.**

| 상황 | 대처 |
|---|---|
| 스키마를 고쳤는데 앱에 반영 안 됨 | `pnpm db:generate`를 안 돌렸다. 스키마 수정 → generate → 재시작이 한 세트다 |
| "migration hash mismatch" | 생성된 SQL을 손으로 고쳤다. 되돌리거나 `drizzle/`을 지우고 다시 생성해라 |
| 개발 DB를 초기화하고 싶다 | `<userData>/one-desk.db*`를 지우고 재시작. userData 경로는 `app.getPath('userData')`를 콘솔에 찍어 확인 |
| 팀원과 마이그레이션 충돌 | `drizzle/meta/_journal.json`이 충돌한다. **양쪽 마이그레이션을 합치지 말고**, 나중에 만든 쪽이 자기 것을 지우고 rebase 후 다시 generate |

### Q11. 섹션 5의 SQL DDL을 Drizzle의 TS 스키마로 어떻게 옮기나요? — B

**Drizzle에서는 SQL을 직접 쓰지 않는다.** TypeScript로 테이블을 선언하면 drizzle-kit이 SQL을 생성한다(Q10). 문법은 SQL과 1:1로 대응돼서 익히기 쉽다.

**설계 문서 §5의 DDL을 전부 옮긴 결과다. 그대로 쓸 수 있다.**

```ts
// core/db/schema.ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'
import { sql, relations } from 'drizzle-orm'

// ── 공통 헬퍼 ──────────────────────────────────────────
// 시각은 전부 epoch milliseconds(정수)로 저장한다.
// SQLite에는 날짜 타입이 없고, 정수로 두면 정렬·비교가 단순하며
// IPC 구조화 복제도 문제없이 통과한다.
const createdAt = () =>
  integer('created_at').notNull().default(sql`(unixepoch() * 1000)`)

// ── workspace ─────────────────────────────────────────
export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  defaultAgentKind: text('default_agent_kind', {
    enum: ['claude-code', 'opencode']
  }).notNull().default('claude-code'),
  defaultModel: text('default_model'),
  defaultPermission: text('default_permission', {
    enum: ['read_only', 'edit', 'full']
  }).notNull().default('edit'),
  createdAt: createdAt(),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`)
})

// ── repo ──────────────────────────────────────────────
export const repo = sqliteTable('repo', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt()
}, (t) => [
  index('repo_workspace_idx').on(t.workspaceId)
])

// ── issue ─────────────────────────────────────────────
export const issue = sqliteTable('issue', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  status: text('status', { enum: ['open', 'doing', 'done'] })
    .notNull()
    .default('open'),
  createdAt: createdAt(),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  closedAt: integer('closed_at')
}, (t) => [
  index('issue_workspace_status_idx').on(t.workspaceId, t.status)
])

// ── memo ──────────────────────────────────────────────
export const memo = sqliteTable('memo', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`)
}, (t) => [
  index('memo_workspace_idx').on(t.workspaceId)
])

// ── N:M 조인 테이블 ────────────────────────────────────
export const issueRepo = sqliteTable('issue_repo', {
  issueId: text('issue_id').notNull().references(() => issue.id, { onDelete: 'cascade' }),
  repoId: text('repo_id').notNull().references(() => repo.id, { onDelete: 'cascade' })
}, (t) => [
  primaryKey({ columns: [t.issueId, t.repoId] }),
  index('issue_repo_repo_idx').on(t.repoId)   // repo로 역방향 조회할 때 필요
])

export const memoRepo = sqliteTable('memo_repo', {
  memoId: text('memo_id').notNull().references(() => memo.id, { onDelete: 'cascade' }),
  repoId: text('repo_id').notNull().references(() => repo.id, { onDelete: 'cascade' })
}, (t) => [
  primaryKey({ columns: [t.memoId, t.repoId] }),
  index('memo_repo_repo_idx').on(t.repoId)
])

// ── asset ─────────────────────────────────────────────
export const asset = sqliteTable('asset', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['skill', 'agent'] }).notNull(),
  source: text('source', { enum: ['discovered', 'authored'] }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  repoId: text('repo_id').references(() => repo.id, { onDelete: 'set null' }),
  filePath: text('file_path'),
  content: text('content'),
  lastSeenAt: integer('last_seen_at'),
  createdAt: createdAt()
}, (t) => [
  index('asset_workspace_kind_idx').on(t.workspaceId, t.kind)
])

// ── run ───────────────────────────────────────────────
export const run = sqliteTable('run', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  agentKind: text('agent_kind', { enum: ['claude-code', 'opencode'] }).notNull(),
  model: text('model'),
  cwd: text('cwd').notNull(),
  permission: text('permission', { enum: ['read_only', 'edit', 'full'] }).notNull(),
  userPrompt: text('user_prompt').notNull(),
  assembledPrompt: text('assembled_prompt').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'succeeded', 'failed', 'canceled', 'interrupted']
  }).notNull().default('pending'),
  externalSessionId: text('external_session_id'),
  parentRunId: text('parent_run_id').references((): any => run.id, { onDelete: 'set null' }),
  resultText: text('result_text'),
  exitCode: integer('exit_code'),
  errorMessage: text('error_message'),
  logPath: text('log_path').notNull(),
  timeoutMs: integer('timeout_ms'),          // §11의 run별 타임아웃. 설계 DDL에 누락됨(구멍 #7)
  needsAnswer: integer('needs_answer', { mode: 'boolean' })
    .notNull().default(false),               // §10 "답변 필요" 판별용(구멍 #8)
  reviewedAt: integer('reviewed_at'),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  createdAt: createdAt()
}, (t) => [
  // 인박스 쿼리의 핵심 인덱스. reviewed_at IS NULL + status 조합을 탄다.
  index('run_inbox_idx').on(t.reviewedAt, t.status),
  index('run_workspace_created_idx').on(t.workspaceId, t.createdAt)
])

export const runContextItem = sqliteTable('run_context_item', {
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  itemType: text('item_type', { enum: ['repo', 'issue', 'memo', 'asset'] }).notNull(),
  itemId: text('item_id').notNull()
}, (t) => [
  primaryKey({ columns: [t.runId, t.itemType, t.itemId] })
])

export const runFileChange = sqliteTable('run_file_change', {
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  changeType: text('change_type', { enum: ['created', 'modified', 'deleted'] }).notNull(),
  beforePath: text('before_path')
}, (t) => [
  primaryKey({ columns: [t.runId, t.filePath] })
])

// ── 앱 전역 설정 (설계 DDL에 없음 — 구멍 #6) ──────────
export const appSetting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull()   // JSON 문자열
})
```

**SQL DDL과 대응이 헷갈리는 지점 네 가지를 짚어둔다.**

**① `text(..., { enum: [...] })`은 DB 제약이 아니라 타입 힌트다.**
SQLite에는 ENUM 타입이 없다. Drizzle의 `enum` 옵션은 **TypeScript 타입만** 좁힌다. 생성되는 SQL은 그냥 `TEXT`이고, 잘못된 값도 DB는 받아들인다. 진짜 방어는 애플리케이션 계층(zod 등)에서 한다. 그래도 이걸 쓰는 이유는 `run.status`에 오타를 쓰면 컴파일 에러가 나기 때문이다.

**② boolean 컬럼은 `integer(..., { mode: 'boolean' })`.**
SQLite에 boolean이 없어 0/1로 저장된다. `mode: 'boolean'`을 주면 Drizzle이 읽고 쓸 때 자동 변환해준다.

**③ 자기 참조 FK(`parentRunId`)에는 반환 타입 주석이 필요하다.**
`references((): any => run.id, ...)` — `run`이 아직 정의 중이라 TypeScript가 순환 추론에 빠진다. `: any`(또는 `: AnySQLiteColumn`)를 명시해 끊어준다. **이걸 빼면 "circularly references itself" 에러가 난다.**

**④ 인덱스 정의는 배열을 반환한다.**
Drizzle 0.4x부터 두 번째 인자 콜백이 **객체가 아니라 배열**을 반환하는 형태로 바뀌었다. 인터넷의 옛 예제는 `=> ({ idx: index(...) })` 형태인데 그러면 deprecation 경고가 뜬다.

**FK를 실제로 작동시키려면 pragma가 필요하다.** SQLite는 기본적으로 외래키 제약을 **끄고** 시작한다. `sqlite.pragma('foreign_keys = ON')`(Q7의 `createCore`)이 없으면 `onDelete: 'cascade'`가 조용히 무시되어, workspace를 지워도 issue가 고아로 남는다. **연결마다** 설정해야 하므로 `openDb` 안에 넣어라.

### Q12. `issue_repo`, `memo_repo` N:M 조인 테이블은 리포지토리 계층에서 어떻게 쿼리하나요? — B

먼저 **"리포지토리 계층"** 이 뭔지부터. 거창한 게 아니다.

> **리포지토리 = "이 테이블에 대한 모든 SQL을 모아둔 클래스."**

목적은 하나다. **SQL이 앱 전체에 흩어지지 않게 하는 것.** IPC 핸들러, MCP 도구, 인박스 로직이 각자 쿼리를 짜면 같은 조건이 미묘하게 달라지고(예: 인박스 조건) 버그가 난다. 리포지토리를 두면 그 조건이 한 곳에만 있다.

```
electron/ipc  ─┐
core/mcp      ─┼→ IssueRepository → Drizzle → SQLite
core/context  ─┘
```

**N:M을 다루는 방법은 Drizzle에 두 가지가 있다. 둘 다 알아야 한다.**

**방법 A — Relational Query (`db.query.*`). 읽기에 쓴다.**

먼저 `relations`를 선언해야 이 API가 열린다. 이건 **런타임 SQL이 아니라 타입 레벨 선언**이라 DB에 영향이 없다.

```ts
// core/db/schema.ts 하단에 추가
export const issueRelations = relations(issue, ({ many, one }) => ({
  workspace: one(workspace, {
    fields: [issue.workspaceId],
    references: [workspace.id]
  }),
  issueRepos: many(issueRepo)
}))

export const repoRelations = relations(repo, ({ many }) => ({
  issueRepos: many(issueRepo),
  memoRepos: many(memoRepo)
}))

// 조인 테이블도 양쪽을 가리키도록 선언한다 — 이게 N:M의 핵심이다
export const issueRepoRelations = relations(issueRepo, ({ one }) => ({
  issue: one(issue, { fields: [issueRepo.issueId], references: [issue.id] }),
  repo: one(repo, { fields: [issueRepo.repoId], references: [repo.id] })
}))

export const memoRepoRelations = relations(memoRepo, ({ one }) => ({
  memo: one(memo, { fields: [memoRepo.memoId], references: [memo.id] }),
  repo: one(repo, { fields: [memoRepo.repoId], references: [repo.id] })
}))
```

**방법 B — 명시적 `innerJoin`. 필터링에 쓴다.**

**리포지토리 전체 구현이다.**

```ts
// core/db/repositories/issueRepository.ts
import { and, eq, inArray, desc, isNull } from 'drizzle-orm'
import { issue, issueRepo, repo } from '../schema'
import type { Db } from '../openDb'
import type { Issue, IssueQuery } from '@shared/client'

export class IssueRepository {
  constructor(private readonly db: Db) {}

  /**
   * 목록 조회. repoId가 주어지면 해당 repo가 태깅된 이슈만 반환한다.
   *
   * 조인 테이블 필터링은 innerJoin으로 한다.
   * "이 repo에 태깅된 이슈"는 issue_repo에 행이 존재한다는 뜻이므로
   * innerJoin이 곧 필터가 된다.
   */
  list(q: IssueQuery): Issue[] {
    const conds = [eq(issue.workspaceId, q.workspaceId)]
    if (q.status) conds.push(eq(issue.status, q.status))

    if (q.repoId) {
      const rows = this.db
        .select({ issue })                       // ← 조인해도 issue 컬럼만 뽑는다
        .from(issue)
        .innerJoin(issueRepo, eq(issueRepo.issueId, issue.id))
        .where(and(...conds, eq(issueRepo.repoId, q.repoId)))
        .orderBy(desc(issue.updatedAt))
        .all()
      return this.attachRepoIds(rows.map((r) => r.issue))
    }

    const rows = this.db
      .select()
      .from(issue)
      .where(and(...conds))
      .orderBy(desc(issue.updatedAt))
      .all()
    return this.attachRepoIds(rows)
  }

  /**
   * N+1 방지: 이슈 N개의 repo 태그를 쿼리 1번으로 가져와 메모리에서 묶는다.
   *
   * 순진하게 이슈마다 태그를 조회하면 이슈 50개에 쿼리 51번이 나간다.
   * better-sqlite3가 동기라서 "느려도 돌아가긴 해서" 눈치채기 어렵다.
   * 처음부터 이 형태로 써라.
   */
  private attachRepoIds(issues: Array<typeof issue.$inferSelect>): Issue[] {
    if (issues.length === 0) return []

    const links = this.db
      .select()
      .from(issueRepo)
      .where(inArray(issueRepo.issueId, issues.map((i) => i.id)))
      .all()

    const byIssue = new Map<string, string[]>()
    for (const l of links) {
      const arr = byIssue.get(l.issueId) ?? []
      arr.push(l.repoId)
      byIssue.set(l.issueId, arr)
    }

    return issues.map((i) => ({ ...i, repoIds: byIssue.get(i.id) ?? [] }))
  }

  /** 상세 조회 — 여기서는 relational query가 더 읽기 좋다 */
  findById(id: string): (Issue & { repos: Array<{ id: string; name: string }> }) | null {
    const row = this.db.query.issue.findFirst({
      where: eq(issue.id, id),
      with: {
        issueRepos: { with: { repo: true } }   // 조인 테이블을 거쳐 repo까지
      }
    })
    if (!row) return null

    return {
      ...row,
      repoIds: row.issueRepos.map((ir) => ir.repoId),
      repos: row.issueRepos.map((ir) => ({ id: ir.repo.id, name: ir.repo.name }))
    }
  }

  /**
   * 생성 — 이슈 삽입과 태그 삽입이 하나의 트랜잭션이어야 한다.
   * 중간에 실패하면 태그 없는 고아 이슈가 남는다.
   *
   * better-sqlite3는 동기이므로 콜백도 동기다. async를 쓰지 마라.
   */
  create(input: { workspaceId: string; title: string; body: string; repoIds?: string[] }): Issue {
    const id = crypto.randomUUID()
    const now = Date.now()

    return this.db.transaction((tx) => {
      tx.insert(issue).values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body,
        status: 'open',
        createdAt: now,
        updatedAt: now
      }).run()

      if (input.repoIds?.length) {
        tx.insert(issueRepo)
          .values(input.repoIds.map((repoId) => ({ issueId: id, repoId })))
          .run()
      }

      return { ...input, id, status: 'open' as const, createdAt: now, updatedAt: now,
               closedAt: null, repoIds: input.repoIds ?? [] }
    })
  }

  /**
   * 태그 갱신 — "전부 지우고 다시 넣기"가 가장 단순하고 안전하다.
   * 차분(diff)을 계산하려 들지 마라. 태그 수가 적어 성능 차이가 없고,
   * 차분 로직은 버그의 온상이다.
   */
  setRepos(issueId: string, repoIds: string[]): void {
    this.db.transaction((tx) => {
      tx.delete(issueRepo).where(eq(issueRepo.issueId, issueId)).run()
      if (repoIds.length) {
        tx.insert(issueRepo).values(repoIds.map((repoId) => ({ issueId, repoId }))).run()
      }
      tx.update(issue).set({ updatedAt: Date.now() }).where(eq(issue.id, issueId)).run()
    })
  }

  /** repo별 이슈 수 — repo 스트립 카드의 배지에 쓴다 (§9) */
  countByRepo(workspaceId: string): Map<string, number> {
    const rows = this.db
      .select({ repoId: issueRepo.repoId, issueId: issue.id })
      .from(issueRepo)
      .innerJoin(issue, eq(issue.id, issueRepo.issueId))
      .where(and(eq(issue.workspaceId, workspaceId), eq(issue.status, 'open')))
      .all()

    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.repoId, (counts.get(r.repoId) ?? 0) + 1)
    return counts
  }
}
```

**꼭 기억할 네 가지.**

**① `.all()` / `.get()` / `.run()`을 붙여야 실행된다.**
Drizzle의 쿼리 빌더는 **지연 실행**이다. `.all()`을 빼면 쿼리 객체만 만들고 끝난다. better-sqlite3(동기)에서는 `await`이 필요 없는 대신 이 종결 메서드가 필수다. `select`는 `.all()`(여러 행) 또는 `.get()`(한 행), `insert`/`update`/`delete`는 `.run()`이다. **`await db.select()...`라고 쓰면 쿼리 객체가 그대로 반환되어 "빈 배열이 아닌 이상한 객체"가 나온다.** 이 실수를 반드시 한 번은 한다.

**② 트랜잭션 콜백을 `async`로 만들지 마라.**
better-sqlite3는 동기 드라이버다. `db.transaction(async (tx) => ...)`로 쓰면 트랜잭션이 콜백 완료 전에 커밋되어 **원자성이 깨진다.** 동기 콜백만 쓴다.

**③ `select({ issue })`로 조인 결과를 좁혀라.**
`.select()`를 인자 없이 쓰고 조인하면 결과가 `{ issue: {...}, issue_repo: {...} }` 형태로 중첩되어 나온다. 필요한 것만 명시하면 매핑 코드가 줄어든다.

**④ "태그가 하나도 없으면 workspace 공통"(§5)을 잊지 마라.**
`q.repoId`로 필터링할 때 태그 없는 이슈는 `innerJoin`에서 탈락한다. 설계 의도상 **repo 카드를 선택했을 때 공통 이슈도 함께 보여야 한다면** `leftJoin` + `OR` 조건이 필요하다. 이건 설계에 명시돼 있지 않으니(구멍 목록 #9) UI 결정 후 확정해라. 필터를 "공통 포함"으로 할 경우의 쿼리는 이렇다.

```ts
// repo 필터 + 태그 없는 공통 항목 포함
const tagged = this.db.select({ id: issueRepo.issueId }).from(issueRepo)
const rows = this.db
  .select()
  .from(issue)
  .where(and(
    eq(issue.workspaceId, q.workspaceId),
    or(
      inArray(issue.id,
        this.db.select({ id: issueRepo.issueId }).from(issueRepo)
          .where(eq(issueRepo.repoId, q.repoId!))
      ),
      notInArray(issue.id, tagged)   // 어떤 repo에도 태깅되지 않은 것
    )
  ))
  .all()
```

---

## 영역 4. Agent 실행 파이프라인

> 이 영역의 CLI 관련 내용은 **로컬에 설치된 `claude` 2.1.224로 직접 실행해 확인**했다. 확인 방법도 함께 적었으니, 버전이 올라가면 같은 방법으로 재확인해라.

### Q13. `SpawnSpec(cmd, args, env)`으로 실제 프로세스를 어떻게 띄우고 stdout을 읽나요? — B

**`child_process.spawn`의 정신 모델부터.** `spawn`은 자식 프로세스를 만들고 **세 개의 파이프**를 돌려준다.

```
        one-desk (main 프로세스)
                │
      spawn()   │
                ▼
        ┌───────────────┐
   ─────│ stdin  (쓰기) │←── 우리가 프롬프트를 써넣는다
        │───────────────│
   ─────│ stdout (읽기) │──→ JSONL 스트림. 여기가 핵심.
        │───────────────│
   ─────│ stderr (읽기) │──→ 에러 메시지. 반드시 따로 모은다.
        └───────────────┘
          claude 프로세스
```

세 스트림은 Node의 `Readable`/`Writable`이고, `'data'`, `'end'`, `'error'` 이벤트를 낸다. 그리고 프로세스 자체가 `'exit'`, `'close'`, `'error'` 이벤트를 낸다.

**`SpawnSpec` 타입 정의.**

```ts
// core/runner/types.ts
export interface SpawnSpec {
  cmd: string                       // 실행 파일 절대경로 (Q15)
  args: string[]                    // 인자 배열. 셸 파싱을 거치지 않는다.
  env: Record<string, string>       // 추가 환경변수
  cwd: string                       // 작업 디렉토리
  stdinPayload?: string             // stdin으로 넣을 프롬프트
  cleanup?: () => void              // 임시 파일 정리 (Q23의 OpenCode 설정 파일 등)
}
```

**프로세스를 띄우고 관리하는 전체 코드.**

```ts
// core/runner/spawnAgent.ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createLineSplitter } from './lineSplitter'
import type { SpawnSpec } from './types'

export interface AgentProcessHandle {
  pid: number | undefined
  kill(signal: NodeJS.Signals): boolean
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

export interface SpawnCallbacks {
  onStdoutLine(line: string): void
  onStderrChunk(text: string): void
  onSpawnError(err: Error): void
}

export function spawnAgent(spec: SpawnSpec, cb: SpawnCallbacks): AgentProcessHandle {
  const child: ChildProcessWithoutNullStreams = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    // ['pipe','pipe','pipe']가 기본값이지만 명시한다.
    // 'inherit'로 두면 부모 콘솔로 흘러가서 우리가 읽을 수 없다.
    stdio: ['pipe', 'pipe', 'pipe'],
    // shell: false 가 기본값. 절대 true로 바꾸지 마라 —
    // 프롬프트에 들어간 따옴표/세미콜론이 셸 명령으로 해석되어 임의 코드 실행이 된다.
    shell: false,
    // 자식을 새 프로세스 그룹의 리더로 만든다.
    // 이게 있어야 Q19에서 자손 프로세스까지 한 번에 죽일 수 있다.
    detached: process.platform !== 'win32'
  })

  // ── stdout: 줄 단위로 잘라서 넘긴다 (Q14) ──
  child.stdout.setEncoding('utf8')
  const splitStdout = createLineSplitter(cb.onStdoutLine)
  child.stdout.on('data', splitStdout.push)

  // ── stderr: 줄 단위일 필요 없다. 통째로 모은다. ──
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', cb.onStderrChunk)

  // ── spawn 자체의 실패 (파일 없음, 권한 없음) ──
  // 'error'는 'exit'과 배타적이다. ENOENT면 exit이 오지 않는다.
  child.on('error', cb.onSpawnError)

  // ── 프롬프트를 stdin으로 넣는다 ──
  // 인자로 넘기지 않는 이유: OS의 인자 길이 상한(macOS 약 256KB)에 걸린다.
  // 맥락이 붙은 assembled_prompt는 쉽게 수십 KB가 된다.
  if (spec.stdinPayload !== undefined) {
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      // 자식이 stdin을 다 읽기 전에 죽으면 EPIPE가 난다.
      // 이건 정상적인 종료 경로이므로 무시한다. 처리 안 하면 main이 크래시한다.
      if (err.code !== 'EPIPE') cb.onSpawnError(err)
    })
    child.stdin.write(spec.stdinPayload)
    child.stdin.end()          // ← EOF를 보내야 CLI가 읽기를 멈추고 시작한다. 빼면 영원히 대기한다.
  }

  // ── 종료 대기 ──
  // 'exit'이 아니라 'close'를 쓴다.
  // 'exit'은 프로세스가 끝난 시점, 'close'는 stdout/stderr까지 모두 닫힌 시점이다.
  // 'exit'에서 정리하면 마지막 몇 줄의 로그를 놓친다.
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('close', (code, signal) => {
      splitStdout.flush()      // 개행 없이 끝난 마지막 줄을 흘려보낸다 (Q14)
      spec.cleanup?.()
      resolve({ code, signal })
    })
  })

  return {
    pid: child.pid,
    kill: (signal) => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          // 음수 pid = 프로세스 그룹 전체.
          // detached: true 와 짝이다. agent가 띄운 자식(npm, git 등)까지 함께 죽인다.
          process.kill(-child.pid, signal)
          return true
        }
        return child.kill(signal)
      } catch {
        return false   // 이미 죽었으면 ESRCH가 난다. 정상이다.
      }
    },
    exited
  }
}
```

**설계에서 놓치기 쉬운 결정 네 가지를 명시해둔다.**

**① 프롬프트는 인자가 아니라 stdin으로 넣는다.**
`claude -p "<프롬프트>"`처럼 인자로 넘기면 `assembled_prompt`가 커질 때 `E2BIG` 에러가 난다. `echo "..." | claude -p`가 CLI가 상정한 형태이고, 실제로 이 문서의 검증도 전부 stdin 방식으로 했다.

**② `shell: false`를 지켜라.**
`shell: true`로 하면 `args` 배열이 하나의 문자열로 합쳐져 셸에 전달된다. 프롬프트에 `; rm -rf ~`가 들어 있으면 그대로 실행된다. `spawn`의 배열 인자 방식이 안전한 이유가 바로 셸을 거치지 않기 때문이다.

**③ `detached: true` + `process.kill(-pid)` 조합.**
agent는 `Bash` 도구로 `npm test` 같은 자식을 만든다. `child.kill()`은 `claude` 프로세스만 죽이고 그 자손은 고아가 되어 계속 돈다. 프로세스 그룹째 죽여야 §6의 "앱 종료 시 실행 중인 모든 프로세스를 정리한다"가 실제로 지켜진다.

**④ `'error'`와 `'exit'`은 배타적이다.**
실행 파일이 없으면(`ENOENT`) `'error'`만 오고 `'exit'`은 오지 않는다. 종료 처리를 `'exit'`에만 걸어두면 **run이 영원히 `running`으로 남는다.** 위 코드는 `onSpawnError`에서도 run을 종료시키도록 호출부에서 처리해야 한다.

### Q14. stdout이 항상 완전한 한 줄 단위로 들어오나요? 잘려서 들어오면 어떻게 하나요? — B

**아니다. 절대 보장되지 않는다.** 이건 "가끔 나는 버그"가 아니라 **파이프의 근본 성질**이다.

`stdout`은 바이트 스트림이다. OS 파이프 버퍼(리눅스 기본 64KB)가 찰 때마다, 혹은 자식이 flush할 때마다 청크가 온다. 청크 경계와 줄 경계는 **아무 관계가 없다.**

```
자식이 쓴 것:
  {"type":"assistant",...}\n{"type":"result",...}\n

우리가 받는 것 (예시):
  청크1: '{"type":"assist'
  청크2: 'ant",...}\n{"type":"res'
  청크3: 'ult",...}\n'
```

**이 앱에서는 반드시 터진다.** 이유가 두 가지다.

1. Claude Code의 `assistant` 이벤트에는 `thinking` 블록의 `signature` 필드가 들어가는데, **실측 결과 이 한 줄만 3~5KB**였다. 파일을 읽은 `tool_result`는 수십 KB가 된다.
2. **64KB를 넘는 단일 JSON 줄**도 흔하다. 큰 파일을 `Read`한 결과가 그렇다.

순진하게 `chunk.split('\n')`을 하면 **JSON.parse가 깨지고, §11의 "파싱 실패는 raw로 남기고 계속"에 걸려 이벤트가 통째로 유실된다.** 게다가 증상이 "긴 파일을 읽을 때만 로그가 이상해진다"로 나타나 원인을 찾기 매우 어렵다.

**해결 — 버퍼를 유지하는 줄 분할기. 이 파일은 그대로 쓰면 된다.**

```ts
// core/runner/lineSplitter.ts

/**
 * 청크 스트림을 줄 단위로 재조립한다.
 *
 * 규칙:
 *  - 마지막 개행 이후의 미완성 부분은 버퍼에 남긴다.
 *  - flush()는 스트림 종료 시 호출한다. 개행 없이 끝난 마지막 줄을 흘려보낸다.
 *  - \r\n(Windows)과 \n을 모두 처리한다.
 */
export function createLineSplitter(onLine: (line: string) => void) {
  let buffer = ''

  return {
    push(chunk: string) {
      buffer += chunk

      let index: number
      while ((index = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)

        if (line.endsWith('\r')) line = line.slice(0, -1)   // CRLF 대응
        if (line.length > 0) onLine(line)                   // 빈 줄은 버린다
      }
    },

    flush() {
      const rest = buffer.trim()
      buffer = ''
      if (rest.length > 0) onLine(rest)
    }
  }
}
```

**테스트로 고정해라. 이 테스트가 있으면 이 부류의 버그가 영원히 재발하지 않는다.**

```ts
// core/runner/__tests__/lineSplitter.test.ts
import { describe, it, expect } from 'vitest'
import { createLineSplitter } from '../lineSplitter'

describe('createLineSplitter', () => {
  it('청크 경계가 줄 중간을 갈라도 온전히 재조립한다', () => {
    const lines: string[] = []
    const s = createLineSplitter((l) => lines.push(l))

    s.push('{"a":')
    s.push('1}\n{"b"')
    s.push(':2}\n')

    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('한 청크에 여러 줄이 들어와도 모두 분리한다', () => {
    const lines: string[] = []
    const s = createLineSplitter((l) => lines.push(l))
    s.push('a\nb\nc\n')
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('개행 없이 끝난 마지막 줄은 flush에서 나온다', () => {
    const lines: string[] = []
    const s = createLineSplitter((l) => lines.push(l))
    s.push('{"last":true}')
    expect(lines).toEqual([])      // 아직 안 나옴
    s.flush()
    expect(lines).toEqual(['{"last":true}'])
  })

  it('한 글자씩 밀어넣어도(최악의 경우) 동일한 결과', () => {
    const lines: string[] = []
    const s = createLineSplitter((l) => lines.push(l))
    for (const ch of '{"x":1}\n{"y":2}\n') s.push(ch)
    expect(lines).toEqual(['{"x":1}', '{"y":2}'])
  })
})
```

**`readline` 모듈을 쓰면 안 되나?** 써도 된다.

```ts
import readline from 'node:readline'
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
rl.on('line', onLine)
```

동작은 똑같다. 그럼에도 직접 만든 것을 권하는 이유는 **테스트 때문**이다. `createLineSplitter`는 스트림 없이 문자열만으로 테스트할 수 있어서 위 4개 테스트가 밀리초 안에 끝난다. `readline`을 쓰면 가짜 `Readable`을 만들어야 하고, 파싱 로직과 스트림 배선이 한 덩어리가 되어 분리 테스트가 안 된다.

> **`setEncoding('utf8')`을 반드시 호출해라** (Q13 코드에 포함돼 있다). 이게 없으면 `Buffer`가 오고, `buffer += chunk`가 암묵적 `toString()`을 하는데 **멀티바이트 문자(한글)가 청크 경계에 걸리면 깨진다.** `setEncoding`을 하면 Node의 `StringDecoder`가 그 경계를 알아서 처리해준다. 한글 프롬프트를 쓰는 이 앱에서는 필수다.

### Q15. CLI 실행 파일은 어떻게 찾나요? PATH인가요, 사용자 입력 절대경로인가요? — B

**둘 다다. 우선순위를 정해서 순서대로 찾고, 다 실패하면 사용자에게 묻는다.**

**여기에는 Electron 특유의 함정이 하나 있고, 이걸 모르면 "터미널에서는 되는데 앱에서만 안 됨"에 반나절을 쓴다.**

> **macOS에서 Finder/Dock으로 실행한 GUI 앱은 셸 설정 파일(`.zshrc`, `.bash_profile`)을 읽지 않는다.** 따라서 `process.env.PATH`가 `/usr/bin:/bin:/usr/sbin:/sbin` 정도로 빈약하다. nvm, Homebrew, pnpm global이 설치한 실행 파일은 **전부 이 PATH에 없다.** `pnpm dev`로 터미널에서 띄우면 터미널의 PATH를 물려받아 잘 되기 때문에, **패키징해서 배포한 뒤에야 터지는** 최악의 형태로 나타난다.

**해결 — 탐색 순서를 명시적으로 구현한다.**

```ts
// core/runner/resolveExecutable.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ResolveResult {
  found: boolean
  path?: string
  version?: string
  searched: string[]      // 어디를 뒤졌는지. 사용자에게 보여주면 자가 진단이 된다.
  hint?: string
}

/** nvm / homebrew / pnpm 등 GUI 앱의 PATH에서 누락되는 표준 위치들 */
function candidateDirs(): string[] {
  const home = os.homedir()
  const dirs = [
    '/opt/homebrew/bin',              // Apple Silicon Homebrew
    '/usr/local/bin',                 // Intel Homebrew, 수동 설치
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, 'Library', 'pnpm'),
    path.join(home, '.claude', 'local')
  ]

  // nvm은 버전별 디렉토리라 글롭이 필요하다
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node')
  if (fs.existsSync(nvmRoot)) {
    for (const v of fs.readdirSync(nvmRoot)) {
      dirs.push(path.join(nvmRoot, v, 'bin'))
    }
  }
  return dirs
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * 탐색 우선순위:
 *   1) 사용자가 workspace 설정에 직접 지정한 절대경로  (§11)
 *   2) 환경변수 override (개발/테스트용 — Q38에서 이걸 쓴다)
 *   3) process.env.PATH
 *   4) 알려진 설치 위치들
 */
export async function resolveExecutable(
  binName: 'claude' | 'opencode',
  userConfiguredPath?: string | null
): Promise<ResolveResult> {
  const searched: string[] = []

  const tryPath = async (p: string): Promise<ResolveResult | null> => {
    searched.push(p)
    if (!isExecutable(p)) return null
    const version = await probeVersion(p)
    // --version이 실패하면 실행 가능한 다른 파일일 수 있다. 신뢰하지 않는다.
    if (version === null) return null
    return { found: true, path: p, version, searched }
  }

  // 1) 사용자 지정
  if (userConfiguredPath) {
    const r = await tryPath(userConfiguredPath)
    if (r) return r
    return {
      found: false,
      searched,
      hint: `설정된 경로에 실행 가능한 ${binName}이 없습니다: ${userConfiguredPath}`
    }
  }

  // 2) 환경변수 override
  const envKey = binName === 'claude' ? 'ONEDESK_CLAUDE_PATH' : 'ONEDESK_OPENCODE_PATH'
  const fromEnv = process.env[envKey]
  if (fromEnv) {
    const r = await tryPath(fromEnv)
    if (r) return r
  }

  // 3) PATH
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  // 4) 알려진 위치
  for (const dir of [...pathDirs, ...candidateDirs()]) {
    const r = await tryPath(path.join(dir, binName))
    if (r) return r
  }

  return {
    found: false,
    searched,
    hint:
      `${binName} 실행 파일을 찾지 못했습니다.\n` +
      `터미널에서 \`which ${binName}\`을 실행한 뒤, 나온 경로를 ` +
      `workspace 설정 > CLI 경로에 붙여넣어 주세요.`
  }
}

/** --version이 정상 응답하는지로 "진짜 그 CLI인지"를 검증한다 */
async function probeVersion(execPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(execPath, ['--version'], {
      timeout: 5000,
      windowsHide: true
    })
    return stdout.trim()
  } catch {
    return null
  }
}
```

**[확인함] `claude --version`의 출력 형식은 `2.1.224 (Claude Code)`** 이다. 버전 문자열을 파싱해 최소 버전을 강제하고 싶다면 `/^(\d+)\.(\d+)\.(\d+)/`로 앞부분만 취해라.
**[확인 필요] `opencode --version`의 출력 형식**은 확인하지 못했다(로컬 미설치). 확인 방법: `opencode --version`을 직접 실행. 어떤 형식이든 `probeVersion`은 "에러 없이 뭔가 출력하면 통과"이므로 코드 수정 없이 동작한다.

**`preflight()`는 이것을 감싼다.**

```ts
// core/runner/adapters/claudeCode.ts
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const
  private cachedPath: string | null = null

  async preflight(userPath?: string | null): Promise<PreflightResult> {
    const exe = await resolveExecutable('claude', userPath)
    if (!exe.found) {
      return { ok: false, reason: 'executable_not_found', message: exe.hint!, searched: exe.searched }
    }
    this.cachedPath = exe.path!
    return { ok: true, executablePath: exe.path!, version: exe.version! }
  }
}
```

**§11의 "실행 버튼 단계에서 차단"을 구현하는 자리는 여기다.**

```ts
// 실행 패널이 열릴 때 + workspace를 전환할 때 호출한다.
// 매 실행마다 호출하면 --version 프로세스가 계속 떠서 느려진다.
ipcMain.handle('runs.preflight', async (_e, { agentKind, cwd, workspaceId }) => {
  const adapter = core.runner.adapters.get(agentKind)!
  const ws = core.workspaces.findById(workspaceId)
  const exe = await adapter.preflight(ws?.cliPath ?? null)
  const cwdOk = fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()   // §11 repo 경로 확인
  return {
    canRun: exe.ok && cwdOk,
    executable: exe,
    cwd: cwdOk ? { ok: true } : { ok: false, message: `작업 디렉토리가 없습니다: ${cwd}` }
  }
})
```

> **결과를 캐시하되 무한히 캐시하지 마라.** 사용자가 앱을 켠 채로 CLI를 업데이트하거나 repo 폴더를 옮길 수 있다. workspace 전환 시와 실행 패널 오픈 시에 다시 확인하는 정도가 적당하다.

### Q16. `--append-system-prompt`, `--output-format stream-json`, `--mcp-config` 플래그의 정확한 값 형식은? — B

**전부 `claude --help` (2.1.224)와 실제 실행으로 확인했다.**

| 플래그 | 값 형식 | 확인 |
|---|---|---|
| `-p`, `--print` | 값 없음 (boolean) | [확인함] |
| `--output-format` | `text` \| `json` \| `stream-json` | [확인함] |
| `--verbose` | 값 없음. **`-p`+`stream-json`에서 필수** | [확인함] |
| `--append-system-prompt` | 문자열 하나. 인자로 직접 전달 | [확인함] |
| `--mcp-config` | **파일 경로 또는 JSON 문자열.** 공백 구분 다중 지정 가능 | [확인함] |
| `--strict-mcp-config` | 값 없음. `--mcp-config` 것만 쓰고 나머지 무시 | [확인함] |
| `--permission-mode` | `acceptEdits` \| `auto` \| `bypassPermissions` \| `manual` \| `dontAsk` \| `plan` | [확인함] |
| `--allowedTools` | 공백 또는 쉼표 구분 도구명 목록 | [확인함] |
| `--disallowedTools` | 동상 | [확인함] |
| `--tools` | 공백/쉼표 구분. **빌트인 도구 집합만** 제한 | [확인함] |
| `--model` | 별칭(`sonnet`, `opus`) 또는 전체명 | [확인함] |
| `--resume` | 세션 ID (UUID) | [확인함, 플래그 존재] |
| `--add-dir` | 디렉토리 경로 (다중) | [확인함] |

**⚠️ 가장 중요한 발견 — `--verbose`가 없으면 실행 자체가 거부된다.**

```
$ echo "test" | claude -p --output-format stream-json
Error: When using --print, --output-format=stream-json requires --verbose
```

설계 문서 §6의 대응표에는 `--verbose`가 없다. **빠뜨리면 2단계에서 첫 실행이 즉시 실패한다.**

**⚠️ 두 번째 발견 — `--bare`를 쓰지 마라.**
`--bare`는 hook/CLAUDE.md를 건너뛰어 깔끔해 보이지만, **OAuth와 keychain을 읽지 않는다.** 실측 결과 `Not logged in · Please run /login`으로 실패했다. 구독 인증을 쓰는 사용자의 앱이 통째로 죽는다.

**`--append-system-prompt`의 값 형식.** 평범한 문자열 인자다. 셸을 거치지 않으므로(`shell: false`) **따옴표를 직접 넣지 마라.**

```ts
// ✓ 올바름
args.push('--append-system-prompt', systemPromptText)

// ✗ 틀림 — 따옴표가 문자열의 일부가 되어 프롬프트에 그대로 들어간다
args.push('--append-system-prompt', `"${systemPromptText}"`)
```

**`--mcp-config`의 값 형식 — 파일과 JSON 문자열 둘 다 된다. [확인함]**

실제로 아래 JSON **문자열**을 그대로 넘겨 MCP 서버 연결에 성공했다.

```json
{"mcpServers":{"onedesk":{"type":"http","url":"http://127.0.0.1:63703/mcp","headers":{"Authorization":"Bearer tok-readonly"}}}}
```

`system`/`init` 이벤트에 `"mcp_servers":[{"name":"onedesk","status":"connected"}]`가 찍히고, 도구가 `mcp__onedesk__list_issues`라는 이름으로 노출됐다.

**어느 쪽을 쓸 것인가 — 이 앱에서는 "임시 파일"을 권한다.** 이유는 보안이다. JSON 문자열로 넘기면 **MCP 토큰이 프로세스 인자에 남아 `ps aux`로 같은 머신의 누구나 볼 수 있다.** 파일로 주고 권한을 `0600`으로 걸면 그 노출이 사라진다.

```ts
// core/runner/mcpConfigFile.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function writeMcpConfig(runId: string, url: string, token: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `onedesk-${runId}-`))
  const file = path.join(dir, 'mcp.json')

  const config = {
    mcpServers: {
      onedesk: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  }

  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 })

  return {
    file,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  }
}
```

`cleanup`은 `SpawnSpec.cleanup`에 실어 보내면 프로세스 종료 시 자동으로 불린다 (Q13 코드 참고).

**완성된 `buildCommand` — 2단계에서 이대로 쓸 수 있다.**

```ts
// core/runner/adapters/claudeCode.ts
import type { AgentAdapter, ResolvedRunSpec, SpawnSpec } from '../types'
import { claudeCodePermissionArgs } from './claudePermissions'   // Q22
import { writeMcpConfig } from '../mcpConfigFile'

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose'                       // ← 필수. 빼면 즉시 에러.
    ]

    if (spec.model) args.push('--model', spec.model)

    // 세션 이어하기 (Q31, Q32)
    if (spec.resumeSessionId) args.push('--resume', spec.resumeSessionId)

    // 시스템 프롬프트 (§6 "MCP 도구의 존재와 사용 지침")
    if (spec.systemPromptAppend) {
      args.push('--append-system-prompt', spec.systemPromptAppend)
    }

    // MCP — spec.mcp가 undefined면 이 블록 전체가 건너뛰어진다.
    // 2단계에서는 항상 undefined이고, 4단계에서 채워진다. (Q42의 이음매)
    let cleanup: (() => void) | undefined
    const mcpToolNames: string[] = []
    if (spec.mcp) {
      const cfg = writeMcpConfig(spec.runId, spec.mcp.url, spec.mcp.token)
      args.push('--mcp-config', cfg.file, '--strict-mcp-config')
      cleanup = cfg.cleanup
      // ⚠️ MCP 도구는 --permission-mode로 자동 승인되지 않는다. (Q22/Q28)
      mcpToolNames.push(`mcp__${spec.mcp.serverName}`)
    }

    // 권한 (Q22) — MCP 도구명을 함께 넘겨 allowedTools에 합류시킨다
    args.push(...claudeCodePermissionArgs(spec.permission, mcpToolNames))

    // 작업 디렉토리 밖을 읽어야 하면 명시적으로 허용
    for (const dir of spec.additionalDirs ?? []) args.push('--add-dir', dir)

    return {
      cmd: spec.executablePath,
      args,
      env: {
        // 색상 이스케이프가 JSON에 섞이는 것을 막는다
        NO_COLOR: '1',
        FORCE_COLOR: '0'
      },
      cwd: spec.cwd,
      stdinPayload: spec.assembledPrompt,
      cleanup
    }
  }
}
```

**직접 검증하는 방법.** 조립한 커맨드가 의심스러우면 인자 배열을 그대로 찍어서 터미널에 붙여넣어 봐라.

```ts
console.log([spec.cmd, ...spec.args].map((a) => JSON.stringify(a)).join(' '))
```

### Q17. `stream.jsonl`에 실시간으로 이어쓰는 코드는 어떻게 짜나요? — B

**`fs.createWriteStream(path, { flags: 'a' })` 하나면 된다.** `'a'`가 append 모드다.

**먼저 설계 문서의 모순 하나를 짚고 간다.** 로그 경로가 두 가지로 쓰여 있다.

- §5 `run` 테이블 주석과 파일 구조도: `logs/<run_id>/stream.jsonl` + `logs/<run_id>/before/`
- §5 "실행 로그는 DB가 아니라 파일에 쓴다"와 §6 흐름도: `logs/<run_id>.jsonl`

**`logs/<run_id>/stream.jsonl`이 맞다.** `before/` 스냅샷 디렉토리가 run별로 필요하므로(§10) run당 디렉토리가 있어야 한다. 아래 코드는 이 형태를 쓴다. (구멍 목록 #1)

```ts
// core/runner/RunLogWriter.ts
import fs from 'node:fs'
import path from 'node:path'
import type { RunEvent } from '@shared/events'

export class RunLogWriter {
  private stream: fs.WriteStream
  readonly dir: string
  readonly beforeDir: string
  readonly streamPath: string

  constructor(logsDir: string, runId: string) {
    this.dir = path.join(logsDir, runId)
    this.beforeDir = path.join(this.dir, 'before')
    this.streamPath = path.join(this.dir, 'stream.jsonl')

    // recursive: true 는 이미 있어도 에러를 내지 않는다 (mkdir -p 와 동일)
    fs.mkdirSync(this.beforeDir, { recursive: true })

    this.stream = fs.createWriteStream(this.streamPath, {
      flags: 'a',              // append. 'w'로 하면 이어서 실행할 때 기존 로그를 날린다.
      encoding: 'utf8'
    })

    // 디스크 가득참 등. 처리하지 않으면 프로세스가 죽는다.
    this.stream.on('error', (err) => {
      console.error(`[RunLogWriter] ${runId} 쓰기 실패`, err)
    })
  }

  /**
   * 정규화된 이벤트를 한 줄로 쓴다.
   *
   * write()의 반환값(false = 버퍼 가득참)을 무시하는 것은 의도적이다.
   * Node가 내부 버퍼에 계속 쌓아주므로 데이터는 유실되지 않는다.
   * 여기서 drain을 기다리면 stdout 읽기가 막혀 역압이 agent에게 전파된다.
   * 로그가 느려서 agent가 멈추는 것보다 메모리를 조금 더 쓰는 편이 낫다.
   */
  write(event: RunEvent): void {
    this.stream.write(JSON.stringify(event) + '\n')
  }

  /** 파싱 실패한 줄 (§11) */
  writeRaw(line: string, runId: string): void {
    this.write({ type: 'raw', runId, line, at: Date.now() })
  }

  /** run 종료 시 반드시 호출. 버퍼가 디스크에 닿을 때까지 기다린다. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.stream.end(() => resolve())
    })
  }
}
```

**`end()`를 부르지 않으면 마지막 줄들이 사라진다.** `write()`는 Node 내부 버퍼에 넣을 뿐이고, 실제 디스크 쓰기는 비동기다. `close()`를 기다리지 않고 프로세스가 끝나면 버퍼가 통째로 날아간다. **앱 종료 경로(Q20)에서 이걸 빠뜨리면 "가끔 로그 끝부분이 잘린다"는 재현 불가능한 버그가 된다.**

**runner에 배선한 전체 모습이다.** Q13~Q17의 조각이 여기서 합쳐진다.

```ts
// core/runner/RunManager.ts (일부)
private async execute(runId: string, spec: ResolvedRunSpec) {
  const adapter = this.deps.adapters.get(spec.agentKind)!
  const logWriter = new RunLogWriter(this.deps.logsDir, runId)
  const snapshotter = new FileSnapshotter(logWriter.beforeDir, spec.cwd)   // Q36
  const spawnSpec = adapter.buildCommand({ ...spec, runId })

  this.deps.runRepo.markStarted(runId, logWriter.streamPath)

  let stderrBuf = ''
  let sessionId: string | null = null
  let resultText = ''

  const emit = (event: RunEvent) => {
    logWriter.write(event)          // ① 파일에 영속화
    this.emit('runEvent', event)    // ② 렌더러로 (electron/ipc가 중계)
  }

  const handle = spawnAgent(spawnSpec, {
    onStdoutLine: (line) => {
      let event: RunEvent | null = null
      try {
        event = adapter.parseLine(line, runId)
      } catch (err) {
        // §11: 한 줄 때문에 run 전체를 실패시키지 않는다
        logWriter.writeRaw(line, runId)
        return
      }
      if (!event) return             // 관심 없는 이벤트 (rate_limit_event 등)

      if (event.type === 'session') sessionId = event.sessionId
      if (event.type === 'result') resultText = event.resultText
      if (event.type === 'tool_use') snapshotter.onToolUse(event)   // Q36

      emit(event)
    },
    onStderrChunk: (text) => { stderrBuf += text },
    onSpawnError: (err) => {
      emit({ type: 'error', runId, message: err.message, at: Date.now() })
    }
  })

  this.active.set(runId, { handle, logWriter, snapshotter })

  const { code, signal } = await handle.exited
  await logWriter.close()           // ← 반드시 기다린다
  this.active.delete(runId)

  this.deps.runRepo.markFinished(runId, {
    status: deriveStatus(code, signal, this.canceled.has(runId)),
    exitCode: code,
    errorMessage: code !== 0 ? stderrBuf.slice(-4000) : null,
    externalSessionId: sessionId,
    resultText
  })

  this.drainQueue()                 // Q21: 슬롯이 났으니 대기열에서 하나 꺼낸다
}
```

> **`stderrBuf.slice(-4000)`** — stderr는 무한정 커질 수 있다(agent가 verbose한 빌드 로그를 뱉는 경우). DB의 `error_message`에 통째로 넣으면 DB가 비대해진다. 뒤쪽 4KB만 남기는 이유는 **에러의 실제 원인이 대개 마지막에 있기 때문**이다.

---

## 영역 5. 동시 실행과 프로세스 생명주기

### Q18. `RunManager` 인스턴스는 어디에 살고 누가 만들어 공유하나요? — A

**`core/index.ts`의 `createCore()`가 만들고, `electron/main.ts`가 그 결과를 모듈 스코프 변수로 붙들고 있는다.** (Q7의 `createCore` 코드가 이미 그렇게 돼 있다.)

싱글톤이 "어디에 있는가"를 정확히 말하면:

```
electron/main.ts
  let core: Core | null = null        ← 이 변수가 유일한 소유자
       │
       └─ createCore({...})           ← 앱 부팅 시 정확히 한 번 호출
              │
              └─ new RunManager({...})  ← core.runner
```

**`RunManager` 자신은 자기가 싱글톤인지 모른다.** 이게 중요하다. 클래스 안에 `static instance`나 `getInstance()`를 넣지 마라.

```ts
// ✗ 이렇게 하지 마라 — 테스트에서 상태가 새어 나간다
export class RunManager {
  private static instance: RunManager
  static getInstance() {
    if (!this.instance) this.instance = new RunManager(...)
    return this.instance
  }
}
```

**왜 안 되는가.** 테스트 A가 run 3개를 큐에 넣고, 테스트 B가 같은 인스턴스를 받으면 **B가 A의 큐를 물려받는다.** 테스트 간 격리가 깨져서 "혼자 돌리면 통과하는데 전체 돌리면 실패"하는 최악의 상황이 된다. §12가 요구하는 "동시 실행 상한, 대기 큐, 취소, 타임아웃" 테스트가 전부 이 함정에 걸린다.

**"인스턴스가 하나뿐이다"는 클래스가 아니라 조립하는 쪽이 보장한다.** 프로덕션에서는 `createCore()`가 한 번만 불리므로 하나뿐이고, 테스트에서는 매번 새로 만들 수 있다. 이 원칙에는 이름이 있다 — **컴포지션 루트(Composition Root)**.

**`electron/main.ts` 전체 골격이다. 생명주기 훅(Q20)까지 포함했다.**

```ts
// electron/main.ts
import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { createCore, type Core } from '../core'
import { registerHandlers } from './ipc'
import { bridgeRunEvents } from './ipc/events'
import { backupBeforeMigrate } from './backup'

let core: Core | null = null
let mainWindow: BrowserWindow | null = null
let unbridge: (() => void) | null = null

// 두 번째 인스턴스를 막는다.
// SQLite 파일을 두 프로세스가 열면 잠금 경합이 나고,
// 무엇보다 RunManager가 둘이 되어 동시 실행 상한이 무의미해진다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  bootstrap().catch((err) => {
    dialog.showErrorBox('one-desk 시작 실패', String(err?.stack ?? err))
    app.exit(1)
  })
}

async function bootstrap() {
  await app.whenReady()

  const userData = app.getPath('userData')
  const dbPath = path.join(userData, 'one-desk.db')
  backupBeforeMigrate(dbPath)

  core = createCore({
    dbPath,
    logsDir: path.join(userData, 'logs'),
    migrationsDir: app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(app.getAppPath(), 'drizzle')
  })

  // §11 "앱 강제 종료 후 남은 run" — 창을 만들기 전에 정리한다.
  // 이 시점에 프로세스는 확실히 존재하지 않는다(방금 부팅했으므로).
  const recovered = core.runs.markOrphansInterrupted()
  if (recovered > 0) console.log(`[boot] ${recovered}개의 유령 run을 interrupted로 정리했다`)

  await core.start()          // MCP 서버 리슨 (4단계)
  registerHandlers(core)
  unbridge = bridgeRunEvents(core)

  createWindow()
}
```

**"유령 run 정리"의 리포지토리 구현이다.** §11의 요구사항이고, 한 줄이면 된다.

```ts
// core/db/repositories/runRepository.ts
/**
 * 부팅 시점에 status='running' 또는 'pending'인 run은
 * 전부 앱이 비정상 종료된 흔적이다.
 * (정상 종료였다면 shutdown()이 canceled/succeeded로 바꿨을 것이다)
 */
markOrphansInterrupted(): number {
  const res = this.db
    .update(run)
    .set({
      status: 'interrupted',
      errorMessage: '앱이 종료되어 실행이 중단되었습니다',
      endedAt: Date.now()
    })
    .where(inArray(run.status, ['running', 'pending']))
    .run()
  return res.changes
}
```

> `pending`도 함께 정리하는 이유는 Q21에서 설명한다 — 대기 큐가 메모리에만 있기 때문이다.

**renderer는 `RunManager`를 어떻게 만나는가.** 만나지 않는다. `OneDeskClient`를 통해서만 접근하고, 그 뒤에 `RunManager`가 있다는 사실조차 모른다. 이게 §4 규칙 2의 실제 의미다.

### Q19. "SIGTERM 후 유예를 두고 SIGKILL"의 유예 시간과 대기 대상은? — A

**유예 시간: 5000ms를 권한다. 대기 대상: 프로세스의 `'close'` 이벤트다.**

**왜 5초인가.** 두 값 사이의 절충이다.

- **너무 짧으면(1초 이하)** agent가 정리를 못 끝낸다. Claude Code는 SIGTERM을 받으면 세션 파일을 디스크에 저장하고 종료한다. 이게 끊기면 **`--resume`으로 이어서 실행할 수 없게 된다.** 이 앱의 핵심 기능 하나가 망가지는 것이다.
- **너무 길면(30초)** 사용자가 취소를 눌렀는데 탭이 30초간 "취소 중…"으로 멈춰 있다. 앱 종료 시에는 창이 사라지지 않아 "앱이 안 꺼진다"는 인상을 준다.

5초는 "정상적인 정리는 충분히 끝나고, 사람이 기다리기에 아직 견딜 만한" 지점이다. **다만 이건 근거 있는 추정이지 측정값은 아니다** — 실제 구현 후 취소 시 `'close'`까지 걸린 시간을 로그로 찍어보고 조정해라.

**대기 대상이 `'exit'`이 아니라 `'close'`인 이유.** (Q13에서 한 번 언급했다)

- `'exit'`: 프로세스가 종료된 시점. **stdout 파이프에 아직 읽지 않은 데이터가 남아 있을 수 있다.**
- `'close'`: 프로세스가 종료되고 **모든 stdio 스트림이 닫힌** 시점.

`'exit'`에서 로그 파일을 닫으면 마지막 `result` 이벤트를 놓칠 수 있다. **`result` 이벤트에는 `session_id`와 최종 응답이 들어 있어서** 이걸 놓치면 run이 "결과 없음"으로 남는다.

**구현.**

```ts
// core/runner/RunManager.ts
const SIGTERM_GRACE_MS = 5000

export class RunManager extends EventEmitter {
  private readonly canceled = new Set<string>()

  /**
   * run을 취소한다. 이미 종료됐으면 아무 일도 하지 않는다.
   * @returns 프로세스가 완전히 사라졌으면 resolve
   */
  async cancel(runId: string, reason: 'user' | 'timeout' | 'shutdown' = 'user'): Promise<void> {
    // ① 아직 시작 안 한 pending run이면 큐에서 빼는 것으로 끝
    const queueIndex = this.queue.indexOf(runId)
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1)
      this.deps.runRepo.markFinished(runId, { status: 'canceled', exitCode: null })
      this.emit('runEvent', { type: 'status', runId, status: 'canceled', at: Date.now() })
      return
    }

    const activeRun = this.active.get(runId)
    if (!activeRun) return           // 이미 끝났다

    this.canceled.add(runId)         // deriveStatus가 이걸 보고 'canceled'로 판정한다

    await terminateGracefully(activeRun.handle, SIGTERM_GRACE_MS)
  }
}

/**
 * SIGTERM → 유예 → SIGKILL.
 *
 * 핵심은 '누가 먼저 오는지 경주시키는' 것이다.
 * 프로세스가 유예 안에 죽으면 타이머를 취소하고 끝낸다.
 * 안 죽으면 타이머가 SIGKILL을 보내고, 그러면 반드시 죽는다.
 */
export async function terminateGracefully(
  handle: AgentProcessHandle,
  graceMs: number
): Promise<void> {
  handle.kill('SIGTERM')

  let timer: NodeJS.Timeout | undefined

  const killAfterGrace = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      // SIGKILL은 프로세스가 가로챌 수 없다. 커널이 즉시 없앤다.
      // 그래서 정리 코드가 실행되지 않는다 — 최후의 수단이다.
      handle.kill('SIGKILL')
      resolve()
    }, graceMs)
  })

  // handle.exited 는 'close' 이벤트에 연결돼 있다 (Q13)
  await Promise.race([handle.exited, killAfterGrace])

  clearTimeout(timer)   // ← 빼먹으면 이 타이머가 앱 종료를 5초간 붙든다

  // SIGKILL을 보냈다면 실제로 사라질 때까지 한 번 더 기다린다
  await handle.exited
}
```

**세 가지 주의사항.**

**① `clearTimeout`을 반드시 불러라.** Node는 살아 있는 타이머가 있으면 이벤트 루프를 종료하지 않는다. 취소된 run마다 5초짜리 타이머가 남으면 앱 종료가 그만큼 지연된다.

**② SIGTERM은 프로세스 그룹으로 보내야 한다.** Q13의 `kill`이 `process.kill(-pid, signal)`을 쓰는 이유다. agent가 `Bash` 도구로 띄운 `npm run dev` 같은 자식은 `claude`가 죽어도 살아남는다. 그룹으로 보내야 함께 정리된다.

**③ Windows에는 SIGTERM이 없다.** Node가 Windows에서 `child.kill('SIGTERM')`을 부르면 **실제로는 `TerminateProcess`(= SIGKILL 상당)** 가 호출되어 유예가 무의미해진다. 이 앱이 macOS 우선이라면 당장은 문제없지만, Windows를 지원할 때 세션 저장이 안 되는 증상으로 나타난다. **[확인 필요]** — Windows 지원 시점에 `taskkill /T /F` 또는 Job Object 사용을 검토해라.

**타임아웃(§11)도 같은 경로를 쓴다.**

```ts
// execute() 안, spawnAgent 직후
let timeoutTimer: NodeJS.Timeout | undefined
if (spec.timeoutMs && spec.timeoutMs > 0) {
  timeoutTimer = setTimeout(() => {
    this.emit('runEvent', {
      type: 'error', runId,
      message: `타임아웃(${spec.timeoutMs}ms)을 초과해 중단했습니다`,
      at: Date.now()
    })
    void this.cancel(runId, 'timeout')
  }, spec.timeoutMs)
}

const { code, signal } = await handle.exited
clearTimeout(timeoutTimer)          // ← 정상 종료 시 타이머 해제
```

§11이 "초과 시 취소와 동일하게 처리"라고 했으므로 `cancel()`을 재사용한다. 다만 **status는 구분하는 편이 낫다** — 사용자가 취소한 것과 타임아웃은 인박스에서 다른 의미다. 설계의 6개 status에 타임아웃 전용 값이 없으므로, `canceled` + `error_message`에 사유를 남기는 방식으로 처리한다.

### Q20. "앱 종료 시 프로세스 정리"는 Electron의 어느 생명주기 훅인가요? — B

**`app.on('before-quit')`이다.** 다만 **`event.preventDefault()`와 재진입 방지 플래그가 반드시 함께 필요하다.**

**Electron 종료 이벤트의 순서를 먼저 정확히 알아야 한다.**

```
사용자가 ⌘Q / 창 닫기 / app.quit() 호출
      │
      ▼
① app 'before-quit'          ← 여기서만 preventDefault()로 막을 수 있다
      │
      ▼
② 각 BrowserWindow 'close'
      │
      ▼
③ app 'window-all-closed'    ← macOS에서는 여기서 quit하지 않는 것이 관례
      │
      ▼
④ app 'will-quit'            ← 아직 막을 수 있지만 창은 이미 사라졌다
      │
      ▼
⑤ app 'quit'                 ← 막을 수 없다. 정리 시간 없음.
```

**왜 `before-quit`인가.** 우리에게 필요한 것은 "**비동기** 정리를 끝낼 때까지 종료를 붙드는 것"이다. `before-quit`이 그게 가능한 첫 지점이고, 창이 아직 살아 있어 "정리 중…" 표시도 할 수 있다.

**`will-quit`은 왜 아닌가.** 여기서도 `preventDefault()`가 되지만, 창이 이미 닫혀서 사용자에게 아무것도 보여줄 수 없다. 5초간 아이콘만 튀는 상태가 된다.

**구현 — 이 코드에는 함정이 세 개 있고 전부 주석으로 표시했다.**

```ts
// electron/main.ts
let isQuitting = false      // ⚠️ 함정 ①: 재진입 방지

app.on('before-quit', (event) => {
  // app.quit()을 다시 부르면 before-quit이 또 발생한다.
  // 이 플래그가 없으면 무한 루프에 빠져 앱이 절대 안 꺼진다.
  if (isQuitting) return

  isQuitting = true
  event.preventDefault()    // 종료를 일단 막는다

  void shutdown()
})

async function shutdown() {
  try {
    // 사용자에게 진행 상황을 보여준다 (선택이지만 권장)
    mainWindow?.webContents.send(CHANNELS.APP_SHUTTING_DOWN)

    unbridge?.()            // core → renderer 이벤트 중계 해제

    // ⚠️ 함정 ②: 여기서 시간이 걸린다. run 3개면 최대 5초.
    // 전체에 상한을 걸어 무한 대기를 막는다.
    await Promise.race([
      core?.dispose() ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 8000))
    ])
  } catch (err) {
    console.error('[shutdown] 정리 중 오류', err)
  } finally {
    // ⚠️ 함정 ③: app.quit()이 아니라 app.exit()을 쓴다.
    // app.quit()은 before-quit을 다시 발생시킨다(플래그로 막히지만 불필요).
    // app.exit()은 이벤트 없이 즉시 끝낸다.
    app.exit(0)
  }
}
```

**`core.dispose()`의 구현 — `RunManager.shutdown()`이 실제 일을 한다.**

```ts
// core/runner/RunManager.ts
/**
 * 실행 중인 모든 run을 정리한다 (§6).
 *
 * 순차가 아니라 병렬로 종료한다.
 * 순차로 하면 run 3개에 최대 15초가 걸리지만, 병렬이면 5초다.
 */
async shutdown(): Promise<void> {
  this.acceptingNew = false        // 새 run 접수 중단

  // ① 대기 중인 것들은 즉시 canceled 처리 (프로세스가 없으므로 빠르다)
  for (const runId of this.queue.splice(0)) {
    this.deps.runRepo.markFinished(runId, {
      status: 'canceled',
      errorMessage: '앱 종료로 취소되었습니다'
    })
  }

  // ② 실행 중인 것들을 병렬로 종료
  const runIds = [...this.active.keys()]
  await Promise.allSettled(
    runIds.map((id) => this.cancel(id, 'shutdown'))
  )

  // ③ 로그 스트림이 전부 flush될 때까지 (Q17)
  await Promise.allSettled(
    [...this.active.values()].map((r) => r.logWriter.close())
  )
}
```

**status를 무엇으로 남길 것인가 — 설계 문서를 따르면 `interrupted`가 맞다.**

§10의 인박스 조건에 "**중단됨** — 앱 강제 종료 등으로 끊김"이 있다. 사용자가 의도적으로 취소한 게 아니라 앱 종료에 휩쓸린 것이므로, 사용자 입장에서는 "내 작업이 끊겼다"이고 인박스에 남아야 한다.

```ts
// shutdown 시에는 canceled가 아니라 interrupted로
this.deps.runRepo.markFinished(id, {
  status: 'interrupted',
  errorMessage: '앱이 종료되어 실행이 중단되었습니다'
})
```

**macOS의 `window-all-closed`를 잘못 처리하는 흔한 실수를 피해라.**

```ts
app.on('window-all-closed', () => {
  // macOS는 창을 다 닫아도 앱이 살아 있는 것이 표준 동작이다.
  // 여기서 무조건 app.quit()을 부르면 창을 닫는 순간 실행 중인 run이 전부 죽는다.
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  // Dock 아이콘 클릭 시 창을 되살린다
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

이 앱은 **백그라운드에서 run이 도는 것이 정상**이므로 macOS의 이 동작이 오히려 잘 맞는다.

**개발 중에는 이 경로가 잘 안 타진다는 점을 알아둬라.** `electron-vite dev`에서 `Ctrl+C`로 죽이면 SIGINT가 main에 직접 가서 `before-quit`이 발생하지 않는다. **정리 로직을 테스트하려면 앱 메뉴의 종료(⌘Q)를 써라.** 개발 중 SIGINT도 처리하고 싶다면:

```ts
if (!app.isPackaged) {
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { void shutdown() })
  }
}
```

### Q21. `pending` run은 메모리 큐인가요, DB 폴링인가요? 재시작하면 대기열이 사라지나요? — B

**메모리 큐다. 그리고 재시작하면 대기열은 사라진다.** 설계 문서에 명시돼 있지 않으므로(구멍 목록 #5) 여기서 결정하고 근거를 남긴다.

**왜 메모리 큐인가.**

| | 메모리 큐 | DB 폴링 |
|---|---|---|
| 지연 | 슬롯이 나는 즉시 시작 (0ms) | 폴링 주기만큼 (보통 1초) |
| 복잡도 | `string[]` 하나 | 타이머 + 잠금 + 경합 처리 |
| 다중 프로세스 | 불가 | 가능 |
| 재시작 후 | 사라짐 | 남음 |

이 앱은 **단일 프로세스**(Q18의 `requestSingleInstanceLock`)이므로 DB 폴링의 유일한 장점인 "다중 워커"가 필요 없다. 그리고 §14의 자율 실행 데몬으로 갈 때도, 그 데몬 역시 단일 프로세스면 메모리 큐로 충분하다. **지금 필요 없는 복잡도를 미리 지불하지 마라.**

**하지만 "DB에는 `pending`이 남는다".** 이게 헷갈리는 지점이다. 정확히 정리하면:

- **DB의 `run.status = 'pending'`** = "이 run은 접수됐고 아직 시작 안 했다"는 **기록**
- **메모리의 `queue: string[]`** = "다음에 무엇을 시작할지"의 **순서**

DB는 사실을 기록하고, 메모리는 스케줄링을 한다. 재시작하면 메모리가 날아가므로 DB의 `pending` 기록이 고아가 된다. **그래서 Q18의 `markOrphansInterrupted()`가 `running`뿐 아니라 `pending`도 함께 정리하는 것이다.**

**전체 구현.**

```ts
// core/runner/RunManager.ts
export class RunManager extends EventEmitter {
  private readonly active = new Map<string, ActiveRun>()
  private readonly queue: string[] = []              // ← FIFO. runId만 담는다.
  private readonly specs = new Map<string, ResolvedRunSpec>()
  private acceptingNew = true

  constructor(private readonly deps: RunManagerDeps) { super() }

  get maxConcurrent() { return this.deps.maxConcurrent }

  /**
   * run 접수. 슬롯이 있으면 즉시 시작, 없으면 큐에 넣는다.
   * 어느 쪽이든 Run 레코드는 바로 만들어 반환한다 —
   * 그래야 UI가 즉시 탭을 그릴 수 있다.
   */
  async start(spec: ResolvedRunSpec): Promise<Run> {
    if (!this.acceptingNew) throw new Error('앱이 종료 중입니다')

    const run = this.deps.runRepo.create({ ...spec, status: 'pending' })
    this.specs.set(run.id, spec)

    if (this.active.size < this.deps.maxConcurrent) {
      void this.execute(run.id, spec)          // await하지 않는다 — 즉시 반환해야 한다
    } else {
      this.queue.push(run.id)
      this.emit('runEvent', {
        type: 'status', runId: run.id, status: 'pending',
        queuePosition: this.queue.length,      // UI에 "대기 2번째" 표시
        at: Date.now()
      })
    }
    return run
  }

  /**
   * 슬롯이 났을 때 대기열에서 하나 꺼내 시작한다.
   * execute()의 마지막에서 호출된다.
   */
  private drainQueue(): void {
    if (!this.acceptingNew) return
    while (this.active.size < this.deps.maxConcurrent && this.queue.length > 0) {
      const runId = this.queue.shift()!        // FIFO (§6)
      const spec = this.specs.get(runId)
      if (!spec) continue                      // 취소되어 사라진 경우
      void this.execute(runId, spec)
    }
  }

  /** 앱 설정에서 상한을 바꾸면 즉시 반영된다 */
  setMaxConcurrent(n: number): void {
    this.deps.maxConcurrent = Math.max(1, n)
    this.drainQueue()                          // 상한을 올렸으면 바로 대기열을 소진
  }

  getQueueSnapshot() {
    return {
      active: [...this.active.keys()],
      queued: [...this.queue],
      maxConcurrent: this.deps.maxConcurrent
    }
  }
}
```

**`void this.execute(...)`의 `void`가 무슨 뜻인가.** "이 Promise를 의도적으로 기다리지 않겠다"는 명시적 표현이다. ESLint의 `no-floating-promises` 규칙을 만족시키면서 의도를 드러낸다. `start()`가 `execute()`를 `await`하면 **실행이 끝날 때까지 IPC 핸들러가 반환하지 않아 UI가 멈춘다.**

**`drainQueue()`는 `execute()`의 `finally`에서 불러야 한다.** Q17의 코드는 정상 경로 끝에 두었는데, 예외가 나면 슬롯이 영원히 반납되지 않는다. 이건 **"몇 번 실패하면 앱이 run을 아예 못 돌린다"** 는 형태로 나타나는 고약한 버그다.

```ts
private async execute(runId: string, spec: ResolvedRunSpec) {
  try {
    // … Q17의 내용 …
  } catch (err) {
    this.deps.runRepo.markFinished(runId, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err)
    })
  } finally {
    this.active.delete(runId)
    this.specs.delete(runId)
    this.drainQueue()          // ← 반드시 finally에
  }
}
```

**재시작 시 대기열이 사라지는 것을 사용자에게 어떻게 알리나.** 그냥 사라지면 "내가 걸어둔 게 없어졌다"가 된다. 인박스가 이 문제를 이미 풀어준다.

`markOrphansInterrupted()`가 `pending` run을 `interrupted`로 바꾸므로, §10의 인박스 조건("중단됨")에 걸려 **인박스에 남는다.** 사용자는 "다시 실행" 버튼으로 되살릴 수 있다. **대기열을 영속화하는 것보다 이쪽이 낫다** — 앱이 꺼진 사이 상황이 바뀌었을 수 있으므로, 자동으로 재개하는 것보다 사람이 다시 판단하는 편이 안전하다.

**테스트 — §12가 요구하는 "동시 실행 상한, 대기 큐"를 가짜 CLI로 검증한다.** (Q38의 주입 구조를 씀)

```ts
// core/runner/__tests__/RunManager.queue.test.ts
it('상한을 넘으면 pending으로 대기하다가 슬롯이 나면 FIFO로 시작한다', async () => {
  const rm = new RunManager({ ...deps, maxConcurrent: 2 })

  const r1 = await rm.start(specWithScript('sleep-then-exit.sh'))
  const r2 = await rm.start(specWithScript('sleep-then-exit.sh'))
  const r3 = await rm.start(specWithScript('sleep-then-exit.sh'))

  expect(rm.getQueueSnapshot().active).toHaveLength(2)
  expect(rm.getQueueSnapshot().queued).toEqual([r3.id])

  await rm.waitForIdle()

  expect(rm.getQueueSnapshot().queued).toHaveLength(0)
  expect(repo.findById(r3.id)!.status).toBe('succeeded')
})
```

> 테스트를 위해 `waitForIdle()` 같은 헬퍼를 `RunManager`에 두는 것은 정당하다. `setTimeout`으로 "대충 기다리기"를 하면 CI에서 간헐적으로 실패하는 테스트가 된다.

---

## 영역 6. 권한 모델

> 이 영역이 이 문서에서 **설계와 실제가 가장 크게 어긋난 곳**이다. 실측으로 확인한 내용을 먼저 요약한다.
>
> 1. **[확인함] `--permission-mode`는 MCP 도구를 자동 승인하지 않는다.** `acceptEdits`로 실행해도 MCP 도구 호출이 `"Claude requested permissions to use mcp__onedesk__list_issues, but you haven't granted it yet."`로 거부됐다.
> 2. **[확인함] `--tools`는 빌트인 도구만 제한한다.** `--tools "Read"`로 실행했는데 `mcp__*` 도구는 그대로 전부 남아 있었다.
> 3. **[확인함] `--allowedTools "mcp__<서버명>"`으로 서버 단위 자동 승인이 된다.** 이걸 추가하니 호출이 통과했다.

### Q22. Claude Code의 "읽기 도구만 화이트리스트"는 실제 어떤 플래그인가요? — A

**`--tools`(도구 집합 제한) + `--allowedTools`(자동 승인) 두 개를 함께 쓴다.** 하나만으로는 안 된다.

두 플래그의 역할이 다르다는 것을 먼저 명확히 해야 한다.

| 플래그 | 하는 일 | 비유 |
|---|---|---|
| `--tools` | 그 도구를 **존재하지 않게** 만든다. 모델이 아예 못 본다. | 건물에 방을 안 만든다 |
| `--allowedTools` | 존재하는 도구를 **묻지 않고 승인**한다 | 방에 자유 출입증을 준다 |
| `--disallowedTools` | 존재하는 도구를 **항상 거부**한다 | 방을 잠근다 |

읽기 전용에는 **`--tools`가 본질적**이다. 도구가 존재하지 않으면 모델이 시도조차 하지 않으므로 "거부당했다"는 잡음도 없고, 프롬프트 인젝션으로 우회할 여지도 없다. `--allowedTools`는 남은 읽기 도구들이 경로 문제로 되묻는 것을 막는 보조 장치다.

**세 단계 전체 구현이다.**

```ts
// core/runner/adapters/claudePermissions.ts
import type { Permission } from '@shared/client'

/** 읽기 전용 run에서 살려둘 빌트인 도구 (Claude Code 2.1.x 기준) */
const READ_ONLY_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite'      // 상태 추적용. 파일을 건드리지 않는다.
] as const

/** 편집 허용에서 추가되는 도구 */
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const

/**
 * 권한 단계를 Claude Code CLI 인자로 변환한다.
 *
 * @param permission one-desk의 3단계
 * @param mcpToolPrefixes 자동 승인할 MCP 서버/도구 이름들.
 *   ⚠️ --permission-mode가 MCP 도구를 커버하지 않으므로 반드시 필요하다. [확인함]
 */
export function claudeCodePermissionArgs(
  permission: Permission,
  mcpToolPrefixes: string[] = []
): string[] {
  switch (permission) {
    case 'read_only': {
      const tools = [...READ_ONLY_TOOLS]
      return [
        // ① 빌트인 도구를 읽기 전용으로 축소. Edit/Write/Bash가 아예 사라진다.
        '--tools', tools.join(','),
        // ② 남은 도구는 자동 승인 (경로 확인 등으로 되묻지 않게)
        '--allowedTools', [...tools, ...mcpToolPrefixes].join(','),
        // ③ 이중 방어. --tools로 이미 없어졌지만 명시해 의도를 문서화한다.
        '--disallowedTools', 'Bash,Edit,Write,NotebookEdit',
        // ④ 그래도 물어볼 상황이 생기면 물어보지 않고 거부한다.
        //    헤드리스에서 'ask'는 곧 무한 대기이므로. [확인 필요: 아래 설명]
        '--permission-mode', 'acceptEdits'
      ]
    }

    case 'edit': {
      const tools = [...READ_ONLY_TOOLS, ...EDIT_TOOLS]
      return [
        '--tools', tools.join(','),          // Bash는 여전히 없다 (§7 "그 외 차단")
        '--allowedTools', [...tools, ...mcpToolPrefixes].join(','),
        '--disallowedTools', 'Bash',
        '--permission-mode', 'acceptEdits'   // 설계 문서 §7 그대로
      ]
    }

    case 'full': {
      return [
        // 도구 제한 없음
        '--permission-mode', 'bypassPermissions',   // 설계 문서 §7 그대로
        // bypassPermissions가 MCP까지 커버하는지 미확인이므로 명시적으로도 넣는다
        ...(mcpToolPrefixes.length ? ['--allowedTools', mcpToolPrefixes.join(',')] : [])
      ]
    }
  }
}
```

**[확인함] 검증한 것.**
- `--tools "Read"`로 실행했을 때 `system`/`init` 이벤트의 `tools` 배열에 `Read`와 `mcp__*`만 남고 `Edit`, `Write`, `Bash`가 사라졌다.
- `--allowedTools "mcp__onedesk"`를 추가하니 MCP 도구 호출이 승인 없이 통과했다 (`permission_denials: []`).

**[확인 필요] 확인하지 못한 것과 검증 방법.**

1. **읽기 전용에서 `--permission-mode`를 무엇으로 둘지.** `acceptEdits`를 쓴 이유는 "편집 도구가 이미 없으므로 승인할 편집도 없다"이지만, 이름이 오해를 부른다. `--permission-mode` 선택지에 `dontAsk`가 있는데(2.1.224에서 확인) 의미가 문서화돼 있지 않다. **이게 더 적합할 가능성이 높다.**
   검증: `--permission-mode dontAsk`로 읽기 전용 run을 돌리고, 작업 디렉토리 밖 파일을 읽게 시켜서 **멈추는지 / 거부되고 진행하는지**를 본다. 멈추면 §7의 "ask는 곧 무한 대기"에 걸리는 것이므로 쓰면 안 된다.

2. **`--tools`가 Task/Skill 같은 메타 도구를 제거했을 때의 부작용.** `Task`(서브에이전트)를 제거하면 agent가 복잡한 작업을 못 나눈다. 읽기 전용 조사 작업에서는 `Task`가 유용할 수 있으니 실제 사용해보고 목록을 조정해라.

3. **도구 이름의 안정성.** `READ_ONLY_TOOLS`의 이름들은 Claude Code 2.1.224에서 확인한 값이다. **CLI가 업데이트되면 도구가 추가·개명될 수 있다.** 방어책: preflight에서 `--version`을 기록해두고, run의 `system`/`init` 이벤트의 `tools` 배열을 로그에 남겨라. 예상과 다르면 나중에 추적할 수 있다.

**가장 중요한 실무 규칙 — 도구 목록을 하드코딩한 것을 부끄러워하지 마라.** 대안은 "런타임에 도구 목록을 조회해서 읽기/쓰기를 분류하기"인데, CLI가 그런 API를 제공하지 않고, 분류 기준도 우리가 정해야 한다. **명시적 목록 + 버전 기록 + 테스트**가 현실적인 최선이다.

### Q23. OpenCode의 권한 JSON은 커맨드 인자인가요, 설정 파일 경로인가요? — B

**설정 파일이다. 그리고 커맨드 인자로 그 파일을 지정할 방법이 없다.** 이게 설계 문서에 없는 중요한 제약이다.

**[확인함] `opencode run`의 플래그 전체** (공식 저장소의 `run` 커맨드 정의에서 확인):

`--command`, `--continue`/`-c`, `--session`/`-s`, `--fork`, `--share`, `--model`/`-m`, `--agent`, `--format`, `--file`/`-f`, `--title`, `--attach`, `--password`/`-p`, `--username`/`-u`, `--dir`, `--port`, `--variant`, `--thinking`, `--interactive`/`-i`, `--auto`, `--replay`, `--replay-limit`

**`--mcp-config`도, `--config`도, `--permission`도 없다.** 설계 문서 §6의 대응표에서 OpenCode의 "원격 MCP" 칸이 `mcp.type: "remote"` + headers로 적힌 것은 **설정 파일의 스키마를 가리킨 것**이고, 그 파일을 run별로 어떻게 넘길지는 비어 있다.

**해결 — `OPENCODE_CONFIG` 환경변수. [확인함, 공식 문서]**

> "Specify a custom config file path using the `OPENCODE_CONFIG` environment variable."

우리는 프로세스를 직접 spawn하므로 `env`를 완전히 통제할 수 있다(Q13). **run마다 임시 설정 파일을 쓰고 `OPENCODE_CONFIG`로 가리키면 된다.** 이 방식이 오히려 Claude Code보다 깔끔하다 — 권한과 MCP가 한 파일에 들어간다.

**[확인함] 권한 스키마** (공식 문서):
- 값: `"allow"` | `"ask"` | `"deny"`
- 키: `read`, `edit`, `glob`, `grep`, `bash`, `task`, `skill`, `lsp`, `question`, `webfetch`, `websearch`, `external_directory`, `doom_loop`, 그리고 와일드카드 `*`

**[확인함] MCP 스키마** (공식 문서):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-remote-mcp": {
      "type": "remote",
      "url": "https://my-mcp-server.com",
      "enabled": true,
      "headers": { "Authorization": "Bearer MY_API_KEY" }
    }
  }
}
```

**구현 — 설정 파일 생성기.**

```ts
// core/runner/adapters/opencodeConfig.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Permission } from '@shared/client'

type PermissionValue = 'allow' | 'deny'      // ⚠️ 'ask'를 타입에서 제거한다 (§7 규칙, Q24)

/**
 * OpenCode 권한 정책.
 *
 * 설계 문서 §7의 표를 실제 키 이름으로 확장했다.
 * 문서의 `{"*":"deny","read":"allow",…}`에서 "…"에 들어갈 것들이
 * 아래의 glob/grep/webfetch/websearch다 —
 * 이것들이 없으면 읽기 전용 run이 파일 검색조차 못 한다.
 */
export function opencodePermissions(permission: Permission): Record<string, PermissionValue> {
  switch (permission) {
    case 'read_only':
      return {
        '*': 'deny',
        read: 'allow',
        glob: 'allow',
        grep: 'allow',
        lsp: 'allow',
        webfetch: 'allow',
        websearch: 'allow'
        // edit, bash, task, external_directory 는 '*': 'deny'가 처리
      }

    case 'edit':
      return {
        '*': 'deny',
        read: 'allow',
        glob: 'allow',
        grep: 'allow',
        lsp: 'allow',
        webfetch: 'allow',
        websearch: 'allow',
        edit: 'allow'
        // bash는 여전히 deny (§7 "파일 수정 자동 승인, 그 외 차단")
      }

    case 'full':
      return { '*': 'allow' }
  }
}

export interface OpencodeConfigInput {
  runId: string
  permission: Permission
  mcp?: { serverName: string; url: string; token: string }
}

export function writeOpencodeConfig(input: OpencodeConfigInput) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `onedesk-oc-${input.runId}-`))
  const file = path.join(dir, 'opencode.json')

  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    permission: opencodePermissions(input.permission)
  }

  if (input.mcp) {
    config.mcp = {
      [input.mcp.serverName]: {
        type: 'remote',
        url: input.mcp.url,
        enabled: true,
        headers: { Authorization: `Bearer ${input.mcp.token}` }
      }
    }
  }

  // 0600: 토큰이 들어 있으므로 소유자만 읽을 수 있게
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 })

  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
```

**어댑터의 `buildCommand` (5단계에서 구현).**

```ts
// core/runner/adapters/opencode.ts
export class OpencodeAdapter implements AgentAdapter {
  readonly kind = 'opencode' as const

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    const cfg = writeOpencodeConfig({
      runId: spec.runId,
      permission: spec.permission,
      mcp: spec.mcp
    })

    const args = ['run', '--format', 'json']

    if (spec.model) args.push('--model', spec.model)         // provider/model 형식
    if (spec.resumeSessionId) args.push('--session', spec.resumeSessionId)
    if (spec.agentName) args.push('--agent', spec.agentName) // §5의 asset kind='agent'
    args.push('--dir', spec.cwd)

    // §7 "전체 허용: --auto + {"*":"allow"}"
    // [확인함] --auto = "auto-approve permissions that are not explicitly denied"
    if (spec.permission === 'full') args.push('--auto')

    return {
      cmd: spec.executablePath,
      args,
      env: {
        OPENCODE_CONFIG: cfg.file,     // ← 권한과 MCP를 여기로 주입한다
        NO_COLOR: '1'
      },
      cwd: spec.cwd,
      stdinPayload: spec.assembledPrompt,
      cleanup: cfg.cleanup
    }
  }
}
```

**[확인 필요] 세 가지. OpenCode가 로컬에 없어 실행 검증을 못 했다.**

1. **`OPENCODE_CONFIG`가 프로젝트/전역 설정을 대체하는지 병합하는지.** 병합이라면 사용자의 `~/.config/opencode/opencode.json`에 `"bash": "ask"`가 있을 때 우리 정책을 덮어써 **헤드리스 무한 대기**가 발생할 수 있다. §7의 가장 중요한 규칙이 깨지는 시나리오다.
   검증: `~/.config/opencode/opencode.json`에 `{"permission":{"bash":"ask"}}`를 넣고, `OPENCODE_CONFIG`로 `{"permission":{"*":"deny"}}`를 준 뒤 bash를 쓰는 프롬프트를 실행한다. 멈추면 병합이다. **멈춘다면 대응책은 `--dir`를 임시 디렉토리로 두거나, 우리 설정에 모든 키를 명시적으로 나열하는 것이다.**

2. **`opencode run`이 세션 없이 새로 시작하는지.** "run 서브커맨드가 기존 세션을 요구하고 자동 생성하지 않는다"는 이슈 보고가 검색에 잡혔다. 사실이면 `--session` 없는 첫 실행이 실패한다.
   검증: 빈 디렉토리에서 `echo "hi" | opencode run --format json`을 실행한다.

3. **stdin으로 프롬프트를 받는지.** 플래그 목록의 `message`가 위치 인자이므로 **인자로만 받을 가능성**이 있다. 그렇다면 Q13의 "긴 프롬프트는 stdin으로" 전략이 OpenCode에서는 못 쓰이고, 프롬프트를 파일로 넘기는 다른 방법을 찾아야 한다(`--file`이 후보다).
   검증: `echo "prompt" | opencode run --format json`과 `opencode run --format json "prompt"`를 각각 실행해 비교한다.

**세 가지 모두 5단계(OpenCode 어댑터) 착수 시점에 30분이면 확인할 수 있다.** 그때까지는 `OpencodeAdapter`의 `preflight()`가 `{ ok: false, reason: 'not_implemented' }`를 반환하게 두고, UI에서 OpenCode 선택지를 비활성화해라.

### Q24. "ask 없음을 테스트로 고정"은 구체적으로 어떤 테스트인가요? — A

**테스트 대상 함수는 두 개다: `opencodePermissions()`와 `claudeCodePermissionArgs()`.** 입출력이 순수 함수라 테스트가 간단하다.

**설계 문서 §12의 "생성된 모든 설정에 `ask`가 없음을 검증"을 그대로 구현한다.**

```ts
// core/runner/adapters/__tests__/permissions.test.ts
import { describe, it, expect } from 'vitest'
import { opencodePermissions, writeOpencodeConfig } from '../opencodeConfig'
import { claudeCodePermissionArgs } from '../claudePermissions'
import type { Permission } from '@shared/client'

const ALL_PERMISSIONS: Permission[] = ['read_only', 'edit', 'full']

describe('권한 설정 생성 — ask 금지 규칙 (설계 §7)', () => {
  // ── OpenCode ──────────────────────────────────────
  it.each(ALL_PERMISSIONS)(
    'opencodePermissions(%s)의 모든 값이 allow 또는 deny다',
    (permission) => {
      const policy = opencodePermissions(permission)
      const values = Object.values(policy)

      expect(values.length).toBeGreaterThan(0)
      for (const v of values) {
        expect(v).toMatch(/^(allow|deny)$/)
      }
      expect(values).not.toContain('ask')
    }
  )

  it.each(ALL_PERMISSIONS)(
    'opencode 설정 파일 전체 직렬화 결과에 "ask" 문자열이 없다 (%s)',
    (permission) => {
      const { file, cleanup } = writeOpencodeConfig({
        runId: 'test-run',
        permission,
        mcp: { serverName: 'onedesk', url: 'http://127.0.0.1:1234/mcp', token: 'tok' }
      })
      const raw = readFileSync(file, 'utf8')
      cleanup()

      // 문자열 수준의 방어. 나중에 누가 중첩 객체 형태의 권한 규칙을
      // 추가하면서 실수로 ask를 넣어도 여기서 잡힌다.
      expect(raw).not.toContain('"ask"')
    }
  )

  // ── Claude Code ───────────────────────────────────
  it.each(ALL_PERMISSIONS)(
    'claudeCodePermissionArgs(%s)가 대화형 권한 모드를 쓰지 않는다',
    (permission) => {
      const args = claudeCodePermissionArgs(permission, ['mcp__onedesk'])

      const modeIndex = args.indexOf('--permission-mode')
      if (modeIndex !== -1) {
        const mode = args[modeIndex + 1]
        // 'default'와 'manual'과 'plan'은 사람에게 묻는다 → 헤드리스에서 무한 대기
        expect(['acceptEdits', 'bypassPermissions', 'dontAsk']).toContain(mode)
      }
    }
  )

  it('읽기 전용은 편집·셸 도구를 도구 집합에서 제거한다', () => {
    const args = claudeCodePermissionArgs('read_only')
    const toolsIndex = args.indexOf('--tools')
    expect(toolsIndex).not.toBe(-1)

    const tools = args[toolsIndex + 1]!.split(',')
    expect(tools).not.toContain('Edit')
    expect(tools).not.toContain('Write')
    expect(tools).not.toContain('Bash')
    expect(tools).toContain('Read')
  })

  it('편집 허용은 Edit/Write는 주되 Bash는 주지 않는다 (§7 "그 외 차단")', () => {
    const args = claudeCodePermissionArgs('edit')
    const tools = args[args.indexOf('--tools') + 1]!.split(',')

    expect(tools).toContain('Edit')
    expect(tools).toContain('Write')
    expect(tools).not.toContain('Bash')
  })

  it('MCP 도구는 어느 단계에서든 allowedTools에 포함된다', () => {
    // ⚠️ 이 테스트가 실측으로 발견한 함정을 고정한다.
    // --permission-mode는 MCP 도구를 자동 승인하지 않는다.
    for (const p of ALL_PERMISSIONS) {
      const args = claudeCodePermissionArgs(p, ['mcp__onedesk'])
      const allowedIndex = args.indexOf('--allowedTools')
      expect(allowedIndex, `${p}에 --allowedTools가 없다`).not.toBe(-1)
      expect(args[allowedIndex + 1]).toContain('mcp__onedesk')
    }
  })
})
```

**이 테스트가 진짜로 막는 사고가 무엇인지 이해해라.** 단순히 "문자열이 있나 없나"를 보는 게 아니다.

시나리오: 6개월 뒤 누군가 "읽기 전용인데 파일 검색이 안 된다"는 버그를 고치려고 `opencodePermissions`에 `grep: 'ask'`를 추가한다. 로컬에서 대화형으로 테스트하면 잘 동작하는 것처럼 보인다(본인이 승인을 누르니까). **배포 후 헤드리스에서 모든 읽기 전용 run이 무한 정지한다.** 타임아웃이 기본 비활성(§11)이므로 영원히 멈춘 run이 인박스에도 안 올라온다.

위 테스트는 그 커밋을 CI에서 막는다. **`PermissionValue` 타입에서 `'ask'`를 제거한 것**(Q23 코드)도 같은 목적의 이중 방어다 — 타입 체커가 먼저 잡고, 테스트가 다음으로 잡는다.

**여기에 하나 더 추가하는 것을 권한다 — 조합 폭발 방지 테스트.**

```ts
it('모든 (권한 × agent) 조합에서 buildCommand가 예외 없이 인자를 만든다', () => {
  const adapters = [new ClaudeCodeAdapter(), new OpencodeAdapter()]

  for (const adapter of adapters) {
    for (const permission of ALL_PERMISSIONS) {
      for (const withMcp of [true, false]) {
        for (const withResume of [true, false]) {
          const spec = makeSpec({ permission, withMcp, withResume })
          expect(() => adapter.buildCommand(spec)).not.toThrow()
        }
      }
    }
  }
})
```

2×3×2×2 = 24개 조합을 한 번에 훑는다. `buildCommand`가 조건 분기의 집합체라서 이런 전수 테스트의 비용 대비 효과가 크다.

---

## 영역 7. MCP 서버

> 질문지에서 "가장 무서운 것 1위"로 꼽힌 영역이다. **이 절의 코드는 실제로 작성해서 돌려보고 검증했다.** 토큰 인증, 토큰별 도구 필터링, Claude Code에서의 실제 호출까지 전부 동작을 확인한 결과다.

### Q25. MCP가 정확히 뭔가요? REST API 서버와 뭐가 다른가요? — B

**MCP(Model Context Protocol)는 "LLM 애플리케이션에게 도구를 제공하는" 표준 프로토콜이다.** 전송은 HTTP를 쓰지만 **REST가 아니라 JSON-RPC 2.0**이다.

**REST와의 결정적 차이는 "자기 자신을 설명한다"는 것이다.**

REST API는 사람이 문서를 읽고 클라이언트를 짠다. MCP는 **클라이언트가 런타임에 서버에게 "너 무슨 도구 있어?"라고 물어본다.** 그 응답에는 각 도구의 이름, 설명, 그리고 **JSON Schema로 된 입력 스펙**이 들어 있다. LLM은 그 스키마를 보고 호출할 인자를 만든다.

```
일반 REST                          MCP
─────────────                      ───
GET  /issues?status=open           POST /mcp
GET  /issues/42                    {"method":"tools/list"}   ← 도구 목록을 물어본다
POST /issues                         ↓
                                   {"tools":[{"name":"list_issues",
엔드포인트마다 URL이 다름                     "inputSchema":{...}}]}
사전에 문서를 읽어야 함
                                   POST /mcp
                                   {"method":"tools/call",
                                    "params":{"name":"list_issues",
                                              "arguments":{"status":"open"}}}
                                   
                                   URL은 하나. method로 구분한다.
```

**요청/응답 형식 — JSON-RPC 2.0.** 세 종류의 메시지만 알면 된다.

```jsonc
// ① 요청 (id가 있으면 응답을 기대한다)
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }

// ② 응답
{ "jsonrpc": "2.0", "id": 1, "result": { "tools": [ /* … */ ] } }

// ③ 알림 (id 없음 = 응답 불필요)
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

**핵심 메서드 네 개.**

| 메서드 | 언제 | 하는 일 |
|---|---|---|
| `initialize` | 연결 직후 1회 | 프로토콜 버전 협상, 서버 정보 교환 |
| `notifications/initialized` | initialize 응답 후 | "준비 끝" 알림 |
| `tools/list` | 필요할 때 | 사용 가능한 도구 목록 + 스키마 |
| `tools/call` | 모델이 도구를 쓸 때 | 도구 실행 |

**[확인함] 실제 주고받은 내용이다.** 아래는 검증용으로 띄운 서버와의 실제 통신 기록이다.

```bash
$ curl -X POST http://127.0.0.1:63703/mcp \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -H 'Authorization: Bearer tok-readonly' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
         "protocolVersion":"2025-06-18","capabilities":{},
         "clientInfo":{"name":"t","version":"1"}}}'

event: message
data: {"result":{"protocolVersion":"2025-06-18",
                 "capabilities":{"tools":{"listChanged":true}},
                 "serverInfo":{"name":"one-desk","version":"0.1.0"}},
       "jsonrpc":"2.0","id":1}
```

**응답이 `event: message` / `data: {...}` 형태인 것을 눈여겨봐라.** 이게 **SSE(Server-Sent Events)** 형식이다. Streamable HTTP 전송은 응답을 SSE로 흘려보낼 수 있어서, 오래 걸리는 도구가 진행 상황을 중간에 보낼 수 있다. **그래서 요청에 `Accept: application/json, text/event-stream` 헤더가 필수다.** 이걸 빼면 406 에러가 난다 — 직접 `curl`로 테스트할 때 가장 많이 걸리는 함정이다.

**쓸 라이브러리: `@modelcontextprotocol/sdk`.** 현재 최신은 **1.30.0**이다. 위 JSON-RPC를 직접 다룰 일은 없다 — SDK가 전부 감춰준다.

```bash
pnpm add @modelcontextprotocol/sdk zod
```

**이 앱에서 MCP가 필요한 이유를 다시 확인해두자.** 설계 문서 §2가 말하듯, agent가 **실행 중에** 앱의 데이터를 읽고 쓰기 위해서다. 맥락 조립(§6)은 실행 **전에** 프롬프트로 밀어넣는 단방향이고, MCP는 실행 **중** 양방향이다. 둘 다 필요하다.

### Q26. 토큰이 포함된 MCP 설정을 CLI에 어떻게 넘기나요? `--mcp-config`는 파일인가요 JSON 문자열인가요? — A

**둘 다 된다. [확인함]** `claude --help`의 설명이 `"Load MCP servers from JSON files or strings (space-separated)"`이고, 실제로 JSON 문자열을 그대로 넘겨 연결에 성공했다.

**Authorization 헤더의 위치는 서버 정의 객체 안의 `headers` 필드다.**

```jsonc
{
  "mcpServers": {                        // ← 최상위 키. 복수형이다.
    "onedesk": {                         // ← 서버 이름. 도구 접두사가 된다.
      "type": "http",                    // ← Streamable HTTP
      "url": "http://127.0.0.1:63703/mcp",
      "headers": {
        "Authorization": "Bearer <run별 랜덤 토큰>"
      }
    }
  }
}
```

**[확인함] 이 설정이 실제로 동작한 증거.** `system`/`init` 이벤트에서:

```json
"mcp_servers": [{ "name": "onedesk", "status": "connected" }]
```

그리고 도구가 **`mcp__onedesk__list_issues`** 라는 이름으로 노출됐다. 이름 규칙은 **`mcp__<서버명>__<도구명>`** 이다. Q22에서 `--allowedTools "mcp__onedesk"`로 서버 단위 승인이 된 것도 이 규칙 덕분이다.

**파일과 문자열 중 무엇을 쓸 것인가 — 파일을 써라.** (Q16에서 이미 `writeMcpConfig()`를 만들었다)

이유는 **`ps aux`로 토큰이 노출되기 때문**이다.

```bash
# JSON 문자열로 넘기면 같은 머신의 아무 프로세스나 이걸 볼 수 있다
$ ps aux | grep claude
user 12345 ... claude -p --mcp-config {"mcpServers":{"onedesk":{...
                                       "Authorization":"Bearer a1b2c3..."}}}
```

설계 문서 §8은 "다른 로컬 프로세스가 포트에 접근해도 토큰 없이는 거부된다"고 보안 경계를 세웠는데, 토큰이 `ps`에 노출되면 **그 경계가 무의미해진다.** 파일 + `0600` 권한이면 이 구멍이 닫힌다.

**`--strict-mcp-config`를 반드시 함께 써라. [확인함]**

이걸 넣지 않으면 사용자의 개인 MCP 설정(`~/.claude.json`, 프로젝트의 `.mcp.json`)이 **함께 로드된다.** 실제로 `--strict-mcp-config` 없이 돌렸을 때 내 개인 MCP 서버 8개가 전부 붙었다.

이게 왜 심각한 문제인가:
1. **읽기 전용 run의 의미가 깨진다.** 우리가 쓰기 도구를 제외해도(Q28) 사용자의 다른 MCP 서버에 쓰기 도구가 있으면 그걸 쓴다.
2. **재현 불가능해진다.** 같은 프롬프트가 사용자마다 다르게 동작한다.
3. **비용과 지연이 늘어난다.** 도구 스키마가 전부 컨텍스트에 들어간다.

```ts
args.push('--mcp-config', cfg.file, '--strict-mcp-config')
```

**⚠️ 그리고 Q22에서 발견한 것을 다시 강조한다. `--mcp-config`만으로는 도구를 쓸 수 없다.**

`--permission-mode acceptEdits`로 실행했을 때 실제로 받은 응답:

```json
{"type":"tool_result",
 "content":"Claude requested permissions to use mcp__onedesk__list_issues, but you haven't granted it yet.",
 "is_error":true}
```

run은 멈추지 않고 종료됐지만, **도구를 하나도 못 쓴 채 "권한이 없어서 못 했습니다"라는 결과만 남았다.** `--allowedTools "mcp__onedesk"`를 추가하자 정상 동작했다(`permission_denials: []`).

**[확인함] 최종적으로 동작하는 인자 조합:**

```
claude -p --output-format stream-json --verbose
       --mcp-config <파일경로> --strict-mcp-config
       --allowedTools "mcp__onedesk"
       --permission-mode acceptEdits
```

**OpenCode는 `OPENCODE_CONFIG` 환경변수로 넘긴다** (Q23 참고). 커맨드 인자가 아니라 환경변수이므로 `ps`에는 파일 경로만 노출되어 오히려 안전하다.

### Q27. `list_repos()` 같은 "도구"는 실제 어떤 형태의 코드인가요? HTTP 엔드포인트인가요, SDK 등록인가요? — B

**SDK 등록이다.** HTTP 엔드포인트를 만들지 않는다. URL은 `/mcp` 하나뿐이고, 도구는 그 안에서 이름으로 분기된다.

**형태는 "이름 + zod 스키마 + 콜백"의 3종 세트다.**

```ts
server.registerTool(
  'list_issues',                    // ① 이름
  {
    title: 'List issues',
    description: '…',
    inputSchema: { status: z.enum(['open','doing','done']).optional() }   // ② 스키마
  },
  async ({ status }) => { … }       // ③ 콜백. 인자는 이미 검증·파싱된 상태다.
)
```

**[확인함] `registerTool`의 실제 시그니처** (`@modelcontextprotocol/sdk@1.30.0`의 타입 정의):

```ts
registerTool<OutputArgs, InputArgs>(
  name: string,
  config: {
    title?: string
    description?: string
    inputSchema?: InputArgs        // ← zod raw shape (객체. z.object()로 감싸지 않는다)
    outputSchema?: OutputArgs
    annotations?: ToolAnnotations
    _meta?: Record<string, unknown>
  },
  cb: ToolCallback<InputArgs>
): RegisteredTool
```

**⚠️ `inputSchema`는 `z.object({...})`가 아니라 그냥 `{...}`다.** 이걸 틀리면 스키마가 이상하게 생성되어 모델이 인자를 못 만든다.

```ts
// ✓ 올바름 — raw shape
inputSchema: { id: z.string(), status: z.enum(['open','doing','done']).optional() }

// ✗ 틀림 — z.object로 감싸지 마라
inputSchema: z.object({ id: z.string() })
```

**설계 문서 §8의 도구 8개를 전부 구현한 코드다.**

```ts
// core/mcp/buildServer.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { RunContext, McpDeps } from './types'

/**
 * run 하나를 위한 MCP 서버 인스턴스를 만든다.
 *
 * ⚠️ 서버가 run별로 만들어지는 것이 이 설계의 핵심이다.
 * ctx가 클로저에 갇히므로, 도구 콜백은 항상 "자기 run의 workspace"만 본다.
 * workspace_id를 인자로 받지 않기 때문에 agent가 조작할 방법이 없다. (§8)
 */
export function buildMcpServer(ctx: RunContext, deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: 'one-desk', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  /** 모든 MCP 호출을 run 로그에 남긴다 (§8 감사 기록) */
  const audit = (tool: string, args: unknown, ok: boolean) => {
    deps.logAudit(ctx.runId, { tool, args, ok, at: Date.now() })
  }

  const ok = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
  })

  // ── 읽기 도구 (항상 등록) ────────────────────────────

  server.registerTool('list_repos', {
    title: 'List repos',
    description: '현재 workspace에 등록된 로컬 repo 목록을 반환한다. 경로와 설명을 포함한다.',
    inputSchema: {}
  }, async () => {
    const rows = deps.repos.listByWorkspace(ctx.workspaceId)
    audit('list_repos', {}, true)
    return ok(rows.map((r) => ({ id: r.id, name: r.name, path: r.path, description: r.description })))
  })

  server.registerTool('list_issues', {
    title: 'List issues',
    description:
      '이슈 목록을 반환한다. status로 필터링하거나 repo id로 태깅된 것만 볼 수 있다. ' +
      '본문(body)은 포함되지 않으므로 상세 내용은 get_issue를 써라.',
    inputSchema: {
      status: z.enum(['open', 'doing', 'done']).optional()
        .describe('생략하면 모든 상태'),
      repo: z.string().optional()
        .describe('repo id. list_repos로 얻는다.')
    }
  }, async ({ status, repo }) => {
    const rows = deps.issues.list({ workspaceId: ctx.workspaceId, status, repoId: repo })
    audit('list_issues', { status, repo }, true)
    return ok(rows.map(({ id, title, status, repoIds, updatedAt }) =>
      ({ id, title, status, repoIds, updatedAt })))
  })

  server.registerTool('get_issue', {
    title: 'Get issue',
    description: '이슈 하나의 전체 내용(본문 포함)을 반환한다.',
    inputSchema: { id: z.string().describe('이슈 id') }
  }, async ({ id }) => {
    const row = deps.issues.findById(id)
    // ⚠️ workspace 확인. 이게 §8의 격리 경계다.
    if (!row || row.workspaceId !== ctx.workspaceId) {
      audit('get_issue', { id }, false)
      return { content: [{ type: 'text', text: `이슈를 찾을 수 없습니다: ${id}` }], isError: true }
    }
    audit('get_issue', { id }, true)
    return ok(row)
  })

  server.registerTool('list_memos', {
    title: 'List memos',
    description: '메모 목록을 반환한다. 본문은 포함되지 않는다.',
    inputSchema: { repo: z.string().optional().describe('repo id로 필터링') }
  }, async ({ repo }) => {
    const rows = deps.memos.list({ workspaceId: ctx.workspaceId, repoId: repo })
    audit('list_memos', { repo }, true)
    return ok(rows.map(({ id, title, repoIds, updatedAt }) => ({ id, title, repoIds, updatedAt })))
  })

  server.registerTool('get_memo', {
    title: 'Get memo',
    description: '메모 하나의 전체 내용을 반환한다.',
    inputSchema: { id: z.string() }
  }, async ({ id }) => {
    const row = deps.memos.findById(id)
    if (!row || row.workspaceId !== ctx.workspaceId) {
      audit('get_memo', { id }, false)
      return { content: [{ type: 'text', text: `메모를 찾을 수 없습니다: ${id}` }], isError: true }
    }
    audit('get_memo', { id }, true)
    return ok(row)
  })

  // ── 쓰기 도구 (읽기 전용이면 등록하지 않는다 — Q28) ──
  if (ctx.permission !== 'read_only') {
    server.registerTool('create_issue', {
      title: 'Create issue',
      description: '새 이슈를 만든다. 작업 중 발견한 별도 과제를 남길 때 사용해라.',
      inputSchema: {
        title: z.string().min(1).max(500),
        body: z.string().default(''),
        repo_ids: z.array(z.string()).optional().describe('태깅할 repo id 목록')
      }
    }, async ({ title, body, repo_ids }) => {
      const created = deps.issues.create({
        workspaceId: ctx.workspaceId, title, body, repoIds: repo_ids
      })
      audit('create_issue', { title, repo_ids }, true)
      return ok({ id: created.id, title: created.title, status: created.status })
    })

    server.registerTool('update_issue', {
      title: 'Update issue',
      description: '이슈의 상태나 본문을 수정한다. 작업을 마쳤으면 status를 done으로 바꿔라.',
      inputSchema: {
        id: z.string(),
        status: z.enum(['open', 'doing', 'done']).optional(),
        body: z.string().optional()
      }
    }, async ({ id, status, body }) => {
      const existing = deps.issues.findById(id)
      if (!existing || existing.workspaceId !== ctx.workspaceId) {
        audit('update_issue', { id }, false)
        return { content: [{ type: 'text', text: `이슈를 찾을 수 없습니다: ${id}` }], isError: true }
      }
      const updated = deps.issues.update(id, { status, body })
      audit('update_issue', { id, status }, true)
      return ok({ id: updated.id, status: updated.status })
    })

    server.registerTool('create_memo', {
      title: 'Create memo',
      description: '새 메모를 만든다. 조사 결과나 참고 자료를 남길 때 사용해라.',
      inputSchema: {
        title: z.string().min(1).max(500),
        body: z.string().default(''),
        repo_ids: z.array(z.string()).optional()
      }
    }, async ({ title, body, repo_ids }) => {
      const created = deps.memos.create({
        workspaceId: ctx.workspaceId, title, body, repoIds: repo_ids
      })
      audit('create_memo', { title }, true)
      return ok({ id: created.id, title: created.title })
    })

    server.registerTool('update_memo', {
      title: 'Update memo',
      description: '메모의 제목이나 본문을 수정한다.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        body: z.string().optional()
      }
    }, async ({ id, title, body }) => {
      const existing = deps.memos.findById(id)
      if (!existing || existing.workspaceId !== ctx.workspaceId) {
        audit('update_memo', { id }, false)
        return { content: [{ type: 'text', text: `메모를 찾을 수 없습니다: ${id}` }], isError: true }
      }
      const updated = deps.memos.update(id, { title, body })
      audit('update_memo', { id }, true)
      return ok({ id: updated.id })
    })
  }

  return server
}
```

**반환값의 형태를 정확히 지켜라.**

```ts
// 성공
{ content: [{ type: 'text', text: '…' }] }

// 실패 — 예외를 던지지 말고 isError를 써라
{ content: [{ type: 'text', text: '이슈를 찾을 수 없습니다' }], isError: true }
```

**예외를 던지면 JSON-RPC 오류가 되어 모델이 그 내용을 못 본다.** `isError: true`로 반환하면 **모델이 에러 메시지를 읽고 스스로 고쳐서 재시도할 수 있다.** 이 차이가 agent의 성공률에 크게 영향을 준다.

**`description`을 성의 있게 써라.** REST API의 주석과 달리, 이 문자열은 **모델이 실제로 읽고 판단하는 프롬프트의 일부**다. "이슈 목록을 반환한다"보다 "본문은 포함되지 않으므로 상세 내용은 get_issue를 써라"가 훨씬 낫다 — 후자는 모델이 불필요한 호출을 줄이게 만든다.

### Q28. "읽기 전용 run에는 쓰기 도구 제외"가 프로토콜상 토큰별로 가능한가요? — B

**가능하다. 실제로 구현해서 검증했다. [확인함]**

**핵심 아이디어는 "요청마다 토큰을 보고 그 토큰에 맞는 서버 인스턴스를 만든다"** 이다. 도구 필터링을 `tools/list` 응답에서 하는 게 아니라, **애초에 등록을 안 한다.**

```
HTTP 요청 도착
   │
   ├─ Authorization 헤더에서 토큰 추출
   ├─ 토큰 → { runId, workspaceId, permission } 조회
   │    └─ 없으면 401. 여기서 끝. (§8 "토큰 없이는 거부")
   │
   ├─ buildMcpServer(ctx)  ← permission에 따라 쓰기 도구를 등록하거나 안 한다
   ├─ 새 Transport 생성 (stateless)
   └─ handleRequest()
```

**[확인함] 실측 결과.**

```bash
# 읽기 전용 토큰
$ curl ... -H "Authorization: Bearer tok-readonly" -d '{"...","method":"tools/list"}'
"name":"list_issues"

# 전체 허용 토큰
$ curl ... -H "Authorization: Bearer tok-full" -d '{"...","method":"tools/list"}'
"name":"list_issues"
"name":"update_issue"

# 읽기 전용 토큰으로 쓰기 도구를 강제 호출하면
$ curl ... -H "Authorization: Bearer tok-readonly" \
    -d '{"...","method":"tools/call","params":{"name":"update_issue",...}}'
{"result":{"content":[{"type":"text","text":"MCP error -32602: Tool update_issue not found"}],
           "isError":true},...}

# 토큰 없이
$ curl ... (no header)
401
```

**목록에서 숨겨질 뿐 아니라 직접 호출해도 거부된다.** 이게 중요하다 — "목록에서만 빼기"였다면 이름을 아는 agent가 그냥 호출할 수 있었을 것이다.

**전체 구현.**

```ts
// core/mcp/host.ts
import http from 'node:http'
import crypto from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildMcpServer } from './buildServer'
import type { Permission } from '@shared/client'

export interface RunContext {
  runId: string
  workspaceId: string
  permission: Permission
}

export class McpServerHost {
  private server: http.Server | null = null
  private readonly tokens = new Map<string, RunContext>()
  private port = 0

  constructor(private readonly deps: McpDeps) {}

  /** §8 "임의 포트", §11 "MCP 포트 충돌: 임의 포트 사용, 실패 시 재시도" */
  async listen(): Promise<number> {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res)
    })

    return new Promise((resolve, reject) => {
      // 포트 0 = OS가 빈 포트를 골라준다. 충돌이 원천적으로 불가능하다.
      // 127.0.0.1에만 바인딩 — 외부 네트워크에서 접근 불가.
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as import('node:net').AddressInfo).port
        resolve(this.port)
      })
      this.server!.once('error', reject)
    })
  }

  /** run 시작 시 호출. 토큰을 발급한다. */
  issueToken(ctx: RunContext): { token: string; url: string } {
    // 32바이트 = 256비트. 무차별 대입이 불가능하다.
    const token = crypto.randomBytes(32).toString('base64url')
    this.tokens.set(token, ctx)
    return { token, url: `http://127.0.0.1:${this.port}/mcp` }
  }

  /** run 종료 시 호출. §8 "토큰은 run 종료와 함께 폐기된다" */
  revokeToken(runId: string): void {
    for (const [token, ctx] of this.tokens) {
      if (ctx.runId === runId) this.tokens.delete(token)
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }

    // ── 인증 ──
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    const ctx = token ? this.tokens.get(token) : undefined

    if (!ctx) {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer'
      })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    // ── 요청마다 서버 + 전송을 새로 만든다 ──
    // 비용이 걱정될 수 있지만, 도구 등록은 객체 몇 개 만드는 것뿐이라 무시할 수준이다.
    // 얻는 것은 "권한이 절대 섞이지 않는다"는 확실한 보장이다.
    const server = buildMcpServer(ctx, this.deps)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined   // ← stateless 모드. 세션 관리를 우리가 안 해도 된다.
    })

    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    await server.connect(transport)
    await transport.handleRequest(req, res)
  }

  async close(): Promise<void> {
    this.tokens.clear()
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
  }
}
```

**`sessionIdGenerator: undefined`(stateless)를 쓰는 이유.** stateful 모드는 서버가 세션 ID를 발급하고 클라이언트가 이후 요청에 그걸 실어야 한다. 우리는 **토큰이 이미 세션 역할을 하므로** 중복이다. stateless면 서버가 상태를 안 들고 있어 메모리 누수 걱정도 없다.

**⚠️ 프로토콜 수준 필터링만으로는 부족하다는 점을 반드시 알아둬라.**

Q22에서 실측한 것을 다시 보자: **`--tools "Read"`로 빌트인을 제한해도 `mcp__*` 도구는 그대로 남았다.** 즉,

> **Claude Code의 CLI 플래그로는 MCP 도구를 읽기 전용으로 만들 수 없다.**

따라서 **§8의 "권한 정책이 도구 노출을 통제한다"는 MCP 서버 쪽에서 구현하는 것 외에 방법이 없다.** 설계 문서의 이 결정은 선택이 아니라 필연이었던 셈이다. 위 코드가 유일한 방어선이므로, 아래 테스트를 반드시 넣어라.

**§12가 "보안 경계이므로 반드시 테스트로 고정"이라고 한 그 테스트다.**

```ts
// core/mcp/__tests__/host.security.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

describe('MCP 보안 경계', () => {
  let host: McpServerHost
  let url: string
  let readOnlyToken: string
  let ws1Token: string
  let ws2Token: string

  beforeAll(async () => {
    host = new McpServerHost(makeDeps())     // 인메모리 DB (Q39)
    await host.listen()
    ;({ token: readOnlyToken, url } = host.issueToken({
      runId: 'r1', workspaceId: 'ws-1', permission: 'read_only'
    }))
    ;({ token: ws1Token } = host.issueToken({
      runId: 'r2', workspaceId: 'ws-1', permission: 'edit'
    }))
    ;({ token: ws2Token } = host.issueToken({
      runId: 'r3', workspaceId: 'ws-2', permission: 'edit'
    }))
  })

  afterAll(() => host.close())

  const rpc = (token: string | null, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    })

  it('토큰이 없으면 401', async () => {
    const res = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(res.status).toBe(401)
  })

  it('폐기된 토큰은 401', async () => {
    host.revokeToken('r1')
    const res = await rpc(readOnlyToken, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(res.status).toBe(401)
  })

  it('읽기 전용 토큰에는 쓰기 도구가 목록에 없다', async () => {
    const names = await listToolNames(ws1Token)   // edit 토큰
    expect(names).toContain('update_issue')

    const roNames = await listToolNames(readOnlyToken2)
    expect(roNames).toContain('list_issues')
    expect(roNames).not.toContain('update_issue')
    expect(roNames).not.toContain('create_issue')
  })

  it('읽기 전용 토큰으로 쓰기 도구를 직접 호출하면 거부된다', async () => {
    const res = await rpc(readOnlyToken2, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'update_issue', arguments: { id: 'i1', status: 'done' } }
    })
    const body = await parseSse(res)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/not found/i)
  })

  it('⭐ 다른 workspace의 이슈에 접근할 수 없다', async () => {
    // ws-2에 이슈를 만들고, ws-1의 토큰으로 읽으려 시도한다
    const issueInWs2 = deps.issues.create({ workspaceId: 'ws-2', title: '비밀', body: '' })

    const res = await rpc(ws1Token, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_issue', arguments: { id: issueInWs2.id } }
    })
    const body = await parseSse(res)

    expect(body.result.isError).toBe(true)
    expect(JSON.stringify(body)).not.toContain('비밀')   // 내용이 새지 않았는지
  })

  it('list_issues는 자기 workspace의 것만 반환한다', async () => {
    deps.issues.create({ workspaceId: 'ws-2', title: 'ws2-only', body: '' })
    const res = await rpc(ws1Token, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'list_issues', arguments: {} }
    })
    expect(JSON.stringify(await parseSse(res))).not.toContain('ws2-only')
  })
})

/** SSE 응답에서 JSON을 뽑는 헬퍼 */
async function parseSse(res: Response) {
  const text = await res.text()
  const line = text.split('\n').find((l) => l.startsWith('data: '))!
  return JSON.parse(line.slice(6))
}
```

**마지막 테스트 두 개가 이 앱에서 가장 중요한 테스트다.** §8이 세운 격리 경계가 실제로 서는지를 증명하고, 나중에 누가 `get_issue`에서 `workspaceId` 체크를 빼먹으면 즉시 잡아낸다.

**RunManager와의 배선.**

```ts
// core/runner/RunManager.ts 의 execute() 안
const mcpGrant = this.deps.mcp.issueToken({
  runId,
  workspaceId: spec.workspaceId,
  permission: spec.permission
})

const spawnSpec = adapter.buildCommand({
  ...spec,
  runId,
  mcp: { serverName: 'onedesk', url: mcpGrant.url, token: mcpGrant.token }
})

try {
  // … 실행 …
} finally {
  this.deps.mcp.revokeToken(runId)      // ← §8 "토큰은 run 종료와 함께 폐기된다"
}
```

---

## 영역 8. 스트림 이벤트와 실시간 UI

### Q29. 수천 개 이벤트를 매번 `setState`하면 렌더링 성능 문제가 생기지 않나요? — B

**생긴다. 그리고 이 앱에서는 확실히 생긴다.** 설계 문서에 배치 처리 언급이 없는 것은 누락이다(구멍 목록 #10).

**문제의 규모를 먼저 계산해보자.** run 하나가 수천 개 이벤트를 낸다(§5). 동시 실행 3개면 초당 수백 개다. React 19는 이벤트 핸들러 안의 `setState`를 자동으로 배치하지만, **IPC 콜백은 React의 이벤트 시스템 밖**이라 자동 배치의 혜택이 제한적이고, 무엇보다 **매 이벤트마다 새 배열을 만드는 비용**이 문제다.

```ts
// ✗ 이렇게 하면 이벤트 1000개에 배열 복사 1000번 = O(n²)
setEvents((prev) => [...prev, newEvent])
```

이벤트가 5000개 쌓이면 마지막 이벤트 하나를 추가하는 데 5000개짜리 배열을 복사한다. **로그 창이 점점 느려지다가 앱이 멈춘 것처럼 보인다.**

**해결은 3단 방어다.**

**① 버퍼링 + `requestAnimationFrame` 플러시 (가장 중요)**

이벤트를 즉시 상태에 넣지 않고 버퍼에 모았다가, 화면 갱신 주기(60fps = 16.7ms)에 맞춰 한 번에 반영한다.

```ts
// renderer/state/runEventStore.ts
import { useSyncExternalStore } from 'react'
import type { RunEvent } from '@shared/events'

/**
 * run별 이벤트를 모으는 외부 스토어.
 *
 * React 상태가 아니라 평범한 Map이다.
 * 이벤트 수신은 React 밖에서 일어나고,
 * 화면 갱신만 rAF 주기로 React에 알린다.
 */
class RunEventStore {
  private readonly events = new Map<string, RunEvent[]>()
  private readonly listeners = new Set<() => void>()
  private pendingFlush = false
  private version = 0

  /** IPC 콜백에서 호출된다. React를 건드리지 않는다. */
  push(event: RunEvent): void {
    const list = this.events.get(event.runId)
    if (list) {
      list.push(event)                 // ← 배열을 복사하지 않는다. O(1).
    } else {
      this.events.set(event.runId, [event])
    }
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) return      // 이미 예약됨 — 여러 이벤트가 한 프레임으로 합쳐진다
    this.pendingFlush = true

    requestAnimationFrame(() => {
      this.pendingFlush = false
      this.version++
      for (const l of this.listeners) l()
    })
  }

  // ── useSyncExternalStore 계약 ──
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): number => this.version

  getEvents(runId: string): RunEvent[] {
    return this.events.get(runId) ?? EMPTY
  }

  /** 탭을 닫을 때 메모리를 돌려준다 */
  drop(runId: string): void {
    this.events.delete(runId)
  }

  seed(runId: string, events: RunEvent[]): void {
    this.events.set(runId, events)
    this.scheduleFlush()
  }
}

const EMPTY: RunEvent[] = []
export const runEventStore = new RunEventStore()

/** 컴포넌트에서 쓰는 훅 */
export function useRunEvents(runId: string): RunEvent[] {
  useSyncExternalStore(runEventStore.subscribe, runEventStore.getSnapshot)
  return runEventStore.getEvents(runId)
}
```

**`useSyncExternalStore`를 쓰는 이유.** React 18+에서 "React 밖의 가변 상태"를 안전하게 구독하는 공식 API다. `useState` + `useEffect`로 흉내 내면 동시성 모드에서 tearing(같은 렌더링 안에서 서로 다른 버전의 데이터를 보는 현상)이 발생할 수 있다.

**`getSnapshot`이 배열이 아니라 숫자(`version`)를 반환하는 것이 핵심이다.** `getSnapshot`은 **호출할 때마다 같은 참조를 반환해야 한다** — 배열을 반환하면 매번 새 참조가 되어 무한 렌더링에 빠진다. 버전 숫자를 반환하면 그 함정을 피하면서도 변경을 알릴 수 있다.

**② 앱 전체에서 구독은 한 번만**

```tsx
// renderer/App.tsx
export function App() {
  useEffect(() => {
    const unsub = window.oneDesk.events.onRunEvent((e) => {
      runEventStore.push(e)          // ← 스토어에만 밀어넣는다. setState 없음.
      if (e.type === 'result' || e.type === 'status') {
        runMetaStore.update(e)       // 탭 아이콘/배지용 가벼운 상태만 따로
      }
    })
    window.oneDesk.app.rendererReady()
    return unsub
  }, [])
  // …
}
```

**③ 화면에 그리는 개수를 제한한다**

이벤트 5000개를 전부 DOM에 그리면 배치 처리를 해도 느리다. 두 가지 중 하나를 골라라.

```tsx
// (a) 간단한 방법 — 최근 N개만. 로그 뷰어에는 대개 이걸로 충분하다.
const MAX_VISIBLE = 500

function RunLogView({ runId }: { runId: string }) {
  const all = useRunEvents(runId)
  const visible = all.length > MAX_VISIBLE ? all.slice(-MAX_VISIBLE) : all

  return (
    <div className="log">
      {all.length > MAX_VISIBLE && (
        <button onClick={() => openFullLog(runId)}>
          이전 {all.length - MAX_VISIBLE}개 이벤트 보기
        </button>
      )}
      {visible.map((e) => <EventRow key={e.seq} event={e} />)}
    </div>
  )
}
```

```tsx
// (b) 제대로 하는 방법 — 가상 스크롤. 이벤트가 정말 많아지면 이쪽으로.
// @tanstack/react-virtual 등을 쓴다. 3단계 이후에 필요해지면 도입해라.
```

**`key`에 배열 인덱스를 쓰지 마라.** 이벤트에 **단조 증가하는 `seq`를 부여**해라. 인덱스를 키로 쓰면 앞쪽이 잘려나갈 때 React가 전체를 다시 그린다.

```ts
// core/runner/RunManager.ts — emit 직전에 부여
let seq = 0
const emit = (event: Omit<RunEvent, 'seq'>) => {
  const withSeq = { ...event, seq: seq++ } as RunEvent
  logWriter.write(withSeq)
  this.emit('runEvent', withSeq)
}
```

**④ `text` 이벤트는 합쳐서 렌더링해라.**

agent의 텍스트 출력은 잘게 쪼개져 오는 경우가 많다(`--include-partial-messages`를 쓰면 더 심하다). 연속된 `text` 이벤트를 하나의 문단으로 합치면 DOM 노드 수가 크게 줄고 텍스트 선택도 자연스러워진다.

```ts
// renderer/state/coalesce.ts
export function coalesceText(events: RunEvent[]): RenderItem[] {
  const items: RenderItem[] = []
  for (const e of events) {
    const last = items[items.length - 1]
    if (e.type === 'text' && last?.kind === 'text') {
      last.text += e.text          // 이전 것에 이어붙인다
      continue
    }
    items.push(toRenderItem(e))
  }
  return items
}
```

`useMemo`로 감싸서 이벤트 배열이 바뀔 때만 다시 계산해라.

**성능을 실제로 확인하는 방법.** 추측하지 말고 측정해라.

```ts
// 가짜 CLI 스크립트(Q38)로 이벤트 5000개를 1초에 쏟아내는 run을 만든다.
// 그리고 Chrome DevTools의 Performance 탭으로 녹화한다.
// 목표: 프레임당 렌더링 시간 16ms 이하, 롱 태스크 없음.
```

### Q30. 앱 재시작 후 지난 run의 탭은 `stream.jsonl`을 다시 읽어 재현하나요? 실시간 표시와 같은 컴포넌트인가요? — B

**둘 다 "예"다. 그리고 그게 이 설계가 잘 된 지점이다.**

**핵심 통찰: `stream.jsonl`에 쓰는 것과 IPC로 보내는 것이 동일한 `RunEvent` 객체다.** (Q17의 `emit` 함수가 같은 객체를 양쪽에 보낸다.) 따라서 파일에서 읽은 것과 실시간으로 받은 것이 **타입도 내용도 완전히 같다.** UI는 출처를 구분할 필요가 없다.

```
실시간:  agent stdout → parseLine → RunEvent ─┬→ stream.jsonl
                                             └→ IPC → store.push()
                                                          │
과거:    stream.jsonl → JSON.parse → RunEvent ──→ store.seed()
                                                          │
                                                          ▼
                                                   같은 배열, 같은 컴포넌트
```

**"과거 로그 읽기"를 `OneDeskClient`에 추가한다.**

```ts
// shared/client.ts
runs: {
  start(spec: RunSpec): Promise<Run>
  cancel(id: string): Promise<void>
  get(id: string): Promise<Run | null>
  /** 저장된 stream.jsonl을 RunEvent[]로 복원한다 */
  loadEvents(id: string, opts?: { limit?: number }): Promise<RunEvent[]>
}
```

```ts
// core/runner/loadRunEvents.ts
import fs from 'node:fs'
import readline from 'node:readline'
import type { RunEvent } from '@shared/events'

/**
 * stream.jsonl을 읽어 RunEvent 배열로 복원한다.
 *
 * 파일 전체를 readFileSync로 읽지 않는 이유:
 * 긴 run의 로그는 수십 MB가 될 수 있고, 그러면 main 프로세스가 그동안 멈춘다.
 * 스트리밍으로 읽으면 이벤트 루프를 놓아준다.
 */
export async function loadRunEvents(
  logPath: string,
  opts: { limit?: number } = {}
): Promise<RunEvent[]> {
  if (!fs.existsSync(logPath)) return []

  const limit = opts.limit ?? 5000
  const events: RunEvent[] = []

  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as RunEvent)
    } catch {
      // 앱이 강제 종료되면 마지막 줄이 잘린 채 남을 수 있다.
      // 한 줄 때문에 전체 복원을 포기하지 않는다 (§11과 같은 원칙).
    }
    // 링 버퍼: 상한을 넘으면 앞에서 버린다. 최근 것이 더 중요하다.
    if (events.length > limit) events.shift()
  }

  return events
}
```

**렌더러 쪽 — 탭 하나가 두 경우를 모두 처리한다.**

```tsx
// renderer/components/RunTab.tsx
export function RunTab({ runId }: { runId: string }) {
  const events = useRunEvents(runId)          // Q29의 훅. 출처를 모른다.
  const run = useRun(runId)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // 스토어에 이미 이벤트가 있으면 = 실시간으로 받고 있는 중이거나 이미 로드함
    if (runEventStore.getEvents(runId).length > 0) return

    // 끝난 run이면 파일에서 복원한다
    if (run && run.status !== 'running' && run.status !== 'pending') {
      setLoading(true)
      window.oneDesk.runs.loadEvents(runId)
        .then((loaded) => runEventStore.seed(runId, loaded))
        .finally(() => setLoading(false))
    }
  }, [runId, run?.status])

  if (loading) return <Spinner label="로그 불러오는 중…" />

  // ⭐ 여기부터는 완전히 동일하다. 실시간이든 과거든 같은 컴포넌트.
  return <RunLogView runId={runId} events={events} isLive={run?.status === 'running'} />
}
```

**`isLive`로 무엇이 달라지나 — 표현만 달라지고 데이터는 같다.**

```tsx
function RunLogView({ events, isLive }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 실시간일 때만 자동 스크롤. 과거 로그를 볼 때 강제로 내려가면 짜증난다.
  useEffect(() => {
    if (isLive) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length, isLive])

  return (
    <div>
      {coalesceText(events).map((item) => <EventRow key={item.seq} item={item} />)}
      {isLive && <TypingIndicator />}      {/* 실시간에만 표시 */}
      <div ref={bottomRef} />
    </div>
  )
}
```

**놓치기 쉬운 경쟁 조건 하나를 짚어둔다.**

앱을 켜자마자 실행 중인 run의 탭을 열면, **파일 로드와 실시간 이벤트가 동시에 온다.** 그러면 `seed()`가 이미 도착한 실시간 이벤트를 덮어쓸 수 있다.

```ts
// ✓ seed는 덮어쓰지 말고 병합하되, seq로 중복을 제거한다
seed(runId, loaded: RunEvent[]): void {
  const existing = this.events.get(runId) ?? []
  const seen = new Set(existing.map((e) => e.seq))
  const merged = [...loaded.filter((e) => !seen.has(e.seq)), ...existing]
  merged.sort((a, b) => a.seq - b.seq)
  this.events.set(runId, merged)
  this.scheduleFlush()
}
```

**이것이 `seq`를 부여한 두 번째 이유다** (첫 번째는 Q29의 React key). 중복 제거와 정렬의 기준이 된다.

**메모리 관리 — 탭을 닫으면 버려라.**

```tsx
useEffect(() => {
  return () => {
    // 끝난 run의 이벤트는 파일에 있으므로 메모리에 들고 있을 이유가 없다.
    // 실행 중인 run은 유지한다 — 다시 열었을 때 이어서 봐야 하므로.
    if (run?.status !== 'running') runEventStore.drop(runId)
  }
}, [runId])
```

---

## 영역 9. 세션 이어서 실행

### Q31. `external_session_id`는 stdout의 어느 이벤트, 어떤 필드에서 얻나요? — A

**[확인함] Claude Code에서는 두 곳에서 얻을 수 있고, 첫 번째가 가장 빠르다.**

**① `system` / `init` 이벤트 — 실행 시작 직후 도착한다. 이걸 써라.**

실제 출력(줄바꿈은 가독성을 위해 넣었다):

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/private/tmp/.../scratchpad",
  "session_id": "1c84c36a-b05c-45c2-945c-d83bd29ec52f",
  "tools": ["Read", "mcp__onedesk__list_issues", "…"],
  "mcp_servers": [{ "name": "onedesk", "status": "connected" }],
  "model": "claude-sonnet-5",
  "permissionMode": "acceptEdits",
  "apiKeySource": "none",
  "claude_code_version": "2.1.224",
  "uuid": "cfbf96b4-50a9-447b-bbd0-ec99f23f5b73"
}
```

**필드명은 `session_id`** (스네이크 케이스)다.

**② `result` 이벤트 — 종료 시. 같은 값이 들어 있다.**

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "pong",
  "session_id": "1c84c36a-b05c-45c2-945c-d83bd29ec52f",
  "num_turns": 1,
  "duration_ms": 3305,
  "total_cost_usd": 0.114822,
  "permission_denials": [],
  "uuid": "8f238c22-7da7-45eb-8afc-ac449d936138"
}
```

**`init`에서 잡는 것이 중요한 이유:** run이 중간에 실패하거나 사용자가 취소해도 세션 ID가 남는다. `result`만 기다리면 **비정상 종료된 run은 이어서 실행할 수 없다.** §10의 "실패 → 다시 실행" 경로가 세션 재사용을 원한다면 `init`이 필수다.

**참고로 `session_id`는 거의 모든 이벤트에 붙어 있다.** `assistant`, `user`, `rate_limit_event`에도 있었다. 하지만 `init`을 기준으로 삼는 것이 명확하다.

**[확인함] `parseLine`의 완전한 구현이다.** 아래 이벤트 타입들을 실제로 관측했다.

```ts
// core/runner/adapters/claudeCode.ts
import type { RunEvent } from '@shared/events'

export class ClaudeCodeAdapter implements AgentAdapter {
  parseLine(line: string, runId: string): RunEvent | RunEvent[] | null {
    const obj = JSON.parse(line) as Record<string, any>
    const at = Date.now()

    switch (obj.type) {
      // ── 세션 확보 ──
      case 'system': {
        if (obj.subtype === 'init') {
          return { type: 'session', runId, sessionId: obj.session_id, at }
        }
        // hook_started / hook_response 등은 UI에 필요 없다.
        // 로그 파일에는 raw로 남기고 싶다면 여기서 raw 이벤트를 반환해라.
        return null
      }

      // ── 모델 출력 ──
      case 'assistant': {
        const events: RunEvent[] = []
        for (const block of obj.message?.content ?? []) {
          if (block.type === 'text') {
            events.push({ type: 'text', runId, text: block.text, at })
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'tool_use', runId,
              toolUseId: block.id,          // "toolu_018djaMLPCX6VaRd4frEcBJa"
              name: block.name,             // "Read"
              input: block.input,           // { file_path: "/abs/path" }
              at
            })
          }
          // block.type === 'thinking' 은 버린다.
          // signature 필드가 3~5KB라 로그를 불필요하게 키운다.
        }
        return events
      }

      // ── 도구 결과 (⚠️ type이 'user'다) ──
      case 'user': {
        const events: RunEvent[] = []
        for (const block of obj.message?.content ?? []) {
          if (block.type !== 'tool_result') continue
          events.push({
            type: 'tool_result', runId,
            toolUseId: block.tool_use_id,
            ok: block.is_error !== true,    // ⚠️ 성공 시 is_error 필드가 아예 없다
            summary: summarizeContent(block.content),
            at
          })
        }
        return events
      }

      // ── 최종 결과 ──
      case 'result': {
        return {
          type: 'result', runId,
          status: obj.is_error ? 'failed' : 'succeeded',
          resultText: typeof obj.result === 'string' ? obj.result : '',
          sessionId: obj.session_id,        // init을 놓쳤을 때의 보험
          numTurns: obj.num_turns,
          costUsd: obj.total_cost_usd,
          at
        }
      }

      // ── 관심 없는 것들 ──
      case 'rate_limit_event':
        return null

      default:
        return null
    }
  }
}

/**
 * tool_result의 content는 문자열일 수도, 블록 배열일 수도 있다.
 * ⚠️ 둘 다 실제로 관측했다:
 *   - 문자열:  "1\thello-one-desk\n2\t"
 *   - 배열:    [{"type":"text","text":"[{...}]"}]
 *   - 배열:    [{"type":"tool_reference","tool_name":"mcp__onedesk__list_issues"}]
 */
function summarizeContent(content: unknown): string {
  const MAX = 2000
  if (typeof content === 'string') return content.slice(0, MAX)
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (typeof b?.text === 'string' ? b.text : JSON.stringify(b)))
      .join('\n')
      .slice(0, MAX)
  }
  return JSON.stringify(content ?? '').slice(0, MAX)
}
```

**⚠️ 인터페이스 변경 제안.** 설계 문서 §6의 `parseLine(line): RunEvent | null`은 **한 줄이 여러 이벤트를 낳는 경우를 표현할 수 없다.** 실측 결과 `assistant` 메시지 하나에 `text` 블록과 `tool_use` 블록이 함께 들어오는 경우가 있으므로, **`RunEvent | RunEvent[] | null`로 넓혀야 한다.** (구멍 목록 #4)

**[확인 필요] OpenCode의 세션 ID 위치.** `--format json`의 출력 스키마를 확인하지 못했다.
검증 방법: `echo "hi" | opencode run --format json 2>/dev/null | head -20`을 실행하고, 나온 JSON에서 세션 식별자로 보이는 필드를 찾는다. 그 값으로 `opencode run --session <값>`이 동작하는지 확인하면 확정된다. **5단계 착수 시 10분이면 끝난다.**

**§12의 "픽스처 대조 테스트"를 지금 만들어라.** 위 필드명들이 CLI 업데이트로 바뀔 수 있으므로, **실제 출력을 파일로 저장해두는 것이 가장 확실한 방어다.**

```ts
// core/runner/adapters/__tests__/claudeCode.parse.test.ts
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('ClaudeCodeAdapter.parseLine — 실제 출력 픽스처', () => {
  const adapter = new ClaudeCodeAdapter()

  // fixtures/claude-code-2.1.224-read-file.jsonl 은
  // 실제 claude -p 실행 결과를 그대로 저장한 것이다.
  const lines = readFileSync(
    new URL('./fixtures/claude-code-2.1.224-read-file.jsonl', import.meta.url),
    'utf8'
  ).split('\n').filter(Boolean)

  const events = lines.flatMap((l) => {
    const r = adapter.parseLine(l, 'run-1')
    return r === null ? [] : Array.isArray(r) ? r : [r]
  })

  it('session 이벤트를 정확히 하나 추출한다', () => {
    const sessions = events.filter((e) => e.type === 'session')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'd12cca44-6616-48ec-b76c-6f344c937bc7'
    })
  })

  it('tool_use와 tool_result가 toolUseId로 짝지어진다', () => {
    const uses = events.filter((e) => e.type === 'tool_use')
    const results = events.filter((e) => e.type === 'tool_result')

    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) {
      expect(results.some((r) => r.toolUseId === u.toolUseId)).toBe(true)
    }
  })

  it('thinking 블록은 이벤트로 만들지 않는다', () => {
    expect(events.some((e) => (e as any).type === 'thinking')).toBe(false)
  })

  it('result 이벤트가 마지막에 정확히 하나', () => {
    expect(events.at(-1)!.type).toBe('result')
  })
})
```

**픽스처를 만드는 명령이다. 첫날에 해둬라.**

```bash
mkdir -p core/runner/adapters/__tests__/fixtures
printf 'Read package.json and summarize it in one line.' | \
  claude -p --output-format stream-json --verbose --model sonnet \
    --tools "Read" --permission-mode acceptEdits \
  > core/runner/adapters/__tests__/fixtures/claude-code-2.1.224-read-file.jsonl
```

### Q32. "이어서 실행" 시 `cwd`/`agent_kind`는 원본과 같아야 하나요, 바꿀 수 있나요? — B

**`agent_kind`와 `cwd`는 잠근다. `model`, `permission`, 맥락, 프롬프트는 바꿀 수 있다.** 설계에 명시가 없으니(구멍 목록 #11) 여기서 근거와 함께 정한다.

| 필드 | 이어서 실행 시 | 근거 |
|---|---|---|
| `agent_kind` | **잠금 (변경 불가)** | 세션 ID는 각 CLI가 자기 저장소에 만든 것이다. Claude Code의 세션 ID를 OpenCode에 주면 "세션 없음" 에러가 난다 |
| `cwd` | **잠금 (변경 불가)** | Claude Code는 세션을 **작업 디렉토리 기준으로** 저장한다. 다른 cwd에서 `--resume`하면 세션을 못 찾을 가능성이 높다 [확인 필요] |
| `model` | 변경 가능 | 세션은 대화 기록이고 모델은 매 턴 선택된다. sonnet으로 조사하고 opus로 마무리하는 흐름이 실제로 유용하다 |
| `permission` | **변경 가능 (핵심 기능)** | §7이 명시한다: "차단된 도구를 호출하면 … 사용자는 권한을 올려 이어서 실행한다" |
| 맥락 | 기본 비움, 추가 가능 | §6이 명시한다: "이전 대화 맥락이 이미 세션에 있으므로 맥락은 기본적으로 다시 첨부하지 않으며, 필요하면 추가로 선택할 수 있다" |
| 프롬프트 | 필수 입력 | 이어서 무엇을 시킬지가 새 지시다 |

**`cwd`를 잠그는 것이 가장 논쟁적이므로 근거를 더 든다.** Claude Code의 세션은 `~/.claude/projects/<cwd를 인코딩한 디렉토리명>/` 아래에 저장된다. 실제로 이 문서를 쓰며 관측한 `memory_paths.auto` 값이 그 구조를 드러낸다:

```
/Users/…/.claude/projects/-private-tmp-claude-501--Users-…-scratchpad/memory/
```

경로가 디렉토리명으로 인코딩돼 있다. **[확인 필요]** — `--resume`이 cwd와 무관하게 세션 ID만으로 찾는지는 직접 확인해야 한다.
검증 방법: 디렉토리 A에서 run을 하나 돌려 세션 ID를 얻고, 디렉토리 B에서 `claude -p --resume <id>`를 실행해 이전 대화를 기억하는지 본다. **잘 되더라도 잠그는 편을 권한다** — cwd가 바뀌면 상대 경로가 전부 어긋나서 agent가 혼란스러워진다.

**[확인함, 2026-08-19] `--resume`은 같은 `session_id`를 그대로 돌려준다 — 새로 발급하지 않는다.** 설계 `2026-08-18-conversation-design.md` §8이 "구현 노트 Q31·Q32에 그 관측이 없다"며 실측을 요구한 항목이다.

검증: 같은 cwd(`/tmp/one-desk-resume-check`)에서 두 번 호출했다.

```bash
printf 'Say pong and nothing else.' | \
  claude -p --output-format stream-json --verbose --model sonnet \
    --tools "" --permission-mode acceptEdits
# → system/init과 result 모두 session_id: "05fdc33a-5541-4e86-be7e-4dd6cd2448e7"

printf 'Say pong again and nothing else.' | \
  claude -p --resume 05fdc33a-5541-4e86-be7e-4dd6cd2448e7 \
    --output-format stream-json --verbose --model sonnet \
    --tools "" --permission-mode acceptEdits
# → system/init과 result 모두 **같은** session_id: "05fdc33a-5541-4e86-be7e-4dd6cd2448e7"
```

`claude-code-version: "2.1.235"`. `system/init`과 최종 `result` 이벤트 양쪽 다 두 호출에서 동일한 `session_id`였다 — resume이 새 세션을 발급하지 않고 기존 세션에 이어 붙는다.

**첫 호출의 실제 원시 출력**(`tools`·`mcp_servers`·`slash_commands` 등 이 계정의 플러그인 설정에서 온 긴 배열은 Q31의 관례대로 생략했다):

```json
{"type":"system","subtype":"init","cwd":"/private/tmp/one-desk-resume-check","session_id":"05fdc33a-5541-4e86-be7e-4dd6cd2448e7","tools":["…생략(개인 계정의 MCP 도구 목록)"],"mcp_servers":["…생략"],"model":"claude-sonnet-5","permissionMode":"acceptEdits","apiKeySource":"none","claude_code_version":"2.1.235","uuid":"b8a4fe1d-7a5b-4484-ac2a-a39b8e6a1fe6"}
{"type":"assistant","message":{"model":"claude-sonnet-5","content":[{"type":"text","text":"pong"}],"session_id":"05fdc33a-5541-4e86-be7e-4dd6cd2448e7"}}
{"is_error":false,"duration_api_ms":1839,"num_turns":1,"stop_reason":"end_turn","session_id":"05fdc33a-5541-4e86-be7e-4dd6cd2448e7","total_cost_usd":0.30526800000000004,"permission_denials":[],"subtype":"success","result":"pong","type":"result","duration_ms":4059,"uuid":"0b24c488-66d4-46c0-a97a-48629e0c04c0"}
```

**두 번째 호출(`--resume`)의 원시 줄은 보존하지 못했다.** 실행 당시 `grep`/`python -c`로 `session_id`·`result` 필드만 추출해 확인하고 임시 디렉토리를 지웠다 — 그 시점엔 이 필드 비교만으로 §8의 질문(같은 id인가 새 id인가)에 충분히 답한다고 판단했다. 재확인용 원시 로그가 필요하면 위 bash 블록의 두 번째 명령을 그대로 다시 돌리면 재현된다(단, 실제 API 호출이라 매번 비용이 든다 — 이번 검증 두 번에 체감상 약 $0.3이 들었다). 지금 다시 돌리지는 않았다.

**설계 §8의 결론이 확정된다:** "이 설계는 어느 쪽이든 동작한다"고 했던 것 중 **"같은 id가 유지되는" 쪽으로 실측이 끝났다.** `latestSessionRun`이 체인에서 세션 id를 가진 가장 최근 run을 찾는 로직(Q32의 표, `execution.ts`의 `resume()`)은 매 턴 값이 바뀌어서가 아니라 **가장 이른 시점에 세션이 생긴 뒤로 계속 같은 값을 읽기 위한 것**이다 — 그 run이 아직 세션을 못 받았을 수 있는 예약 상태(pending) 때문에 여전히 필요하다(설계 §3-2).

**구현 — `RunSpec`을 만드는 쪽에서 강제한다.**

```ts
// core/runner/buildResumeSpec.ts
import type { Run, RunSpec, Permission } from '@shared/client'

export interface ResumeOverrides {
  userPrompt: string
  model?: string | null
  permission?: Permission
  additionalContextItems?: RunSpec['contextItems']
}

/**
 * 원본 run에서 "이어서 실행"할 RunSpec을 만든다.
 *
 * 잠긴 필드(agentKind, cwd, workspaceId)는 인자로 받지 않는다.
 * 타입 수준에서 변경이 불가능하므로 실수할 수 없다.
 */
export function buildResumeSpec(parent: Run, overrides: ResumeOverrides): RunSpec {
  if (!parent.externalSessionId) {
    throw new Error(
      '이 run은 세션 ID가 없어 이어서 실행할 수 없습니다. ' +
      '새 run으로 시작해 주세요.'
    )
  }

  return {
    // ── 잠김: 원본에서 그대로 ──
    workspaceId: parent.workspaceId,
    agentKind: parent.agentKind,
    cwd: parent.cwd,

    // ── 변경 가능 ──
    model: overrides.model !== undefined ? overrides.model : parent.model,
    permission: overrides.permission ?? parent.permission,
    userPrompt: overrides.userPrompt,

    // ── 맥락: 기본 비움 (§6) ──
    contextItems: overrides.additionalContextItems ?? [],

    // ── 연결 ──
    resumeSessionId: parent.externalSessionId,
    parentRunId: parent.id
  }
}
```

**UI 규칙 — 잠긴 필드는 숨기지 말고 비활성화해서 보여줘라.**

```tsx
// renderer/components/RunPanel.tsx
<Field label="agent">
  <Select
    value={spec.agentKind}
    disabled={isResume}                              // ← 회색으로 보이되 값은 보인다
    options={AGENT_OPTIONS}
    onChange={…}
  />
  {isResume && (
    <Hint>세션을 이어받으므로 agent와 작업 디렉토리는 바꿀 수 없습니다.
          다른 조건으로 하려면 <a onClick={startFresh}>새 실행</a>을 선택하세요.</Hint>
  )}
</Field>
```

**숨기면 안 되는 이유:** 사용자가 "지금 어떤 조건으로 도는지"를 확인할 수 없게 된다. §9가 강조하는 "지금 무엇이 넘어가는지를 한 곳에서 확인"의 원칙과 같다. 그리고 **탈출구(`새 실행`)를 항상 제공해라** — §6이 "새 세션으로 시작하는 것도 항상 가능하다"고 명시한 그 요구사항이다.

**맥락을 추가로 선택했을 때 프롬프트는 어떻게 조립되나.** 원본과 같은 형식을 쓰되, 이어서 실행임을 명시한다.

```ts
// core/context/assemble.ts
export function assemblePrompt(input: AssembleInput): string {
  const parts: string[] = []

  if (input.contextItems.length > 0) {
    parts.push(renderContextBlock(input))     // §6의 <context> XML
  }

  parts.push(`<task>\n${input.userPrompt}\n</task>`)
  return parts.join('\n\n')
}
```

이어서 실행에서 맥락이 비어 있으면 `<context>` 블록 자체가 생략되고 `<task>`만 남는다. **깔끔하고, 세션에 이미 있는 내용을 중복 주입하지 않는다.**

**`parent_run_id`로 체인을 그려라.** UI에서 "이 run은 run 87에서 이어짐" 링크를 보여주면 추적이 쉬워진다.

```ts
// core/db/repositories/runRepository.ts
/** 이어서 실행 체인 전체를 시간순으로 반환한다 */
getChain(runId: string): Run[] {
  const chain: Run[] = []
  let current = this.findById(runId)

  // 위로 거슬러 올라간다
  while (current) {
    chain.unshift(current)
    current = current.parentRunId ? this.findById(current.parentRunId) : null
    if (chain.length > 100) break        // 순환 방어 (있으면 안 되지만)
  }
  return chain
}
```

---

## 영역 10. 결과 인박스 & diff

### Q33. 사이드바 배지는 실시간 갱신되나요? IPC push인가요 폴링인가요? — B

**IPC push다. 폴링하지 마라.**

**왜 폴링이 아닌가.** 인박스 카운트가 바뀌는 순간은 정확히 정해져 있다.

1. run이 종료될 때 (`succeeded` / `failed` / `interrupted` / `canceled`)
2. 사용자가 "확인함" / "보관"을 누를 때 (`reviewed_at` 설정)
3. 앱 시작 시 유령 run 정리 (Q18)

**전부 우리가 일으키는 사건이다.** 외부에서 몰래 DB가 바뀌는 경우가 없으므로, 그 순간에 알리면 된다. 1초마다 `SELECT COUNT(*)`를 돌리는 것은 순수한 낭비다.

**설계 원칙: 카운트를 계산하는 곳은 한 군데여야 한다.** §10의 인박스 조건이 여러 곳에 복사되면 "배지에는 3개인데 열어보니 2개"가 발생한다.

```ts
// core/db/repositories/runRepository.ts

/**
 * 인박스 포함 조건 (§10).
 *
 * ⚠️ 이 함수가 유일한 정의다.
 * 배지 카운트도, 인박스 목록도, 테스트도 전부 이걸 통과한다.
 */
const INBOX_STATUSES = ['succeeded', 'failed', 'interrupted', 'canceled'] as const

function inboxCondition() {
  return and(
    isNull(run.reviewedAt),                    // 확인/보관하지 않은 것
    inArray(run.status, INBOX_STATUSES)        // 종료된 것 (running/pending 제외)
  )
}

export class RunRepository {
  /** 인박스 목록 — 모든 workspace를 가로지른다 (§10) */
  listInbox(): InboxItem[] {
    return this.db
      .select()
      .from(run)
      .where(inboxCondition())
      .orderBy(desc(run.endedAt))
      .all()
      .map(toInboxItem)
  }

  /**
   * 배지용 카운트를 한 번의 쿼리로 전부 가져온다.
   * workspace마다 따로 세면 workspace 10개에 쿼리 10번이다.
   */
  getInboxCounts(): { total: number; byWorkspace: Record<string, number> } {
    const rows = this.db
      .select({ workspaceId: run.workspaceId, count: count() })
      .from(run)
      .where(inboxCondition())
      .groupBy(run.workspaceId)
      .all()

    const byWorkspace: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      byWorkspace[r.workspaceId] = r.count
      total += r.count
    }
    return { total, byWorkspace }
  }
}
```

**변경을 알리는 배선.** `RunManager`가 상태를 바꾼 뒤 이벤트를 낸다.

```ts
// core/runner/RunManager.ts — execute()의 finally 안
this.deps.runRepo.markFinished(runId, { … })
this.emitInboxChanged()

private emitInboxChanged(): void {
  this.emit('inboxChanged', this.deps.runRepo.getInboxCounts())
}
```

```ts
// core/index.ts — 리뷰 처리도 같은 이벤트를 낸다
markReviewed(runId: string) {
  runs.markReviewed(runId)
  runner.emitInboxChanged()      // ← 같은 경로로 흘려보낸다
}
```

```ts
// electron/ipc/events.ts — Q3의 bridgeRunEvents에 추가
core.runner.on('inboxChanged', (counts) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.INBOX_CHANGED, counts)
  }
})
```

**렌더러 — 초기값은 요청으로, 이후는 push로.**

```ts
// renderer/state/inboxStore.ts
export function useInboxCounts() {
  const [counts, setCounts] = useState<InboxCounts>({ total: 0, byWorkspace: {} })

  useEffect(() => {
    // ① 최초 1회는 요청해서 채운다 (push는 "변경"만 알려주므로 초기값이 없다)
    void window.oneDesk.runs.getInboxCounts().then(setCounts)

    // ② 이후는 push로 갱신
    return window.oneDesk.events.onInboxChanged(setCounts)
  }, [])

  return counts
}
```

**"초기값은 요청, 이후는 push"가 실시간 UI의 표준 패턴이다.** push만 쓰면 앱 시작 시 배지가 0으로 보이고, 요청만 쓰면 갱신이 안 된다.

```tsx
// renderer/components/Sidebar.tsx
function Sidebar() {
  const counts = useInboxCounts()
  const workspaces = useWorkspaces()

  return (
    <nav>
      <InboxLink badge={counts.total} />          {/* §10 전체 미처리 건수 */}
      <Section title="WORKSPACES">
        {workspaces.map((ws) => (
          <WorkspaceLink
            key={ws.id}
            workspace={ws}
            badge={counts.byWorkspace[ws.id] ?? 0}   {/* §10 workspace별 */}
          />
        ))}
      </Section>
    </nav>
  )
}
```

**낙관적 업데이트를 넣으면 체감이 크게 좋아진다.** "확인함"을 눌렀는데 배지가 IPC 왕복 후에 줄어들면 굼떠 보인다.

```ts
async function markReviewed(runId: string, workspaceId: string) {
  // ① 먼저 UI를 줄인다
  inboxStore.decrement(workspaceId)
  try {
    await window.oneDesk.runs.markReviewed(runId)
    // ② 서버가 보낸 정확한 값이 push로 도착해 덮어쓴다
  } catch (err) {
    inboxStore.increment(workspaceId)   // ③ 실패하면 되돌린다
    toast.error('확인 처리에 실패했습니다')
  }
}
```

### Q34. "관련 이슈 닫기"는 issue repository 직접 호출인가요, MCP `update_issue` 재사용인가요? — B

**issue repository 직접 호출이다. MCP를 재사용하지 마라.**

**걱정한 "같은 로직을 두 군데 만들게 될까"는 정당하지만, 답은 "MCP를 재사용"이 아니라 "둘 다 리포지토리를 부른다"이다.**

```
UI "관련 이슈 닫기" ──→ IPC ──→ core.issues.close(id)  ─┐
                                                        ├─→ IssueRepository.update()
agent의 update_issue ──→ MCP ──→ core.issues.close(id)  ─┘
                                                             ↑
                                              공유되는 로직은 여기 한 곳
```

**MCP를 UI가 호출하면 안 되는 이유가 네 가지 있다.**

**① 방향이 거꾸로다.** MCP 서버는 **agent에게 기능을 제공하는 어댑터**다. UI가 MCP를 부르면 `HTTP 요청 → JSON-RPC 파싱 → zod 검증 → 리포지토리` 경로를 도는데, 같은 프로세스 안에서 자기 자신에게 HTTP를 보내는 셈이다.

**② 토큰이 없다.** MCP 도구는 run 토큰으로 인증한다(§8). UI 동작에는 run이 없다. 억지로 "UI용 토큰"을 만들면 §8이 세운 "토큰은 run에 묶인다"는 보안 모델이 무너진다.

**③ 권한 모델이 어긋난다.** 읽기 전용 run에는 `update_issue`가 아예 등록되지 않는다(Q28). UI는 항상 쓸 수 있어야 하는데 MCP를 타면 그 필터에 걸린다.

**④ 감사 기록이 오염된다.** §8은 모든 MCP 호출을 run 로그에 남긴다. UI 동작이 거기 섞이면 "이 이슈가 왜 done이 되었는가"의 답이 흐려진다. **오히려 반대로, 출처를 구분해서 기록해야 한다.**

**올바른 구조 — 공유 지점은 리포지토리다.**

```ts
// core/db/repositories/issueRepository.ts
export class IssueRepository {
  /**
   * 이슈 상태 변경. UI와 MCP가 공유하는 유일한 지점.
   * closedAt 관리 같은 규칙이 여기에만 있다.
   */
  update(id: string, patch: { status?: IssueStatus; title?: string; body?: string }): Issue {
    const now = Date.now()
    const values: Record<string, unknown> = { updatedAt: now }

    if (patch.title !== undefined) values.title = patch.title
    if (patch.body !== undefined) values.body = patch.body

    if (patch.status !== undefined) {
      values.status = patch.status
      // ⭐ 이 규칙이 한 곳에만 있다.
      // 양쪽에 복사되면 MCP로 닫은 이슈만 closedAt이 비는 버그가 난다.
      values.closedAt = patch.status === 'done' ? now : null
    }

    this.db.update(issue).set(values).where(eq(issue.id, id)).run()
    return this.findById(id)!
  }
}
```

```ts
// electron/ipc/inbox.ts — UI 경로
ipcMain.handle(CHANNELS.INBOX_CLOSE_ISSUE, (_e, { runId, issueId }) => {
  // §10 "run_context_item에 첨부된 이슈가 있을 때만 표시된다"를 서버에서도 검증한다.
  // UI가 버튼을 숨기는 것만으로는 방어가 아니다.
  const attached = core.runs.getContextItems(runId)
  const isAttached = attached.some((i) => i.itemType === 'issue' && i.itemId === issueId)
  if (!isAttached) throw new Error('이 run에 첨부되지 않은 이슈입니다')

  const updated = core.issues.update(issueId, { status: 'done' })

  // 출처를 남긴다 — "왜 done이 되었는가"의 답
  core.activity.record({
    kind: 'issue_closed',
    issueId,
    actor: 'user',
    viaRunId: runId,
    at: Date.now()
  })
  return updated
})
```

```ts
// core/mcp/buildServer.ts — agent 경로 (Q27의 update_issue)
server.registerTool('update_issue', { … }, async ({ id, status, body }) => {
  const existing = deps.issues.findById(id)
  if (!existing || existing.workspaceId !== ctx.workspaceId) { … }

  const updated = deps.issues.update(id, { status, body })   // ← 같은 함수

  deps.activity.record({
    kind: 'issue_updated',
    issueId: id,
    actor: 'agent',                  // ← 출처가 다르다
    viaRunId: ctx.runId,
    at: Date.now()
  })
  audit('update_issue', { id, status }, true)
  return ok({ id: updated.id, status: updated.status })
})
```

**"두 군데에서 부른다"와 "두 군데에 로직이 있다"는 다르다.** 위 구조에서 중복된 로직은 없다 — `closedAt` 규칙도, 검증도 리포지토리에 한 번만 있다. 각 진입점은 **자기 맥락에 맞는 검증(첨부 확인 / workspace 확인)과 기록(actor)** 만 추가한다. 그게 각 계층의 고유한 책임이므로 중복이 아니다.

**UI 구현 — §10의 "첨부 이슈가 여럿이면 각각에 대해 표시한다".**

```tsx
// renderer/components/InboxItem.tsx
function CompletedActions({ run }: { run: InboxRun }) {
  const attachedIssues = run.contextItems.filter((i) => i.itemType === 'issue')

  return (
    <div className="actions">
      <Button onClick={() => openDiff(run.id)}>변경 보기</Button>
      <Button onClick={() => openResume(run.id)}>이어서 실행</Button>

      {/* 첨부된 이슈마다 하나씩 */}
      {attachedIssues.map((item) => (
        <Button key={item.itemId} onClick={() => closeIssue(run.id, item.itemId)}>
          「{item.title}」 닫기
        </Button>
      ))}

      <Button primary onClick={() => markReviewed(run.id)}>확인함</Button>
    </div>
  )
}
```

### Q35. `tool_use.name`은 정규화된 이름인가요 CLI 원본인가요? 두 CLI의 도구 이름이 다를 텐데 파일 수정을 어떻게 하나의 로직으로 감지하나요? — B

**`RunEvent.tool_use.name`에는 CLI 원본 이름을 담아라.** 그리고 **정규화된 분류를 별도 필드로 추가해라.** 설계 문서에 이 구분이 없으므로(구멍 목록 #3) 여기서 정한다.

**왜 원본을 버리면 안 되나.** 로그 뷰어에 "파일 편집"이라고만 뜨면 사용자가 실제로 무슨 도구가 불렸는지 알 수 없다. 디버깅할 때 원본 이름이 반드시 필요하다. 반대로 원본만 있으면 스냅샷 로직이 CLI마다 분기해야 한다.

**둘 다 담는다.**

```ts
// shared/events.ts
export type ToolEffect =
  | 'read'          // 파일/데이터 읽기
  | 'file_write'    // 파일 생성·수정·삭제  ← 스냅샷 트리거
  | 'shell'         // 셸 명령 (파일 변경 감지 불가)
  | 'mcp'           // one-desk MCP 도구
  | 'other'

export interface ToolUseEvent {
  type: 'tool_use'
  runId: string
  seq: number
  toolUseId: string
  name: string              // ← CLI 원본. "Edit", "write", "mcp__onedesk__list_issues"
  effect: ToolEffect        // ← 정규화된 분류. 로직은 이걸 본다.
  targetPaths: string[]     // ← effect가 file_write일 때 대상 파일들 (절대경로)
  input: unknown
  at: number
}
```

**어댑터가 분류한다. 이게 §6의 "어댑터는 이벤트 정규화를 한다"의 실제 내용이다.**

```ts
// core/runner/adapters/claudeCode.ts
import path from 'node:path'

/**
 * Claude Code 2.1.224의 도구 이름 → 효과 분류. [확인함]
 *
 * ⚠️ 이 표는 CLI 버전에 묶인다.
 * 모르는 이름이 오면 'other'로 떨어지고, 파일 변경을 놓친다.
 * 그래서 아래 classifyTool은 미지의 이름을 로그에 남긴다.
 */
const CLAUDE_TOOL_EFFECTS: Record<string, ToolEffect> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  NotebookRead: 'read',

  Edit: 'file_write',
  Write: 'file_write',
  NotebookEdit: 'file_write',

  Bash: 'shell',

  Task: 'other',
  TodoWrite: 'other',
  Skill: 'other'
}

function classifyClaudeTool(name: string): ToolEffect {
  if (name.startsWith('mcp__')) return 'mcp'

  const known = CLAUDE_TOOL_EFFECTS[name]
  if (known) return known

  console.warn(`[claudeCode] 알 수 없는 도구: ${name}. other로 분류한다.`)
  return 'other'
}

/**
 * 파일 수정 도구의 대상 경로를 뽑는다.
 *
 * Claude Code의 Edit/Write는 input.file_path에 절대경로를 담는다. [확인함]
 * 실측: {"name":"Read","input":{"file_path":"/private/tmp/.../probe.txt"}}
 */
function extractTargetPaths(name: string, input: any, cwd: string): string[] {
  const raw: unknown =
    input?.file_path ??            // Edit, Write, Read
    input?.notebook_path ??        // NotebookEdit
    null

  if (typeof raw !== 'string') return []
  // 상대경로로 올 가능성에 대비한다
  return [path.isAbsolute(raw) ? raw : path.resolve(cwd, raw)]
}
```

```ts
// core/runner/adapters/opencode.ts — 5단계에서
/**
 * [확인 필요] OpenCode의 도구 이름을 확인하지 못했다.
 *
 * 검증 방법: opencode run --format json으로 파일을 수정시키고
 * 출력에서 도구 이름과 입력 필드명을 확인한다.
 * 소문자(edit/write/read)일 가능성이 높지만 추측이다.
 */
const OPENCODE_TOOL_EFFECTS: Record<string, ToolEffect> = {
  read: 'read',
  glob: 'read',
  grep: 'read',
  webfetch: 'read',
  edit: 'file_write',
  write: 'file_write',
  bash: 'shell'
}
```

**이제 스냅샷 로직이 CLI를 모른다. 이게 목표였다.**

```ts
// core/runner/FileSnapshotter.ts
onToolUse(event: ToolUseEvent): void {
  if (event.effect !== 'file_write') return    // ← 이름이 아니라 효과로 판단
  for (const p of event.targetPaths) this.snapshot(p)
}
```

**세 번째 agent를 추가할 때 이 파일은 손대지 않는다.** 어댑터에 표 하나만 추가하면 된다. §6의 "세 번째 agent를 추가할 때도 어댑터 파일 하나만 작성하면 된다"가 이렇게 실현된다.

**미지의 도구를 놓치지 않는 안전망을 하나 더 걸어라.**

```ts
// run 종료 후, git repo라면 교차 검증한다 (§10 "git diff 결과를 함께 표시")
async function reconcileChanges(runId: string, cwd: string, snapshotted: Set<string>) {
  if (!isGitRepo(cwd)) return

  const gitChanged = await getGitChangedFiles(cwd)   // git status --porcelain
  const missed = gitChanged.filter((f) => !snapshotted.has(f))

  if (missed.length > 0) {
    // 스냅샷이 없으므로 before/after diff는 못 만들지만,
    // "변경됐다"는 사실은 기록할 수 있다. §10의 "셸로 바꾸면 감지 못 한다"는 구멍이 여기서 메워진다.
    for (const f of missed) {
      runFileChangeRepo.insert({ runId, filePath: f, changeType: 'modified', beforePath: null })
    }
    console.warn(`[reconcile] 스냅샷 없이 변경된 파일 ${missed.length}개 (셸 명령 또는 미분류 도구)`)
  }
}
```

**이 경고 로그가 도구 이름 표가 낡았음을 알려주는 신호가 된다.** 정기적으로 확인해라.

### Q36. `before/` 스냅샷을 "감지 시점"에 뜬다는데, 이미 수정된 후 아닌가요? 정확히 언제 복사해야 하나요? — A

**당신의 의심이 맞다. 설계대로 `tool_use` 이벤트에서 복사하면 경쟁 조건이 있다.** 이 문서에서 지적할 가장 중요한 설계 결함이다(구멍 목록 #2).

**타이밍을 정확히 그려보자.**

```
CLI 프로세스                          one-desk (main)
─────────────                        ─────────────────
모델이 tool_use 블록 생성
stdout에 assistant 이벤트 write ────→ (파이프에 들어감)
        │                                    │ ← 여기서 언제 읽힐지는 OS가 정한다
        │                             ┌──────┴──── 이벤트 루프가 'data'를 처리
        ▼                             │
  도구 실행 (파일 수정!) ◄── 경쟁 ──→ │ parseLine → snapshot()
        │                             │
  결과를 stdout에 write ─────────────→ tool_result 수신
```

**`tool_use`가 stdout에 나가는 것과 CLI가 실제로 파일을 쓰는 것 사이에 동기화가 없다.** 우리 프로세스가 그 줄을 읽고 `copyFileSync`를 실행하기까지 수 밀리초가 걸리는데, 그 사이에 CLI가 이미 파일을 덮어썼을 수 있다. **작은 파일일수록 더 위험하다.**

**게다가 `tool_result`에서 뜨는 것은 확실히 틀렸다.** 그때는 100% 수정된 후다. 설계 문서가 "감지 시점"이라고만 쓰고 어느 이벤트인지 명시하지 않은 것은, 이 문제를 인지하지 못했기 때문으로 보인다.

**해법은 두 가지다. 둘 다 구현하기를 권한다.**

---

**해법 A (권장) — `PreToolUse` 훅으로 확실하게 잡는다.**

Claude Code에는 **도구 실행 직전에 외부 명령을 실행하고 그것이 끝날 때까지 기다리는** 훅이 있다. 이건 경쟁 조건이 아니라 **순서 보장**이다.

```ts
// core/runner/adapters/claudeHooks.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * PreToolUse 훅 설정을 만든다.
 *
 * 훅은 도구 실행 "전에" 동기적으로 실행되고, 완료될 때까지 CLI가 기다린다.
 * 따라서 여기서 스냅샷을 뜨면 원본이 보장된다.
 *
 * 훅 프로세스는 stdin으로 JSON을 받는다.
 * [확인 필요] 그 JSON의 정확한 필드명은 확인하지 못했다.
 *   검증: 아래 스크립트를 `cat > /tmp/hook-input.json` 으로 바꿔 한 번 실행하고
 *         받은 JSON을 직접 확인해라. 10분이면 끝난다.
 */
export function writeSnapshotHook(runId: string, beforeDir: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `onedesk-hook-${runId}-`))
  const scriptPath = path.join(dir, 'snapshot.mjs')
  const settingsPath = path.join(dir, 'settings.json')

  // 훅으로 실행될 스크립트. Node로 작성해 셸 이식성 문제를 피한다.
  fs.writeFileSync(scriptPath, `
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const BEFORE_DIR = ${JSON.stringify(beforeDir)}

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk

try {
  const payload = JSON.parse(raw)
  // 필드명이 다르면 여기가 undefined가 된다 → 위의 [확인 필요]를 먼저 해결할 것
  const filePath = payload?.tool_input?.file_path ?? payload?.toolInput?.file_path
  if (filePath && fs.existsSync(filePath)) {
    const key = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)
    const dest = path.join(BEFORE_DIR, key)
    // 이미 스냅샷했으면 건너뛴다 (§10 "아직 스냅샷되지 않았을 경우")
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(BEFORE_DIR, { recursive: true })
      fs.copyFileSync(filePath, dest)
      fs.writeFileSync(dest + '.meta.json', JSON.stringify({ filePath, at: Date.now() }))
    }
  }
} catch {}

process.exit(0)   // ⚠️ 반드시 0으로 나가야 도구가 차단되지 않는다
`, { mode: 0o700 })

  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'Edit|Write|NotebookEdit',
        hooks: [{ type: 'command', command: `node ${JSON.stringify(scriptPath)}` }]
      }]
    }
  }), { mode: 0o600 })

  return { settingsPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
```

`buildCommand`에서 `--settings`로 넘긴다. **[확인함] `--settings <file-or-json>` 플래그가 존재한다** (`claude --help`).

```ts
const hook = writeSnapshotHook(spec.runId, spec.beforeDir)
args.push('--settings', hook.settingsPath)
```

**[확인 필요] 이 접근 전체.** 훅 설정 스키마(`hooks.PreToolUse[].matcher`)와 stdin JSON 필드명을 실행으로 확인하지 못했다.
**검증 방법:** 위 스크립트를 `#!/bin/sh` + `cat >> /tmp/hook-debug.jsonl`로 바꾸고, `--settings`로 넘겨 파일을 수정하는 run을 한 번 돌린다. `/tmp/hook-debug.jsonl`에 찍힌 JSON을 보면 필드명이 확정된다. **2단계 착수 시 가장 먼저 할 검증 중 하나로 잡아라.**

---

**해법 B (필수, 항상 함께) — `tool_use`에서 최선을 다하고, 놓친 것을 사후에 메운다.**

훅이 안 되거나 OpenCode에서는 이 방식뿐이다. **경쟁 조건을 줄이는 요령이 있다.**

```ts
// core/runner/FileSnapshotter.ts
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export class FileSnapshotter {
  private readonly snapshotted = new Map<string, SnapshotMeta>()

  constructor(
    private readonly beforeDir: string,
    private readonly cwd: string
  ) {}

  /**
   * tool_use 이벤트에서 호출된다.
   *
   * ⚠️ 반드시 동기 API(copyFileSync)를 써라.
   * fs.promises.copyFile을 쓰면 await 지점에서 이벤트 루프가 다른 일을 처리하고,
   * 그 사이 CLI가 파일을 덮어쓸 확률이 크게 올라간다.
   * 동기 호출은 이 함수가 끝날 때까지 다른 코드가 끼어들지 못하게 한다.
   */
  onToolUse(event: ToolUseEvent): void {
    if (event.effect !== 'file_write') return

    for (const filePath of event.targetPaths) {
      if (this.snapshotted.has(filePath)) continue   // §10 "아직 스냅샷되지 않았을 경우"

      try {
        const key = this.keyFor(filePath)
        const dest = path.join(this.beforeDir, key)

        if (fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath)
          fs.copyFileSync(filePath, dest)
          this.snapshotted.set(filePath, {
            key, existed: true,
            size: stat.size, mtimeMs: stat.mtimeMs   // ← 사후 검증용
          })
        } else {
          // 파일이 없다 = Write로 새로 만드는 중 = change_type: 'created'
          this.snapshotted.set(filePath, { key, existed: false })
        }
      } catch (err) {
        console.error(`[snapshot] 실패: ${filePath}`, err)
        // 스냅샷 실패로 run을 죽이지 않는다. diff를 못 볼 뿐이다.
      }
    }
  }

  /**
   * run 종료 후 호출. 변경 목록을 만들고 스냅샷 신뢰도를 검증한다.
   */
  finalize(runId: string): FileChangeRecord[] {
    const records: FileChangeRecord[] = []

    for (const [filePath, meta] of this.snapshotted) {
      const beforePath = path.join(this.beforeDir, meta.key)
      const existsNow = fs.existsSync(filePath)

      let changeType: 'created' | 'modified' | 'deleted'
      if (!meta.existed && existsNow) changeType = 'created'
      else if (meta.existed && !existsNow) changeType = 'deleted'
      else changeType = 'modified'

      records.push({
        runId,
        filePath,
        changeType,
        beforePath: meta.existed ? beforePath : null,
        // ⚠️ 경쟁 조건 감지:
        // 스냅샷 시점의 mtime이 현재와 같다면, 그건 우리가 "수정 후"를 복사했다는 뜻이다.
        // (수정됐다면 mtime이 바뀌었어야 한다)
        suspect: meta.existed && existsNow && this.looksUnchanged(filePath, meta)
      })
    }
    return records
  }

  private looksUnchanged(filePath: string, meta: SnapshotMeta): boolean {
    try {
      const now = fs.statSync(filePath)
      return now.size === meta.size && now.mtimeMs === meta.mtimeMs
    } catch {
      return false
    }
  }

  /** 파일 경로를 파일명으로 쓸 수 없으니 해시한다. 충돌 걱정 없는 길이. */
  private keyFor(filePath: string): string {
    return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)
  }
}
```

**`suspect` 플래그가 이 구현의 핵심이다.** 경쟁에서 졌다면 before와 after가 동일해져서 **diff가 비어 보인다.** 사용자는 "변경이 없나?" 하고 넘어가는데 실제로는 변경이 있었던, 조용하고 위험한 실패다. `suspect: true`면 UI에서 경고를 띄워라.

```tsx
{change.suspect && (
  <Banner variant="warning">
    원본 스냅샷을 제때 확보하지 못했을 수 있습니다. 아래 diff가 부정확할 수 있으니
    {isGitRepo && ' git diff 결과를 함께 확인하세요.'}
  </Banner>
)}
```

**결론 — 우선순위를 이렇게 잡아라.**

1. **2단계에서:** 해법 B(동기 스냅샷 + `suspect` 검증)를 구현한다. 5단계의 diff 뷰어 전에 데이터가 쌓이기 시작해야 하므로 미루지 마라.
2. **2단계에서 검증:** 훅의 stdin JSON 필드명을 확인한다(위 검증 방법).
3. **5단계에서:** 훅이 동작하면 해법 A를 주 경로로 삼고, B는 보조로 남긴다.
4. **항상:** git repo면 `git diff`를 함께 보여준다(§10). 이게 모든 구멍의 최종 안전망이다.

---

## 영역 11. 빌드/배포 & 테스트

### Q37. electron-vite와 electron-builder는 각각 언제 쓰나요? package.json 스크립트 구성은? — A

**역할이 완전히 다르다. 겹치지 않는다.**

| | electron-vite | electron-builder |
|---|---|---|
| 언제 | 개발 중 + 소스 컴파일 | 배포용 설치 파일 생성 |
| 입력 | `electron/`, `renderer/`, `core/` 소스 | `out/` (electron-vite의 결과물) |
| 출력 | `out/main/`, `out/preload/`, `out/renderer/` | `dist/one-desk-1.0.0.dmg` |
| 하는 일 | TS→JS 컴파일, 번들링, HMR | Electron 런타임 동봉, asar 패킹, 코드 서명, 인스톨러 |

**한 문장으로: electron-vite가 만든 JS를 electron-builder가 앱으로 포장한다.** 순서가 있고, 후자는 전자 없이 할 일이 없다.

```
소스 (TS/TSX)
   │  electron-vite build
   ▼
out/           ← 실행 가능한 JS. `electron out/main/index.js`로 돌릴 수 있다.
   │  electron-builder
   ▼
dist/one-desk-1.0.0-arm64.dmg   ← 사용자에게 주는 것
```

**`package.json` 전체다. 버전은 확정된 스택 그대로 쓰되, 한 곳을 바로잡았다(아래 ⚠️ 참고).**

```jsonc
{
  "name": "one-desk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",       // ⚠️ electron이 실행할 진입점. out/을 가리킨다.
  "engines": { "node": ">=22.16" },
  "packageManager": "pnpm@10.0.0",

  "scripts": {
    // ── 개발 ──
    "dev": "electron-vite dev",
    "dev:watch": "electron-vite dev --watch",

    // ── 검증 ──
    "typecheck": "tsc -b tsconfig.json && tsc -p tsconfig.core.json --noEmit",
    "lint": "eslint . --max-warnings 0",
    "lint:boundaries": "! grep -rnE \"from ['\\\"]electron['\\\"]\" core/ --include='*.ts'",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "pnpm typecheck && pnpm lint && pnpm lint:boundaries && pnpm test",

    // ── 빌드 ──
    "build": "pnpm check && electron-vite build",
    "preview": "electron-vite preview",           // 빌드 결과를 패키징 없이 실행

    // ── 배포 ──
    "pack": "pnpm build && electron-builder --dir",   // 폴더만. 빠른 확인용.
    "dist:mac": "pnpm build && electron-builder --mac",
    "dist:win": "pnpm build && electron-builder --win",

    // ── DB ──
    "db:generate": "drizzle-kit generate",
    "db:studio": "drizzle-kit studio",

    // ── 네이티브 모듈 (Q9) ──
    "rebuild:electron": "electron-rebuild -f -w better-sqlite3",
    "rebuild:node": "pnpm rebuild better-sqlite3",
    "postinstall": "electron-rebuild -f -w better-sqlite3"
  },

  "dependencies": {
    "better-sqlite3": "13.0.3",
    "drizzle-orm": "0.45.2",
    "@modelcontextprotocol/sdk": "1.30.0",
    "zod": "4.4.3"
  },

  "devDependencies": {
    "electron": "43.3.0",
    "electron-vite": "5.0.0",
    "electron-builder": "26.15.3",
    "@electron/rebuild": "4.2.0",
    "vite": "7.1.5",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "@vitejs/plugin-react": "5.2.0",   // ⚠️ 6.0.x가 아니다. 아래 설명 참고.
    "typescript": "5.9.3",
    "vitest": "4.1.10",
    "drizzle-kit": "0.31.10",
    "eslint": "^9",
    "typescript-eslint": "^8",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/better-sqlite3": "^7",
    "@types/node": "^22"
  },

  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3", "electron"]   // Q9
  }
}
```

**⚠️ 확정 스택의 오류 하나를 바로잡았다. 이대로 두면 설치 단계에서 막힌다.**

지정된 스택은 `@vitejs/plugin-react 6.0.x`인데, **실제로 확인한 결과 이 버전의 peerDependency는 `vite: ^8.0.0`이다.**

```
$ npm view @vitejs/plugin-react@6.0.0 peerDependencies.vite
^8.0.0

$ npm view @vitejs/plugin-react@5.2.0 peerDependencies.vite
^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0
```

electron-vite 5.0.0이 `vite: ^5||^6||^7`을 요구하므로 Vite 7이 확정인데, 그 위에서 plugin-react 6.x는 **peer 충돌**을 일으킨다. pnpm은 기본적으로 이걸 에러로 올린다. **Vite 7과 호환되는 최신은 `5.2.0`이므로 그걸 쓴다.** (자세한 내용은 구멍 목록 #12)

**`vitest.config.ts`를 별도로 둔다.** electron-vite 설정은 3개 타깃 구조라 Vitest가 그대로 못 읽는다.

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
        // core/ 는 순수 Node에서 (§12의 전제)
        test: {
          name: 'core',
          include: ['core/**/*.test.ts', 'shared/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        // renderer 는 jsdom에서 (§12 "OneDeskClient를 목으로 대체")
        test: {
          name: 'renderer',
          include: ['renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./renderer/test/setup.ts']
        }
      }
    ]
  }
})
```

**`electron-builder.yml`.**

```yaml
appId: com.onedesk.app
productName: one-desk
directories:
  output: dist
  buildResources: build

files:
  - out/**/*
  - package.json
  - "!**/*.map"

# ⚠️ drizzle/ 마이그레이션 SQL을 반드시 동봉해야 한다.
# 빠뜨리면 패키징된 앱이 시작 시 "migrations folder not found"로 죽는다. (Q10)
extraResources:
  - from: drizzle
    to: drizzle

# ⚠️ better-sqlite3는 네이티브 모듈이라 asar 안에서 로드할 수 없다.
asarUnpack:
  - "**/node_modules/better-sqlite3/**"

mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [arm64, x64]
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist

win:
  target: nsis
```

**`asarUnpack`과 `extraResources`가 이 앱의 두 가지 패키징 함정이다.** 둘 다 **개발 중에는 절대 재현되지 않고 `pnpm dist:mac` 후에야 터진다.** 그래서 아래를 권한다.

> **1단계가 끝나면 곧바로 `pnpm pack`을 한 번 돌려서 패키징된 앱이 실행되는지 확인해라.** 5단계까지 가서 처음 패키징하면 원인 후보가 너무 많아진다. 이 앱은 네이티브 모듈 + 외부 리소스 + 자식 프로세스를 전부 쓰므로 패키징 리스크가 평균보다 훨씬 높다.

### Q38. "가짜 CLI 스크립트" 테스트에서 `cmd`를 어떻게 테스트용 경로로 바꿔치기하나요? — B

**`ResolvedRunSpec.executablePath`가 이미 주입 지점이다.** (Q16의 `buildCommand`가 `spec.executablePath`를 쓴다) 별도 장치가 필요 없다 — 테스트에서 그 값에 스크립트 경로를 넣으면 된다.

**왜 이미 되어 있나.** `buildCommand`는 실행 파일을 **직접 찾지 않는다.** `preflight()`가 찾아서 `ResolvedRunSpec`에 담아주고, `buildCommand`는 그걸 받아 쓸 뿐이다. 이 분리가 §0-(3)의 "필요한 것을 인자로 받는다" 원칙의 결과이고, 덕분에 테스트 주입이 공짜가 됐다.

```ts
// core/runner/types.ts
export interface ResolvedRunSpec extends RunSpec {
  runId: string
  executablePath: string       // ← 여기. preflight가 채우거나, 테스트가 채운다.
  assembledPrompt: string
  systemPromptAppend?: string
  mcp?: { serverName: string; url: string; token: string }
  beforeDir: string
}
```

**가짜 CLI 스크립트를 만든다.** §12가 요구하는 "JSON 몇 줄을 출력하고 종료하는 셸 스크립트"다. **Node로 쓰는 것을 권한다** — 셸 이식성 문제를 피하고, 인자 파싱과 지연 처리가 쉽다.

```js
// core/runner/__tests__/fake-cli/fake-claude.mjs
#!/usr/bin/env node
/**
 * Claude Code를 흉내 내는 가짜 CLI.
 *
 * 환경변수로 동작을 제어한다:
 *   FAKE_SESSION_ID   내보낼 세션 id
 *   FAKE_DURATION_MS  종료 전 대기 시간 (동시 실행/취소 테스트용)
 *   FAKE_EXIT_CODE    종료 코드
 *   FAKE_EMIT_TOOL    'edit' 이면 파일 수정 tool_use를 내보낸다
 *   FAKE_EDIT_TARGET  수정할 파일 경로
 *   FAKE_IGNORE_SIGTERM  '1' 이면 SIGTERM을 무시한다 (SIGKILL 경로 테스트용)
 */
import fs from 'node:fs'

const sessionId = process.env.FAKE_SESSION_ID ?? 'fake-session-0001'
const duration = Number(process.env.FAKE_DURATION_MS ?? '0')
const exitCode = Number(process.env.FAKE_EXIT_CODE ?? '0')

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

// stdin(프롬프트)을 다 읽는다 — 실제 CLI와 동일하게 동작해야 EPIPE 경로가 재현된다
let prompt = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) prompt += chunk

if (process.env.FAKE_IGNORE_SIGTERM === '1') {
  process.on('SIGTERM', () => { /* 일부러 무시 */ })
}

// ① 실제 형식과 동일한 init 이벤트 (Q31에서 확인한 필드명)
emit({
  type: 'system', subtype: 'init',
  session_id: sessionId,
  cwd: process.cwd(),
  tools: ['Read', 'Edit'],
  model: 'fake-model',
  permissionMode: 'acceptEdits'
})

emit({
  type: 'assistant',
  message: { content: [{ type: 'text', text: '작업을 시작합니다.' }] },
  session_id: sessionId
})

// ② 파일 수정 시뮬레이션 (Q36의 스냅샷 테스트용)
if (process.env.FAKE_EMIT_TOOL === 'edit') {
  const target = process.env.FAKE_EDIT_TARGET
  emit({
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use', id: 'toolu_fake001', name: 'Edit',
        input: { file_path: target, old_string: 'a', new_string: 'b' }
      }]
    },
    session_id: sessionId
  })

  // 스냅샷이 뜰 시간을 준다. 0으로 두면 경쟁 조건 자체를 테스트할 수 있다.
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_EDIT_DELAY_MS ?? '50')))
  if (target) fs.writeFileSync(target, 'AFTER')

  emit({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'toolu_fake001', content: 'ok' }]
    },
    session_id: sessionId
  })
}

// ③ 지연 (동시 실행 상한 / 취소 / 타임아웃 테스트)
if (duration > 0) await new Promise((r) => setTimeout(r, duration))

// ④ 최종 결과
emit({
  type: 'result', subtype: exitCode === 0 ? 'success' : 'error_during_execution',
  is_error: exitCode !== 0,
  result: exitCode === 0 ? '작업을 완료했습니다.' : '실패했습니다.',
  session_id: sessionId,
  num_turns: 1,
  duration_ms: duration,
  permission_denials: []
})

process.exit(exitCode)
```

**테스트에서 주입한다.**

```ts
// core/runner/__tests__/helpers.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FAKE_CLI = fileURLToPath(new URL('./fake-cli/fake-claude.mjs', import.meta.url))

export function makeSpec(overrides: Partial<ResolvedRunSpec> = {}): ResolvedRunSpec {
  return {
    runId: crypto.randomUUID(),
    workspaceId: 'ws-1',
    agentKind: 'claude-code',
    executablePath: process.execPath,   // ← node 자체를 실행 파일로 쓴다
    model: null,
    cwd: process.cwd(),
    permission: 'edit',
    userPrompt: '테스트',
    assembledPrompt: '<task>테스트</task>',
    contextItems: [],
    beforeDir: '/tmp/test-before',
    ...overrides
  }
}
```

**⚠️ `executablePath`에 `process.execPath`(= node 바이너리)를 넣고, 스크립트 경로는 첫 번째 인자로 넣는 것이 가장 확실하다.** `#!/usr/bin/env node` 셔뱅에 의존하면 실행 권한(`chmod +x`)이 git에 보존되지 않는 환경에서 깨진다.

```ts
// 어댑터를 테스트용으로 감싼다
class TestAdapter extends ClaudeCodeAdapter {
  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    const real = super.buildCommand(spec)
    return {
      ...real,
      cmd: process.execPath,               // node
      args: [FAKE_CLI, ...real.args],      // 스크립트를 첫 인자로
      env: { ...real.env, ...this.fakeEnv }
    }
  }
}
```

**이제 §12가 요구한 테스트를 전부 쓸 수 있다.**

```ts
// core/runner/__tests__/RunManager.lifecycle.test.ts
describe('RunManager 생명주기', () => {
  it('정상 종료하면 succeeded와 session_id를 저장한다', async () => {
    const rm = makeRunManager({ fakeEnv: { FAKE_SESSION_ID: 'sess-abc' } })
    const run = await rm.start(makeSpec())
    await rm.waitForIdle()

    const saved = repo.findById(run.id)!
    expect(saved.status).toBe('succeeded')
    expect(saved.externalSessionId).toBe('sess-abc')
    expect(saved.resultText).toContain('완료')
  })

  it('exit code가 0이 아니면 failed', async () => {
    const rm = makeRunManager({ fakeEnv: { FAKE_EXIT_CODE: '1' } })
    const run = await rm.start(makeSpec())
    await rm.waitForIdle()
    expect(repo.findById(run.id)!.status).toBe('failed')
  })

  it('취소하면 SIGTERM으로 종료되고 canceled가 된다', async () => {
    const rm = makeRunManager({ fakeEnv: { FAKE_DURATION_MS: '30000' } })
    const run = await rm.start(makeSpec())
    await waitUntil(() => rm.getQueueSnapshot().active.includes(run.id))

    const t0 = Date.now()
    await rm.cancel(run.id)

    // SIGTERM에 바로 반응하므로 유예(5초)를 다 쓰지 않는다
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(repo.findById(run.id)!.status).toBe('canceled')
  })

  it('SIGTERM을 무시하면 유예 후 SIGKILL로 죽인다', async () => {
    const rm = makeRunManager({
      fakeEnv: { FAKE_DURATION_MS: '30000', FAKE_IGNORE_SIGTERM: '1' },
      sigtermGraceMs: 300          // 테스트에서는 유예를 짧게 (Q19)
    })
    const run = await rm.start(makeSpec())
    await waitUntil(() => rm.getQueueSnapshot().active.includes(run.id))

    const t0 = Date.now()
    await rm.cancel(run.id)
    const elapsed = Date.now() - t0

    expect(elapsed).toBeGreaterThanOrEqual(300)   // 유예를 기다렸다
    expect(elapsed).toBeLessThan(2000)            // 그러나 무한정은 아니다
  })

  it('타임아웃이 지나면 자동으로 중단된다', async () => {
    const rm = makeRunManager({ fakeEnv: { FAKE_DURATION_MS: '30000' } })
    const run = await rm.start(makeSpec({ timeoutMs: 300 }))
    await rm.waitForIdle()

    const saved = repo.findById(run.id)!
    expect(saved.status).toBe('canceled')
    expect(saved.errorMessage).toContain('타임아웃')
  })
})
```

> **`sigtermGraceMs`를 `RunManagerDeps`에 넣어 테스트에서 줄일 수 있게 해라.** 상수로 하드코딩하면 SIGKILL 테스트 하나에 5초가 걸린다.

### Q39. "인메모리 SQLite"는 어떻게 만드나요? 테스트마다 마이그레이션을 다시 실행하나요? — B

**`new Database(':memory:')`가 전부다.** 파일 대신 메모리에 DB를 만드는 SQLite의 표준 기능이고, better-sqlite3가 그대로 지원한다.

**마이그레이션은 테스트마다 다시 실행한다. 그리고 그게 빠르다.**

```ts
// core/db/__tests__/testDb.ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import * as schema from '../schema'

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../drizzle')

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>
  close(): void
}

/**
 * 완전히 격리된 인메모리 DB를 만든다.
 *
 * ':memory:' 는 연결마다 별개의 DB다.
 * 즉 이 함수를 두 번 부르면 서로 아무 관계 없는 DB 두 개가 생긴다.
 * 테스트 격리에 이상적이다.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:')

  // ⚠️ WAL은 켜지 마라. 인메모리 DB에서는 의미가 없고 경고만 난다.
  sqlite.pragma('foreign_keys = ON')     // ← 이건 반드시. 프로덕션과 동작을 맞춘다.

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })   // 동기 (Q10)

  return { db, close: () => sqlite.close() }
}
```

```ts
// 사용
describe('IssueRepository', () => {
  let testDb: TestDb
  let repo: IssueRepository

  beforeEach(() => {
    testDb = createTestDb()          // ← 매 테스트마다 새 DB
    repo = new IssueRepository(testDb.db)
  })

  afterEach(() => testDb.close())

  it('repo 태그와 함께 이슈를 만든다', () => {
    const ws = seedWorkspace(testDb.db)
    const r1 = seedRepo(testDb.db, ws.id, 'api-server')

    const created = repo.create({
      workspaceId: ws.id, title: '토큰 만료 버그', body: '…', repoIds: [r1.id]
    })

    expect(repo.findById(created.id)!.repoIds).toEqual([r1.id])
  })
})
```

**"매번 마이그레이션하면 느리지 않나?"** 안 느리다. 실측 감각으로 **테이블 10개 정도의 마이그레이션은 1~3ms**다. 인메모리라 디스크 I/O가 없다. `beforeEach`에 넣어도 테스트 100개에 0.3초 정도 추가될 뿐이다.

**그래도 최적화하고 싶다면 `beforeAll` + 트랜잭션 롤백 패턴이 있다.**

```ts
// 더 빠르지만 복잡하다. 테스트가 수백 개로 늘어난 뒤에 고려해라.
let shared: TestDb
beforeAll(() => { shared = createTestDb() })
afterAll(() => shared.close())

beforeEach(() => {
  shared.db.run(sql`BEGIN`)
})
afterEach(() => {
  shared.db.run(sql`ROLLBACK`)   // 테스트가 만든 데이터를 통째로 되돌린다
})
```

**단, 이 패턴은 테스트 대상 코드가 자체 트랜잭션을 쓰면 깨진다.** `IssueRepository.create()`가 `db.transaction()`을 쓰므로(Q12) **중첩 트랜잭션 문제가 생긴다.** 이 앱에서는 **`createTestDb()`를 `beforeEach`에 두는 단순한 방식을 권한다.**

**⚠️ Q9의 함정을 다시 상기해라.** 이 테스트를 돌리려면 `better-sqlite3`가 **시스템 Node ABI로** 빌드돼 있어야 한다.

```bash
pnpm rebuild:node && pnpm test
```

`pnpm test` 스크립트에 이미 넣어뒀다(Q37). **개발 중 `pnpm dev`를 돌린 직후 `vitest`를 실행하면 ABI 에러가 난다** — 그때 당황하지 말고 `pnpm rebuild:node`를 먼저 실행해라. 이 왕복이 번거로우면 터미널을 두 개 쓰고 한쪽은 테스트 전용으로 두는 것이 실용적이다.

**마이그레이션 파일이 없으면 테스트가 전부 실패한다.** CI에서 `drizzle/`을 커밋하지 않으면 이 함정에 빠진다. **`drizzle/` 디렉토리는 반드시 git에 커밋해라** — 생성물이지만 소스로 취급한다(Prisma의 migrations와 같은 취급이다).

**시드 헬퍼를 만들어 두면 테스트가 훨씬 짧아진다.**

```ts
// core/db/__tests__/seed.ts
export function seedWorkspace(db: Db, overrides: Partial<NewWorkspace> = {}) {
  const ws = {
    id: crypto.randomUUID(),
    name: 'test-workspace',
    description: null,
    defaultAgentKind: 'claude-code' as const,
    defaultModel: null,
    defaultPermission: 'edit' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
  db.insert(workspace).values(ws).run()
  return ws
}

export function seedRepo(db: Db, workspaceId: string, name: string) { … }
export function seedIssue(db: Db, workspaceId: string, overrides = {}) { … }
export function seedRun(db: Db, workspaceId: string, overrides = {}) { … }
```

**§12의 "인박스 조건" 테스트가 이걸로 아주 짧아진다.**

```ts
// core/db/__tests__/inbox.test.ts
describe('인박스 포함 조건 (§10)', () => {
  const cases: Array<[RunStatus, number | null, boolean]> = [
    // status,        reviewedAt,  인박스에 포함되나?
    ['succeeded',     null,        true],
    ['succeeded',     Date.now(),  false],   // 확인함
    ['failed',        null,        true],
    ['interrupted',   null,        true],
    ['canceled',      null,        true],
    ['running',       null,        false],   // 아직 도는 중
    ['pending',       null,        false],   // 아직 시작 안 함
    ['failed',        Date.now(),  false]    // 보관함
  ]

  it.each(cases)('status=%s reviewedAt=%s → %s', (status, reviewedAt, expected) => {
    const { db } = testDb
    const ws = seedWorkspace(db)
    const run = seedRun(db, ws.id, { status, reviewedAt })

    const inbox = new RunRepository(db).listInbox()
    expect(inbox.some((r) => r.id === run.id)).toBe(expected)
  })
})
```

### Q40. 렌더러가 `OneDeskClient`를 어떤 방식(Context, 싱글톤 import)으로 받나요? — B

**React Context를 써라. 싱글톤 import는 쓰지 마라.**

**싱글톤 import가 왜 안 되나.**

```ts
// ✗ renderer/client.ts
export const client: OneDeskClient = window.oneDesk
```

이러면 이 모듈을 import하는 **모든 컴포넌트가 `window.oneDesk`의 존재를 전제**한다. 그런데 §12는 "`OneDeskClient`를 목으로 대체해 Electron 없이 렌더링 테스트"를 요구한다. jsdom에는 `window.oneDesk`가 없으므로 **모듈 로드 시점에 `undefined`가 되고**, 테스트마다 전역을 조작해야 한다.

```ts
// ✗ 이런 코드를 매 테스트 파일에 쓰게 된다 — 누수와 순서 의존이 발생한다
beforeEach(() => { (globalThis as any).window.oneDesk = mockClient })
```

**Context 방식.**

```tsx
// renderer/client/ClientProvider.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { OneDeskClient } from '@shared/client'

const ClientContext = createContext<OneDeskClient | null>(null)

export function ClientProvider({
  client,
  children
}: {
  client: OneDeskClient
  children: ReactNode
}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function useClient(): OneDeskClient {
  const client = useContext(ClientContext)
  if (!client) {
    // 명확한 에러 메시지가 디버깅 시간을 크게 줄인다
    throw new Error('useClient는 <ClientProvider> 안에서만 쓸 수 있습니다')
  }
  return client
}
```

```tsx
// renderer/main.tsx — 여기서만 window.oneDesk를 만진다
import { createRoot } from 'react-dom/client'
import { ClientProvider } from './client/ClientProvider'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <ClientProvider client={window.oneDesk}>
    <App />
  </ClientProvider>
)
```

**`window.oneDesk`가 등장하는 곳이 `main.tsx` 한 줄뿐이다.** 나머지 컴포넌트는 전부 `useClient()`를 쓴다. 이게 §4 규칙 2("렌더러는 전송 계층을 모른다")를 렌더러 내부에서까지 관철한 형태다.

**테스트 — 목을 주입한다.**

```tsx
// renderer/test/renderWithClient.tsx
import { render } from '@testing-library/react'
import type { OneDeskClient } from '@shared/client'
import { ClientProvider } from '../client/ClientProvider'

export function createMockClient(overrides: DeepPartial<OneDeskClient> = {}): OneDeskClient {
  return {
    workspaces: {
      list: vi.fn(async () => []),
      create: vi.fn(async (i) => ({ id: 'ws-1', ...i } as Workspace)),
      ...overrides.workspaces
    },
    issues: {
      list: vi.fn(async () => []),
      ...overrides.issues
    },
    runs: {
      start: vi.fn(async () => makeRun()),
      cancel: vi.fn(async () => {}),
      loadEvents: vi.fn(async () => []),
      ...overrides.runs
    },
    events: {
      // 기본은 아무 이벤트도 안 오는 구독
      onRunEvent: vi.fn(() => () => {}),
      onInboxChanged: vi.fn(() => () => {}),
      ...overrides.events
    }
  } as OneDeskClient
}

export function renderWithClient(ui: React.ReactElement, client = createMockClient()) {
  return {
    client,
    ...render(<ClientProvider client={client}>{ui}</ClientProvider>)
  }
}
```

```tsx
// renderer/components/__tests__/IssueList.test.tsx
it('이슈 목록을 렌더링한다', async () => {
  const client = createMockClient({
    issues: {
      list: vi.fn(async () => [
        { id: 'i1', title: '인증 토큰 만료 버그', status: 'doing', repoIds: [] }
      ])
    }
  })

  renderWithClient(<IssueList workspaceId="ws-1" />, client)

  expect(await screen.findByText('인증 토큰 만료 버그')).toBeInTheDocument()
  expect(client.issues.list).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
})

it('실시간 이벤트가 오면 로그에 추가된다', async () => {
  let emit!: (e: RunEvent) => void
  const client = createMockClient({
    events: {
      onRunEvent: vi.fn((cb) => { emit = cb; return () => {} })
    }
  })

  renderWithClient(<RunTab runId="run-1" />, client)

  // 테스트가 이벤트를 직접 쏜다 — Electron도 실제 agent도 필요 없다
  act(() => {
    emit({ type: 'text', runId: 'run-1', text: '안녕하세요', seq: 0, at: Date.now() })
  })

  expect(await screen.findByText('안녕하세요')).toBeInTheDocument()
})
```

**`onRunEvent`의 콜백을 테스트가 붙잡아 직접 호출하는 패턴을 눈여겨봐라.** 실시간 UI를 완전히 결정론적으로 테스트할 수 있다. 타이머도, 대기도 필요 없다.

**Storybook이나 브라우저 프리뷰가 필요하면 목 클라이언트를 그대로 재사용해라.** `window.oneDesk`가 없는 순수 브라우저에서도 앱이 뜬다 — 디자인 작업이 훨씬 편해진다.

---

## 영역 12. 구현 순서

### Q41. 1단계의 "Electron + Vite + React 셸"은 손으로 세팅하나요, 템플릿이 있나요? — B

**템플릿으로 시작하고, 바로 구조를 우리 것으로 바꿔라.** 처음부터 손으로 만들면 electron-vite의 설정 관례를 몰라서 하루를 쓴다.

```bash
pnpm create electron-vite
# 프롬프트에서:
#   Project name: one-desk
#   Select a framework: React
#   Select a variant: TypeScript
```

**[확인함] `create-electron-vite`의 최신 버전은 0.7.1**이다.

**⚠️ 하지만 템플릿의 버전을 그대로 쓰면 안 된다.** 템플릿은 자기 시점의 최신을 깔아주므로, 확정된 스택(Q37의 `package.json`)으로 **덮어써라.** 특히 `@vitejs/plugin-react`를 `5.2.0`으로 고정하는 것을 잊지 마라(Q37의 ⚠️).

```bash
cd one-desk
# 템플릿이 만든 package.json의 dependencies/devDependencies를
# Q37의 것으로 교체한 뒤
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

**템플릿이 만드는 구조와 우리가 원하는 구조가 다르다. 이렇게 옮겨라.**

```
템플릿 기본                     one-desk 목표 (설계 §4)
────────────                    ──────────────────────
src/main/index.ts          →   electron/main.ts
src/preload/index.ts       →   electron/preload.ts
src/renderer/src/App.tsx   →   renderer/App.tsx
src/renderer/index.html    →   renderer/index.html
(없음)                      →   core/          ← 새로 만든다
(없음)                      →   shared/        ← 새로 만든다
```

```bash
mkdir -p electron/ipc core/{db/repositories,context,runner/adapters,mcp} renderer shared drizzle

git mv src/main/index.ts electron/main.ts
git mv src/preload/index.ts electron/preload.ts
git mv src/renderer/index.html renderer/index.html
git mv src/renderer/src/* renderer/
rm -rf src
```

그리고 `electron.vite.config.ts`를 Q5의 것으로 교체하면 새 경로를 인식한다.

**템플릿이 제공하는 것 중 유지할 가치가 있는 것.**

| 템플릿 산출물 | 유지? | 이유 |
|---|---|---|
| `electron.vite.config.ts` | 교체 | Q5의 alias/경로 설정이 필요하다 |
| `electron-builder.yml` | 수정 | Q37의 `asarUnpack`, `extraResources`를 추가해야 한다 |
| `.npmrc` | 유지 | Electron 미러 설정 등이 들어 있다 |
| `src/preload/index.d.ts` | 교체 | `shared/global.d.ts`(Q5)로 옮긴다 |
| `dev-app-update.yml` | 삭제 | 자동 업데이트는 이번 스펙 밖이다 |
| `resources/icon.png` | 유지 | 나중에 교체 |

**1단계를 마치는 순서를 구체적으로 제시한다.** 각 항목이 끝날 때마다 앱이 실행돼야 한다.

1. 템플릿 생성 → 구조 이동 → `pnpm dev`로 흰 창이 뜨는 것 확인
2. tsconfig 4개 작성(Q5) → `pnpm typecheck` 통과
3. ESLint 경계 규칙(Q6) → `pnpm lint` 통과
4. `shared/client.ts`, `shared/channels.ts`, `shared/events.ts` 뼈대
5. `core/db/schema.ts`(Q11) → `pnpm db:generate` → `drizzle/0000_init.sql` 확인
6. `createCore()`(Q7) + `electron/main.ts` 부트스트랩(Q10) → 앱 시작 시 DB 파일 생성 확인
7. `WorkspaceRepository` + IPC 핸들러 + preload(Q1) → renderer에서 `workspaces.list()` 호출 성공
8. 나머지 리포지토리(repo/issue/memo) + IPC
9. `ClientProvider`(Q40) + §9 레이아웃 (사이드바 / repo 스트립 / 3컬럼)
10. **`pnpm pack`으로 패키징 확인** (Q37의 권고)

**7번에서 처음으로 전체 경로가 이어진다.** 여기까지 오면 나머지는 반복이다. **7번에 도달하기 전에 UI를 예쁘게 만드는 데 시간을 쓰지 마라** — 배선이 되는지가 먼저다.

### Q42. 2단계에 "권한 세 단계 포함"인데 섹션 8은 권한이 MCP 도구 노출과 연결된다고 합니다. MCP는 4단계입니다. 2단계 권한은 부분 구현인가요? — A

**당신의 지적이 정확하다. 그리고 이 문서의 실측 결과 이 모순은 설계 문서가 인지한 것보다 더 크다.**

**먼저 답: 2단계 권한은 "부분 구현"이 아니라 "완결된 한 층"이다.** 권한이 두 개의 독립된 층으로 나뉘기 때문이다.

```
┌─ 층 1: 프로세스 권한 (2단계) ─────────────────────┐
│  agent가 로컬 파일시스템·셸에 무엇을 할 수 있는가   │
│  구현 위치: buildCommand()의 CLI 플래그            │
│  Claude Code: --tools / --allowedTools /           │
│               --permission-mode                    │
│  OpenCode:    OPENCODE_CONFIG의 permission 객체     │
│  → 2단계에서 100% 완성된다. MCP와 무관하다.        │
└────────────────────────────────────────────────────┘

┌─ 층 2: 데이터 권한 (4단계) ───────────────────────┐
│  agent가 one-desk의 issue/memo에 무엇을 할 수 있는가│
│  구현 위치: buildMcpServer()의 registerTool 분기    │
│  → 4단계에서 추가된다.                             │
│    2단계에는 MCP 서버가 없으므로 이 층 자체가 없다. │
└────────────────────────────────────────────────────┘
```

**두 층은 같은 `Permission` 값을 읽지만 서로를 참조하지 않는다.** 그래서 2단계의 산출물은 그 자체로 완결되고, 4단계는 그 위에 얹힐 뿐이다. 설계 문서가 "나중에 붙이면 커맨드 조립을 다시 손대야 한다"고 한 것은 **층 1**을 말한 것이고, 그 판단은 옳다.

---

**⚠️ 그러나 실측 결과, 설계가 예상하지 못한 결합이 하나 있다.**

Q22와 Q26에서 확인한 것을 다시 보자.

> **`--permission-mode`는 MCP 도구를 자동 승인하지 않는다.** MCP 도구를 쓰려면 `--allowedTools "mcp__onedesk"`를 **명시적으로 추가**해야 한다.

즉 **4단계에서 MCP를 붙일 때 `buildCommand`(층 1의 코드)를 반드시 수정하게 된다.** 설계가 2단계에 권한을 넣은 이유("나중에 커맨드 조립을 다시 손대야 한다")가 부분적으로 무력화되는 것이다.

**해결: 2단계에서 그 이음매를 미리 만들어 둔다.** 4단계에 코드를 고치는 게 아니라 **값만 채우면 되도록** 설계한다.

```ts
// core/runner/types.ts — 2단계에서 이 형태로 정의한다
export interface ResolvedRunSpec extends RunSpec {
  runId: string
  executablePath: string
  assembledPrompt: string
  systemPromptAppend?: string
  beforeDir: string

  /**
   * MCP 접속 정보.
   *
   * 2단계: 항상 undefined. MCP 서버가 아직 없다.
   * 4단계: McpServerHost.issueToken()의 결과가 들어온다.
   *
   * ⚠️ 이 필드가 2단계부터 존재하는 것이 핵심이다.
   * buildCommand의 분기가 이미 작성돼 있으므로 4단계에서는 아무것도 고치지 않는다.
   */
  mcp?: { serverName: string; url: string; token: string }
}
```

Q16의 `buildCommand`는 **이미 이 형태로 작성돼 있다.**

```ts
let cleanup: (() => void) | undefined
const mcpToolNames: string[] = []
if (spec.mcp) {                    // ← 2단계에서는 항상 false. 코드는 존재한다.
  const cfg = writeMcpConfig(spec.runId, spec.mcp.url, spec.mcp.token)
  args.push('--mcp-config', cfg.file, '--strict-mcp-config')
  cleanup = cfg.cleanup
  mcpToolNames.push(`mcp__${spec.mcp.serverName}`)
}
args.push(...claudeCodePermissionArgs(spec.permission, mcpToolNames))
```

**2단계에서 `mcpToolNames`는 항상 빈 배열이고, `claudeCodePermissionArgs`는 그걸 그대로 처리한다.** 4단계에서 `RunManager`가 `spec.mcp`를 채우기 시작하면 나머지가 자동으로 따라온다. **`buildCommand`는 한 글자도 안 바뀐다.**

---

**단계별로 무엇을 만드는지 표로 정리한다.**

| | 2단계 | 3단계 | 4단계 |
|---|---|---|---|
| `Permission` 타입 | ✅ `shared/permissions.ts` | — | — |
| workspace 기본 권한 | ✅ DB 컬럼 + 설정 UI | — | — |
| 실행 패널 권한 드롭다운 | ✅ | — | — |
| `run.permission` 기록 | ✅ | — | — |
| `claudeCodePermissionArgs()` | ✅ 완성 | — | — |
| `mcp?` 필드와 분기 | ✅ **자리만 만든다** | — | ✅ 값을 채운다 |
| `ask` 금지 테스트 | ✅ (Q24) | — | ✅ MCP용 추가 |
| 전체 허용의 별도 확인 절차 | ✅ (§7) | — | — |
| `opencodePermissions()` | 5단계 | — | — |
| MCP 도구 필터링 | — | — | ✅ `buildMcpServer` |
| 토큰 격리 테스트 | — | — | ✅ (Q28) |

**2단계 완료 시점에 "동작하는 앱"인가?** 그렇다. 사용자는 읽기 전용 / 편집 허용 / 전체 허용을 골라 agent를 돌릴 수 있고, 그 선택이 실제로 파일시스템 접근을 통제한다. **MCP가 없어도 §13이 요구하는 "그 자체로 동작하는 앱"의 조건을 만족한다.**

---

**한 가지 더 — 설계 문서에는 없지만 2단계에서 결정해야 하는 것이 있다.**

§7은 "읽기 전용 run에는 쓰기 도구를 제외한다"의 근거를 이렇게 말한다.

> "파일은 수정하지 못하는데 이슈 상태는 바꿀 수 있다면 '읽기 전용'이라는 표현을 신뢰할 수 없게 된다."

**이 논리를 2단계에도 적용하면, 2단계에서 `--append-system-prompt`에 넣을 "MCP 도구 사용 지침"(§6)이 문제가 된다.** MCP 서버가 없는데 도구 사용법을 안내하면 agent가 존재하지 않는 도구를 부르려다 혼란스러워진다.

```ts
// core/context/systemPrompt.ts
export function buildSystemPromptAppend(spec: { mcp?: unknown; permission: Permission }): string {
  const parts = [
    '너는 one-desk라는 데스크톱 앱이 실행한 agent다.',
    '작업 결과는 사용자의 인박스에 표시되므로, 마지막 응답에 무엇을 했는지 요약해라.',
    '판단이 필요한 질문이 있으면 추측하지 말고 질문을 남기고 종료해라. 사용자가 답한 뒤 세션을 이어서 실행한다.'
  ]

  // ⚠️ MCP 안내는 실제로 MCP가 붙었을 때만 넣는다
  if (spec.mcp) {
    parts.push(
      'one-desk MCP 도구로 이 workspace의 이슈와 메모를 조회할 수 있다.',
      'list_issues / get_issue / list_memos / get_memo 로 배경을 더 확인해라.'
    )
    if (spec.permission !== 'read_only') {
      parts.push(
        '작업을 마쳤으면 update_issue로 관련 이슈의 상태를 갱신해라.',
        '작업 중 발견한 별도 과제는 create_issue로 남겨라.'
      )
    }
  }

  return parts.join('\n')
}
```

**`permission`에 따라 시스템 프롬프트까지 달라지는 것을 눈여겨봐라.** 읽기 전용 run에서 쓰기 도구는 애초에 등록되지 않지만(Q28), **안내조차 하지 않는 것이 낫다.** 없는 도구를 쓰라고 안내하면 agent가 "권한이 없다"는 결론에 도달하느라 턴을 낭비한다.

---

## 설계 문서에서 발견한 구멍

42개 질문에 답하면서 발견한 누락·모순이다. **심각도 순**으로 정렬했다. 각각 어떻게 메울지 제안을 붙였다.

---

### 🔴 #1 — 로그 경로가 두 가지로 쓰여 있다 (모순)

**어긋난 지점:** §5의 `run` 테이블 주석과 파일 구조도는 `logs/<run_id>/stream.jsonl`이고, 같은 §5의 "실행 로그는 DB가 아니라 파일에 쓴다" 문단과 §6의 흐름도는 `logs/<run_id>.jsonl`이다.

**왜 문제인가:** 사소해 보이지만 두 사람이 각각 다른 쪽을 읽고 구현하면 `run.log_path`에 저장된 경로로 파일을 못 찾는다. §10의 `before/` 스냅샷 디렉토리가 run별로 필요하므로 **디렉토리 형태가 아니면 성립하지 않는다.**

**메우는 법:** `logs/<run_id>/stream.jsonl` + `logs/<run_id>/before/`로 통일한다. §5의 문장과 §6의 흐름도를 수정한다. (이 문서 Q17이 이 형태로 구현했다)

---

### 🔴 #2 — `before/` 스냅샷 타이밍에 경쟁 조건이 있다 (설계 결함)

**어긋난 지점:** §10은 "runner가 스트림에서 파일 수정 도구 호출을 감지하면 … 원본을 복사한다"고만 쓰고 어느 이벤트인지 명시하지 않았다.

**왜 문제인가:** `tool_use` 이벤트가 stdout에 나가는 것과 CLI가 실제로 파일을 쓰는 것 사이에 **동기화가 없다.** 우리가 그 줄을 읽고 복사하기까지 수 밀리초 사이에 이미 덮어써졌을 수 있다. **실패해도 조용하다** — before와 after가 같아져서 "변경 없음"으로 보인다. `tool_result`에서 뜨는 것은 100% 틀렸다.

**메우는 법:** 세 겹으로 방어한다. (Q36에 전체 구현이 있다)
1. **동기 `copyFileSync`** 사용 (`fs.promises`를 쓰면 확률이 크게 올라간다)
2. **`suspect` 플래그** — 스냅샷 시점의 `mtime`/`size`가 종료 후와 같으면 경쟁에서 졌다는 뜻이므로 UI에 경고한다
3. **`PreToolUse` 훅** — Claude Code의 훅은 도구 실행 전에 동기적으로 실행되므로 순서가 보장된다. `--settings`로 주입한다. **[확인 필요] 훅 stdin JSON의 필드명은 검증하지 못했다.**

---

### 🔴 #3 — "답변 필요" 상태를 판별할 방법이 없다 (누락)

**어긋난 지점:** §7과 §10은 "agent가 질문을 남기고 종료하면 인박스에 `답변 필요` 상태로 올라온다"고 한다. 그런데 **어떻게 그것을 감지하는지가 어디에도 없다.**

**왜 문제인가:** 실측한 `result` 이벤트에는 `subtype: "success"`와 `is_error: false`만 있다. 질문을 남기고 끝난 run과 작업을 마친 run이 **데이터상 완전히 동일하다.** §10의 4개 인박스 상태 중 하나를 구현할 수 없다. 그리고 §7이 "질문도 다른 결과와 똑같이 인박스에 쌓이는 편이 일관적"이라며 이 방식을 택한 **설계의 핵심 근거가 무너진다.**

**메우는 법:** 세 가지 중 하나. 위에서부터 권한다.
1. **구조화 출력을 강제한다.** `--append-system-prompt`에 "질문이 있으면 마지막 줄에 `[NEEDS_ANSWER]`를 남겨라"를 넣고, `result_text`에서 그 토큰을 찾는다. 저비용이고 결정론적이다.
2. **`--json-schema`를 쓴다.** Claude Code에 `--json-schema <schema>` 플래그가 있다(2.1.224에서 확인). `{needs_answer: boolean, summary: string}` 형태를 강제하면 파싱이 확실해진다. **[확인 필요]** — `stream-json`과 함께 쓸 수 있는지 검증 필요.
3. 휴리스틱(물음표로 끝나는가)은 오탐이 많으니 **쓰지 마라.**

DB에는 `run.needs_answer` 컬럼을 추가한다 (이 문서 Q11의 스키마에 포함해 두었다).

---

### 🟠 #4 — `parseLine`의 시그니처가 실제 출력을 표현하지 못한다

**어긋난 지점:** §6의 `parseLine(line: string): RunEvent | null`.

**왜 문제인가:** **실측 결과 `assistant` 메시지 하나에 `text` 블록과 `tool_use` 블록이 함께 들어온다.** 한 줄이 이벤트 두 개를 낳으므로 이 시그니처로는 하나를 버려야 한다.

**메우는 법:** `parseLine(line: string, runId: string): RunEvent | RunEvent[] | null`로 넓힌다. 호출부에서 `Array.isArray()`로 분기한다. (Q31에 구현이 있다)

---

### 🟠 #5 — `default_model`이 두 CLI의 형식 차이를 담지 못한다

**어긋난 지점:** §5의 `workspace.default_model`, `run.model` 컬럼이 단일 문자열이다.

**왜 문제인가:** **Claude Code는 `sonnet` / `opus` / `claude-fable-5` 형식**이고, **[확인함] OpenCode는 `provider/model` 형식**이다(`--model, -m  "model to use in the form of provider/model"`). workspace 기본 모델을 `sonnet`으로 두고 agent를 OpenCode로 바꾸면 **잘못된 모델명이 그대로 전달된다.**

**메우는 법:** 둘 중 하나.
- (권장) `workspace.default_model_claude`, `workspace.default_model_opencode`로 컬럼을 나눈다. UI에서 agent 종류를 바꾸면 모델 드롭다운도 함께 바뀐다.
- 또는 `default_model`을 JSON(`{"claude-code":"sonnet","opencode":"anthropic/claude-sonnet-4"}`)으로 저장한다.

어느 쪽이든 **agent 종류를 바꿀 때 모델을 초기화하는 UI 규칙**이 필요하다.

---

### 🟠 #6 — 앱 전역 설정을 저장할 곳이 없다

**어긋난 지점:** §6은 "기본 동시 실행 상한은 3이며, **앱 설정에서 변경할 수 있다**"고 하고, §11은 "run별 타임아웃 설정(기본 비활성)"을 말한다. 그런데 §5의 데이터 모델에 **설정 테이블이 없다.**

**왜 문제인가:** 상한을 바꿔도 앱을 껐다 켜면 3으로 돌아간다. 타임아웃 기본값도 저장할 곳이 없다. 그리고 §11의 "CLI 실행 파일 경로를 workspace 설정에서 직접 지정 가능"도 `workspace` 테이블에 컬럼이 없다.

**메우는 법:** 두 가지를 추가한다. (Q11의 스키마에 포함해 두었다)
- `app_setting(key, value)` — key-value 테이블. `maxConcurrent`, `defaultTimeoutMs` 등.
- `workspace`에 `cli_path_claude`, `cli_path_opencode` 컬럼 추가 (§11의 요구사항).
- `run`에 `timeout_ms` 컬럼 추가 (§11의 "run별 타임아웃").

---

### 🟠 #7 — 실시간 UI의 배치 처리가 언급되지 않았다

**어긋난 지점:** §5는 "agent 실행 한 번에 수천 개의 스트리밍 이벤트가 발생한다"고 인정하면서, §9의 UI 섹션에는 렌더링 전략이 없다.

**왜 문제인가:** `setEvents(prev => [...prev, e])` 패턴은 O(n²)라 이벤트 5000개에서 앱이 멈춘다. 주니어가 가장 자연스럽게 쓰는 패턴이 바로 그것이다.

**메우는 법:** (Q29에 구현이 있다)
- 외부 스토어 + `requestAnimationFrame` 플러시 + `useSyncExternalStore`
- `RunEvent`에 **`seq` 필드 추가** (React key, 중복 제거, 정렬에 모두 필요하다). 이건 §6의 이벤트 정의에 반영해야 한다.
- 렌더링 개수 상한(최근 500개) 또는 가상 스크롤

---

### 🟡 #8 — 대기 큐의 영속성이 명시되지 않았다

**어긋난 지점:** §6은 "초과분은 `pending` 상태로 대기하다가 슬롯이 나면 FIFO 순으로 시작한다"고만 한다.

**왜 문제인가:** 재시작 시 어떻게 되는지가 없다. DB에 `pending`이 남아 있는데 메모리 큐는 비었으므로, **정리하지 않으면 영원히 시작되지 않는 유령 run이 쌓인다.** §11의 "앱 강제 종료 후 남은 run" 항목은 `running`만 언급하고 `pending`을 빠뜨렸다.

**메우는 법:** 메모리 큐로 확정하고, §11의 부팅 정리에 `pending`을 포함시킨다. 그러면 인박스의 "중단됨"으로 올라와 사용자가 "다시 실행"할 수 있다. (Q18, Q21에 구현이 있다)

---

### 🟡 #9 — `tool_use.name`의 정규화 여부가 정해지지 않았다

**어긋난 지점:** §6은 `tool_use`를 "도구 호출 (이름, 입력)"이라고만 정의한다.

**왜 문제인가:** 두 CLI의 도구 이름이 다르다. `Edit`(Claude) vs `edit`(OpenCode 추정). §10의 스냅샷 트리거가 이름을 직접 보면 **CLI마다 분기해야 하고**, §6이 약속한 "UI와 저장 로직은 agent 종류를 알 필요가 없다"가 깨진다.

**메우는 법:** `RunEvent.tool_use`에 **`effect: 'read'|'file_write'|'shell'|'mcp'|'other'`와 `targetPaths: string[]`를 추가**한다. 원본 `name`은 그대로 두고(디버깅에 필요), 로직은 `effect`만 본다. 분류표는 어댑터가 소유한다. (Q35에 구현이 있다)

---

### 🟡 #10 — repo 필터링 시 "workspace 공통" 항목의 처리가 없다

**어긋난 지점:** §5는 "태그가 하나도 없으면 그것이 곧 'workspace 공통' 항목이 된다"고 한다. §9는 "카드를 클릭하면 아래 issue/memo가 그 repo로 필터링된다"고 한다.

**왜 문제인가:** 두 문장을 합치면 **repo 카드를 클릭했을 때 공통 항목이 보여야 하는지 아닌지가 정해지지 않는다.** `innerJoin`으로 필터링하면 공통 항목이 전부 사라지고, "공통"이라는 개념이 UI에서 사라진다.

**메우는 법:** "repo 필터 시 공통 항목도 함께 표시"를 권한다 — 공통 항목은 정의상 모든 repo에 관련되기 때문이다. 쿼리는 Q12 말미에 있다. 어느 쪽이든 §9에 한 문장 명시가 필요하다.

---

### 🟡 #11 — 이어서 실행 시 변경 가능한 필드가 정해지지 않았다

**어긋난 지점:** §6의 "세션 이어서 실행"은 맥락 첨부 규칙만 정하고 나머지를 비워뒀다.

**왜 문제인가:** `agent_kind`를 바꾸면 세션 ID가 무의미해지고, `cwd`를 바꾸면 세션을 못 찾을 수 있다. 실행 패널의 기본값과 잠금 규칙이 없으면 구현자가 임의로 정하게 된다.

**메우는 법:** `agent_kind`와 `cwd`는 잠그고, `model`·`permission`·맥락·프롬프트는 변경 가능으로 확정한다. **특히 `permission` 변경은 §7이 명시적으로 요구하는 흐름**("사용자는 권한을 올려 이어서 실행한다")이므로 반드시 열려 있어야 한다. 잠긴 필드는 숨기지 말고 비활성화해서 보여주고, "새 실행" 탈출구를 제공한다. (Q32에 구현이 있다)

---

### 🟡 #12 — `@vitejs/plugin-react` 6.0.x와 Vite 7이 충돌한다 (스택 오류)

**어긋난 지점:** 확정 스택이 "Vite 7.x (electron-vite 5.0.0의 peerDependency 때문에 8.x 불가)"와 "@vitejs/plugin-react 6.0.x"를 동시에 지정한다.

**왜 문제인가:** **[확인함] `@vitejs/plugin-react@6.0.0`의 peerDependency는 `vite: ^8.0.0`이다.**

```
$ npm view @vitejs/plugin-react@6.0.0 peerDependencies.vite  →  ^8.0.0
$ npm view @vitejs/plugin-react@5.2.0 peerDependencies.vite  →  ^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0
$ npm view electron-vite@5.0.0 peerDependencies             →  { vite: '^5.0.0 || ^6.0.0 || ^7.0.0' }
```

Vite 7이 확정이므로 plugin-react 6.x는 **peer 충돌**이다. pnpm 10은 이를 에러로 올린다. **첫날 `pnpm install`에서 막힌다.**

**메우는 법:** `@vitejs/plugin-react`를 **5.2.0**(Vite 7 호환 최신)으로 고정한다. Vite 8로 올리는 것은 electron-vite가 막으므로 불가능하다.

---

### ⚪ #13 — MCP 도구의 자동 승인이 `--permission-mode` 밖에 있다 (설계 전제 오류)

**어긋난 지점:** §7의 표는 권한 3단계를 `--permission-mode` 하나로 매핑한다. §8은 "권한 정책이 도구 노출을 통제한다"고 한다.

**왜 문제인가:** **[확인함] `--permission-mode acceptEdits`로도 MCP 도구 호출이 거부됐다.**

```
"Claude requested permissions to use mcp__onedesk__list_issues,
 but you haven't granted it yet."
```

`--allowedTools "mcp__onedesk"`를 추가해야 통과한다. 이걸 모르면 **4단계에서 MCP를 붙였는데 agent가 도구를 하나도 못 쓰는** 상황이 되고, 원인 파악이 매우 어렵다(에러가 아니라 "권한이 없다"는 텍스트 응답으로 나오므로).

**함께 확인한 것:** **`--tools "Read"`로 빌트인을 제한해도 `mcp__*` 도구는 남는다.** 즉 CLI 플래그로는 MCP 도구를 읽기 전용으로 만들 수 없다 — **§8의 "MCP 서버 쪽에서 도구를 필터링한다"는 선택이 아니라 유일한 방법이었다.** 설계의 결론은 옳았고, 근거만 보강하면 된다.

**메우는 법:** §7의 표에 `--allowedTools`를 추가하고, "MCP 도구는 `--permission-mode`의 적용을 받지 않으므로 별도 허용이 필요하다"는 주석을 단다. Q42의 `mcp?` 이음매로 2단계에서 미리 대비한다.

---

### ⚪ #14 — `--verbose`가 대응표에서 빠졌다

**어긋난 지점:** §6의 두 CLI 대응표에 `claude -p` + `--output-format stream-json`만 있다.

**왜 문제인가:** **[확인함] `--verbose` 없이는 실행 자체가 거부된다.**

```
Error: When using --print, --output-format=stream-json requires --verbose
```

2단계의 첫 실행이 즉시 실패한다.

**메우는 법:** 대응표의 "스트리밍 JSON" 칸을 `--output-format stream-json --verbose`로 고친다.

---

### ⚪ #15 — OpenCode에 `--mcp-config` 상당의 플래그가 없다

**어긋난 지점:** §6의 대응표는 원격 MCP를 `mcp.type: "remote"` + headers로 적었다. 이는 **설정 파일의 스키마**이고, run별로 어떻게 전달할지가 비어 있다.

**왜 문제인가:** **[확인함] `opencode run`의 플래그 목록에 `--mcp-config`도 `--config`도 없다.** run마다 다른 토큰을 주입할 방법이 명시되지 않으면 §8의 "토큰은 run에 묶인다"가 OpenCode에서 성립하지 않는다.

**메우는 법:** **[확인함] `OPENCODE_CONFIG` 환경변수**로 설정 파일 경로를 지정한다(공식 문서). run마다 임시 파일을 쓰고 `SpawnSpec.env`로 넘긴다. 권한과 MCP가 한 파일에 들어가므로 오히려 깔끔하다. (Q23에 구현이 있다)
**[확인 필요]** — `OPENCODE_CONFIG`가 사용자의 전역 설정을 **대체하는지 병합하는지** 검증이 필요하다. 병합이라면 사용자 설정의 `"ask"`가 새어 들어와 §7의 규칙이 깨진다.

---

### ⚪ #16 — "보관"과 "확인함"이 데이터상 구분되지 않는다

**어긋난 지점:** §10이 "두 표현을 나눈 것은 사용자의 의도가 다르기 때문이며, 데이터상 구분이 필요해지면 그때 컬럼을 추가한다"고 **스스로 인정한 항목**이다.

**왜 문제인가:** 구멍이라기보다 의도된 유보다. 다만 §10이 "실패한 run을 이슈로 전환하는 경로가 특히 중요하다"고 강조하므로, **나중에 "보관한 실패 run만 다시 보기" 같은 요구가 나올 가능성이 높다.**

**메우는 법:** 지금은 그대로 두되, `reviewed_at` 옆에 `reviewed_kind TEXT` 컬럼을 **미리 추가**하는 것이 비용이 거의 없다. 나중에 마이그레이션 한 번을 아낀다.

---

## 구현 시작 첫날 체크리스트

**순서대로 실행한다. 각 단계에서 확인 사항이 통과해야 다음으로 넘어간다.**

### 0. 사전 확인 (10분)

```bash
node --version        # v22.16.x 여야 한다
pnpm --version        # 10.x
claude --version      # 설치돼 있어야 2단계를 검증할 수 있다
which claude          # 경로를 메모해 둘 것 (Q15의 preflight 테스트에 쓴다)
git --version
```

- [ ] Node가 22.16이 아니면 `nvm use 22.16` 후 진행
- [ ] `claude`가 없으면 설치하고 `claude auth`로 로그인까지 끝낸다

### 1. 스캐폴딩 (30분)

```bash
pnpm create electron-vite
#   Project name: one-desk
#   Framework: React
#   Variant: TypeScript

cd one-desk
```

- [ ] `pnpm install && pnpm dev`로 **일단 창이 뜨는 것**을 먼저 확인한다 (템플릿 기본 상태)

```bash
# 구조를 설계 §4에 맞춘다
mkdir -p electron/ipc core/{db/repositories,context,runner/adapters,mcp} renderer shared
git init && git add -A && git commit -m "Scaffold from create-electron-vite"

git mv src/main/index.ts electron/main.ts
git mv src/preload/index.ts electron/preload.ts
git mv src/renderer/index.html renderer/index.html
git mv src/renderer/src/* renderer/
rm -rf src
```

### 2. 의존성 확정 (20분)

**⚠️ 여기가 첫날 가장 막히기 쉬운 지점이다** (구멍 #12).

```bash
# package.json의 dependencies/devDependencies를 이 문서 Q37의 것으로 교체한 뒤
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

- [ ] `@vitejs/plugin-react`가 **5.2.0**인지 확인한다 (6.0.x는 Vite 8을 요구해 설치가 실패한다)
- [ ] `package.json`에 `pnpm.onlyBuiltDependencies: ["better-sqlite3", "electron"]`가 있는지 확인 (없으면 네이티브 빌드가 조용히 생략된다)
- [ ] `postinstall`에 `electron-rebuild -f -w better-sqlite3`가 걸려 있는지 확인

```bash
# 설치 결과 검증
pnpm ls vite @vitejs/plugin-react electron electron-vite
ls node_modules/better-sqlite3/build/Release/better_sqlite3.node   # 존재해야 한다
```

### 3. ABI 확인 (10분) — Q9

```bash
# Electron이 요구하는 NODE_MODULE_VERSION을 기록해 둔다
npx electron -e "console.log('electron modules ABI:', process.versions.modules, \
'node:', process.versions.node, 'electron:', process.versions.electron)"

node -e "console.log('system node ABI:', process.versions.modules)"
```

- [ ] 두 숫자가 **다르다**는 것을 눈으로 확인한다. 이게 Q9의 모든 혼란의 근원이다.
- [ ] 이 숫자들을 README나 CLAUDE.md에 메모해 둔다

### 4. tsconfig와 경계 (40분) — Q5, Q6

- [ ] `tsconfig.json`, `tsconfig.base.json`, `tsconfig.node.json`, `tsconfig.web.json`, `tsconfig.core.json` 작성
- [ ] `electron.vite.config.ts`를 Q5의 것으로 교체
- [ ] `eslint.config.js`에 경계 규칙 추가
- [ ] `vitest.config.ts` 작성

```bash
pnpm typecheck        # 통과해야 한다
pnpm lint             # 통과해야 한다
```

**경계가 실제로 작동하는지 일부러 깨보고 확인해라. 이게 중요하다.**

```bash
# 임시 파일을 만들어 규칙이 잡는지 확인
echo "import { app } from 'electron'; console.log(app)" > core/__boundary_test.ts
pnpm lint             # ← 에러가 나야 정상이다
rm core/__boundary_test.ts
```

- [ ] `core/`에서 `electron` import 시 lint 에러가 뜬다
- [ ] `renderer/`에서 `@core/*` import 시 컴파일 에러가 뜬다

### 5. CLI 실측 검증 (30분) — 2단계 준비물을 첫날 확보한다

**이 단계를 첫날에 하는 이유:** 이 문서의 CLI 관련 내용이 전부 `claude` 2.1.224 기준이다. 버전이 다르면 지금 알아야 한다.

```bash
mkdir -p core/runner/adapters/__tests__/fixtures

# ① stream-json 픽스처를 뜬다 (Q31의 파싱 테스트에 쓴다)
printf 'Read package.json and summarize it in one line. Then stop.' | \
  claude -p --output-format stream-json --verbose --model sonnet \
    --tools "Read" --permission-mode acceptEdits \
  > core/runner/adapters/__tests__/fixtures/claude-$(claude --version | cut -d' ' -f1)-read.jsonl

# ② 필드명을 눈으로 확인한다
node -e '
const ls=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
for(const l of ls){const o=JSON.parse(l);
  if(o.type==="system"&&o.subtype==="init") console.log("session_id:", o.session_id);
  if(o.type==="assistant") for(const b of o.message.content) if(b.type==="tool_use")
    console.log("tool_use:", b.name, JSON.stringify(b.input));
  if(o.type==="result") console.log("result keys:", Object.keys(o).join(","));
}' core/runner/adapters/__tests__/fixtures/*.jsonl
```

- [ ] `system`/`init`에 **`session_id`** 필드가 있다 (Q31)
- [ ] `assistant`의 `tool_use` 블록에 `id`, `name`, `input.file_path`가 있다 (Q35)
- [ ] `result`에 `is_error`, `result`, `session_id`가 있다
- [ ] **`--verbose`를 빼면 에러가 나는지** 확인한다 (구멍 #14)

```bash
printf 'hi' | claude -p --output-format stream-json 2>&1 | head -1
#   기대: "Error: When using --print, --output-format=stream-json requires --verbose"
```

### 6. DB 스키마와 마이그레이션 (60분) — Q10, Q11

- [ ] `core/db/schema.ts` 작성 (Q11의 전체 스키마. **구멍 #6의 `app_setting`, `run.timeout_ms`, `run.needs_answer` 포함**)
- [ ] `drizzle.config.ts` 작성

```bash
pnpm db:generate
cat drizzle/0000_*.sql          # ← 생성된 SQL을 반드시 읽어본다
git add drizzle && git commit -m "Add initial migration"
```

- [ ] `drizzle/` 디렉토리를 **git에 커밋**한다 (Q39 — 안 하면 CI에서 테스트가 전부 실패한다)
- [ ] SQL에 예상한 테이블 9개가 모두 있는지 확인

```bash
# 인메모리 DB로 마이그레이션이 실제로 도는지 확인
pnpm rebuild:node
node -e "
const D=require('better-sqlite3');const db=new D(':memory:');
const sql=require('fs').readFileSync(require('fs').readdirSync('drizzle').filter(f=>f.endsWith('.sql')).map(f=>'drizzle/'+f)[0],'utf8');
db.exec(sql);
console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());
"
```

### 7. 첫 번째 IPC 왕복 (60분) — Q1, Q2, Q7, Q40

**이것이 첫날의 진짜 목표다.** 여기까지 오면 나머지는 같은 패턴의 반복이다.

- [ ] `shared/channels.ts`, `shared/client.ts` 작성
- [ ] `core/index.ts`의 `createCore()` (Q7)
- [ ] `core/db/repositories/workspaceRepository.ts`
- [ ] `electron/main.ts` 부트스트랩 (Q18의 전체 골격)
- [ ] `electron/preload.ts` (Q1)
- [ ] `electron/ipc/index.ts` (Q3)
- [ ] `renderer/main.tsx`의 `ClientProvider` (Q40)

```bash
pnpm rebuild:electron && pnpm dev
```

**렌더러 콘솔에서 직접 확인한다.**

```js
await window.oneDesk.workspaces.create({ name: '첫 workspace' })
await window.oneDesk.workspaces.list()
// → [{ id: '...', name: '첫 workspace', ... }]
```

- [ ] 위 두 줄이 동작한다
- [ ] 앱을 껐다 켜도 workspace가 남아 있다 (DB 영속성 확인)
- [ ] `<userData>/one-desk.db`가 실제로 생성됐다

```js
// userData 경로 확인 (main 프로세스 콘솔에서)
// electron/main.ts에 console.log(app.getPath('userData')) 를 임시로 넣어 확인
```

### 8. 첫 테스트 (30분) — Q39

- [ ] `core/db/__tests__/testDb.ts` 작성
- [ ] `WorkspaceRepository` 테스트 1개

```bash
pnpm rebuild:node && pnpm test
```

- [ ] 통과한다
- [ ] **`pnpm dev`를 돌린 뒤 `pnpm test`를 하면 ABI 에러가 나는 것**을 한 번 겪어본다. 이걸 첫날 겪어두면 나중에 당황하지 않는다.

### 9. 패키징 확인 (30분) — Q37

**5단계까지 미루지 마라.** 이 앱은 네이티브 모듈 + 외부 리소스를 쓰므로 패키징 리스크가 높다.

- [ ] `electron-builder.yml`에 `asarUnpack`(better-sqlite3)과 `extraResources`(drizzle) 추가

```bash
pnpm pack
open dist/mac-arm64/one-desk.app     # macOS
```

- [ ] 패키징된 앱이 실행되고 workspace 생성이 동작한다
- [ ] 실패하면 **지금 고쳐라.** 원인은 거의 항상 위 두 설정 중 하나다.

### 10. 커밋과 문서 (10분)

```bash
pnpm check            # typecheck + lint + boundaries + test
git add -A
git commit -m "Set up project skeleton with SQLite and IPC"
```

- [ ] `CLAUDE.md`에 다음을 기록한다:
  - Electron/Node ABI 숫자 (3번에서 확인한 것)
  - `pnpm rebuild:node` ↔ `pnpm rebuild:electron` 전환 규칙
  - 검증한 `claude` CLI 버전
  - 이 문서(`2026-08-07-implementation-notes.md`)로 가는 링크

---

### 첫날에 하지 말아야 할 것

- **UI를 예쁘게 만들기.** 7번(IPC 왕복)이 되기 전까지 CSS에 시간을 쓰지 마라.
- **agent 실행 시도.** 2단계다. 1단계 뼈대가 안 서면 디버깅할 수 있는 것이 없다.
- **MCP 서버.** 4단계다. 다만 이 문서 Q25~Q28의 코드가 검증된 것이므로, 4단계에 오면 그대로 쓰면 된다.
- **완벽한 타입.** `any`를 잠깐 쓰고 `TODO`를 남겨도 된다. 배선이 먼저다.

### 둘째 날 이후 가장 먼저 검증할 [확인 필요] 항목

우선순위 순이다. 전부 30분 이내에 확인할 수 있다.

1. **`PreToolUse` 훅의 stdin JSON 필드명** (Q36, 구멍 #2) — 스냅샷 정확성의 핵심
2. **읽기 전용의 `--permission-mode` 선택** (Q22) — `dontAsk`가 맞는지 실험
3. **`--json-schema`와 `stream-json` 병용 가능 여부** (구멍 #3) — "답변 필요" 판별
4. **`--resume`이 다른 cwd에서 동작하는지** (Q32)
5. **OpenCode 3종** (Q23) — `OPENCODE_CONFIG` 병합 여부, 세션 자동 생성, stdin 수용. **5단계 착수 시**








