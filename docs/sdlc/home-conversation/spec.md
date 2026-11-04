# Spec: 홈 대화 — workspace를 넘어 읽는 읽기 전용 대화

- 출처: `intent.md` (승인 2026-10-26)
- 작성자: 권용현 (초안: Claude)
- 상태: 승인 (2026-10-26, 사용자가 시안 https://claude.ai/artifact/RenZHCTjPbjwNHW9K7HNwK 를 보고 "이렇게 해줘") — §5의 결정 반영. plan §0의 개정 열둘 반영 (2026-11-03 승인, 사용자 "승인, 구현해줘")
- 적용한 규칙: `CLAUDE.md`(세 경계 · App prop 필수 · 짧은 이름의 e2e 부분 일치 · `Run` 스프레드 · 색 토큰), 전체 설계 §8(이 spec이
  한 대화에 한해 뒤집는다 — FR-1), `docs/sdlc/home/spec.md` FR-1(홈 요약은 MCP에 없다 — 그대로 둔다)

## 0. intent의 미해결 질문에 대한 답

| 질문 | 답 |
|---|---|
| 어디에 저장하나 | **숨은 workspace 한 행**(`workspace.kind = 'home'`). 아래 표. |
| 어디서 띄우나 | `<dataDir>/home-conversation/` 빈 폴더. repo가 아니므로 host 환경, `@` 멘션·맥락 없음. |
| 대화록은 어디에 | **홈 화면 바닥의 도크.** 홈 workspace를 받은 `Dock`을 그대로 그린다(FR-12). |
| 여러 개인가 | 여럿. 도크 목록 그대로 — 끝내기·이름 바꾸기·이어 가기가 공짜로 따라온다. |
| 인박스·홈 배지·리포트 | 인박스와 홈 할 일에는 나온다(이름 `홈`). 리포트에는 안 나온다. |
| 결과를 메모로 | 이 사이클에는 없다 — `응답 복사`. (§5 우려 4) |
| 어느 workspace까지 | 홈 workspace를 뺀 전부. 고르는 화면 없음. |
| agent 종류 | 둘 다 받는다 — 읽기 전용과 MCP는 두 어댑터에 이미 있다. 기본은 claude. |

**저장 자리 비교** (intent의 세 대안)

| 안 | 비용 | 결과 |
|---|---|---|
| workspace 없는 run (`workspace_id` NULL) | SQLite는 NOT NULL을 풀려면 테이블을 다시 만들어야 하고, 그 `DROP TABLE run`이 `run_context_item`의 cascade를 태워 **모든 맥락 기록을 지운다**(CLAUDE.md `root_run_id` 항목과 같은 함정). 게다가 run을 읽는 모든 자리가 null을 다뤄야 한다 | **버림** |
| **숨은 workspace** (`kind` 컬럼) | `ALTER TABLE workspace ADD COLUMN` 하나(마이그레이션 `0015`, 백필 없음 — 기본값 `'normal'`). 목록을 거르는 자리를 저장소 한 곳에 둔다 | **고름** |
| 고른 workspace에 저장, 토큰만 넓힘 | 마이그레이션 없음 | 그 workspace의 도크·인박스·리포트에 "그 workspace의 대화"로 섞이고, workspace를 지우면 홈 대화가 같이 지워진다. **버림** |

`kind`를 컬럼으로 둔 이유: `app_setting`에 id 하나를 적는 안(마이그레이션 없음)도 있지만, 그 키를 잃으면 홈 workspace가 사이드바에 보통
workspace로 나타나고, 거르는 자리마다 설정을 읽어야 한다. 행 자신이 "나는 홈이다"를 말하는 편이 판정이 한 자리다.

## 1. 범위

**들어가는 것.** 홈 workspace(마이그레이션 `0015`), MCP 토큰의 범위(`workspace` | `all`)와 `all` 범위의 도구 여덟, 홈 대화의 실행 규칙
(읽기 전용 강제 · 빈 폴더 cwd · 앱 기본 CLI 경로), 홈 화면 바닥의 도크, 인박스·홈 할 일에서 홈 대화의 이름과 여는 길.

**빠지는 것.** intent "범위 밖" 그대로(다른 대화 조종 · 그룹 · 정해진 시각의 요약). 그리고 **workspace 범위 MCP는 한 글자도 바뀌지
않는다** — 도구 목록·설명·응답 모양 전부(NFR-1). 메모 저장 버튼, 범위 체크 화면, 대화를 읽는 글자 수 늘리기도 이 사이클 밖이다.

## 2. 기능 요구사항

### (A) 홈 workspace

- **FR-1** 전체 설계 §8의 "agent는 토큰의 workspace만 본다"에 예외를 하나 둔다: **홈 workspace의 run은 홈을 뺀 모든 workspace를 읽기만
  할 수 있다.** 근거는 intent(사용자 결정 2026-10-26). 전체 설계 §8에 이 문단을 가리키는 한 줄을 더한다 — MCP 상시 기동이 §14에 남긴
  것과 같은 방식.
- **FR-2** `workspace.kind`(`'normal' | 'home'`, NOT NULL, 기본 `'normal'`). 홈 행은 **core가 부팅 때 없으면 하나 만든다**(이름 `홈`). 둘
  이상이면 가장 오래된 것을 쓰고 나머지는 건드리지 않는다(만들 때 트랜잭션으로 검사하므로 정상 경로에서는 생기지 않는다).
- **FR-3** 저장소의 `workspaces.list()`는 **`normal`만** 준다. 홈 행은 `workspaces.home()` 하나로만 닿는다. 그래서 지금 `list()`를 쓰는
  모든 자리(사이드바·리포트·홈 요약의 workspace 카드·asset 스캔·`panelScope`·`home.lastTarget` 검증·…)는 손대지 않아도 홈을 보지
  않는다. 반대로 홈 행이 **필요한** 자리는 명시적으로 `home()`을 부른다(FR-6·FR-9·FR-14) — 홈 요약의 할 일·돌고 있는 것(plan §0-1·§0-9)이 그렇다.
  run이 끝난 뒤의 asset 재스캔은 홈 id면 돌지 않는다(plan §0-2 — 스캔이 글로벌 루트를 그 workspace 아래에 쌓는다). 정기 실행의 입력 검증은
  workspace 표를 직접 읽으므로 `kind = 'normal'`을 함께 본다(plan §0-8).
- **FR-4** 홈 workspace에는 사람이 손댈 길이 없다 — core의 `workspaces.rename`·`remove`·`updateDefaults`·`updatePaths`·`repos.create`·
  이슈·메모 만들기·`assets.createAuthored`(plan §0-10)가 홈 id를 받으면 던진다(없는 workspace와 같은 말이 아니라 "홈 workspace는 바꿀 수 없습니다"). 렌더러는 홈 id로 그런
  호출을 하지 않지만 IPC는 렌더러를 믿지 않는다.

### (B) 실행

- **FR-5** 홈 workspace의 run은 **권한이 `read_only`가 아니면 시작하지 않는다** — `start`·`resume` 둘 다, run 행을 만들기 전에 던진다.
  조용히 낮추지 않는다(사람이 고른 권한과 다른 것으로 돌면 대화록의 메타 줄이 거짓말이 된다).
- **FR-6** cwd는 core가 정한다: `<dataDir>/home-conversation/`(없으면 만든다). 렌더러가 보낸 `cwd`는 홈 run에서 무시하지 않고 **다르면
  던진다**(FR-5와 같은 이유). 렌더러는 이 경로를 IPC `workspaces.home()`이 주는 `{ workspace, cwd }`로 안다(plan §0-3). repo가 아니므로 실행 환경은 host,
  `@` 멘션은 아무것도 싣지 않고(`resolveMentions(null, …)` — 지금 동작), 맥락 칩은 없다(홈 workspace에 이슈·메모·asset이 없다).
- **FR-7** CLI 경로는 `ONE_DESK_AGENT_PATH` → **앱 기본 경로** → PATH 탐색이다 — workspace 예외 칸이 없을 뿐 `agentPathOf` 한 자리를
  그대로 탄다(홈 행의 `claude_path`·`opencode_path`는 늘 null). 실행 기본값(agent·모델·effort)은 홈 행의 컬럼이고 바꾸는 화면은 없다 —
  입력부 알약으로 턴마다 고른다.
- **FR-7a** 홈 턴에는 이슈화 안내(`PROPOSE_ISSUE_GUIDE`)를 붙이지 않는다(plan §0-7) — 홈 대화에는 이슈가 생길 수 없고 `all` 범위에는
  `propose_issue`가 없다. `shouldProposeIssue`의 필수 입력 `home`이 정기 실행의 `fromSchedule`과 같은 자리에서 끈다.

### (C) MCP

- **FR-8** `RunContext`에 범위가 생긴다: `scope: { kind: 'workspace'; workspaceId } | { kind: 'all' }`. **범위는 run의 workspace 행에서만
  나온다** — `prepare()`가 그 행의 `kind`를 읽어 정한다(`deps.workspaces.home()?.id`와 같은가 — plan §0-6). 렌더러·`LaunchSpec`·IPC 어디에도 범위를 넘기는 인자가 없다.
- **FR-9** `all` 범위의 서버는 **쓰기 도구도 `propose_issue`도 등록하지 않는다** — 권한 판정과 별개로, 범위 판정에서 먼저 끝난다(FR-5가 뚫려도 막는 두
  번째 겹). 등록하는 도구는 여덟(처음에 일곱으로 잘못 셌다 — 2026-11-03 구현 중 바로잡음):
  - `list_workspaces` — id·name·description·repo 수. 홈 행은 없다.
  - `list_repos(workspaceId?)`, `list_issues(workspaceId?, status?, repoId?, since?, until?)`, `list_memos(workspaceId?, repoId?, since?, until?)`,
    `list_conversations(workspaceId?, closed?, since?, until?)` — 인자 없으면 홈을 뺀 전부. **항목마다 `workspaceId`·`workspaceName`을
    싣는다.** 모양은 workspace 범위의 같은 도구에 두 필드를 더한 것이다(요약 함수를 같이 쓴다 — 따로 적지 않는다).
  - `get_issue(id)`, `get_memo(id)`, `get_conversation(id)` — 소속 검사는 "그 행의 workspace가 `normal`인가"다. 홈 대화는 없는 id와 같은
    말로 떨군다.
  `closed`는 `all` 범위에만 있다 — workspace가 많으면 끝낸 대화까지 다 실은 목록이 한 번의 호출로 커지므로 agent가 거를 수 있어야 한다.
- **FR-10** `all` 범위의 도구 설명은 "이 workspace의" 대신 "모든 workspace의"를 말하고, `list_conversations`의 설명은 "열린 대화만 보려면
  `closed: false`"를 말한다. 시각은 지금처럼 시간대가 붙은 ISO다.
- **FR-11** MCP `deps`에 `workspaces` 저장소가 더해진다. **홈 요약(`core.home`)과 리포트(`core.reports`)는 여전히 넘기지 않는다** —
  `core/index.test`의 "홈은 MCP deps에 없다"·리포트 쪽 같은 검사는 그대로 산다. 넓어진 것은 같은 저장소를 읽는 범위이지, 화면 전용 집계가
  아니다.

### (D) 화면

- **FR-12** 홈 화면 바닥에 **홈 workspace를 받은 `Dock`** 이 선다. 도크의 대화 목록·대화록·입력부·끝내기·이름 바꾸기·다시 보내기는 지금
  코드 그대로다. 다른 것:
  - 도크 머리에 `홈 대화 · 모든 workspace를 읽습니다` 안내(`role` 없는 글자).
  - 입력부의 **권한 알약은 `읽기 전용`에 고정**(누를 수 없다, `title`이 이유), **작업 디렉토리 알약은 없다**.
  - 코드 칸·터미널 버튼이 서지 않는다(App이 홈 화면에서 코드 칸 자리를 내리지 않는다 — 지금 인박스·설정과 같다).
  - 맥락 담기가 없다(담을 패널이 없다).
  - 대화 헤더 `⋯`의 이슈 할당·바꾸기·해제가 없다(plan §0-11 — 홈 workspace에는 이슈가 없다).
- **FR-13** ~~홈 화면의 새 대화 카드는 홈 도크가 접혀 있을 때만 선다.~~ **2026-11-03 개정 — 새 대화 카드를 걷었다**(§6, 사용자 결정
  "홈에서 다른 repo로 대화 보내기는 제거"). 홈 화면에서 보내는 대화는 홈 도크 하나다 — 그 workspace · repo로 보내려면 그 workspace
  화면으로 간다. 처음 켰을 때의 준비 단계(home spec FR-14)는 그대로이고, 그 ④ `첫 대화`도 지금처럼 workspace 화면의 새 대화 칸으로 간다.
- **FR-13a** 홈 도크는 **접힌 채 시작한다**(§5 우려 6의 결정 — 시안 ①). 접힌 줄은 `홈 대화 · 모든 workspace를 읽습니다 · 읽기 전용`
  배지와 대화 수 · 마지막 시각이다. 펼치면 홈의 위쪽(할 일)은 줄어든 채 남고 도크가 나머지를 쓴다(시안 ②). 펼침 상태는 이 장비의
  localStorage에 남는다.
- **FR-14** 인박스와 홈 할 일, 그리고 "지금 돌고 있는 것"(홈 화면 · `에이전트 현황` — plan §0-9, 실행 슬롯은 홈 턴도 센다)에서 홈 대화는 workspace 이름 자리에 `홈`이고, `대화 열기`·`답하기`·`다시 보내기`는 **홈 화면으로 가서** 그
  대화를 홈 도크에 연다(`focusConversationId`·`focusReply`를 홈 도크가 받는다). workspace 화면으로 가지 않는다 — 사이드바에 홈 workspace가
  없다. 인박스의 workspace별 보기에서 홈 대화는 `홈` 묶음이고 맨 아래다.
- **FR-15** 리포트의 **목록**에는 홈 대화가 나오지 않는다(FR-3으로 저절로 — workspace 체크 목록에 홈이 없다). **2026-11-03 개정 —
  리포트 화면 바닥에도 홈 도크가 선다**(§6, 사용자 결정 "리포트에서도 홈 대화를 넣어줘"). 홈 화면의 것과 같은 도크이고 펼침 상태도 하나다
  (FR-13a의 localStorage). 최대화하면 리포트를 숨긴다(홈과 같다).
- **FR-15a** (2026-11-03) 리포트의 **`agent에게 다듬기`는 메모를 만들지 않는다.** 지시 초안과 **지금 리포트의 마크다운**(`마크다운 복사`와
  같은 `toMarkdown` — 보이는 workspace·담을 것 그대로)을 홈 도크의 **새 대화 칸**에 채우고 도크를 펼친다. **보내지 않는다** — 사람이
  읽고 고쳐 보낸다(period-report FR-24와 같은 규칙). 홈 agent는 모든 workspace를 읽으므로 초안에 없는 것은 스스로 찾아 읽는다. 버튼은
  고른 workspace가 없어도 서고(메모를 쓸 곳이 필요 없다), 홈 자리를 아직 못 읽었으면 잠긴다. `<workspace>에 메모로 저장`은 그대로다.

## 3. 비기능 요구사항

- **NFR-1** workspace 범위 MCP의 회귀가 없다: `tools.test`의 기존 테스트가 전부 그대로 통과하고, workspace 범위 서버의 `tools/list`
  응답이 이 작업 전과 바이트로 같다(스냅샷 하나).
- **NFR-2** 범위 판정·소속 검사·읽기 전용 강제는 core의 테스트로 고정하고 변이로 확인한다 — 셋 중 하나를 지우면 빨개지는 테스트가 각각
  있어야 한다(`prepare`가 `kind`를 안 보게, `all` 서버가 쓰기 도구를 등록하게, FR-5 검사를 빼게).
- **NFR-3** 새 이름의 부분 일치: `홈`은 사이드바 진입점 `홈`과 같다 — 인박스 묶음 머리는 `홈 묶음`이고(지금 규칙 `<이름> 묶음`), 도크
  안내는 버튼이 아니다. e2e가 `{ name: '홈' }`을 exact로 잡는지 본다.
- **NFR-4** 세 경계를 지킨다. 홈 도크는 `Dock`을 고치지 않고 prop으로 다르게 그리는 것이 목표다 — 새 prop은 **필수**(`homeMode` 같은
  선택 prop이면 App 한 줄을 지워도 조용히 일반 도크가 된다).

## 4. e2e

`e2e/home-conversation.e2e.ts`(가짜 CLI): workspace 둘에 대화를 하나씩 돌린 뒤 홈 도크에서 지시를 보내면

1. 가짜 CLI가 받은 MCP 설정으로 `list_workspaces`·`list_conversations`를 실제로 호출해 두 workspace의 대화가 다 온다(가짜 CLI의 MCP
   시나리오 — `fake-claude-mcp.mjs` 패턴에 `ONE_DESK_FAKE_SCRIPT=home-mcp`를 더한다. 기본 시나리오는 건드리지 않는다).
2. 캡처한 인자의 권한이 읽기 전용이고 cwd가 `home-conversation`이다.
3. 그 대화가 사이드바 workspace 목록에 없고, 인박스에 `홈`으로 뜨며, 인박스의 `대화 열기`가 홈 화면의 도크로 연다.

## 5. 우려

**결정 (2026-10-26, 사용자가 시안을 보고 "이렇게 해줘").** 1은 plan이 맡는다. 2·3·4·7은 가정대로다 — 홈 대화는 홈 대화를 읽지 않고,
`closed`에 기본값이 없고(설명이 권한다), 메모 저장 버튼이 없고, 디스크 읽기는 지금 workspace 대화와 같은 노출로 본다. 5는 **도크를
펼친 동안 새 대화 카드를 숨긴다**(FR-13 — 가정을 뒤집었다, 시안 ②가 그렇게 그렸다). 6은 가정대로 접힌 채 시작한다(FR-13a).

1. **`workspaces.list()`를 거르는 것은 넓은 변경이다.** 지금 `list()`를 쓰는 자리는 core에만 여덟이고(`core/index.ts`), 그중 하나는
   실행 파일 경로를 찾는 `workspaceOf`다 — 홈 run이 여기서 workspace를 못 찾으면 어떻게 되는지는 plan이 확인해야 한다(FR-7은 "앱 기본
   경로로 간다"를 요구한다). 반대 방향(거르지 않은 자리가 남아 홈이 보이는 것)은 FR-3의 설계로 막힌다. → **plan에서 호출 자리를 전부
   표로 적는다.**
2. **홈 대화가 홈 대화를 읽어야 하나.** FR-9는 홈을 뺀다 — "어제 홈에서 정리한 것"을 agent가 못 본다. 넣으면 agent가 자기 요약을 다시
   요약하는 고리가 생기고 목록이 그만큼 커진다. → **사용자 결정.** (가정: 뺀다.)
3. **읽는 양.** 대화가 수십 개면 `list_conversations` 한 번이 수만 자다(대화마다 첫 지시 200자 + 마지막 답 300자). `closed: false`가 기본이
   아니라서 agent가 거르지 않으면 끝낸 대화까지 다 읽는다. workspace 범위 도구와 뜻을 맞추려고 기본을 바꾸지 않았다. → **사용자 결정:**
   `all` 범위에서만 `closed` 기본을 `false`로 할지. (가정: 기본 없음, 설명이 권한다.)
4. **결과를 남길 길이 없다.** 홈 대화는 쓰기가 없어 `create_memo`를 못 하고, 사람의 "메모로 저장" 버튼도 이 사이클에 없다 — 정리한 결과는
   대화록과 `응답 복사`에만 있다. 써 보고 불편하면 리포트의 `<workspace>에 메모로 저장`과 같은 버튼을 답 칸에 더한다. → **사용자 확인.**
5. **두 입력칸.** 홈 화면에 새 대화 카드(그 workspace로 보낸다)와 홈 도크 입력부(여기 남는다)가 같이 선다. FR-13의 글자로 가르지만, 잘못
   보내면 회사 workspace에 개인적인 질문이 대화로 남는다. 대안은 홈 도크가 있는 동안 카드를 숨기는 것이다(그러면 home spec FR-11의 첫
   대화 길이 사라진다). → **사용자 결정.** (가정: 둘 다 둔다.)
6. **홈 화면의 높이.** 홈은 이미 할 일 · 돌고 있는 것 · 타임라인 · 카드로 차 있다. 도크가 기본 높이(창의 50%)로 서면 1100×760 노트북 창에서
   할 일이 거의 안 보인다. (가정: 홈 도크는 **접힌 채** 시작하고, 펼치면 하한 280px — ux-polish FR-1의 `compact`와 같은 장치.) 캡처로
   확인한다.
7. **opencode의 읽기 전용.** opencode는 `OPENCODE_PERMISSION`으로 막고 `verifyRunnable`이 `ask`를 검사한다 — 파일 쓰기는 막히지만, cwd가 빈
   폴더라도 `read`는 절대 경로로 디스크 어디든 읽는다. claude도 같다(`Read`는 읽기 전용에 있다). 홈 대화가 "앱 데이터 폴더의 DB 파일을
   직접 읽는" 것은 막지 못한다 — 다만 그것은 지금 workspace 대화도 같다. → 새 노출이 아니라는 판단을 **사용자가 확인.**

## 6. 개정 (2026-11-03, 사용자 결정)

구현을 써 본 뒤 사용자가 둘을 정했다. "홈에서 다른 repo로 대화 보내기는 제거해줘, 그리고 리포트에서도 홈 대화를 넣어줘."

1. **홈의 새 대화 카드를 걷는다**(FR-13). 홈 도크가 생긴 뒤 홈에 입력칸이 둘이었다 — 펼침에 따라 하나만 보였지만, 카드는 그 workspace로
   보내고 떠나는 길이라 홈의 뜻("모든 workspace를 보고 여기 남는다")과 어긋났다. 함께 사라지는 것: `HomeComposer`, "마지막으로 보낸 곳"
   (home spec FR-7 — `core.home.lastTarget`·`setLastTarget`, IPC 두 채널, `HomeTarget`, `renderer/home/target.ts`), `HomePanel`의
   `composerHidden`. `app_setting`에 남은 `home.lastTarget` 행은 읽는 곳이 없을 뿐 지우지 않는다(마이그레이션 없음). `newRunInput`
   (`renderer/runDefaults.ts`)은 카드만 쓰던 함수라 함께 뺀다 — RunPanel은 원래 그것을 부르지 않았다.
2. **리포트 화면에도 홈 도크가 선다**(FR-15). 리포트를 보며 "이번 주 무엇이 막혔나"를 물을 자리가 리포트 안에 있어야 한다.
3. **`agent에게 다듬기`는 홈 도크로 간다**(FR-15a). period-report FR-24("메모로 저장한 뒤 그 workspace의 새 대화 칸")를 뒤집었다 — 리포트는
   workspace를 넘는 것인데 다듬기가 한 workspace를 골라야 했다(이 기능을 시작한 질문 그대로). 메모가 없으니 리포트가 맥락 칩이 아니라 지시
   초안의 글자로 간다. 리포트가 길면 입력칸이 길어진다 — 보내기 전에 사람이 본다는 규칙이 그것을 정당화한다.

"workspace를 넘는 데이터가 agent에게 가는 길은 사람이 누른 버튼이 만든 메모 하나"(period-report FR-24의 마지막 줄)는 이 기능의 FR-1이 이미
좁혔다 — 홈 대화가 둘째 길이고, 다듬기는 이제 그 길을 탄다.
