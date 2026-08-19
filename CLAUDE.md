# one-desk

workspace/repo/issue/memo를 한 화면에서 관리하고, 필요한 맥락을 골라 CLI 코딩 agent(Claude Code, OpenCode)에게 넘겨 헤드리스로 실행한 뒤 결과를 앱에 기록하는 Electron 데스크톱 앱.

**현재 상태:** 4단계 완료(MCP 서버 — 호스트/도구 아홉 개/권한별 등록/커맨드 배선), `main`에 병합됨(`a19b4fd`). 이슈·메모 본문 편집(설계 `2026-08-14-issue-memo-body-design.md`)도 `main`에 병합됨(`c91438e`) — 저장소의 `updateIfUnchanged`로 낙관적 잠금, 선택한 패널이 커지는 동적 3컬럼, 맥락 담기와 열기 분리, `IssueDetail`·`MemoDetail` 본문 편집기, 그리고 `e2e/body.e2e.ts`가 IPC 왕복(`client.issues.updateIfUnchanged` → preload → `ipcMain.handle` → 저장소)을 실제로 검증한다. **상태 편집은 상세에만 있다** — 목록의 상태 칩은 읽기 전용 배지다(§5·§9). 3b 리뷰가 4단계로 이월한 것 둘 다 해소됐다: `core/`의 `console.error`가 주입식 `onError`로 바뀌었고, `resume`의 catch는 DB 장애를 더 이상 뭉개지 않는다.

**릴리스 파이프라인**(설계 `2026-08-14-release-pipeline-design.md`)이 붙었다. `v*` 태그를 밀면 GitHub Actions가 빌드해 draft 릴리스에 산출물을 올린다. **지금 빌드하는 것은 Windows portable `.exe`(x64) 하나뿐이다** — 받아서 쓰는 사람이 Windows뿐이고, release job이 `needs: build`라 다른 플랫폼이 깨지면 Windows 산출물까지 못 올라가기 때문이다(워크플로 matrix 주석에 되살리는 법이 적혀 있다). macOS는 개발 장비에서 `pnpm run pack`으로 언제든 만든다. **네이티브 모듈 때문에 크로스 컴파일은 불가능하므로** — `better-sqlite3`를 각 러너에서 그 플랫폼의 Electron ABI에 맞춰 컴파일한다. Windows 러너는 `windows-2022`로 고정돼 있다(최신 이미지의 Visual Studio 18을 node-gyp가 못 읽는다).

**agent는 MCP에 stdio로 붙는다**(설계 `2026-08-14-mcp-stdio-design.md`) — claude가 `core/mcp/bridge.mjs`를 자식 프로세스로 띄우고, 브리지가 앱 안의 HTTP 서버로 중계한다. 사내 프록시가 루프백 HTTP를 403으로 막던 환경 때문이다. `ONE_DESK_REAL_CLI=1 pnpm test realCli`가 진짜 CLI로 이 계약을 검증한다.

**MCP 서버는 이제 부팅과 함께 뜬다**(설계 `2026-08-14-mcp-always-on-design.md`). 전체 설계 §14의 "앱을 여는 행위가 아무것도 시작하지 않는다"를 사용자가 명시적으로 뒤집은 것이다 — 사이드바 하단이 `● MCP :53021`로 상태와 포트를 보여준다. 토큰은 여전히 run 단위라, run이 없는 동안 서버는 401만 돌려주는 껍데기다. **포트는 원래부터 동적이었다** — `listen(0)`이 OS에게 빈 포트를 받으므로 충돌이 구조적으로 불가능하다.

같은 작업에서 **Windows 실행 경로**가 처음으로 열렸다. 실행 파일 탐색이 `core/runner/executable.ts`로 떨어져 나와 `PATHEXT`와 폴백 디렉토리를 다루고, `.cmd` 설치본은 preflight가 명확한 메시지로 거부한다. 그 과정에서 로그 스트림의 미처리 오류가 메인 프로세스를 죽이던 결함도 잡혔다.

**대화(세션을 이어가는 대화)**가 10개 태스크로 완성돼 `main`에 병합됐다(`79a612e`, 설계 `2026-08-18-conversation-design.md`, 계획 `2026-08-18-conversation.md`). v0.2.0으로 릴리스됐다 — **첫 실행에 마이그레이션이 돈다**(`run.root_run_id` 추가 + 기존 행 백필). run은 더 이상 일회용이 아니라 전부 대화다: `run.rootRunId`가 턴을 한 대화로 묶고(승계 규칙은 "부모의 rootRunId, 부모가 없으면 자기 id"), 도크는 run이 아니라 대화 단위 탭이며(`Dock.tsx`의 `groupConversations`), 인박스 항목도 대화 하나당 한 줄로 그 대화의 마지막 턴을 보여준다 — "로그 보기"·"이어서 실행" 두 버튼이 "대화 열기" 하나로 합쳐졌다. **대화당 예약은 하나뿐이다**(설계 §3-2): 앞 턴이 도는 중에 다음 지시를 보내면 그 턴은 `pending`으로 대기 버블만 만들고 전송이 잠긴다 — `RunQueue`의 `groupKey`(대화의 root run id)가 같은 대화의 두 턴이 동시에 뜨는 것을 막는다(`claude --resume`은 이전 프로세스가 끝나야 한다). 대화록의 각 턴은 **진행 중일 때만 기본으로 펼쳐지고**, 끝난 턴은 접힌 채로 "자세히"를 눌러야 도구 호출 같은 세부가 보인다(최종 답변 자체는 항상 보인다). `e2e/conversation.e2e.ts`가 화면을 벗어나지 않고 3턴을 실제로 주고받아 이 핵심 약속 — 특히 "앞 턴이 끝나면 예약된 턴이 자동으로 뜬다" — 을 검증한다.

다음은 5단계(OpenCode 어댑터 · asset 스캔 · diff 뷰어)다. **착수를 막던 환경변수 결정은 해소됐다**(아래 절). 본문 작업이 넷으로 쪼갠 것 중 첫째였으므로 나머지 셋(마크다운 렌더링 · 검색/필터/정렬 · run 완료 구독)도 후보로 남아 있다. 대화 기능은 이 목록과 별개로 진행돼 완료·병합됐다(위 절). 그중 **run 완료 구독은 이미 해소됐으므로** 남은 것은 마크다운 렌더링과 검색/필터/정렬 둘이다.

## 환경변수 — Windows에서는 해결됐고, `Workspace.env`는 필요 없다

한동안 "5단계 착수 전에 정할 것"으로 잡아두고 **평문 SQLite에 자격 증명을 넣을지**를 막힌 결정으로 남겼던 항목이다. 대상 환경을 실측해 보니 **배관 자체가 불필요했다.**

**Windows GUI 앱은 사용자·시스템 환경변수를 정상적으로 물려받는다.** macOS의 launchd와 다르다. 실측한 환경에서 Bedrock에 필요한 변수 셋(사용 플래그·사내 게이트웨이 주소·사설 CA 번들 경로)이 모두 사용자 범위에 영구 등록돼 있었고, 어댑터의 `env: { ...process.env }`가 그대로 넘긴다.

자격 증명도 문제가 아니다. `aws sso login`이 받은 토큰은 `~/.aws/sso/cache/`에 **파일로** 저장되고 Claude Code 안의 AWS SDK가 직접 읽는다 — **앱이 자격 증명을 손에 쥘 일이 없어** 저장 위치를 정할 필요가 없다.

**macOS에서는 여전히 미해결이다.** launchd가 최소 환경만 주므로, macOS에서 Bedrock을 쓰려는 사람이 나오면 그때 `Workspace.env`나 로그인 셸 환경 가져오기를 검토한다. 실행 파일 탐색은 `core/runner/executable.ts`의 폴백이 세 OS 모두에서 해결했다.

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
gh workflow run release.yml   # 3플랫폼 산출물을 손으로 빌드 (태그 없이)
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

**agent가 MCP로 만든 데이터는 run이 끝나면 화면에 나타난다.** `useIssues`/`useMemos`가 `onRunUpdate`를 구독해, **같은 workspace의 끝난 run**에 대해 목록을 다시 읽는다. 4단계 설계 §1이 "UI 변경 없음"으로 미뤄뒀던 경계였고, MCP가 실제로 돌기 시작하면서 매번 걸려 해소했다. 같은 run의 후속 갱신(확인함/보관)으로는 다시 읽지 않는다. **`e2e/mcp.e2e.ts`는 화면을 벗어나지 않고 확인한다** — 예전처럼 인박스에 갔다 돌아오면 패널이 다시 마운트돼 구독이 죽어도 통과해 버린다.

**`updatedAt`은 단조 증가해야 낙관적 잠금이 성립한다.** 같은 밀리초 안에 두 번 쓰면 `Date.now()`만으로는 이전 값과 같아져 "그 사이 바뀌었다"를 놓친다. `updateIfUnchanged`의 `buildPatch`는 `Math.max(Date.now(), previousUpdatedAt + 1)`로 반드시 이전 값보다 크게 만든다(`core/db/repositories/issue.ts`·`memo.ts`).

**성공한 저장이 기대값(`expected.current`)을 갱신하지 않으면 두 번째 저장이 자기 자신과 충돌한다.** `IssueDetail`/`MemoDetail`의 `persist()`는 매 성공 응답의 `result.issue.updatedAt`(또는 `memo`)으로 `expected.current`를 다시 세운다 — 안 하면 디바운스로 이어지는 다음 자동 저장이 이미 낡은 `expectedUpdatedAt`을 들고 가 스스로와 충돌 배너를 띄운다.

**`node:path`의 기본 `join`은 실행 중인 OS를 따른다.** macOS에서 `join('C:\\bin', 'claude.exe')`는 `C:\bin/claude.exe`가 되고, posix로 `C:\...`를 PATH 구분자(`:`)로 쪼개면 경로가 두 동강 난다. Windows 경로 규칙을 다루는 코드는 `win32`/`posix` 변형을 **platform 인자로** 골라야 개발 장비에서 검증할 수 있다(`core/runner/executable.ts`). 반대로 **진짜 파일을 만들어 탐색시키는 테스트는 호스트 플랫폼을 그대로 써야 한다** — 실제 경로에 다른 플랫폼 규칙을 씌우면 검증하려던 것과 다른 것을 보게 된다.

**`access(path, X_OK)`는 Windows에서 실행 권한을 보지 않는다.** 파일시스템에 그 개념이 없어 존재 여부(`F_OK`)처럼 동작한다. 그래서 Windows에서는 `PATHEXT` 확장자를 붙인 후보만 만들고 확장자 없는 이름은 아예 제외한다 — 만들면 npm이 Git Bash용으로 함께 까는 sh 스크립트를 실행 파일로 골라버린다.

**`.cmd`/`.bat`는 `shell: true` 없이 spawn하면 `EINVAL`이다**(Node 18.20.2+ / 20.12.2+, CVE-2024-27980). shell을 켜면 인자가 cmd.exe의 인용 규칙을 타고, `terminate`가 죽이는 대상이 cmd.exe 껍데기가 되어 취소가 자식에 닿지 않는다. 그래서 켜지 않고 **preflight가 거부한다** — npm 전역 설치 대신 네이티브 설치 스크립트(`claude.exe`)를 쓰게 안내한다.

**`createWriteStream`의 open은 비동기다 — `error` 리스너가 없으면 앱이 죽는다.** `mkdirSync`가 방금 만든 디렉토리라도 그 사이에 사라질 수 있고, 디스크가 차거나 권한이 막혀도 실패한다. 리스너가 없으면 처리되지 않은 예외가 되어 Electron 메인 프로세스가 통째로 내려간다. `core/runner/logWriter.ts`가 이를 `ErrorSink`로 흘려보내고, 실패한 뒤 `close()`가 매달리지 않게 한다(매달리면 run이 안 끝나 동시 실행 슬롯이 영영 점유된다).

**Windows는 열린 핸들이 있는 파일을 지우지 못한다 — 테스트가 연 DB는 반드시 닫아야 한다.** POSIX는 열려 있는 파일도 unlink되므로 macOS·Linux에서는 핸들을 흘려도 `rmSync`가 조용히 성공한다. Windows에서만 `EBUSY: resource busy or locked`로 죽고, **그래서 로컬은 전부 초록인데 릴리스 CI의 Windows 잡에서만 터진다**(v0.2.0 릴리스가 실제로 이렇게 한 번 깨졌다). `openDb`는 핸들을 돌려주지 않는 것처럼 보이지만 반환한 drizzle 인스턴스의 `$client`가 그것이다 — `core/db/open.test.ts`의 기존 테스트들이 이미 `db.$client.close()`를 쓰고 있으니 그 패턴을 따를 것.

**`productName`이 사용자 데이터 위치를 정한다 — `appId`가 아니다.** Electron은 `userData`를 `appData` + 앱 이름으로 만들고 앱 이름은 `productName`을 우선한다. `electron-builder.yml`의 `productName: one-desk`를 보기 좋게 바꾸면 기존 사용자의 DB 디렉토리를 앱이 더 이상 보지 않는다.

**MCP는 stdio로 간다 — HTTP가 아니다.** claude가 `core/mcp/bridge.mjs`를 자식 프로세스로 띄우고 표준입출력으로 JSON-RPC를 주고받으면, 브리지가 그것을 앱 안의 HTTP 서버로 중계한다. **HTTP로 직접 붙던 시절에는 사내 프록시가 루프백 요청을 403으로 막아 그 환경에서 아예 못 썼다** — 같은 포트에 `curl`은 401을 받는데 agent만 실패하는 증상이었다. Node의 `http`/`fetch`는 `HTTP_PROXY`를 자동으로 쓰지 않으므로 브리지는 통과한다. **브리지는 멍청한 파이프다** — 권한 게이팅과 도구 등록은 전부 서버에 남는다.

**브리지는 `extraResources`로 나간다.** 번들되지 않는 원본 `.mjs`이고, `command`는 Electron 바이너리에 `ELECTRON_RUN_AS_NODE=1`이다(패키징된 앱에 독립 `node`가 없다). asar 안에 두지 않는다 — asar 내부 경로를 자식 프로세스로 실행할 수 있는지가 플랫폼마다 미묘하다.

**사내 프록시가 잡힌 환경에서는 루프백을 예외로 못박아야 한다.** MCP 서버는 항상 `127.0.0.1`인데 `NO_PROXY`에 루프백이 빠져 있으면 agent의 MCP 요청이 프록시로 나가 30초 뒤 타임아웃으로 죽는다. **같은 포트에 `curl`은 401을 받는데 agent만 못 붙는 증상**으로 나타난다 — 그게 이 원인을 가리키는 신호다. `claudeCode.ts`의 `withLoopbackBypass`가 기존 값을 보존하며 `127.0.0.1`·`localhost`·`::1`을 더한다. NO_PROXY는 목적지만 정하므로 원격 호출에는 영향이 없다.

**`execFileSync`는 이벤트 루프를 막는다 — 같은 프로세스의 서버를 죽인다.** MCP 서버가 붙어 있는 테스트에서 CLI를 동기로 띄우면 서버가 연결을 하나도 받지 못해 클라이언트가 30초 타임아웃으로 죽는다. **제품이 멀쩡한데 `status: failed`가 나온다.** 실제로 이 함정에 빠져 존재하지 않는 결함을 한참 쫓았다 — `core/mcp/realCli.test.ts`가 비동기 `spawn`을 쓰는 이유다.

**픽스처에 서버 이름을 리터럴로 박지 않는다.** `fake-claude-mcp.mjs`가 `.mcpServers.onedesk`를 하드코딩하고 있어서 `MCP_SERVER_NAME`을 바꾸자 `cfg`가 `undefined`가 되고 e2e가 통째로 깨졌다. **단위 테스트 412개는 전부 초록이었다.** 지금은 `Object.values(...)[0]`로 유일한 값을 집는다.

**ad-hoc 서명(`identity: '-'`)은 hardened runtime의 라이브러리 검증에 걸린다.** Team ID가 없어 Electron Framework조차 로드되지 않고 앱이 아예 안 뜬다 — `build/entitlements.mac.plist`의 `com.apple.security.cs.disable-library-validation`이 그것을 푼다. **설정이 문법에 맞는 것과 앱이 열리는 것은 다르다** — DMG를 실제로 열어봐야만 드러난다.

**같은 대화의 두 턴은 동시에 뜨면 안 된다** — `claude --resume`은 이전 프로세스가 끝나야 한다. `RunQueue`의 `groupKey`가 막고 있다.

**`root_run_id`를 NOT NULL로 "고치지" 말 것** — SQLite에서 그러려면 테이블을 다시 만들어야 하고, 그 `DROP TABLE run`이 `run_context_item`의 cascade를 태워 모든 맥락 기록을 지운다. 마이그레이션의 `PRAGMA foreign_keys=OFF`는 트랜잭션 안이라 무시된다.

**e2e에서 `getByRole('button', { name: '실행' })`은 exact 없이 쓰면 강제로 실패한다.** substring 매칭이 기본이라 도크 토글("▾ 실행"/"▴ 실행")과 슬롯 표시기(`aria-label="실행 슬롯"`)까지 같이 걸려 strict mode 위반이 된다 — run-start 버튼을 잡으려면 `{ name: '실행', exact: true }`가 필수다(태스크 8이 라벨을 "▶ 실행"에서 "실행"으로 줄이면서 처음 생긴 충돌).

**대화의 첫 턴을 시작한 직후 도크 탭 텍스트로 "떴다"고 판단하지 말 것.** Dock의 `view`/`pickedId` 전환(RunPanel의 `onStarted` 콜백, 동기)과 `runs` 목록 갱신(`useRuns`의 `onRunUpdate` IPC push, 비동기)이 서로 다른 경로로 온다. 도크 탭(`conversations.map(...)`)은 `runs`가 갱신되는 즉시 그려지지만, 그 순간 `ConversationPanel`은 아직 `key='new'`인 옛 인스턴스일 수 있다 — 탭 텍스트가 보인다고 바로 다음 입력을 채우면 곧 재마운트될 RunPanel에 채워 넣어 버려 전송이 빈 프롬프트로 막힌다(실행 버튼이 계속 disabled). 대화록 안의 `.turn-user` 텍스트로 기다려야 재마운트가 끝난 안정된 인스턴스를 보장한다(`e2e/conversation.e2e.ts`).

**인박스 소속은 뿌리의 `reviewedAt`으로 판정한다.** 확인·보관·취소 같은 "인박스에서 내리는" 동작은 전부 **뿌리(root run) id**에 찍어야 한다. 턴 id에 찍으면 아무 일도 일어나지 않는다 — 대화는 인박스에 그대로 남는다. 실제로 `execution.cancel()`이 이 자리에서 걸렸다: 예약된 뒤 턴을 취소하면서 그 턴의 id에 확인 표시를 찍었더니, 뿌리는 계속 미확인으로 남아 대화 전체가 "대기 중 취소됨"으로 인박스에 다시 떴다(C-1-a). 반대로 뿌리에 찍는 것만으로는 새 문제가 생긴다 — `markReviewed`는 한 번 찍히면 스스로 지워지지 않으므로, 뿌리(=첫 턴)를 실행 중에 취소하면 그 대화는 세션이 살아 있어 계속 이어갈 수 있는데도 이후 어떤 턴도(`needs_answer`로 멈춘 턴을 포함해) 인박스에도 배지에도 다시 나타나지 않는다(C-1-b). 그래서 반대쪽 절반이 반드시 같이 있어야 한다: **`create()`가 `parentRunId`를 받으면(=기존 대화에 새 턴을 잇는 것이면) 뿌리의 `reviewedAt`/`reviewedKind`를 지운다.** 확인 표시를 찍는 자리(취소·확인함·보관)와 지우는 자리(새 턴 생성)가 항상 짝을 이뤄야 한다 — 한쪽만 고치면 반대 방향으로 조용히 깨진다.

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
| `docs/superpowers/specs/2026-08-14-release-pipeline-design.md` | 릴리스 파이프라인 설계 — 3플랫폼 빌드, Windows 실행 경로, 서명 |
| `docs/superpowers/plans/2026-08-14-release-pipeline.md` | 릴리스 파이프라인 구현 계획 (5개 태스크) |
| `docs/superpowers/specs/2026-08-14-mcp-always-on-design.md` | MCP 상시 기동과 상태 표시 — 전체 설계 §14를 뒤집은 근거(§2) |
| `docs/superpowers/specs/2026-08-14-mcp-stdio-design.md` | MCP를 stdio로 옮긴 설계 — 프록시가 막던 실측 근거(§1), 브리지 구조(§2) |
| `docs/superpowers/specs/2026-08-18-conversation-design.md` | 대화 설계 — 일회용 run을 이어지는 대화로, `rootRunId` 데이터 모델(§2), 큐 직렬화(§3), 도크/인박스 UI(§4·§5) |
| `docs/superpowers/plans/2026-08-18-conversation.md` | 대화 구현 계획 (완료, 10개 태스크) |

**설계 문서의 결정을 코드에서 임의로 바꾸지 않는다.** 설계에 구멍이 보이면 고치지 말고 지적할 것 — 그게 더 값지다.
