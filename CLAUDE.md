# one-desk

workspace/repo/issue/memo를 한 화면에서 관리하고, 필요한 맥락을 골라 CLI 코딩 agent(Claude Code, OpenCode)에게 넘겨 헤드리스로 실행한 뒤 결과를 앱에 기록하는 Electron 데스크톱 앱.

**현재 상태:** 4단계 완료(MCP 서버 — 호스트/도구 아홉 개/권한별 등록/커맨드 배선), `main`에 병합됨(`a19b4fd`). 이슈·메모 본문 편집(설계 `2026-08-14-issue-memo-body-design.md`)도 `main`에 병합됨(`c91438e`) — 저장소의 `updateIfUnchanged`로 낙관적 잠금, 선택한 패널이 커지는 동적 3컬럼, 맥락 담기와 열기 분리, `IssueDetail`·`MemoDetail` 본문 편집기, 그리고 `e2e/body.e2e.ts`가 IPC 왕복(`client.issues.updateIfUnchanged` → preload → `ipcMain.handle` → 저장소)을 실제로 검증한다. **상태 편집은 상세에만 있다** — 목록의 상태 칩은 읽기 전용 배지다(§5·§9). 3b 리뷰가 4단계로 이월한 것 둘 다 해소됐다: `core/`의 `console.error`가 주입식 `onError`로 바뀌었고, `resume`의 catch는 DB 장애를 더 이상 뭉개지 않는다.

다음은 5단계(OpenCode 어댑터 · asset 스캔 · diff 뷰어)이고, 착수 전에 아래 "환경변수" 절을 먼저 정해야 한다. 본문 작업이 넷으로 쪼갠 것 중 첫째였으므로 나머지 셋(마크다운 렌더링 · 검색/필터/정렬 · run 완료 구독)도 후보로 남아 있다.

## 5단계 착수 전에 정할 것 — agent 프로세스의 환경변수

**설계 문서에 인증 이야기가 한 줄도 없다.** 지금 어댑터는 `env: { ...process.env }`로 프로세스 환경을 통째로 물려주고 인증은 `claude` CLI에 맡긴다(`~/.claude/.credentials.json`). 터미널에서 `pnpm dev`로 띄우는 동안에는 셸 환경이 그대로 흘러가 아무 문제가 없다.

**`pnpm run pack`으로 만든 앱을 Finder/Dock에서 실행하면 그 가정이 깨진다.** macOS의 GUI 앱은 launchd의 최소 환경만 받아 `.zshrc`가 export한 것이 하나도 안 들어온다. 둘이 동시에 깨진다.

- **실행 파일 탐색** — `findExecutable`이 `process.env.PATH`를 뒤지는데 거기 `/usr/bin:/bin` 정도만 있어 `claude`를 못 찾고 모든 run이 프리플라이트 실패로 끝난다. **탈출구는 있다** — workspace 설정의 `claudePath`에 절대 경로를 박으면 된다.
- **환경변수** — **탈출구가 없다.** `Workspace` 스키마에는 `claudePath`/`opencodePath`/모델/권한뿐이고 env를 담을 자리가 없다. AWS Bedrock으로 도는 환경(`CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`, `AWS_PROFILE`)은 패키징된 앱에서 그 값을 전달할 방법이 아예 없다. 모델 ID는 workspace 기본 모델이 `--model`로 넘어가므로 그쪽은 이미 통한다.

**유력한 방향:** `Workspace`에 `env: Record<string, string>`을 더하고 어댑터가 `{ ...process.env, ...workspace.env }`로 병합한다. Bedrock·Vertex·프록시·사내 게이트웨이가 같은 통로로 풀리고, 실행 파일 경로가 이미 workspace 단위인 것과 결이 맞는다.

**막힌 결정:** 값에 자격 증명이 들어가는데 **SQLite 파일은 암호화가 없다.** `AWS_PROFILE`처럼 이름만 넣고 실제 키는 `~/.aws/credentials`에 두게 유도하는 편이 안전하지만, 규약으로 강제할 수 없다. 평문 저장을 허용할지 / Keychain을 쓸지 / 이름만 받는 화이트리스트로 좁힐지를 먼저 정해야 한다.

**4단계 리뷰가 5단계로 이월한 것 (전부 비차단):** `core/execution.ts`가 `serverName: MCP_SERVER_NAME`을 넘기는 한 줄이 어떤 테스트로도 묶여 있지 않다 — 다른 리터럴로 바꿔도 단위·e2e 모두 초록이다(가짜 CLI가 `--allowedTools`를 보지 않는다). `core/mcp/host.ts`의 listen 후 error 리스너 교체(M-7)와 헤더 전송 후 오류의 `res.end()`(M-8)는 고쳤지만 전용 테스트가 없다 — 결정적으로 재현하려면 서버 핸들을 밖으로 빼는 이음매가 필요하다.

핵심 한 바퀴(맥락 담기 → 실행 → 로그 → 완료)는 `pnpm test:e2e`가 빌드된 앱을 실제로 클릭해 검증한다. 3단계가 `RunManager`의 동시 실행 상한과 대기 큐, 결과 인박스, 사이드바 배지, 세션 이어서 실행을 붙였다. `needs_answer`는 이제 인박스의 "답변 필요" 카테고리로 드러난다. 4단계는 agent가 실행 중에 `127.0.0.1`의 run별 MCP 서버로 workspace 데이터를 직접 읽고 쓰는 통로를 붙였다 — `e2e/mcp.e2e.ts`가 가짜 CLI로 실제 HTTP 호출까지 왕복시켜 검증한다. **이 단계는 렌더러를 건드리지 않았다** — agent가 MCP로 만든 이슈/메모는 그 패널을 다시 마운트해야(예: 다른 화면으로 갔다 오기) 화면에 보인다. `IssuePanel`/`MemoPanel`이 run 완료를 구독하지 않기 때문이며, 설계 문서(`2026-08-12-stage4-mcp-design.md` §1 "빠지는 것")가 "UI 변경 없음"으로 명시한 의도된 경계다.

## 명령어

**npm이 아니라 pnpm을 쓴다.**

```bash
pnpm dev          # 개발 실행
pnpm test         # Vitest (core=node, renderer=jsdom)
pnpm test:e2e     # 빌드 후 Playwright로 실제 앱을 띄워 클릭 (pnpm test와 섞이지 않는다)
pnpm typecheck    # tsc --build
pnpm lint         # eslint
pnpm db:generate  # Drizzle 마이그레이션 생성
pnpm run pack     # 패키징 (pnpm pack은 내장 명령이라 다름 — run을 빼지 말 것)
```

## 절대 지켜야 할 경계 세 가지

깨지면 이후 단계가 무너진다. tsconfig와 ESLint가 강제하고 있으니 **우회하지 말고 설계를 다시 볼 것.**

1. **`core/`는 `electron`을 import하지 않는다.** 나중에 `core/`를 별도 데몬으로 떼어내기 위해서다. 경로가 필요하면 인자로 받는다 — `app.getPath()`를 core에서 부르면 안 된다.
2. **`renderer/`는 `core/`를 import하지 않는다.** `window.oneDesk` 참조는 `renderer/main.tsx` **한 곳뿐**이어야 한다. 컴포넌트는 `useClient()`를 쓴다.
3. **IPC 핸들러는 얇다.** core 메서드 호출만 하고 로직을 넣지 않는다.

확인:

```bash
grep -rn "from 'electron'" core/                        # 출력 없어야 함
grep -rn "window.oneDesk" renderer/ | grep -v main.tsx  # 출력 없어야 함
```

## 의도된 중복 — 합치지 말 것

`issue.ts`↔`memo.ts`, `useIssues.ts`↔`useMemos.ts`는 거의 같은 코드다. **실수가 아니라 사용자가 명시적으로 승인한 설계 결정이다.**

이슈에는 앞으로 상태 전이, agent 실행(run) 연결, `needs_answer`가 붙지만 메모에는 붙지 않는다. 지금 공통 헬퍼로 추출하면 다음 단계에서 되돌려야 하고, 그 비용이 중복을 유지하는 비용보다 크다.

**대신 두 쌍을 항상 대칭으로 유지한다.** 한쪽을 고치면 반드시 다른 쪽도 고친다. 어긋나면 그건 진짜 결함이다.

## 밟으면 조용히 깨지는 것들

전부 실제로 겪은 것들이다.

**preload 경로는 `../preload/index.mjs`다.** `package.json`에 `"type": "module"`이 있어 electron-vite가 preload를 `.mjs`로 내보낸다. `.js`로 "고치면" **창은 정상적으로 뜨는데 `contextBridge`가 실행되지 않아 `window.oneDesk`가 영원히 `undefined`**가 된다. 흰 창만 보고는 못 잡는다.

**`--output-format stream-json`은 `--verbose` 없이는 실행이 거부된다.** Claude Code 실측 확인.

**Claude Code는 프롬프트를 인자로 줘도 stdin을 읽는다.** 닫지 않으면 3초 대기 후 진행한다. 프로세스를 띄운 뒤 반드시 `stdin.end()`를 부를 것.

**Dynamic Workflows는 `claude -p`에서 돌지 않는다.** 헤드리스에는 워크플로 도구가 노출되지 않아 `ultracode` 키워드도 `--effort ultracode`도 무력하다(v2.1.226 실측). one-desk가 띄우는 실행에는 해당 없음.

**생성하는 권한 설정에 `ask`를 절대 넣지 않는다.** 헤드리스에서 물어보면 응답할 사람이 없어 프로세스가 그대로 멈춘다. 모든 정책은 `allow` 아니면 `deny`로만 떨어져야 한다.

**Vite dev 서버는 `127.0.0.1`로 고정돼 있다.** 기본값으로 두면 IPv6 `[::1]`에만 바인딩하는데 macOS는 `localhost`를 양쪽으로 해석해서 Electron이 `ERR_TIMED_OUT`으로 멈춘다. `electron.vite.config.ts`의 `server.host`를 지우지 말 것.

**better-sqlite3는 외래키를 기본으로 끄고 시작한다.** `openDb`의 `pragma('foreign_keys = ON')`이 없으면 스키마의 `onDelete: 'cascade'`가 전부 무효가 된다.

**`pnpm test:e2e`와 `pnpm dev`를 동시에 돌리지 말 것.** `test:e2e`는 `electron-vite build`로 시작하는데, 그 산출물 디렉토리가 `electron-vite dev --watch`가 감시하는 `out/`과 같아서 실행 중인 dev 앱의 main/preload가 e2e용 빌드로 갈아끼워진다. 반대 방향(dev가 떠 있어도 e2e는 정상 동작)은 검증돼 있으니, 손해를 보는 쪽은 항상 dev다.

**`dev` 스크립트의 `--watch`를 지우지 말 것.** `electron-vite dev`는 `--watch` 없이는 **main과 preload를 시작할 때 딱 한 번만 빌드한다.** 렌더러는 HMR로 즉시 반영되므로 화면은 멀쩡해 보이는데, `core/`나 `electron/`을 고쳐도 앱은 낡은 코드를 계속 돌린다. 2단계에서 어댑터를 고치고도 반영이 안 돼 한참 헤맸다 — `out/main/index.js`의 mtime이 소스보다 오래됐는지 보면 바로 드러난다.

**MCP 서버의 응답은 SSE(`text/event-stream`)다.** `StreamableHTTPServerTransport`가 그렇게 응답한다. `res.json()`으로 바로 파싱하면 깨진다 — 본문을 텍스트로 받아 `data:`로 시작하는 줄을 찾아 그 뒤를 JSON.parse해야 한다. `core/runner/fixtures/fake-claude-mcp.mjs`가 그 패턴이다.

**`--tools`와 `--allowedTools`는 다른 일을 한다.** `--tools`는 도구 자체를 존재하지 않게 만들어 모델이 시도조차 못 하게 하고, `--allowedTools`는 존재하는 도구를 묻지 않고 승인한다. **MCP 도구는 `--permission-mode`로 자동 승인되지 않는다** — `mcp__<serverName>` 접두사를 `--allowedTools`에 직접 얹어야 하고, 빠뜨리면 agent가 MCP 도구를 전혀 못 쓰는데 실패가 조용하다(`core/runner/adapters/claudeCode.ts`의 `mcpToolPrefixes`).

**agent가 MCP로 만든 데이터는 화면에 바로 안 뜬다.** `IssuePanel`/`MemoPanel`은 workspace를 고를 때 한 번만 목록을 불러오고, run 완료를 구독하지 않는다(4단계 설계 §1 "UI 변경 없음" — 의도된 경계). e2e에서 이를 확인하려면 그 패널을 다시 마운트시켜야 한다 — 예를 들어 인박스로 갔다가 workspace를 다시 고르면 `App.tsx`의 `view === 'workspace' && workspaceId` 조건부 블록이 unmount/remount되며 다시 읽어온다.

**`updatedAt`은 단조 증가해야 낙관적 잠금이 성립한다.** 같은 밀리초 안에 두 번 쓰면 `Date.now()`만으로는 이전 값과 같아져 "그 사이 바뀌었다"를 놓친다. `updateIfUnchanged`의 `buildPatch`는 `Math.max(Date.now(), previousUpdatedAt + 1)`로 반드시 이전 값보다 크게 만든다(`core/db/repositories/issue.ts`·`memo.ts`).

**성공한 저장이 기대값(`expected.current`)을 갱신하지 않으면 두 번째 저장이 자기 자신과 충돌한다.** `IssueDetail`/`MemoDetail`의 `persist()`는 매 성공 응답의 `result.issue.updatedAt`(또는 `memo`)으로 `expected.current`를 다시 세운다 — 안 하면 디바운스로 이어지는 다음 자동 저장이 이미 낡은 `expectedUpdatedAt`을 들고 가 스스로와 충돌 배너를 띄운다.

## 데이터 규칙

- **시각은 전부 epoch milliseconds 정수.** `Date.now()`로 명시 삽입한다. 스키마의 `unixepoch() * 1000` 기본값은 해상도가 초라서 같은 초에 만든 항목들의 정렬이 무너진다.
- **id는 `randomUUID()`.** 자동증가 정수가 아니다.
- **쓰기는 트랜잭션으로 감싼다.** 본문 INSERT와 태그 조작이 원자적이어야 한다.
- **태그로 붙이는 repo는 같은 workspace 소속인지 검증한다.** 외래키는 존재만 보장하고 소속은 보지 않는다.
- **`closedAt`은 `status`에서 파생된다.** 호출자가 따로 넘기게 하면 둘이 어긋난다.

## 컨벤션

- 들여쓰기 2칸, 함수명 camelCase, 상수 UPPER_SNAKE_CASE
- `verbatimModuleSyntax: true` — 타입 전용 import는 `import type`
- 주석과 오류 메시지는 한국어
- 테스트는 TDD로 — 실패를 먼저 확인하고 구현한다. 특히 **회귀 테스트를 추가할 때는 대상 코드를 잠시 망가뜨려 그 테스트가 실제로 실패하는지 확인할 것.** 1단계에서 트랜잭션 회귀 테스트가 다음 태스크의 검증 로직에 무력화돼, 트랜잭션을 통째로 지워도 통과하는 상태가 한동안 유지된 적이 있다.
- **배선(prop 전달)도 검증 대상이다.** 특히 `App.tsx`가 `Sidebar`·`Dock`·`InboxPanel` 같은 자식에게 내려보내는 prop 한 줄은 그 자체로 되돌릴 수 있는 변이다 — 지우거나 다른 값을 넘겨도 테스트가 잡아야 한다. 3a는 테스트 175개가 초록인 채로 핵심 약속 넷이 무방비였고, 3b는 최종 리뷰가 변이 18개를 돌려 13개가 살아남는 것을 찾았다. **두 단계 다 새어나간 자리는 예외 없이 `App.tsx`가 자식에게 내려보내는 prop 한 줄이었다.**

## 문서

| 파일 | 내용 |
|---|---|
| `docs/superpowers/specs/2026-08-07-one-desk-design.md` | 전체 설계. 데이터 모델, 실행 파이프라인, 권한, UI, 구현 순서 |
| `docs/superpowers/specs/2026-08-07-implementation-notes.md` | 실측으로 검증된 CLI 사실과 파싱 코드 (큰 파일, 필요한 부분만 grep) |
| `docs/superpowers/specs/2026-08-08-stage2-handoff.md` | 2단계 착수 전 남은 장애물 |
| `docs/superpowers/plans/2026-08-08-stage2-agent-execution.md` | 2단계 구현 계획 (14개 태스크) |
| `docs/superpowers/specs/2026-08-10-e2e-ui-driver-design.md` | e2e UI 드라이버 설계 |
| `docs/superpowers/plans/2026-08-10-e2e-ui-driver.md` | e2e UI 드라이버 구현 계획 (완료) |
| `docs/superpowers/specs/2026-08-11-stage3b-inbox-design.md` | 3b 설계 — 결과 인박스, 후속 행동표(§5) |
| `docs/superpowers/plans/2026-08-11-stage3b-inbox.md` | 3b 구현 계획 (완료) |
| `docs/superpowers/specs/2026-08-12-stage4-mcp-design.md` | 4단계 설계 — MCP 서버, 범위와 "빠지는 것"(§1) |
| `docs/superpowers/plans/2026-08-13-stage4-mcp.md` | 4단계 구현 계획 (완료, 8개 태스크) |
| `docs/superpowers/specs/2026-08-14-issue-memo-body-design.md` | 이슈·메모 본문 편집 설계 — 낙관적 잠금, 동적 3컬럼, 맥락 담기/열기 분리, 범위와 "빠지는 것"(§2) |
| `docs/superpowers/plans/2026-08-14-issue-memo-body.md` | 이슈·메모 본문 편집 구현 계획 (완료, 7개 태스크) |

**설계 문서의 결정을 코드에서 임의로 바꾸지 않는다.** 설계에 구멍이 보이면 고치지 말고 지적할 것 — 그게 더 값지다.
