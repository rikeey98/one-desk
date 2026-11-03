# Plan: 홈 대화 — workspace를 넘어 읽는 읽기 전용 대화

- 출처: `spec.md` (승인 2026-10-26)
- 상태: 승인 (2026-11-03, 사용자 "승인, 구현해줘"). 2026-11-03에 `main`(`2eb74cc`, v0.30.0) 기준으로 다시 썼다 — 첫 초안(2026-10-26) 뒤에 agent-proposals·정기 실행·
  그림·에이전트 현황이 들어왔다. §0의 개정 열둘은 spec에 반영했다

## 0. 코드를 읽고 spec에서 고쳐야 하는 것 (승인 필요)

spec을 쓸 때 가정한 자리 몇이 코드와 달랐고, spec 뒤에 들어온 기능이 홈 대화와 부딪히는 자리가 생겼다. 설계 결정을 코드에서 조용히 바꾸지
않기 위해(CLAUDE.md) 먼저 적는다. 1~6은 첫 초안의 것이고, 7~12는 2026-11-03에 더한 것이다.

1. **FR-3 "`list()`만 거르면 손대지 않아도 된다"가 두 자리에서 틀렸다** — 거른 결과가 홈을 **필요로** 하는 자리다.
   - **홈 할 일**: `core/home/summary.ts`의 `badgeRuns(inbox, wsIds)`가 인박스를 `src.workspaces()`의 id로 거른다. 홈 행이 빠지면 홈 대화의
     답변 필요·실패가 할 일에 안 뜬다(FR-14 위반). → `HomeSources`에 **필수** `home(): Workspace | null`을 더하고, `wsIds`에 홈 id를 넣고, 그 할 일의
     `workspaceName`은 `홈`이다. workspace 카드·오늘 완료·준비 단계는 지금처럼 `workspaces()`만 본다. `homeCount`도 같은 거름을 쓴다(배지와 목록이
     갈리면 안 된다).
   - **인박스 이름**: `renderer/inboxView.ts`의 `workspaceName`이 `workspaces` 목록에서 찾으므로 홈 대화는 `MISSING_WORKSPACE`로 보인다. → 렌더러가
     홈 workspace의 id를 알아야 한다(아래 3).
2. **run이 끝나면 그 workspace를 다시 훑는 자리가 홈에 글로벌 asset을 쌓는다.** `core/index.ts`의 `onRunUpdate`가 `scanWorkspace(run.workspaceId)`를
   부르고, 스캔은 repo가 없어도 **글로벌 루트**를 그 workspace 이름으로 upsert한다(`~/.claude/skills`가 홈 행 아래 asset으로 생긴다). spec이 못 본
   자리다. → `assetService.scanWorkspace`가 홈 id면 아무것도 하지 않는다(IPC의 `assets.rescan`도 같은 함수를 탄다). 부팅 스캔(`workspaceIds`)은
   `list()`라 이미 홈을 뺀다.
3. **렌더러가 홈 workspace를 아는 길이 spec에 없다.** FR-6은 "`core.workspaces.home()`이 주는 값으로 안다"고만 했다. → IPC `workspaces.home()`이
   `{ workspace: Workspace; cwd: string }`을 준다(`cwd` = `<dataDir>/home-conversation/`). App이 한 번 읽는 훅 `useHomeWorkspace`로 쥐고, 홈 도크·
   인박스·홈 패널에 **필수 prop**으로 내린다.
4. **FR-13 "카드에 쓰던 글은 초안 스토어가 쥔다"가 틀렸다.** `HomeComposer`는 `useState('')`다(39행) — 도크를 펼칠 때 카드를 언마운트하면 글이
   사라진다. → 카드를 **언마운트하지 않고 `hidden`** 으로 숨긴다(item-windows의 `목록 숨기기`와 같은 방식). 초안 스토어로 옮기지 않는다 — 카드는
   대화가 아니라 키가 없다.
5. **도크의 펼침은 저장되지 않고 늘 펼친 채 시작한다**(`Dock`의 `useState(true)`, 115행), 그리고 App이 펼침을 모른다. FR-13(카드 숨김)·FR-13a(접힌 채
   시작, localStorage)에 둘 다 필요하다. → `Dock`에 **필수** prop `variant`를 더한다(아래 §2-8). 홈 갈래가 처음 값과 펼침 변화를 받는다.
6. **FR-8 "prepare()가 그 행의 kind를 읽는다"의 구체.** MCP 호스트는 workspace 저장소가 없다. FR-11이 `deps.workspaces`를 더하므로 `prepare`는
   `deps.workspaces.home()?.id === ctx.workspaceId`로 범위를 정한다(행의 `kind`를 보는 것과 같은 판정 — 홈 행은 `home()` 하나로만 닿는다).
7. **이슈화 안내가 홈 턴에 붙는다** (agent-proposals, 2026-10-27). `shouldProposeIssue`(`core/proposals/guide.ts`)는 이슈가 할당되지 않은 대화의
   턴마다 `PROPOSE_ISSUE_GUIDE`를 붙이는데, 홈 대화에는 이슈가 생길 수 없으니 **모든 홈 턴**이 안내를 받는다. 그런데 `all` 범위 서버에는
   `propose_issue`가 없고(FR-9의 여덟), 안내는 "이 workspace의 열린 이슈"를 보라고 한다 — agent가 없는 도구를 부르려 한다. → `ProposeIssueInput`에
   **필수** `home: boolean`을 더하고 참이면 붙이지 않는다(`fromSchedule`과 같은 자리·같은 이유). 실행 서비스가 `spec.workspaceId === home()?.id`로
   넘긴다. 또 workspace 범위 서버에서 `propose_issue`는 `read_only` 조기 반환 **앞에** 있으므로(`tools.ts` 213행), `buildAllServer`를
   `buildServer`에서 복사해 시작하면 함께 따라온다 — 여덟에서 빠뜨리지 않게 테스트가 이름을 정확히 본다.
8. **정기 실행의 입력 검증은 workspace 표를 직접 읽는다** (scheduled-runs, 2026-11-02). `validateScheduleInput`(`core/schedules/input.ts` 58행)이
   `db.select().from(workspace)`로 id만 확인하므로 홈 id가 통과한다. 지금은 바로 다음의 repo 검사("이 workspace의 repo를 골라야 합니다")에서 막히지만,
   그것은 FR-4가 홈에 repo를 못 만들게 막는 데 기대는 두 겹 추론이다. → 그 질의에 `kind = 'normal'`을 더해 "workspace를 찾을 수 없습니다"로
   떨군다. 정기 실행 화면은 `workspaces`(= `list()`)를 쓰므로 홈을 고를 길이 원래 없다.
9. **실행 슬롯은 홈 턴을 세는데 "지금 돌고 있는 것"은 홈 턴을 안 보인다** (home §6-1, agent-status 2026-11-02). 큐는 전역이라 도는 홈 턴이 슬롯
   하나를 쥐고 사이드바 하단의 `실행 1/3`이 그것을 센다. 그런데 `summary.running`(홈 화면의 돌고 있는 것 · `에이전트 현황` 패널의 지금 동작)은
   `workspaces()`의 대화만 훑어 홈 턴이 없다 — 슬롯은 찼는데 무엇이 쥐었는지 안 보인다. → `running`도 1의 `home()` 소스로 홈 대화를 훑는다
   (`workspaceName: '홈'`, 누르면 홈 도크로 — §2-9의 분기). 오늘 타임라인·workspace 카드·오늘 완료는 지금처럼 `workspaces()`만 본다.
10. **FR-4의 가드 목록에 `assets.createAuthored`가 빠졌다.** workspace id만 받고 repo를 요구하지 않으므로 홈 id로 asset 행을 만들 수 있다. → 가드에
    더한다(여덟). 그림(`drawings.create`)·정기 실행은 repo id를 받으므로 홈에서는 repo 검사에서 막히고(8은 그 앞에서 막는다), 대화의 이슈 할당은
    저장소가 "같은 workspace의 이슈"를 확인하므로(`run.ts`의 `assignIssue`) 홈에서는 찾을 이슈가 없다.
11. **대화 헤더의 `⋯`에 `이슈 할당`이 선다** (conversation-issue, v0.20.0). 홈 도크에서 그 메뉴를 열면 홈 workspace의 이슈 목록 — 늘 비어 있다 — 이
    뜬다. → spec FR-12의 "다른 것"에 한 줄: 홈 갈래는 이슈 할당·바꾸기·해제 항목을 그리지 않는다. 헤더의 이슈 링크는 할당이 없으니 저절로 없다.
12. **마이그레이션 번호가 `0012`가 아니라 `0015`다.** `0012`는 제안, `0013`은 정기 실행, `0014`는 그림이 썼다.

## 1. 홈을 가르는 자리 (spec §5 우려 1)

`workspaces.list()`를 부르는 자리는 core에 여덟이다(전부 `core/index.ts`, 줄은 `2eb74cc` 기준). 그 밖에 workspace 표를 직접 읽는 자리가 하나 늘었다.

| 줄 | 자리 | 홈을 빼면 | 처리 |
|---|---|---|---|
| 208 | `workspaceOf` → `preflightFor`·`agentProbes`의 host 칸 | 홈 run에서 `null` → `resolveAgentPath(…, null, 앱 기본값)` = `ONE_DESK_AGENT_PATH` → 앱 기본 → PATH | **FR-7 그대로다.** 고치지 않고 테스트로 고정(3단계) |
| 339 | asset `workspaceIds`(부팅 스캔) | 홈에 글로벌 asset을 안 쌓는다 | 그대로 |
| 350 | `scanAll` 뒤 알림 | 홈에 알리지 않는다 | 그대로 |
| 580 | `homeSources().workspaces` | 카드는 맞다. 할 일·돌고 있는 것은 틀린다 | §0-1·§0-9 — `home()` 소스를 더한다 |
| 625 | `checkAgents` | 홈 id면 앱 기본값으로 판정 | 그대로(렌더러가 홈 id로 부르지 않는다) |
| 890 | `reports.build` | FR-15 | 그대로 |
| 908 | `home.lastTarget` | 홈은 "마지막으로 보낸 곳"이 될 수 없다 | 그대로(카드는 홈으로 보내지 않는다) |
| 945 | `panelScope` | 홈 패널 창을 못 연다 | 그대로 |
| (IPC) | `electron/ipc/workspaces.ts`의 `workspacesList` | 사이드바·설정·리포트·정기 실행에 홈이 없다 | 그대로 |
| `schedules/input.ts:58` | `validateScheduleInput`이 workspace 표를 직접 읽는다 | 홈 id가 통과한다 | §0-8 — `kind = 'normal'` |

core 밖에서 `workspace` 테이블을 직접 읽는 자리는 `core/db/open.test.ts`(행 수가 아니라 마이그레이션을 본다 — 홈 행은 core가 만들므로 영향 없음)뿐이다.

## 2. 순서

각 단계는 테스트를 먼저 쓰고 빨간 것을 본 뒤 구현한다. 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다(§4).

0. **기준선.** 바꾸기 전에 workspace 범위 서버의 `tools/list` 응답(권한 셋 — 목록은 둘이다: `read_only`는 읽기 일곱 + `propose_issue`, 편집 허용과
   전체 허용은 거기에 쓰기 넷이 같게 붙는다)을
   `core/mcp/__snapshots__/`에 찍는다(NFR-1). 전체 `pnpm test`·`pnpm typecheck`·`pnpm lint`가 초록인지 본다.
1. **스키마.** `workspace.kind`(`text`, enum `['normal','home']`, NOT NULL, 기본 `'normal'`) → `pnpm db:generate`로 `drizzle/0015_*.sql`(ADD COLUMN
   하나인지 눈으로 본다 — 테이블을 다시 만드는 SQL이면 멈춘다). `shared/models.ts`의 `Workspace`에 `kind: WorkspaceKind`.
2. **저장소.** `workspace.ts`: `list()`는 `kind = 'normal'`만. `home()`은 가장 오래된 홈 행 또는 null. `ensureHome()`은 트랜잭션 안에서 없으면
   만든다(이름 `홈`, 권한 기본 `read_only`). 바뀜 알림 래퍼(`notifyingWorkspaces`)는 둘을 그대로 흘려보낸다 — 부팅 때 만드는 홈은 알리지 않는다.
   테스트: 홈 행이 `list()`에 없다 · 두 번 불러도 하나 · 이미 둘이면 오래된 것.
3. **core 표면.** 부팅에 `ensureHome()` — workspace 저장소를 만든 바로 뒤, 부팅 스캔·`reapStale`·스케줄러보다 앞이다. `core.workspaces.home()` →
   `{ workspace, cwd }`(`mkdirSync(recursive)`). FR-4 가드 **여덟** — `workspaces.rename`·`remove`·`updateDefaults`·`updatePaths`, `repos.create`,
   `issues.create`, `memos.create`, `assets.createAuthored`(§0-10)가 홈 id면 `홈 workspace는 바꿀 수 없습니다`. 가드는 **저장소를 감싸는 자리에서
   한 번** 하고(`core/changes.ts`의 바뀜 알림 래퍼 옆), 감싼 것을 IPC와 MCP `deps`가 같이 받는다 — 맨 저장소를 따로 넘기지 않는다. `all` 범위 MCP에는
   쓰기가 없고 workspace 범위 MCP는 토큰의 workspace(늘 `normal`)에만 쓰므로 MCP 쪽은 두 번째 겹이다. `validateScheduleInput`의 `kind` 조건(§0-8).
   IPC·preload·`shared/client.ts`에 `workspaces.home`. 테스트: 가드 여덟 각각 · `workspaceOf`가 홈에서 앱 기본 경로로 간다(§1의 208) · 홈 id로
   정기 실행을 만들면 "workspace를 찾을 수 없습니다".
4. **실행.** `createExecutionService`에 **필수** 옵션 `home: () => { id: string; cwd: string } | null`. `launch`가 맨 앞(맥락·멘션 해석과 `runs.create`
   **앞**)에서 홈이면 권한이 `read_only`가 아니거나 cwd가 다르면 던진다(FR-5·6) — `start`·`resume` 둘 다 launch를 지난다. `proposeIssueFor`가
   `home`을 넘긴다(§0-7). 테스트: start·resume 각각, "던졌을 때 run 행이 없다", "홈 턴의 조립된 프롬프트에 이슈화 안내가 없다"(가짜 MCP CLI의
   `ONE_DESK_PROMPT_CAPTURE`나 run 행의 `assembledPrompt`).
5. **asset.** `assetService.scanWorkspace`가 홈 id면 돌아온다(§0-2). 테스트: 홈 run이 끝나도 홈 workspace에 asset 행이 없다.
6. **MCP 범위.** `RunContext`(지금 `runId`·`rootRunId`·`workspaceId`·`permission`·`agentKind`·`env`)에 `scope`를 더하지 않고 **`prepare`가 계산해
   토큰에 저장**한다(`TokenContext = RunContext & { scope }`) — 호출자(`execution.ts`)가 범위를 넘길 길이 아예 없게(FR-8). `McpHostDeps`에
   `workspaces: Pick<WorkspaceRepository, 'list' | 'home'>` — 쓰기 메서드를 MCP에 넘기지 않는다. `buildServer`가 `scope.kind`로 갈린다:
   - `workspace`: **지금 코드 그대로** — 함수를 `buildWorkspaceServer`로 이름만 옮긴다.
   - `all`: `buildAllServer`(새 파일 `core/mcp/allTools.ts`) — 도구 여덟(FR-9 — spec이 일곱으로 잘못 셌다), 쓰기도 `propose_issue`도 없다(§0-7). 대화 요약은 이미
     `core/mcp/conversations.ts`의 `summarizeConversations`·`conversationDetail`이고, `tools.ts`에서는 `issueSummary`·`memoSummary`·`issueOut`·
     `memoOut`·`RANGE`·`readRange`만 export해 같이 쓴다. 항목에 `workspaceId`·`workspaceName`만 얹는다. `get_*`의 소속 검사는 "행의 workspace가
     `deps.workspaces.list()`에 있는가" — `get_conversation`은 `runs.get(id)`로 workspace를 찾은 뒤 그 workspace의 `runs.list`로 펼친다.
     `list_conversations`의 `closed`.
   테스트: `all` 서버의 `tools/list`가 정확히 여덟(이름 집합) · 쓰기 도구·`propose_issue` 호출이 "없는 도구" · 홈 대화 id는 `get_conversation`이
   못 찾는다 · 두 workspace의 항목이 다 오고 이름이 붙는다 · **0단계 스냅샷이 그대로다**. `core/index.test`의 MCP deps 세 검사(홈·리포트 하나,
   그림, 정기 실행)는 그대로 초록이어야 한다. 그 검사는 `createMcpHost({ deps: { … } })`의 **소스 글자**를 `/home|reports|buildHomeSummary/`로 본다 —
   감싼 저장소 **변수** `workspaces`를 넘긴다. `{ list, home }` 같은 인라인 객체로 넘기면 `home`이 그 정규식에 걸리고, 그 정규식의 `[^}]*`가 첫 `}`에서
   멈춰 뒤의 deps를 보지 못한다.
7. **홈 요약.** `HomeSources.home`(필수) — §0-1·§0-9. 테스트: 홈 대화의 답변 필요가 할 일에 `홈`으로 뜨고 count에 세며, workspace 카드에는 없다 ·
   도는 홈 턴이 `running`에 `홈`으로 있다(에이전트 현황 패널이 같은 값을 쓴다).
8. **도크.** `Dock`의 필수 prop
   `variant: { kind: 'workspace' } | { kind: 'home'; cwd: string; open: boolean; onOpenChange: (open: boolean) => void }`.
   - 홈 갈래: 펼침을 App이 쥔다(제어 컴포넌트 — 카드 숨김과 같은 값을 봐야 한다). 머리에 안내 글자와 `읽기 전용` 배지, 접혀 있으면 대화 수 · 마지막
     시각. 새 대화 칸의 `RunPanel`에 `home` 갈래를 넘긴다: cwd 고정 · 작업 디렉토리 알약 없음 · 권한 알약은 `읽기 전용`에 잠김(`title`이 이유).
     맥락 칩 줄은 원래 칩이 없으면 서지 않는다. 대화 헤더 `⋯`의 이슈 할당 항목이 없다(§0-11).
   - **코드 칸·터미널·그림 버튼이 없는 것은 Provider가 없어서다.** 그 버튼은 `TitleBarSlotContext`의 자리에 포털로 서고 칸은 `CodePaneSlotContext`의
     자리인데, App은 두 Provider로 **workspace 도크만** 감싼다(`App.tsx` 677·678행). 홈 도크를 그 안에 넣지 말 것 — 넣으면 홈 화면 제목 줄에
     `파일`이 서고 누르면 열 자리(`.code-column`)가 없다.
   - 펼침 저장은 `renderer/homeDock.ts`(localStorage `one-desk.homeDock.open`, 읽기·쓰기 try/catch, 기본 `false`).
   - workspace 갈래는 **지금 동작 그대로** — 기존 `Dock.test` 전부 초록. 아직 선택인 `draftIssue`·`onClearDraftIssue`·`focusNew`·`onOpenIssue`
     (conversation-issue spec §7의 미룬 것)는 이 작업에서 필수로 올리지 않는다 — 홈 도크는 넘기지 않는다.
   테스트: 홈 갈래의 권한 알약이 잠겨 있고 보내는 입력이 `read_only`·홈 cwd다 · 처음 접힌 채 · 펼침이 `onOpenChange`로 나간다 · 헤더 메뉴에
   이슈 할당이 없다.
9. **인박스.** `InboxPanel`·`inboxView.ts`에 필수 `homeWorkspaceId: string | null`. 이름 `홈`, workspace별 보기에서 `홈 묶음`은 맨 아래(FR-14,
   NFR-3). `대화 열기`는 App의 `openConversation`이 run의 workspace가 홈이면 `setView('home')` + 홈 도크 펼침 + `focusConversationId`.
   홈 할 일·돌고 있는 것의 `답하기`·`다시 보내기`·`대화 열기`·`멈추기`도 같은 분기(`replyFromHome`·`resendFromHome`이 부르는
   `openReportConversation`에서 가른다 — 정기 실행 기록의 `대화 열기`도 그 함수지만 홈 대화가 거기 올 일은 없다, §0-8).
10. **홈 화면.** `HomePanel`에 필수 `composerHidden: boolean` — 카드 상자에 `hidden`(§0-4). 레이아웃: 홈 패널 아래에 홈 도크(시안 ①②). 펼치면 위쪽은
    줄어든 채 스크롤되고 도크가 나머지 — 높이는 기존 도크 높이 장치를 그대로 쓰되 시작은 하한(280px, ux-polish의 `compact`와 같은 값).
11. **App 배선.** `useHomeWorkspace`, `useRuns(homeId)`(홈 화면일 때만), 홈 도크 렌더(slot Provider 밖), 펼침 state ↔ `composerHidden`,
    `openReportConversation`·`openConversation`의 홈 분기. 테스트는 §4의 App 변이를 하나씩 잡는다.
12. **e2e.** 가짜 MCP CLI는 이미 `ONE_DESK_FAKE_MCP_CALL`(JSON `{ name, arguments }`)로 부를 도구를 받는다(agent-proposals) — 새 시나리오를 만들지
    않고 그것으로 `list_conversations`를 부른다. 그 가짜는 지금 프롬프트만 남기고(`ONE_DESK_PROMPT_CAPTURE`) 인자·cwd·도구 결과는 남기지 않으므로
    `ONE_DESK_FAKE_MCP_CAPTURE` 하나를 더한다 — 있으면 `{ cwd: process.cwd(), argv, result }`(result는 도구 결과의 text)를 그 파일에 쓴다. 실제
    프로세스의 cwd와 권한 인자를 보므로 run 행에 저장된 값보다 강하다. 없으면 지금 그대로라 `mcp.e2e`·`proposal.e2e`가 영향받지 않는다. `e2e/home-conversation.e2e.ts`가 spec §4의 셋을 본다(두 workspace의
    대화가 `workspaceName`과 함께 온다 · 캡처한 인자가 읽기 전용이고 cwd가 `home-conversation`이다 · 사이드바에 없고 인박스에 `홈`으로 뜨고 `대화
    열기`가 홈 도크로 연다). `list_workspaces`는 단위 테스트(6단계)가 맡는다. 전체 `pnpm test:e2e`로 `{ name: '홈' }` 부분 일치 충돌이 없는지 본다
    (NFR-3 — 도크 안내는 버튼이 아니고 묶음 머리는 `홈 묶음`이다).
13. **캡처와 문서.** 1440×900·1100×760에서 접힘·펼침 캡처(라이트·다크 — `emulateMedia`)로 시안과 비교. 전체 설계 §8에 한 줄(FR-1), `CLAUDE.md`에
    이 기능 절과 함정 절(§5의 1·2·7), 문서 표에 이 폴더. spec에 §0의 개정 열둘.

## 3. 바뀌는 파일

| 영역 | 파일 |
|---|---|
| DB | `core/db/schema.ts`, `drizzle/0015_*.sql`+meta, `core/db/repositories/workspace.ts`(+test) |
| core | `core/index.ts`(+test), `core/homeGuard.ts`(새 — 가드 래퍼), `core/execution.ts`(+test), `core/home/summary.ts`(+test), `core/proposals/guide.ts`(+test), `core/schedules/input.ts`(+test) |
| MCP | `core/mcp/host.ts`(+test), `core/mcp/tools.ts`, `core/mcp/allTools.ts`(새, +test), `core/mcp/tools.test.ts`(스냅샷) |
| shared/IPC | `shared/models.ts`, `shared/client.ts`, `shared/channels.ts`, `electron/ipc/workspaces.ts`, `electron/preload` |
| renderer | `renderer/App.tsx`(+test), `components/Dock.tsx`(+test), `components/RunPanel.tsx`(+test), `components/ConversationHeader.tsx`(+test), `components/ConversationList.tsx`, `components/ConversationPanel.tsx`, `components/InboxPanel.tsx`, `renderer/inboxView.ts`(+test), `components/home/*`(HomePanel·HomeComposer), `renderer/homeDock.ts`(새), `hooks/useHomeWorkspace.ts`(새), `index.css`(토큰만) |
| e2e | `core/runner/fixtures/fake-claude-mcp.mjs`(`ONE_DESK_FAKE_MCP_CAPTURE`), `e2e/home-conversation.e2e.ts`(새) |
| 문서 | `docs/superpowers/specs/2026-08-07-one-desk-design.md` §8 한 줄, `CLAUDE.md`, 이 폴더의 spec(§0 반영) |

## 4. 변이 (되돌려 빨개지는지 볼 것)

| 변이 | 잡는 테스트 |
|---|---|
| `list()`에서 `kind` 거름을 지운다 | workspace 저장소 "홈 행은 list에 없다" |
| `prepare`가 늘 `workspace` 범위를 준다 | host "홈 workspace의 토큰은 all 범위다" (NFR-2) |
| `buildAllServer`가 쓰기 도구나 `propose_issue`를 등록한다 | allTools "도구는 정확히 여덟, 쓰기·제안 없음" (NFR-2) |
| 홈 run의 `read_only` 검사를 지운다 | execution "홈 run은 read_only가 아니면 행을 만들기 전에 던진다" — start·resume 각각 (NFR-2) |
| 홈 run의 cwd 검사를 지운다 | execution "홈 run의 cwd는 core의 것이어야 한다" |
| `shouldProposeIssue`의 `home` 판정을 지운다 | guide "홈 턴에는 안내를 붙이지 않는다" + execution "홈 턴의 프롬프트에 이슈화 안내가 없다" |
| `get_conversation` 소속 검사에서 홈을 빼먹는다 | allTools "홈 대화 id는 없는 id와 같은 말" |
| `scanWorkspace`의 홈 가드를 지운다 | index "홈 run이 끝나도 홈에 asset이 없다" |
| `badgeRuns`의 `wsIds`에 홈을 안 넣는다 | summary "홈 대화의 답변 필요가 할 일에 홈으로" |
| `running`이 홈 대화를 훑지 않는다 | summary "도는 홈 턴이 running에 홈으로" |
| FR-4 가드 하나를 지운다 | index의 가드 테스트(여덟 각각) |
| `validateScheduleInput`의 `kind` 조건을 지운다 | input "홈 workspace로는 정기 실행을 만들 수 없다" — 메시지가 "workspace를 찾을 수 없습니다"인지까지 본다(repo 검사의 메시지와 갈린다) |
| 홈 갈래가 헤더의 이슈 할당 항목을 그린다 | Dock.test "홈 대화의 메뉴에 이슈 할당이 없다" |
| App이 홈 도크에 `variant` 홈 갈래 대신 workspace를 넘긴다 | 타입이 막는다(cwd 등 필드) + App.test "홈 도크의 권한 알약은 잠겨 있다" |
| App이 홈 도크를 slot Provider 안에 둔다 | App.test "홈 화면 제목 줄에 파일 버튼이 없다" |
| App이 `composerHidden`에 `false`를 넘긴다 | App.test "홈 대화를 펼치면 새 대화 카드가 숨는다" |
| App이 `homeWorkspaceId`에 `null`을 넘긴다 | App.test "인박스의 홈 대화는 홈으로 뜬다" |
| `openConversation`의 홈 분기를 지운다 | App.test "인박스에서 홈 대화를 열면 홈 화면의 도크로" |
| `openReportConversation`의 홈 분기를 지운다 | App.test "홈 할 일의 답하기는 홈 도크로 연다" |
| `homeDock.ts` 기본을 `true`로 | homeDock.test + App.test "홈 대화는 접힌 채 시작한다" |
| workspace 범위 도구 설명 한 글자 | 0단계 스냅샷 (NFR-1) |

## 5. 위험

1. **`Workspace`에 `kind`가 생기면 IPC로 나간다** — 의도다(렌더러가 홈을 가를 수 있다). 다만 `list()`가 홈을 안 주므로 렌더러가 `kind === 'home'`을
   보는 일은 `home()`의 결과뿐이다. 판정은 id 비교로 한다(`kind`로 거르는 렌더러 코드를 두면 두 자리가 된다).
2. **마이그레이션이 테이블을 다시 만들면 안 된다.** drizzle이 enum 변경을 rebuild로 내는 경우가 있다 — 생성된 SQL이 `ALTER TABLE … ADD COLUMN` 한
   줄이 아니면 손으로 쓴다(`root_run_id` 함정과 같은 cascade 위험은 없지만 — `workspace`를 DROP하면 cascade로 **모든 것**이 지워진다).
3. **홈 도크와 workspace 도크가 같은 `focusConversationId`를 본다.** 한 번에 하나만 마운트되므로(화면이 다르다) 섞이지 않지만, 홈 대화 id가
   workspace 도크로 가면 "못 찾음"으로 조용히 무시된다 — `openConversation`·`openReportConversation` 분기 테스트가 그것을 막는다. 초안 스토어의
   새 대화 키는 `new:<homeId>`라 workspace의 새 대화 칸과 섞이지 않는다.
4. **opencode의 읽기 전용 + 빈 폴더 cwd.** `verifyRunnable`이 `opencode debug config`를 빈 폴더에서 돈다 — 프로젝트 설정이 없으니 전역 설정만 남는다.
   읽기 전용의 OpenCode는 `` `${MCP_SERVER_NAME}_*` ``만 연다(agent-proposals spec §8의 6) — `all` 범위 도구 여덟도 그 키로 열린다. 실측은 opencode
   실행이 있는 장비에서 한 번(선택, `realOpencode`), 단위 테스트는 기존 경로 그대로.
5. **`all` 범위의 응답 크기**(spec §5-3, 기본 없음으로 결정). 실측으로 대화 50개 workspace 둘의 `list_conversations` 크기를 완료 증명에 적는다.
6. **단축키는 workspace 화면 그대로다.** Ctrl+J(대화창 토글)는 홈 도크에 넓히지 않고(spec에 없다), Ctrl+N(새 대화)은 지금처럼 workspace 화면의
   새 대화 칸으로 간다 — 홈 화면에서 누르면 홈을 떠난다. 써 보고 필요하면 따로.
7. **가짜 클라이언트에 `workspaces.home`이 있어야 한다.** App이 마운트하며 부르므로, 없으면 App을 그리는 테스트가 전부 던진다(`events.onItemChanged`·
   `proposals`와 같은 함정 — CLAUDE.md). App.test·Dock.test의 가짜를 같은 커밋에서 고친다.
8. **슬래시 커맨드 probe가 홈 폴더에서 돈다.** 입력부의 `/` 피커는 (workspace id, cwd)로 묻고(`commands`), 홈에서는 cwd가 빈 폴더라 사용자 수준
   커맨드만 나온다. 맞는 동작이지만 처음 한 번 `claude` init이 그 폴더에서 뜬다 — 캡처 때 확인한다. `@` 피커는 홈에 repo가 없어 아무것도 싣지
   않는다(FR-6).

**범위 밖으로 남은 것.** 리포트의 `agent에게 다듬기`는 이 사이클에서도 고른 workspace에 메모를 저장하고 그 workspace의 새 대화로 간다(spec §1).
홈 workspace에는 메모를 둘 수 없으므로(FR-4) 리포트를 홈 대화로 보내려면 다른 길(예: 리포트 마크다운을 홈 도크의 지시 초안에 넣기)이 필요하고,
그것은 spec 개정이다 — 2026-11-03 사용자가 다시 물은 것이라 이 plan과 따로 결정을 받는다.

## 6. 구현하며 달라진 것 (2026-11-03)

1. **`all` 범위 도구는 일곱이 아니라 여덟이다** — spec이 나열한 것(`list_workspaces` + list 넷 + get 셋)을 잘못 셌다. spec·plan의 수를 고쳤다.
2. **가드는 `core/changes.ts`가 아니라 새 파일 `core/homeGuard.ts`다** — 바뀜 알림과 일이 달라 갈랐다. `lockHomeWorkspace`(넷)와 `lockHomeCreate`
   (`create`·`createAuthored`)이고, `core/index.ts`가 알림 래퍼 바깥에서 한 번 감싼다.
3. **실행 서비스의 `home`은 함수가 아니라 값이다** — `{ workspaceId, cwd } | null`(필수). 홈 id는 부팅 때 정해져 앱이 사는 동안 같다.
4. **도크의 홈 갈래가 입력부에 넘기는 것은 `variant`가 아니라 `homeCwd: string | null`이다** (`ConversationPanel` → `RunPanel`, 둘 다 필수).
5. **캡처로 찾은 둘을 같은 작업에서 고쳤다.** 홈 도크 입력부 위에 "작업 디렉토리로 쓸 repo를 먼저 등록하세요"가 섰다(`RunPanel`의
   `repos.length === 0` 안내 — 홈에서는 끈다). 목록 줄과 헤더 부제에 내부 폴더 이름 `home-conversation`이 보였다 — `ConversationList`의 필수
   `repoNames`, `ConversationHeader`의 필수 `showRepo`를 더해 홈 갈래에서 끈다.
6. **인박스는 `homeWorkspaceId`를 받고 이름은 상수 `홈`이다**(`HOME_LABEL`) — `sourceLabel`·`groupByWorkspace`가 인자로 받는다. 홈 묶음은
   사라진 workspace보다도 아래다.
7. **e2e는 새 가짜 시나리오를 만들지 않았다** — `ONE_DESK_FAKE_MCP_CALL`로 `list_conversations`를 부르고 `ONE_DESK_FAKE_MCP_CAPTURE`
   (`{ cwd, argv, result }`)를 더했다.
8. **인박스의 `다시 실행`도 홈 대화면 홈 도크로 간다** — `goToRun`이 가르므로 `대화 열기`와 같이 따라왔다. 홈 도크가 App의 `draftPrompt`를 받는다.
9. **홈 도크는 `compact`로 그린다** — 펼치면 하한(280px)에서 시작하고 끌 수 있으며 그 높이는 저장하지 않는다(ux-polish FR-1과 같은 장치).
   최대화하면 홈 패널이 숨는다(`.main:has(> .dock-max) > .home`).

## 7. 완료 증명

- **기준선**(바꾸기 전, `main` `2eb74cc`): `pnpm typecheck` 0 · `pnpm test` 209 파일 · 3524 통과(같은 때 쓴 빨간 테스트 넷 제외).
- **마이그레이션** `drizzle/0015_bored_fixer.sql`: `workspace`에 `kind text DEFAULT 'normal' NOT NULL`을 더하는 ALTER TABLE 한 줄.
- **NFR-1** workspace 범위 서버의 `tools/list`(권한 셋)를 바꾸기 전에 `core/mcp/__snapshots__/tools.test.ts.snap`에 찍었고, 끝난 뒤에도 그대로다.
- **§4 변이 39개 전부 빨강**(대상 줄을 망가뜨리고 해당 테스트만 돌림, 스크립트로 자동 복원):

| 변이 | 결과 |
|---|---|
| `list()`에서 kind 거름 제거 | 1개 실패 |
| `prepare`가 늘 workspace 범위 | 17개 실패 |
| all 서버가 `create_issue` / `propose_issue` 등록 | 각 4개 실패 |
| 홈 run read_only 검사 / cwd 검사 제거 | 3개 / 1개 실패 |
| `shouldProposeIssue`의 home 판정 제거 | 2개 실패 |
| all 서버가 홈 workspace를 읽는다 | 2개 실패 |
| `scanWorkspace` 홈 가드 제거 | 1개 실패 |
| `badgeRuns`에 홈 id 빠짐 / `running`이 홈을 훑지 않음 | 각 1개 실패 |
| FR-4 가드 여덟 각각 제거 | 각 1개 실패(issues.create는 괄호를 지키는 변이로 다시 돌렸다 — 첫 변이는 문법이 깨져 빨갰다) |
| core가 실행 서비스에 / 요약에 홈을 안 넘김 | 각 1개 실패 |
| 정기 실행 검증의 kind 조건 제거 | 1개 실패 |
| workspace 범위 도구 설명 한 글자 | 1개 실패(스냅샷) |
| 도크: 이슈 할당 · 줄 repo 이름 · 헤더 repo 이름 · 펼침을 제 것으로 | 각 1개 실패 |
| 입력부: 권한 고정 · repo 안내 · 홈 cwd | 각 1개 실패 |
| App: `composerHidden` false · `homeWorkspaceId` null · `goToRun` 분기 · `openReportConversation` 분기 · workspace 갈래 · 펼침 저장 | 1·1·2·1·3·1개 실패 |
| `homeDock` 기본 펼침 · 인박스 홈 묶음 순서 | 각 1개 실패 |

  변이로 보지 않은 것 하나: App이 홈 도크를 코드 칸 slot Provider **안에** 두는 것 — 문자열 치환으로 만들기 어려워 돌리지 않았다. App.test의
  "제목 줄에 파일 버튼이 없다" 단언이 그 상태를 본다.
- **§5-5 응답 크기**: 홈을 뺀 workspace 둘 × 대화 50개(지시 ~200자 · 답 ~300자로 잘린다)의 `list_conversations` 한 번이 **100개 · 98,502자**
  (대화당 약 985자, JSON 들여쓰기 포함). 기본을 바꾸지 않은 결정(spec §5-3)은 그대로다.
- **e2e** `e2e/home-conversation.e2e.ts` 통과 — 가짜 MCP CLI가 브리지를 거쳐 `all` 범위의 `list_conversations`를 실제로 불러 두 workspace의 대화를
  받고, 캡처한 프로세스 cwd가 `home-conversation`, `--disallowedTools`에 Edit. 캡처 `e2e/artifacts/home-conversation-{folded,open}-{light,dark}.png`
  (1440×900). **1100×760 캡처는 찍지 않았다.**
- **마지막 실행**(이 브랜치, 2026-11-03): `pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm test` 212 파일 · 3584 통과 · `pnpm test:e2e` 39 파일 중 36 통과 ·
  3 건너뜀(선택 실행) · 75 테스트 · 310초. 세 경계 grep(`from 'electron'` in core, `window.oneDesk` 밖) 출력 없음.
- **기존 테스트 하나의 시간 제한을 늘렸다** — `core/index.test`의 "WSL claude 경로가 비었으면…"(FR-12). 가짜 wsl.exe → 가짜 CLI를 여러 번 띄워
  혼자 3.1초, 전체 실행에서 **`main`도 4,916·4,975ms**(기본 5초의 98~99%)였고 이 브랜치에서 테스트가 늘자 5,009·5,015ms로 넘었다. 동작 변화가
  아니라 부하라 15초를 준다(같은 파일의 프로세스를 띄우는 테스트들처럼).
