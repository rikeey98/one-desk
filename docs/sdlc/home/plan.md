# Plan: 앱을 열면 "오늘 할 일"이 보이는 홈

- 출처: `spec.md` (초안 — 승인 대기)
- 상태: 초안 — 승인 대기 (2026-10-21). 아래 §0의 spec 개정 여덟을 함께 승인받는다.

## 0. 코드를 읽고 spec에서 고쳐야 하는 것 (승인 필요 — 승인되면 spec에 반영한다)

spec을 쓸 때 가정한 자리 몇이 코드와 달랐다. 설계 결정을 코드에서 조용히 바꾸지 않기 위해(CLAUDE.md) 여기 먼저 적는다.

1. **FR-11 새 대화 카드의 전송 경로 — "App이 도크의 새 대화 칸에 초안을 넣고 보낸다"를 "App이 `runs.start`를 직접 부른다"로.**
   spec의 근거("맥락·`@` 해석·슬래시 커맨드가 전부 RunPanel에 있다")가 코드와 다르다 — `@`는 core의 `assemble.ts`가 보낼 때 해석하고
   (`rewriteMentions`), 슬래시는 입력 중의 피커뿐이며, 맥락 칩은 App state다. RunPanel이 `runs.start` 전에 하는 일은 **기본값 유도**
   (`defaultModelOf`·`defaultEffortOf`·`defaultPermission`·WSL repo면 claude 강제)와 초안 스토어 비우기뿐이다. 초안 넘기기로 보내려면
   (a) Dock → ConversationPanel → RunPanel 세 겹의 일회성 "보내라" prop과 `ready`를 기다리는 타이밍 계약이 생기고, (b) 홈 카드의
   agent·모델·권한 알약을 바꾼 값을 실어 나를 길이 없다(`draftPrompt`·`draftCwd`뿐이다) — 카드가 보여준 값과 실제로 보낸 값이 갈린다.
   그래서 **기본값 유도를 `renderer/runDefaults.ts` 순수 함수로 떼어 RunPanel과 홈 카드가 같이 쓰고**, App의 `onStartConversation`이
   그 입력으로 `client.runs.start`를 부른 뒤 `setLastTarget`과 대화 열기(`openReportConversation`과 같은 길)를 한다. 홈이 아니라
   **App이** 부르므로 "홈은 읽기다"는 지켜진다. 실패는 카드의 오류 줄이다.
2. **§3 `HomeWorkspace.repos[]`에 `path`·`agentEnv`를 더한다** — 1의 입력(cwd)과 WSL 규칙(`agentBlockedReason`)에 필요하다.
3. **FR-9 `답하기`의 배선을 구체화한다** — Dock에 필수 일회성 prop `focusReply`(`focusConversationId`와 함께 서고 `onFocusConsumed`로
   같이 치운다)를 더하고, ConversationPanel이 그것을 받아 `inputRef`에 포커스한다(FR-44의 `onAnswer`가 쓰는 그 ref). spec의 "그 길을
   App까지 올린다"가 이것이다.
4. **NFR-3에 이름 셋을 더한다.** (a) workspace 카드 버튼의 이름은 workspace 이름이 아니라 `<이름> 워크스페이스 열기`다 — 홈이 보이는
   동안 사이드바의 workspace 버튼(`{ name: '<이름>', exact: true }`)과 **같은 이름의 버튼이 둘**이 된다(접힌 사이드바 타일이 펼친 목록과
   동시에 서지 않는 것과 같은 규칙). (b) 준비 단계의 버튼은 `워크스페이스 만들기` · `폴더 연결하기` · `다시 확인` · `설정에서 경로
   지정` · `첫 대화 보내기`다 — `repo 등록`·`추가`·`폴더 선택`을 부분 문자열로 품지 않는다(사이드바 폼의 버튼과 같은 화면에 선다).
   (c) 돌고 있는 것의 `멈추기`는 이름 `<제목> 실행 멈추기`다 — `실행` exact와 부딪히지 않고 도크의 셋과도 다르다(홈에는 도크가 없다).
5. **§6-4의 드라이버 단계는 필요 없다.** App의 `selectWorkspace`가 이미 `setView('workspace')`를 하고, 기존 e2e는 전부 workspace를 만든 뒤
   사이드바의 그 버튼을 누른다(`core-loop`·`asset` 등 — 자동 선택이 없어 누를 수밖에 없다). 그래서 첫 화면이 홈이어도 그 클릭이 workspace
   화면으로 데려간다. 드라이버는 건드리지 않고 **전체 e2e를 돌려 확인한다**(16단계). 파일 수는 65가 아니라 **33개**다(65는 테스트 수).
6. **§7 e2e의 재료.** e2e 드라이버는 가짜 CLI에 `--scenario`를 못 넘겨 지금 e2e에는 실패·답변 필요 대화가 없다. 가짜 CLI에
   `ONE_DESK_FAKE_SCRIPT=home`을 더한다 — **지시문으로 가른다**: `[질문]`으로 시작하면 `[NEEDS_ANSWER]` 결과, `[실패]`로 시작하면
   `is_error` + exit 1, 그 밖은 기본 시나리오 그대로(기본 시나리오는 건드리지 않는다). 오래 안 본 이슈는 UI로 만들 수 없으므로(`markSeen`은
   지금 시각) e2e 프로세스가 `better-sqlite3`로 `<dataDir>/one-desk.db`의 `issue.seen_at`을 15일 전으로 고치고 홈을 떠났다 돌아온다
   (앱은 바뀜 알림을 못 받는다 — 다시 마운트가 다시 읽는다).
7. **FR-10 돌고 있는 것의 갱신 주기.** 요약은 push가 아니다. 도는 턴이 있는 동안 홈은 **2초마다** 요약을 다시 읽고(타이머 — run 이벤트마다
   긁지 않는다), 경과 시간만 `useNow`로 매초 센다. 없으면 타이머가 없다. 그 밖의 계기는 `onRunUpdate`·`onInboxUpdate`·`onQueueUpdate`·
   `onItemChanged(issue)`다(FR-4의 둘에 run 시작·큐를 더했다 — 돌고 있는 것 카드와 슬롯 수가 그것으로 바뀐다).
8. **`HomeSetup.cli`는 core가 아니라 렌더러가 채운다** (7단계에서 드러남). `checkAgents`·`probeAgents`는 1~1.6초이고 요약에 묶으면 홈
   전체가 그만큼 늦게 뜬다. core의 `HomeSetup`은 `{ workspace, repo, firstRun }`이고, 렌더러의 `renderer/home/setup.ts`가 `cli`를 합쳐
   `done`을 센다. spec §3·FR-14·FR-15를 그렇게 고친다.

## 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(아래 "변이"). 1·2단계는
동작을 바꾸지 않는 이동이라 기존 테스트가 초록인 채로 남는 것이 완료 조건이다.

0. **기준선** — `pnpm typecheck` · `pnpm lint` · `pnpm test` 초록, `pnpm test:e2e` 33개 통과(시간을 적어 둔다).
1. **이슈 판정을 `shared/`로** (NFR-2) — `shared/issueRules.ts`에 `STALE_MS`(`issueAxes.ts`에서)·`isStale`(`issueGroups.ts`에서)·
   `isUntriaged`(`triageQueue`의 술어 `triagedAt === null && status !== 'done'`를 뗀 것). `issueGroups.ts`·`issueAxes.ts`·`IssuePanel.tsx`는
   그것을 import한다(re-export 없이 — 자리가 하나여야 한다). `shared/issueRules.test.ts`(core 프로젝트의 include가 잡는다 — CLAUDE.md
   함정) + `issueGroups.test`·`IssuePanel.test` 그대로 초록. `shared/`는 renderer 타입 검사에도 걸리므로 node 모듈을 쓰지 않는다.
2. **경로로 repo 찾기를 `shared/`로** (FR-6) — `renderer/conversation.ts`의 `pathKey`·`repoOfCwd`를 `shared/repoPath.ts`로 옮기고
   `conversation.ts`·`code/target.ts`가 import한다. `conversation.test`의 `repoOfCwd` 테스트를 `shared/repoPath.test.ts`로 옮긴다.
   core의 요약이 같은 함수로 repo 카드의 대화를 가른다.
3. **실행 기본값 한 자리** (§0-1) — `renderer/runDefaults.ts`: `defaultModelOf`·`defaultEffortOf`(RunPanel에서 옮김)·
   `newRunInput({ workspace, repo, prompt, picks })` → `StartRunInput`(agent는 picks ?? workspace 기본값, WSL repo면 `agentBlockedReason`으로
   claude 강제, 모델·effort 빈 값은 null, 권한은 `defaultPermission`, cwd는 `repo.path`, context 없음). `runDefaults.test.ts`. RunPanel은
   두 함수를 import만 한다(동작 불변 — `RunPanel.test` 초록).
4. **돌고 있는 턴의 메모리 스냅샷** (§6-1) — `core/home/live.ts`: 순수 `applyRunEvent(map, event)`(`tool_use`면 `currentTool`, `text`면
   `lastText` 앞 160자, 그 run의 `result`·종료면 삭제)와 `LiveSnapshot { currentTool, lastText }`. `core/index.ts`의 manager `onEvent`가
   `emitter.emit` 앞에서 그것을 갱신하고 `onRunUpdate`의 종료 갈래가 지운다. **이벤트로 만들지 않고 저장하지 않는다** — `planUsage`와 같은
   자리·같은 모양. `live.test.ts`.
5. **홈 요약 순수 함수** (FR-1~7·14) — `core/home/summary.ts`: `HomeSources { workspaces(); repos(wsId); issues(wsId); runs(wsId); inbox();
   live(runId); queue() }`, `buildHomeSummary(src, { now, dayStart })`, `homeCount(src, { now })`(같은 계산의 `todos.length` — 한 함수에서
   나온다), `setupOf(src)`. 판정은 전부 import다: `representativeTurn`·`inboxCategory`·`INBOX_RULES`(`shared/inbox`), `isStale`·
   `isUntriaged`(1단계), `conversationTitle`(`shared/conversationTitle`), `groupTurns`·`conversationSpan`(`core/period`), `repoOfCwd`(2단계).
   §3의 타입은 `shared/models.ts`에 둔다(§0-2·§0-8 포함). `summary.test.ts`가 spec §7의 단위 항목 전부를 고정 epoch로 본다 — `dayStart`는
   인자라 시간대에 기대지 않는다(§6-6). NFR-1은 같은 파일의 테스트 하나가 workspace 3·이슈 300·run 2,000 합성 데이터로 50ms를 잰다.
6. **설정 키** (FR-7) — `core/db/repositories/setting.ts`에 `HOME_LAST_TARGET_KEY = 'home.lastTarget'`, `homeLastTarget()`(깨진 JSON·모양이
   다르면 null)·`setHomeLastTarget(target)`. `setting.test`.
7. **core 표면** — `core/index.ts`에 `home: { summary, count, lastTarget, setLastTarget }`. `lastTarget`은 저장값의 workspace·repo가 지금
   있을 때만 돌려주고 아니면 null(FR-7). CLI 판정은 요약에 넣지 않는다(§0-8). `core/index.test.ts`: workspace 둘을 넘는 요약,
   `count === summary.todos.length`, `lastTarget`의 지워진 id 폴백, **MCP `deps`에 `home`이 없다**(`reports`와 같은 방식으로 본다).
8. **IPC** — `shared/channels.ts`에 `homeSummary`·`homeCount`·`homeLastTarget`·`homeSetLastTarget`, `electron/ipc/home.ts`(핸들러 네 줄,
   `registerIpc`에 등록), `electron/preload.ts`·`shared/client.ts`의 `home` 네임스페이스.
9. **훅** — `renderer/hooks/useHome.ts`: `useHome(active)`가 `active`일 때 `{ now: Date.now(), dayStart: startOfDay(now) }`로 읽고 §0-7의
   계기로 다시 읽는다, `useHomeCount()`는 늘 `count`를 읽고 `onInboxUpdate`·`onItemChanged(null, 'issue')`(모든 workspace)로 다시 읽는다.
   `useHome.test.tsx`(가짜 클라이언트 — `useInbox.test`와 같은 모양). `startOfDay`는 `renderer/report/period.ts` 그대로.
10. **홈 화면** — `renderer/components/home/`: `HomePanel`(틀 + `setup.done`이면 본문, 아니면 `HomeSetup`), `HomeRunning`, `HomeTodos`,
    `HomeTimeline`, `HomeWorkspaces`, `HomeComposer`(새 대화 카드 — 3단계의 `newRunInput`으로 보낼 값을 만들어 `onStartConversation(input,
    target)`으로 올린다), `HomeSetup`(`AgentStatusRow` 재사용 — 세 번째 자리). 판정은 `renderer/home/*.ts` 순수 함수에 둔다:
    `timeline.ts`(막대 기하 — `[dayStart, now]`를 폭으로, 2시간 눈금), `target.ts`(`lastTarget` → 폴백 → null), `setup.ts`(`cli` 합치기와
    `done`). 각 `*.test`. 버튼 이름은 spec §4 + §0-4. FR-13의 "1280px 아래에서는 타임라인을 그리지 않는다"는 `HomePanel`이
    `ResizeObserver`로 `.home` 폭을 재 1280 미만이면 `HomeTimeline`을 마운트하지 않는 것이다 — jsdom에는 `ResizeObserver`가 없어
    테스트는 폭을 prop으로 받는 안쪽 컴포넌트 `HomeBody({ width })`를 본다. 열 배치 자체는 CSS 컨테이너 쿼리다.
11. **IssuePanel의 훑기 시작** (FR-9) — 선택 prop `startTriage`·`onStartTriageConsumed`(패널 창도 같은 컴포넌트라 `focusAdd`와 같이
    선택이다 — App의 한 줄은 14단계의 변이가 지킨다). effect가 `startTriage`면 기존 `startTriage()`(이름이 겹치므로 내부 함수를
    `beginTriage`로)를 부르고 치운다. 큐가 비었으면 아무것도 하지 않고 치운다. `IssuePanel.test`.
12. **Dock · ConversationPanel의 답 포커스** (§0-3) — `Dock`의 필수 prop `focusReply: boolean`; `focusConversationId` effect가 그 값을
    `ConversationPanel`의 `focusInput` prop으로 내리고 `onFocusConsumed`로 같이 치운다. `ConversationPanel`은 effect에서 `inputRef.current?.focus()`.
    `Dock.test`·`ConversationPanel.test`. **`focusNew`와 동시에 서지 않는다**(App이 둘 중 하나만 세운다).
13. **Sidebar · RepoStrip** — 사이드바 맨 위 `홈` 버튼(아이콘 + 글자, 접히면 타일, `view === 'home'`이면 활성, 배지 `homeCount`를
    `.group-count`에 `--warn`), 필수 prop `onSelectHome`·`homeCount`·`view`에 `'home'`. 준비 단계 ①·②를 위한 일회성 prop
    `focusWorkspaceAdd`(Sidebar — 새 workspace 입력칸 포커스)·`openRepoForm`(RepoStrip — 등록 폼을 펼치고 이름 칸 포커스), 각각 `on…Consumed`.
    `Sidebar.test`·`RepoStrip.test`.
14. **App 배선** (FR-17·18) — `view`에 `'home'`, 초기값 `'home'`, `scopeLabel` `홈`, `SHORTCUTS`에 `{ action: 'home', label: '홈', key: 'h',
    mod: true, shift: true }`(`shortcut.test`), `useHome(view === 'home')`·`useHomeCount()`·CLI 판정(`checkAgents`·`probeAgents` — 첫
    workspace, 홈이 보이고 `setup`이 `done`이 아닐 때만). 핸들러: `onOpenConversation` = `openReportConversation`, `onReply` = 그것 +
    `focusReply`, `onResend` = `ConversationPanel`의 다시 보내기와 **같은 입력**(그 함수를 `renderer/resend.ts`의 순수 `resendInput(run)`으로
    떼어 둘이 쓴다 — `file` 맥락을 거르는 규칙이 한 자리여야 한다) → `runs.resume` → 대화 열기, `onTriage` = `selectWorkspace` + `triageStart`,
    `onOpenIssues` = `selectWorkspace`, `onOpenWorkspace` = `selectWorkspace`, `onStartConversation` = §0-1. `App.test`: 변이 표 전부, "첫
    렌더가 홈이다", "Ctrl+Shift+H", "홈의 답하기는 그 workspace의 도크를 그 대화로 열고 입력칸에 포커스한다", "새 대화 카드가 보낸 run의
    workspace·repo가 `home.setLastTarget`에 찍힌다".
15. **CSS** — `index.css` 끝의 `docs/sdlc/home/` 블록: `.home` 컨테이너(`container-type: inline-size`), 카드·할 일 줄·타임라인(막대 색은
    `.status-<enum>`과 같은 토큰, 지금 선 `--danger`)·준비 단계·배지 `--warn`. 새 토큰 없음, 라이트·다크. `DESIGN.md`에 홈 절.
16. **e2e** — 가짜 CLI `ONE_DESK_FAKE_SCRIPT=home`(§0-6, `fake-claude.mjs` — 기본 시나리오 불변, `fake-claude.test`에 두 갈래). `e2e/home.e2e.ts`:
    (a) 아무것도 심지 않은 앱 → 준비 단계 넷, `워크스페이스 만들기`가 사이드바 입력칸에 포커스, 만들면 ①이 접힌다, `폴더 연결하기`가
    등록 폼을 펼친다, 등록하면 ②가 접힌다, CLI 줄이 가짜 CLI로 초록이 된다. (b) workspace 둘 · `[질문]` 대화 · `[실패]` 대화 · 이슈 둘(정리
    안 됨) · `seen_at`을 DB로 15일 전으로 → 홈 배지 4 → `답하기` → 도크에 그 대화 + 입력칸 포커스 → 홈 → `훑기` → 훑기 카드 → 홈 →
    새 대화 카드에서 보내면 그 workspace 도크에 턴이 서고 다시 홈에 오면 대상 알약이 그 repo다. 그다음 **전체 e2e 33개**(§0-5).
17. **캡처** — 임시 `e2e/zz-home.e2e.ts`로 라이트·다크 × 1440×900 · 1100×760 · 준비 단계를 찍어 보내고(`page.emulateMedia`), 고친 뒤
    임시 파일을 지운다.
18. **문서** — CLAUDE.md(현재 상태 한 단락 · 함정: 첫 화면이 홈이라 e2e는 workspace 버튼을 눌러 들어간다, 홈의 버튼 이름, `STALE_MS`·
    `repoOfCwd`의 자리, `lastTarget`은 렌더러가 보낼 때만 찍는다, 돌고 있는 턴의 스냅샷은 메모리 · 문서 표), `DESIGN.md`, intent·spec
    상태 줄, 이 plan의 완료 증명(변이 결과·요약 시간·번들 크기).

## 바뀌는 파일

- 새: `shared/issueRules.ts`(+test) · `shared/repoPath.ts`(+test) · `core/home/live.ts`(+test) · `core/home/summary.ts`(+test) ·
  `electron/ipc/home.ts` · `renderer/runDefaults.ts`(+test) · `renderer/resend.ts`(+test) · `renderer/hooks/useHome.ts`(+test) ·
  `renderer/home/{timeline,target,setup}.ts`(+test) · `renderer/components/home/{HomePanel,HomeRunning,HomeTodos,HomeTimeline,HomeWorkspaces,
  HomeComposer,HomeSetup}.tsx`(+test) · `e2e/home.e2e.ts`.
- 고침: `shared/{models,channels,client}.ts` · `core/index.ts`(+test) · `core/db/repositories/setting.ts`(+test) ·
  `core/runner/fixtures/fake-claude.mjs`(+test) · `electron/{preload,ipc/index}.ts` · `renderer/{App,shortcut,issueGroups,issueAxes,conversation}.ts(x)`(+test) ·
  `renderer/code/target.ts` · `renderer/components/{Sidebar,RepoStrip,Dock,ConversationPanel,IssuePanel,RunPanel}.tsx`(+test) ·
  `renderer/index.css` · `CLAUDE.md` · `DESIGN.md` · `docs/sdlc/home/{intent,spec}.md`.
- 건드리지 않음: 마이그레이션 · MCP(`core/mcp/`) · e2e 드라이버.

## 변이 (되돌려 빨개지는지 볼 것)

| 망가뜨릴 줄 | 빨개져야 할 테스트 |
|---|---|
| App: `onSelectHome` 핸들러를 빈 함수로 | "사이드바 `홈`을 누르면 홈이다" |
| App: `homeCount={0}` 고정 | "홈 배지는 할 일 수다" |
| App: `onTriage`를 `onOpenIssues`와 같은 함수로 | "홈의 훑기는 이슈 패널의 훑기 카드를 띄운다" |
| App: 첫 `view`를 `'workspace'`로 | "앱을 열면 홈이다" |
| App: `setLastTarget` 호출 지움 | "새 대화 카드가 보낸 대상이 저장된다" |
| App: `focusReply`를 늘 `false`로 | "홈의 답하기는 입력칸에 포커스한다" |
| App: `startTriage={triageStart}` 지움 | 위 훑기 테스트 |
| summary: `reviewedAt`이 찍힌 대화를 거르는 줄 지움(= `inbox()` 대신 `runs`에서 셈) | "인박스에서 내려간 대화는 할 일이 아니다" |
| summary: `isStale`의 `done` 제외 지움 | "done 이슈는 오래 안 본 것이 아니다" |
| summary: `seenAt ?? createdAt`을 `seenAt`만으로 | "seenAt이 없으면 createdAt으로 잰다" |
| summary: 타임라인 클립 하한을 지움 | "어제 시작해 오늘 끝난 대화의 막대는 자정에서 시작한다" |
| summary: repo 상태 우선순위의 `running`·`needs-answer` 순서를 바꿈 | "repo 상태는 running > needs-answer > …" |
| summary: `homeCount`가 `todos`를 따로 셈 | "count는 summary.todos.length다" |
| live: 종료 갈래의 삭제 지움 | "끝난 run의 스냅샷은 없다" |
| setting: 깨진 JSON에 던짐 | "깨진 값은 null이다" |
| core: `lastTarget`의 존재 검사 지움 | "지워진 workspace의 저장값은 null이다" |
| useHomeCount: `onItemChanged` 구독 지움 | "이슈가 바뀌면 배지를 다시 읽는다" |
| HomeComposer: WSL repo에서 opencode를 그대로 보냄 | `runDefaults.test` "WSL repo는 claude-code다" |
| fake-claude: `[질문]` 갈래 지움 | `fake-claude.test` + `home.e2e` 배지 수 |

## 위험

1. **홈이 보이는 동안의 이름 충돌** (§0-4). workspace 이름·repo 이름이 홈의 버튼 이름에 그대로 들어가면 사이드바와 둘이 된다. 홈의
   모든 버튼 이름을 15단계 전에 목록으로 만들어 `grep`으로 e2e의 `{ name: … }`와 부분 일치를 본다.
2. **준비 단계와 기존 e2e.** 아무것도 심지 않은 e2e는 준비 단계 화면에서 시작한다. 사이드바 폼은 그대로라 통과해야 하지만, 준비 단계가
   첫 workspace로 `probeAgents`를 부른다 — 가짜 CLI에 `--version`이 한 번 더 돌고(`ONE_DESK_*_CAPTURE`를 세운 테스트는 그 파일이 덮인다 —
   CLAUDE.md의 같은 함정), `ONE_DESK_FAKE_DELAY_MS`가 큰 테스트는 그만큼 늦어진다. **probe는 workspace가 생긴 뒤·`setup.done`이 아닐
   때·홈이 보일 때만** 부른다 — workspace 화면으로 들어가면 멈춘다. 16단계의 전체 e2e가 판정한다. 캡처 파일을 보는 e2e(`slash`·
   `opencode-real`)가 깨지면 그 테스트의 캡처 대기를 "run의 것"으로 좁힌다.
3. **요약이 모든 workspace의 run을 읽는다** (`runs.list(wsId)`는 맥락까지 hydrate한다). NFR-1을 5단계의 측정이 보고, 넘으면 `runs.list`에
   슬림 select(`inboxCounts`가 쓰는 `lastTurnsOf`와 같은 방식)를 더한다 — 지금은 가정이다. `count`는 `inbox()` + 이슈 둘만 읽어 run 전체를
   긁지 않는다.
4. **DB를 밖에서 고치는 e2e** (§0-6). 앱이 WAL로 연 파일을 e2e 프로세스가 `better-sqlite3`로 쓴다 — SQLite는 허용하지만 Windows의 잠금
   타이밍에 걸리면 `SQLITE_BUSY`다. `timeout: 5000`으로 열고, 그래도 깨지면 오래 안 본 이슈는 e2e에서 빼고(배지 3) 단위 테스트에만 둔다.
5. **홈 카드가 보낸 run의 초안·맥락.** App이 직접 보내므로 RunPanel의 초안 스토어는 관여하지 않는다 — 보낸 뒤 그 대화가 열리면 도크의
   입력칸은 비어 있다(의도). 맥락 칩은 싣지 않는다(홈에는 담을 것이 없다).
6. **`ResizeObserver`와 컨테이너 쿼리의 경계가 어긋날 수 있다**(둘 다 1280이지만 재는 요소가 다르면 몇 px 갈린다). 둘 다 `.home`의
   `clientWidth`를 기준으로 하고, 캡처(17단계)에서 1279·1280을 본다.
7. **`Ctrl+Shift+H`가 입력칸 안에서도 듣는다** — 다른 전역 단축키(Ctrl+N 등)와 같은 규칙이다(수정키 없는 `?`만 글 받는 자리에서 안 듣는다).
   CodeMirror의 바꾸기는 `Ctrl+H`라 겹치지 않는다.
