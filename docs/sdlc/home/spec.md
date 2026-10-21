# Spec: 앱을 열면 "오늘 할 일"이 보이는 홈

- 출처: `intent.md`
- 작성자: 권용현 (초안: Claude)
- 상태: 승인 (2026-10-21, 사용자 — "승인하고 구현 시작해줘"). plan §0의 개정 여덟을 같이 승인했고 아래에 반영돼 있다(각 자리에
  "**plan 개정 N**"으로 표시).
- 시안: https://claude.ai/artifact/ST6FQPHU8XPSKXTREZHPVN 셋째 줄 (E1 · E2 · E3)

## 0. intent의 미해결 질문에 대한 답

| 질문 | 답 |
|---|---|
| 앱을 열면 어디로 가나 | **늘 홈.** 돌고 있는 대화는 홈 맨 위 카드다. 마지막 화면을 기억하는 설정은 두지 않는다. |
| "마지막으로 보낸 workspace · repo"의 자리 | `app_setting`의 키 `home.lastTarget`(`{"workspaceId","repoId"}` JSON). 마이그레이션 없음. workspace·repo가 지워졌으면 무시하고 첫 workspace의 첫 repo. |
| 홈 배지가 세는 것 | 답변 필요 + 실패 + 중단(= `INBOX_RULES[*].badge`) **+ 정리 안 된 이슈 + 오래 안 본 이슈.** 넷 다 "오늘 할 일"의 줄이고, 줄 수가 배지다. |
| "오늘"의 경계 | 이 장비의 로컬 자정. 리포트의 `startOfDay`(`renderer/report/period.ts`)를 그대로 쓴다. |
| 준비 단계의 "끝났다"에 OpenCode | **어느 하나**가 실행 파일 · 인증 · 모델까지 통과하면 끝. |
| 준비 단계를 다시 보는 길 | 두지 않는다. 단계마다 가는 곳이 이미 설정 화면이다. |

## 1. 범위

**들어가는 것.** 사이드바의 `홈` 진입점과 배지, 새 화면 `HomePanel`(할 일 · 돌고 있는 것 · 타임라인 · workspace 카드 · 오늘 완료 ·
새 대화 카드), 처음 켰을 때의 준비 단계, core의 홈 요약 한 자리(`core.home.summary`), 앱 설정 키 하나, 첫 화면을 홈으로.

**빠지는 것.** intent "범위 밖" 그대로 — 홈에서의 편집, 타임라인 조작, OS 알림, 다른 컨셉. 그리고 **MCP 도구 추가 없음**, **스키마
변경 없음**(`app_setting`은 키-값 표라 키를 더하는 것은 마이그레이션이 아니다 — agent-path-default FR-2와 같다).

## 2. 기능 요구사항

### (A) core — 홈 요약

- **FR-1** `core.home.summary(now)`가 모든 workspace를 넘어 홈이 그릴 것을 한 번에 돌려준다. 읽기 전용이고 **IPC에만** 열린다 —
  MCP `deps`에 넘기지 않는다(전체 설계 §8, period-report FR-1과 같은 규칙). 소스는 `reports.build`와 같은 묶음(`workspaces.list` ·
  `repos.list` · `issues.list` · `runs.list` · `runs.inbox`)이고, 순수 함수 `core/home/summary.ts`가 그것을 받아 계산한다 — DB 없이
  단위 테스트한다.
- **FR-2** 요약의 모양:
  ```ts
  interface HomeSummary {
    running: HomeRunning[]          // 실행 중 턴 — 대화마다 하나 (conversation.active)
    queued: number                  // pending(예약 + 슬롯 대기)
    slots: { used: number; limit: number }
    todos: HomeTodo[]               // (B) 순서대로
    timeline: HomeTimelineRow[]     // workspace마다 한 줄, 오늘의 대화
    workspaces: HomeWorkspace[]     // 열림·진행 중·오늘 완료·repo별 상태
    doneToday: HomeDoneIssue[]
    setup: HomeSetup                // (D) — 준비 단계
  }
  ```
  세부 필드는 §3. 제목은 `shared/conversationTitle.ts`의 사다리(도크·리포트와 같은 제목), 대화 상태는 `representativeTurn`(인박스·
  도크와 같은 턴), 실행 중은 `conversation.active`와 같은 판정(running > pending)이다. **따로 적지 않는다.**
- **FR-3** 할 일(`todos`)은 네 종류이고 이 순서다:
  1. `needs-answer` — 답변 필요 대화 (대화마다 한 줄)
  2. `failed` · `interrupted` — 실패·중단된 대화 (대화마다 한 줄). 판정은 `inboxCategory` → `INBOX_RULES[cat].badge`이고,
     **인박스에서 내려간 대화(`reviewedAt`)는 빠진다** — `runs.inbox()`가 주는 목록 그대로다.
  3. `untriaged` — 정리 안 된 이슈 (**workspace마다 한 줄**, 개수와 앞 세 제목). 판정은 `triagedAt IS NULL` — `issueGroups.triageQueue`와
     같은 술어이고 core에도 같은 모양으로 둔다(§5 NFR-2).
  4. `stale` — 오래 안 본 이슈 (**workspace마다 한 줄**, 개수와 앞 세 제목). 판정은 `isStale`과 같다: `status !== 'done'` 그리고
     `now - (seenAt ?? createdAt) > STALE_MS`(14일). **`STALE_MS`는 `shared/`로 옮겨 core와 renderer가 같은 상수를 쓴다.**
  종류 안의 순서는 1·2는 인박스와 같은 순(대표 턴 `endedAt` 최신 먼저), 3·4는 workspace 목록 순이다.
- **FR-4** 홈 배지 = `todos.length`. 사이드바가 받는 수이고(`InboxCounts`와 **다른 값**), 바뀌는 계기는 인박스 배지와 같다 — run 종료·
  확인·취소(`INBOX_UPDATE`) **그리고** 이슈 변경(`event:itemChanged` kind `issue`). core는 push하지 않고 렌더러가 그 두 이벤트에 다시
  묻는다(§3).
- **FR-5** 타임라인은 workspace마다 한 줄이고, 줄에는 **오늘**(`[startOfDay(now), now]`) 안에 턴이 하나라도 있는 대화의 막대가 있다 —
  막대는 대화의 `conversationSpan`을 오늘로 클립한 것, 색은 대표 턴 상태(`running`은 `active`)다. core는 epoch ms로 주고 "오늘"의
  경계는 **렌더러가 넘긴 `from`**이다(FR-1의 `now`와 함께 `{ now, dayStart }`) — core가 로컬 자정을 알면 안 된다(시간대는 화면의 것).
- **FR-6** workspace 카드: 열림(`open`)·진행 중(`doing`)·오늘 완료(`closedAt >= dayStart` 이고 `done`)·정리 안 됨, repo마다
  `{ repoId, name, open, conversations, state }` — `state`는 그 repo의 대화들(`repoOfConversation`과 같은 판정 — `core/period/`가 아니라
  `shared/`로 올린다, §6) 중 가장 급한 것: running > needs-answer > failed·interrupted > done > none.
- **FR-7** `home.lastTarget` 읽기/쓰기: `core.home.lastTarget()`·`setLastTarget({ workspaceId, repoId })`. **쓰는 자리는 실행 서비스의
  `start`가 아니라 렌더러의 전송 성공 콜백이다** — 자동 재시도·다시 보내기·MCP가 만든 run이 "마지막으로 보낸 곳"을 바꾸면 안 된다.
  읽을 때 workspace나 repo가 없으면(지워짐) null을 주고 화면이 폴백한다.

### (B) 렌더러 — 할 일 목록

- **FR-8** `HomePanel`은 그리기만 한다. 줄의 행동은 전부 App이 내리는 **필수 prop**이다(CLAUDE.md "배선도 검증 대상"):
  `onOpenConversation(workspaceId, conversationId)` · `onResend(workspaceId, runId)` · `onTriage(workspaceId)` ·
  `onOpenIssues(workspaceId, sort: 'stale')` · `onOpenWorkspace(workspaceId)` · `onStartConversation(target, prompt)`.
- **FR-9** 줄마다 버튼 하나(실패·중단만 둘):
  | 종류 | 버튼 | 가는 곳 |
  |---|---|---|
  | 답변 필요 | `답하기` | 그 workspace 화면, 도크의 그 대화(`focusConversationId`), 입력칸 포커스(대화록 "답하기"와 같다 — `focusNew`가 아니라 답 포커스. **plan 개정 3**: Dock의 필수 일회성 prop `focusReply`가 `focusConversationId`와 함께 서고 `onFocusConsumed`로 같이 치워지며, ConversationPanel이 FR-44의 `inputRef`에 포커스한다) |
  | 실패·중단 | `다시 보내기` · `대화 열기` | `runs.resume`(인박스의 "다시 실행"이 아니라 대화록의 "다시 보내기" — 같은 대화) / 대화 열기 |
  | 정리 안 됨 | `훑기` | 그 workspace 화면, repo 거름 없음, 이슈 패널이 **훑기를 시작한 상태**(`IssuePanel`의 새 일회성 prop `startTriage` + `onStartTriageConsumed` — ux-polish FR-9의 `focusAdd`와 같은 모양) |
  | 오래 안 본 | `방치 이슈 보기` | 그 workspace 화면, 이슈 패널 (묶기 축은 그대로, 상세 열지 않음) |
  **줄이 빠지는 때**는 요약을 다시 읽을 때다(FR-4의 두 이벤트) — 낙관적으로 미리 지우지 않는다(실패하면 거짓이 된다).
- **FR-10** 돌고 있는 것: 대화마다 제목 · workspace · repo · 턴 수 · 경과 · 지금 도는 도구 · 마지막 텍스트 한 줄. `대화 열기`·`멈추기`
  (멈추기는 `conversation.active`의 running 턴 — 도크의 세 멈추기와 같은 턴, 예약은 건드리지 않는다). 경과·도구·텍스트는 **홈이
  run 이벤트 스토어를 보지 않고** 요약의 스냅샷(`startedAt`·마지막 이벤트의 도구 이름·`resultText` 대신 마지막 text — manager가
  `runs.list`에 주는 값은 없다, §6의 1)으로만 그린다. 비어 있으면 한 줄 "돌고 있는 대화 없음". **plan 개정 7** — 요약은 push가
  아니므로 도는 턴이 있는 동안 홈은 **2초마다** 요약을 다시 읽고(타이머 — run 이벤트마다 긁지 않는다) 경과 시간만 `useNow`로 매초
  센다. 그 밖의 계기는 `onRunUpdate`·`onInboxUpdate`·`onQueueUpdate`·`onItemChanged(issue)`다. `멈추기`의 접근성 이름은 `<제목> 실행
  멈추기`다(plan 개정 4).
- **FR-11** 새 대화 카드: 입력칸 + 대상 알약(`<workspace> · <repo> ▾`, 메뉴로 바꿈) + agent·모델·권한 알약(그 workspace의 기본값,
  `RunPanel`과 같은 표 — `agents.ts`·`permission.ts`·`ModelField compact`) + `실행`. **plan 개정 1** — 기본값 유도(`defaultModelOf`·
  `defaultEffortOf`·`defaultPermission`·WSL repo면 claude 강제)를 `renderer/runDefaults.ts`의 순수 함수로 떼어 RunPanel과 홈 카드가 같이
  쓰고, 카드는 `newRunInput`으로 만든 `StartRunInput`을 `onStartConversation(input, target)`으로 App에 올린다. **App이 `client.runs.start`를
  직접 부른 뒤** `setLastTarget`(FR-7)과 대화 열기(`openReportConversation`과 같은 길)를 한다 — 홈 컴포넌트가 부르는 것이 아니라 App이
  부르므로 "홈은 읽기다"는 지켜진다. 초안 넘기기(처음 안)는 카드에서 바꾼 agent·모델·권한을 실어 나를 길이 없어 버렸다 — `@`는 core의
  `assemble.ts`가 보낼 때 해석하고 슬래시는 입력 중의 피커뿐이라 RunPanel을 거칠 이유가 없다. 홈 카드는 `/`·`@` 피커가 없다(§6의 2).
  비어 있으면 `실행`이 잠기고 실패는 카드의 오류 줄이다.
  대상 기본값은 FR-7, 없으면 첫 workspace의 첫 repo, repo가 하나도 없으면 카드 대신 "repo를 등록하세요" 한 줄.
- **FR-12** 제목 줄 범위는 `홈`, `document.title`은 `홈 — one-desk`(ux-polish FR-6의 표에 한 줄). 사이드바 `홈`은 인박스 **위**,
  접힌 사이드바에서도 타일이고 배지는 FR-4. 단축키 표(`SHORTCUTS`)에 **`Ctrl+Shift+H` 홈**을 더한다 — `Ctrl+H`는 브라우저·Electron의
  기록이라 피한다(§6의 3).

### (C) 작은 창

- **FR-13** 홈의 본문은 한 열이 기본이고 **1280px 이상**에서만 둘(돌고 있는 것 | 타임라인)·셋(workspace 카드)로 벌어진다 — CSS
  컨테이너 쿼리(`.home` 폭). 1280px 아래에서는 타임라인을 그리지 않는다(막대가 읽히지 않는다). 사이드바 접힘은 기존 `collapsed`
  그대로 — 홈이 접지 않는다.

### (D) 처음 켰을 때

- **FR-14** `setup`은 네 단계의 상태다 (**plan 개정 8** — core는 셋만 주고 `cli`·`done`은 렌더러의 `renderer/home/setup.ts`가 합친다.
  `checkAgents`·`probeAgents`는 1~1.6초라 요약에 묶으면 홈 전체가 그만큼 늦게 뜬다):
  ```ts
  // core (HomeSummary.setup)
  interface HomeSetup {
    workspace: boolean                  // workspaces.list().length > 0
    repo: boolean                       // 어느 workspace든 repo 하나 이상
    firstRun: boolean                   // run 행 하나 이상
  }
  // renderer (renderer/home/setup.ts)
  interface SetupState extends HomeSetup {
    cli: 'ready' | 'pending' | 'none'   // FR-15
    done: boolean                       // 넷 다
  }
  ```
  `done`이 false면 홈은 (B)·(C) 대신 준비 단계를 그린다. `done`이 true가 되는 순간부터는 다시 묻지 않는다 — 단, 네 조건 중 하나가
  거짓이 되면(마지막 workspace를 지움) 다시 준비 단계다. 따로 "봤다" 표식을 저장하지 않는다(상태가 곧 판정).
- **FR-15** CLI 칸은 설정 화면 실행 탭과 **같은 데이터**다 — `checkAgents`(실행 파일, 즉시) + `probeAgents`(인증·모델, 느리다)를 첫
  workspace로 부른다. `ready` = claude 또는 opencode(또는 WSL claude)가 실행 파일 · 인증 `ok` · 모델 `resolved`(opencode는 모델이
  `skipped`라 인증까지). `pending` = 아직 응답 전. `none` = 어느 것도 아니다. 화면은 `AgentStatusRow`를 그대로 쓴다(wsl-repo-setup이
  WSL 탭에서 한 것과 같다 — 세 번째로 그리는 자리다, 따로 만들지 않는다). **workspace가 없으면 CLI를 묻지 않는다**(probe는 workspace
  id를 받는다) — 단계 1이 먼저다. 묻는 것은 **①·②가 끝나고 홈이 보이며 `done`이 아닐 때만**이다(구현 중 좁힘 — workspace를 만든
  직후 뜬 probe가, 그 사이 workspace 화면에서 돌린 run의 가짜 CLI 캡처 파일을 늦게 덮어 e2e 셋이 깨졌다). workspace 화면으로
  들어가면 멈춘다.
- **FR-16** 단계마다 가는 곳: ① 사이드바의 workspace 추가 폼에 포커스(새 일회성 prop `focusWorkspaceAdd`) ② 사이드바의 `repo 등록` 폼 —
  등록 폼은 그대로 사이드바에 있고 홈은 **그 폼을 펼쳐 포커스**한다(`RepoStrip`의 일회성 prop `openRepoForm` — 폼을 둘 두지 않는다,
  WSL 버튼·폴더 선택이 거기 있다) ③ `다시 확인`은 `probeAgents(refresh)`, `설정에서 경로 지정`은 설정 실행 탭 ④ `Ctrl+N` 안내. 끝난
  단계는 한 줄로 접힌다(`workspace` 줄에 이름, `repo` 줄에 개수). 버튼 이름은 `워크스페이스 만들기` · `폴더 연결하기` · `다시 확인` ·
  `설정에서 경로 지정` · `첫 대화 보내기`다(**plan 개정 4** — `repo 등록`·`추가`·`폴더 선택`을 부분 문자열로 품지 않는다, 사이드바 폼의
  버튼과 같은 화면에 선다).

### (E) 배선

- **FR-17** App: `view`에 `'home'`이 는다. 첫 렌더의 `view`는 **`'home'`**(지금은 `'workspace'`). `Sidebar`의 필수 prop `onSelectHome`·
  `homeCount`. 홈이 쓰는 요약은 훅 `useHome(active)`가 `view === 'home'`일 때만 읽고(`useInbox(view === 'inbox')`와 같은 모양) 배지는
  `useHomeCount()`가 늘 읽는다 — 요약 전체를 늘 읽으면 workspace 화면에 있을 때도 매 이슈 변경에 모든 workspace를 긁는다. 배지만
  주는 가벼운 길 `core.home.count()`를 따로 연다(FR-1과 같은 순수 함수에서 `todos.length`만).
- **FR-18** 변이 표(plan에서 돌린다): `onSelectHome` 지움 → 사이드바 홈 무반응 · `homeCount` 고정 → 배지 테스트 · `onTriage`를
  `onOpenIssues`로 바꿈 → 훑기 테스트 · 첫 `view`를 `'workspace'`로 되돌림 → "앱을 열면 홈이다" · `setLastTarget` 호출 지움 → 새
  대화 카드 대상 테스트.

## 3. 인터페이스

```ts
// shared/models.ts
interface HomeRunning { workspaceId; repoId: string | null; conversationId; title; turns; startedAt; currentTool: string | null; lastText: string | null; runId }
type HomeTodo =
  | { kind: 'needs-answer' | 'failed' | 'interrupted'; workspaceId; repoId; conversationId; runId; title; question: string | null; at: number }
  | { kind: 'untriaged' | 'stale'; workspaceId; count: number; titles: string[] }   // titles ≤ 3
interface HomeTimelineRow { workspaceId; name; bars: { conversationId; title; from; to; status: RunStatus; needsAnswer }[] }
// repos의 path·agentEnv는 plan 개정 2 — 새 대화 카드의 cwd와 WSL 규칙(agentBlockedReason)에 필요하다
interface HomeWorkspace { workspaceId; name; open; doing; doneToday; untriaged; repos: { repoId; name; path; agentEnv; open; conversations; state: HomeRepoState }[] }
type HomeRepoState = 'running' | 'needs-answer' | 'failed' | 'done' | 'none'
interface HomeDoneIssue { workspaceId; issueId; title; closedAt }
interface HomeTarget { workspaceId: string; repoId: string }

// core.home (IPC home:*)
summary(input: { now: number; dayStart: number }): HomeSummary
count(input: { now: number }): number
lastTarget(): HomeTarget | null
setLastTarget(target: HomeTarget): void
```

`question`은 답변 필요 턴의 `resultText` 앞 160자(리포트의 `lastAnswer`와 같은 `clip`). IPC 핸들러는 core 호출 한 줄이다.

## 4. 화면 규칙

- 할 일 줄: 왼쪽 상태 점(`.status-<enum>`과 같은 토큰 — 정리 안 됨·오래 안 본은 `--text-muted`) · 제목 · 한 줄 부제(질문 / 실패 이유 /
  제목 셋) · 범위(`workspace · repo`, 모노) · 시각 · 버튼. 버튼 이름은 `답하기`·`다시 보내기`·`대화 열기`·`훑기`·`보기`.
- 타임라인: 줄 높이 28px, 막대 16px, 시각 눈금 2시간, 지금은 `--danger` 2px 선. 막대 `title`이 제목·상태·시각.
- 새 색 없음 — 전부 `index.css` 토큰. 다크에서 같은 값.
- 글자는 전부 한국어(ux-polish FR-3). `홈` 배지는 `.group-count`(사이드바 인박스 배지와 같은 모양, 색만 `--warn`).
- 타이틀·`document.title`: `홈`.

## 5. 비기능 요구사항

- **NFR-1** 요약 한 번은 workspace 셋 · 이슈 300 · run 2,000에서 50ms 안(`reports.build`와 같은 급). 배지(`count`)는 그 절반.
- **NFR-2** "정리 안 됨"·"오래 안 본"·"대표 턴"·"실행 중" 판정은 **각각 한 자리**다 — `shared/inbox.ts`·`shared/issueRules.ts`(새 — `STALE_MS`·
  `isStale`·`isUntriaged`를 renderer에서 옮긴다)·`shared/conversationTitle.ts`. renderer의 `issueGroups.ts`는 그것을 import한다.
- **NFR-3** 새 이름이 기존 e2e와 부분 일치로 부딪히지 않는다: `홈`은 버튼 이름으로는 없지만 등록 폼의 WSL 버튼 `title`("…의 홈에서 엽니다")과
  WSL 탭 안내문에 글자로 있다 — e2e는 `getByRole('button', { name: '홈', exact: true })`로 잡는다. `보기`는 **`마크다운으로 보기`·`이전 내용 보기`·`인박스 보기`와 부딪힌다** → 버튼 이름은 `방치 이슈 보기`로 한다. `답하기`는
  대화록에 턴마다 있지만 홈 화면에서는 대화록이 없다 — 같은 화면에 서지 않는다. **plan 개정 4**: (a) workspace 카드 버튼의 이름은
  workspace 이름이 아니라 `<이름> 워크스페이스 열기`다 — 홈이 보이는 동안 사이드바의 workspace 버튼(`{ name: '<이름>', exact: true }`)과
  같은 이름의 버튼이 둘이 된다(접힌 사이드바 타일이 펼친 목록과 동시에 서지 않는 것과 같은 규칙). repo 줄은 버튼이 아니다. (b) 준비 단계의
  버튼 이름은 FR-16. (c) 돌고 있는 것의 멈추기는 `<제목> 실행 멈추기`다.
- **NFR-4** 세 경계. `core/home/summary.ts`는 DB·electron 없이 순수. 렌더러는 `useClient()`.

## 6. 우려 사항

1. **돌고 있는 것의 "지금 도는 도구·마지막 텍스트"는 DB에 없다** — manager의 이벤트 스토어(렌더러의 `runEvents`)에만 있다. 홈이 그것을
   보이려면 (a) 홈이 `runs.readLog`를 부르거나(접힌 턴은 로그를 읽지 않는다는 규칙에 어긋난다) (b) manager가 run마다 마지막 도구·마지막
   텍스트를 메모리에 쥐고 `runs.list`가 아니라 **요약이** 묻는다. **(b)로 간다** — core 메모리 하나(`plan-usage`의 "마지막 값 하나"와
   같은 모양), 앱을 다시 켜면 비어 있고 화면은 "진행 중"만 쓴다.
2. **홈의 새 대화 카드에는 `/`·`@` 피커가 없다.** 두 피커는 RunPanel 안에 깊이 묶여 있다(cwd·커맨드 캐시·초안 스토어). 홈 카드는 초안을
   App에 올려 RunPanel이 보내게 하므로 글은 **그대로** 들어가고 `@경로`는 RunPanel의 전송 경로에서 해석된다 — 다만 치는 동안 피커가 뜨지
   않는다. 받아들인다. 필요해지면 RunPanel의 입력부를 떼어 홈이 쓴다(그때는 초안 스토어 키 `home`).
3. **단축키 `Ctrl+Shift+H`**는 Windows의 다른 앱에서 쓰지 않는 조합이다. `Ctrl+H`는 Chromium이 기록을 열지 않지만(Electron에 메뉴가 없다)
   편집기의 "바꾸기"와 겹친다 — 코드 칸이 열려 있으면 CodeMirror가 먼저 받는다. Shift를 붙인다.
4. **첫 화면이 홈으로 바뀌면 기존 e2e(파일 33개)가 첫 화면을 workspace 화면으로 가정한다.** **plan 개정 5** — 드라이버는 건드리지
   않는다. 기존 e2e는 전부 사이드바 폼으로 workspace를 만든 뒤 **그 버튼을 누르고**(자동 선택이 없어 누를 수밖에 없다), App의
   `selectWorkspace`가 이미 `setView('workspace')`를 하므로 그 클릭이 workspace 화면으로 데려간다. 첫 화면은 준비 단계이지만 사이드바의
   폼은 그대로 있으므로 **그대로 통과해야 한다** — 준비 단계 화면이 사이드바를 가리거나 폼을 옮기면 안 되는 이유다. 전체 e2e를 돌려
   확인한다(plan 16단계).
5. `home.lastTarget`은 DB에 있어 **다른 장비의 DB를 옮겨 오면 그 값의 workspace·repo id가 그대로 유효**하다 — 의도다(intent 가정).
6. 타임라인의 `dayStart`를 렌더러가 넘기므로 **단위 테스트는 시간대에 기대지 않는다**(core 테스트가 고정 epoch를 넘긴다).

## 7. 검증

- 단위(core): `summary.ts` — 네 종류 할 일의 순서와 판정(인박스에서 내려간 대화는 빠진다 · done 이슈는 stale이 아니다 · seenAt null은
  createdAt), 타임라인 클립(어제 시작해 오늘 끝난 대화 · 오늘 시작해 도는 대화), workspace 카드의 repo 상태 우선순위, `setup`의 네 조건,
  `lastTarget`의 지워진 id 폴백. `count`가 `summary.todos.length`와 같다(한 함수에서 나온다).
- 단위(shared): `issueRules.ts`로 옮긴 뒤 `issueGroups.test`가 그대로 초록.
- 컴포넌트: `HomePanel` — 줄마다 버튼 하나와 콜백 인자(workspace·id), 준비 단계의 접힘, 1280px 아래 타임라인 없음, 새 대화 카드의
  잠김·대상 폴백.
- 배선(`App.test`): FR-18의 변이 다섯이 각각 빨개진다. 첫 렌더가 홈이다. `Ctrl+Shift+H`.
- e2e `e2e/home.e2e.ts`: workspace 둘에 가짜 CLI로 답변 필요 대화 하나 · 실패 대화 하나 · 정리 안 된 이슈 둘 · `seenAt`을 15일 전으로
  둔 이슈 하나를 만든다 → 홈 배지 4 → `답하기`가 그 workspace의 도크를 그 대화로 연다 → `훑기`가 이슈 패널의 훑기 카드를 띄운다 →
  새 대화 카드에서 보내면 그 workspace 도크에 턴이 선다. 그리고 **아무것도 심지 않은 앱**이 준비 단계를 보이고 repo를 등록하면 단계가
  접힌다. **plan 개정 6** — 드라이버는 가짜 CLI에 `--scenario`를 못 넘기므로 `ONE_DESK_FAKE_SCRIPT=home`을 더한다: 지시문이 `[질문]`으로
  시작하면 `[NEEDS_ANSWER]` 결과, `[실패]`로 시작하면 `is_error` + exit 1, 그 밖은 기본 시나리오 그대로(기본 시나리오 불변). 오래 안 본
  이슈는 UI로 만들 수 없으므로(`markSeen`은 지금 시각) e2e 프로세스가 `better-sqlite3`로 `<dataDir>/one-desk.db`의 `issue.seen_at`을 15일
  전으로 고치고 홈을 떠났다 돌아온다(앱은 바뀜 알림을 못 받는다 — 다시 마운트가 다시 읽는다).
- 기존 e2e 33개 파일 전부 초록(드라이버 변경 없음).
- 실제 앱 캡처(라이트·다크, 1440×900 · 1100×760, 준비 단계).
