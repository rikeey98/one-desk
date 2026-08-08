# 2단계 착수 전 처리 목록

작성일: 2026-08-08
근거: 1단계(`feature/stage1-skeleton-and-data`) 브랜치 전체 리뷰

1단계는 워크스페이스·repo·이슈·메모 관리까지 완성됐다. 2단계는 여기에 agent 실행 파이프라인을 얹는다 — `AgentAdapter`, 프로세스 spawn, 스트림 파싱, 하단 도크의 실시간 로그.

이 문서는 **2단계 코드를 쓰기 전에 손봐야 할 것**을 모은 것이다. 전부 1단계 리뷰에서 나왔고, 대부분 지금은 잠복 상태지만 2단계 코드가 올라가는 순간 실효 결함이 된다.

## 지금 손대야 싼 것

### 1. `main.ts`에 윈도우 참조가 없다

`mainWindow`가 `createWindow()`의 지역 변수다. 설계 §4의 단방향 이벤트 경로

```
core/runner (EventEmitter) → electron/ipc (webContents.send) → renderer
```

를 놓으려면 `webContents.send`를 부를 곳이 있어야 한다. 모듈 스코프 참조를 두고 `registerIpc(core, getWindow)`로 시그니처를 바꾸는 편이 낫다. 지금은 3줄이고, run 이벤트 코드를 쓰기 시작한 뒤에는 그 코드를 다시 손대야 한다.

### 2. 생명주기 훅이 하나도 없다

`app.on('before-quit')`도 `db.close()`도 없다. 스펙이 요구하는 두 동작을 걸 자리가 아직 없다.

- §6 — 앱 종료 시 실행 중인 agent 프로세스를 전부 정리
- §11 — 앱 시작 시 `running`/`pending` 상태인데 프로세스가 없는 run을 `interrupted`로 정리

**여기에 `db.close()`를 함께 붙이면 WAL 체크포인트가 결정적이 되어 백업 안전성도 올라간다.** 두 문제를 한 자리에서 해결할 수 있다.

### 3. 리포지토리 create/update에 트랜잭션이 없다

재현된 실패:

```ts
issues.create({ workspaceId, title: '고아 이슈', repoIds: ['없는-repo'] })
// issue INSERT 성공 → replaceTags가 FOREIGN KEY constraint failed로 throw
// 호출자에게는 실패로 보이지만 DB에는 태그 없는 이슈가 남는다
```

1단계 UI는 항상 유효한 `repoId`만 넘기므로 도달 불가능하다. **하지만 4단계 MCP의 `create_issue(title, body, repo_ids)`는 agent가 임의의 id를 넘길 수 있다.** 그 전에 `db.transaction()`으로 감싸야 한다.

### 4. 태그가 workspace 경계를 넘을 수 있다

재현된 실패: workspace A의 이슈에 workspace B의 repo id를 `repoIds`로 넘기면 그대로 저장된다. 외래키는 repo의 **존재**만 보장하고 소속은 보지 않는다.

스펙 §8은 "agent는 자신의 workspace 밖 데이터를 읽을 수도 수정할 수도 없다"를 MCP의 보안 경계로 약속한다. `replaceTags`에 workspace 검증이 없으면 그 약속이 깨진다.

### 5. `run_context_item`에 cascade를 관례적으로 붙이지 말 것

현재 외래키 7개가 전부 `ON DELETE cascade`이고 1단계에서는 이게 맞다. 하지만 같은 관례를 `run_context_item`에 적용하면 **이슈를 지웠을 때 그 이슈를 첨부했던 과거 run의 기록이 조용히 사라진다.** 스펙 §5가 asset에 대해 경고한 바로 그 상황이다. 2단계 스키마를 설계할 때 의식적으로 판단해야 한다.

### 6. 렌더러에 오류 표시 경로가 없다

`client.X.create()`가 거부되면 `await`가 throw하고 `finally`에서 busy만 풀린다. 사용자에게는 아무것도 표시되지 않고 콘솔에 unhandled rejection만 남는다.

1단계에서는 실질적 트리거가 디스크 오류 정도라 위험이 낮다. **2단계는 프리플라이트 실패·spawn 실패·CLI 미발견처럼 오류가 정상 흐름이므로 반드시 필요하다.**

## 해결된 것 — dev 서버 `ERR_TIMED_OUT`

1단계 종료 직후 `pnpm dev`가 다음으로 실패했다.

```
electron: Failed to load URL: http://localhost:5173/ with error: ERR_TIMED_OUT
```

**원인은 IPv4/IPv6 주소 계열 불일치였다.** `lsof`로 확인한 결과:

```
node ... IPv6 ... TCP [::1]:5173 (LISTEN)
```

Vite 7은 `server.host`를 지정하지 않으면 IPv6 `[::1]`에만 바인딩한다. 그런데 macOS의 `/etc/hosts`는 `localhost`를 IPv4(`127.0.0.1`)와 IPv6(`::1`) 양쪽으로 해석하므로, Electron이 `http://localhost:5173/`을 열 때 IPv4를 먼저 시도했다가 응답 없이 타임아웃했다.

`ERR_CONNECTION_REFUSED`가 아니라 `ERR_TIMED_OUT`이었던 것이 단서였다 — 프록시도 방화벽도 아니었고(둘 다 확인함), 주소 계열이 어긋난 것이었다.

**해결**: `electron.vite.config.ts`의 renderer에 `server: { host: '127.0.0.1', port: 5173, strictPort: true }`를 추가해 IPv4로 고정했다. 검증:

| 설정 | 바인딩 |
|---|---|
| 기본값 (host 미지정) | `IPv6 [::1]:5173` |
| `host: '127.0.0.1'` | `IPv4 127.0.0.1:5199` |

`strictPort: true`를 함께 넣은 이유는, 포트가 점유됐을 때 Vite가 조용히 다른 포트로 옮겨가면 Electron이 예전 URL을 열어 같은 증상이 다시 나타나기 때문이다. 그럴 땐 차라리 실패하는 편이 낫다.

**같은 증상이 다시 나오면 먼저 `lsof -nP -iTCP:5173 -sTCP:LISTEN`으로 바인딩 주소부터 확인할 것.**

## 이월된 사소한 것들

우선순위 낮음. 관련 코드를 건드릴 때 함께 처리하면 된다.

- **git author가 호스트명 유래** (`yonghyun-kwon@y-hyun-MacBookAir.local`). 원격에 푸시하기 전에 `git config user.email`을 설정해야 커밋이 계정에 연결된다.
- **백업 파일이 무한 누적된다.** `openDb`가 열릴 때마다 `.bak`이 하나씩 생기고 정리 로직이 없다. 보관 개수 상한을 두는 편이 낫다.
- **`CreateRepoInput`에 `sortOrder`가 없어 항상 0이다.** 실질적인 정렬은 이름순뿐이다. repo 순서 변경 UI를 도입할 때 함께 처리한다.
- **`memo.test.ts`에 `repoIds` 갱신 테스트가 없다.** `issue.test.ts`에는 있다. 의도된 중복 쌍이므로 테스트도 대칭이어야 드리프트를 잡는다.
- **`makeTestDb()`의 `migrationsDir: 'drizzle'`이 cwd 상대 경로다.** 지금은 vitest가 항상 루트에서 돌아 문제없지만 실행 위치에 묶여 있다.
- **잔재 파일**: `resources/icon.png`가 어디서도 참조되지 않는다(electron-builder는 `build/`를 쓴다). prettier 설정 3종이 있으나 `prettier`가 devDependencies에 없고 `format` 스크립트도 없다.

## 1단계에서 유지해야 할 것

2단계에서 무심코 완화하기 쉬운 것들이라 적어둔다.

**경계가 관례가 아니라 구조로 강제된다.** `tsconfig.web.json`에 `@core/*` 경로를 아예 넣지 않은 것과 ESLint `no-restricted-imports`의 이중 방어다. 사람이 지키는 규칙이 아니라 컴파일러가 지키는 규칙이라, 2단계에서 코드가 늘어도 무너지지 않는다. **여기는 절대 완화하지 말 것.**

**채널 상수 단일 출처.** preload와 핸들러가 같은 `CHANNELS` 객체를 참조해서, 오타로 인한 무응답 채널이 구조적으로 불가능하다. 2단계에서 채널이 두 배가 돼도 이 패턴이면 안전하다.

**의도된 중복이 실제로 "동일한" 중복이다.** `issue.ts`와 `memo.ts`의 공통 항목 필터 쿼리가 완전히 일치하고 `useIssues`/`useMemos`도 대칭이다. 승인된 중복이 드리프트하지 않는 것이 이 결정을 정당화한다. 한쪽을 고치면 반드시 다른 쪽도 고쳐야 한다.

**`closedAt`이 `status`에서 파생된다.** 호출자가 둘을 어긋나게 만들 수 없다. `needs_answer`를 추가할 때도 같은 원칙을 지키는 게 좋다.

---

## 처리 완료 (2026-08-08, `feature/stage1-hardening`)

위 6가지 선행 작업은 모두 처리됐다. 최종 브랜치 리뷰에서 태스크 경계 문제 4건이 추가로 나와 함께 고쳤다.

| 항목 | 커밋 |
|---|---|
| 리포지토리 트랜잭션 | `d2ac723` |
| workspace 경계 검증 | `bb3d931` |
| 렌더러 오류 표시 | `5bbd01d` |
| 윈도우 참조 + 생명주기 | `d70f0e9` |
| minor 정리 + cascade 기록 | `6003bdc` |
| update 경로 롤백 회귀 테스트 | `49fef57` |
| 전송 계층 오류 문자열 언래핑 | `d4352c0` |
| DB close를 `will-quit`으로 이동 | `53b9e7d` |
| prettier 무시 범위 정정 | `400ac34` |

특히 짚어둘 것이 하나 있다. **트랜잭션을 넣을 때 심은 회귀 테스트가, 그 다음 태스크에서 경계 검증을 추가하자 무력화됐다.** 존재하지 않는 repo id도 검증에서 먼저 걸려 INSERT 자체가 실행되지 않게 됐고, 롤백할 것이 없어졌다. 그 결과 트랜잭션 4개를 통째로 지워도 테스트가 전부 통과하는 상태가 한동안 유지됐다. `update` 경로는 UPDATE가 검증보다 먼저 실행되므로, **update 경계 위반 롤백 테스트만이 트랜잭션을 실제로 검증한다.** 이 테스트를 지우지 말 것.

## 2단계 구현 중 드러난 것 (2026-08-09, `feature/stage2-agent-execution`)

계획서(`plans/2026-08-08-stage2-agent-execution.md`)를 실행하면서 나온 결함과 결정이다. 계획서 본문은 고치지 않았으므로 다음에 읽을 때 여기를 함께 볼 것.

### 계획서의 결함 넷

1. **`Omit<RunEvent, 'seq'>`가 payload를 전부 날린다.** Omit은 유니온에 분배되지 않고 `keyof`가 멤버들의 교집합만 주므로 결과가 `{ runId; at; type }`으로 쪼그라든다. 런타임 테스트는 전부 통과하는데 타입만 무의미해지는 종류의 결함이다. `shared/events.ts`에 분배형 `RunEventInit`을 두고 어댑터 반환 타입으로 쓴다.
2. **`renderer/store/runEvents.test.ts`가 실행되지 않는다.** vitest renderer 프로젝트가 `*.test.tsx`만 포함해서, `.ts` 테스트는 core·renderer 어느 쪽에도 안 잡히고 **없는 채로 성공 보고된다**(실측: 93 vs 102). include를 `*.test.{ts,tsx}`로 넓혔다.
3. **`logPath`가 두 곳에서 따로 계산됐다.** 게다가 계획서의 실행 서비스는 `randomUUID()`로 만든 id로 경로를 조립한 뒤 `runs.create()`가 **또 다른 id**를 만들게 되어 있어, DB의 `log_path`가 존재하지 않는 디렉토리를 가리켰다. `manager.logPathFor(runId)`를 단일 출처로 삼고 `CreateRunInput.id`로 id를 먼저 정한다.
4. **`manager.start()` 거부 시 run이 영원히 `running`으로 남았다.** `markStarted` 뒤 예외가 나면 `markFinished`가 없어 재시작 전까지 정리되지 않는다. 실패 경로에서 `failed`로 기록한다.

(계획서가 스스로 경고한 `cancels.set` 위치 버그도 지적대로 존재했다. 등록을 spawn 직후로 옮기고 종료 시 지운다.)

### 설계 §5의 구멍 — `ON DELETE SET NULL`은 표현할 수 없다

설계 §5는 `run_context_item`에 `ON DELETE SET NULL`을 요구하지만, `item_id`는 repo·issue·memo·asset을 함께 가리키는 **다형 참조라 외래키 자체를 걸 수 없다.** 그래서 이슈를 지워도 죽은 id가 그대로 남는다.

읽는 시점에 걸러내 같은 관측 동작(run 기록은 남고 맥락 항목만 빠짐)을 만들었다. **다만 설계가 약속한 "화면에서 '삭제된 이슈'로 표시한다"는 이 방식으로는 불가능하다** — 표시하려면 지워졌다는 사실을 API가 실어 날라야 한다. 3단계에서 인박스가 지난 run의 맥락을 렌더링할 때 다시 판단할 것.

### 바꾼 계약 — `execution.start()`는 완료를 기다리지 않는다

계획서 Task 11은 `start()`가 끝난 run을 돌려주게 되어 있었다. 그러면 IPC 한 번이 몇 분씩 막히고, 그동안 렌더러는 run의 id를 몰라 **도크 탭도 취소 버튼도 만들 수 없다.** 설계 §9의 "탭 하나가 run 하나"와 어긋난다.

`markStarted` 직후의 `running` run을 즉시 반환하고, 완료는 `core.onRunUpdate` → `event:runUpdate` 채널로 알린다. 3단계의 대기 큐(`pending` 표시)도 이 형태를 그대로 쓴다.

### 종단 검증 결과

실제 Claude Code(v2.1.226)로 확인했다. 검증 스크립트는 스위트에 포함하지 않았다(실행마다 진짜 CLI를 부른다).

| 확인 | 결과 |
|---|---|
| 읽기 전용 실행이 끝까지 흐른다 | `succeeded`, 세션 id 확보, `result` 수신 |
| seq 단조 증가 | 통과 |
| DB `log_path`에 실제 JSONL 파일 | 통과 (2줄 이상) |
| 앱 재시작 후 로그 재현 | `readLog`가 `result` 포함해 재현 |
| 실제 프로세스 취소 | SIGTERM으로 `canceled` |
| 프리플라이트 | PATH 탐색 성공 / 잘못된 경로 거부 |
| 유령 run 정리 | 재시작 시 `interrupted` |
| `pnpm dev` | `127.0.0.1:5173` 바인딩, Electron 기동, `ERR_TIMED_OUT` 없음 |

**GUI 클릭 경로는 사람이 확인해야 한다** — 항목을 눌러 칩이 담기는지, 도크에 로그가 실시간으로 흐르는지, 탭 전환, 취소 버튼. 그 아래 계층은 전부 자동 검증했다.

## 2단계 착수 시 남은 장애물

1. **`registerIpc` 시그니처.** `getMainWindow()`가 `electron/main.ts`에서 export되어 있어, `electron/ipc/runs.ts`가 이를 import하면 `main.ts → ipc/index.ts → ipc/runs.ts → main.ts` 순환이 생긴다. 호이스팅 덕에 대개 동작하지만 `main.ts`는 최상위 부수효과를 가진 진입점이라 평가 순서에 기대는 구조가 된다. `registerIpc(core, getWindow)`로 주입하는 편이 낫다.
2. **`OneDeskClient`에 구독 API가 없다.** 현재 preload는 invoke 전용이다. 설계 §4의 `events: { onRunEvent(cb): Unsubscribe }`를 넣으려면 `ipcRenderer.on` + unsubscribe 함수를 contextBridge로 되돌리는 패턴이 필요한데 아직 선례가 없다.
3. **읽기 경로 오류가 조용히 사라진다.** `useIssues`/`useMemos`/`useRepos`/`useWorkspaces`가 `useEffect(() => { void refresh() }, [refresh])` 패턴이라 `list()` 실패 시 unhandled rejection만 남고 화면은 빈 목록이 된다. `useWorkspaces`는 더 나쁘다 — `setLoading(false)`가 `await` 뒤에 있어 실패하면 `loading`이 영원히 true, 사이드바가 "불러오는 중…"에서 멈춘다. **이 패턴이 run 목록 로딩에 그대로 복제될 것이다.**
4. **단일 인스턴스 잠금이 없다.** `app.requestSingleInstanceLock()`이 없다. 지금은 두 인스턴스가 같은 SQLite를 열어도 WAL이 감당하지만, agent 프로세스와 run 상태가 붙으면 두 인스턴스가 같은 run을 spawn하고 서로의 종료 정리가 상대를 덮어쓴다.
5. **`backupIfNeeded`가 이름과 달리 "needed"를 판정하지 않는다.** 마이그레이션 필요 여부와 무관하게 매 오픈마다 전체 파일을 복사하고 정리 로직이 없다. 지금 DB가 90KB라 실해는 없다.
6. **패키징 빌드의 종료 경로가 미검증이다.** dev 모드에서만 WAL 체크포인트를 확인했다. agent 프로세스 정리가 붙으면 패키징 종료를 한 번 실측할 것.
