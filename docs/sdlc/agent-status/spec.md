# Spec: 사이드바 하단의 에이전트 현황 — 동작·설치·실행 환경·설정 파일

- 출처: 사용자 요청(2026-11-02) — "좌측 하단 MCP 있는 부분에 에이전트 동작 현황을 보여줘. 클릭하면 설정과 실행환경,
  에이전트 설치 상태, 동작 상태 등을 쉽게 볼 수 있게. 설정 파일도 클릭으로 바로 열 수 있게."
  요청이 구체적이고 새 판정이 설정 파일 하나뿐이라 intent·plan은 두지 않는다.
- 작성자: 권용현 (초안: Claude)
- 상태: 구현 완료 (2026-11-02, v0.30.0), 하단 줄 개정 (2026-11-03) — §4의 결정들은 뒤집을 수 있다.
- 마이그레이션·스키마 변경 없음. IPC 채널 둘(`app:configFiles`·`app:openConfigFile`)이 늘었다.

## 1. 하단 줄 (FR-1·FR-2)

**2026-11-03 개정 (사용자 결정)** — "MCP 포트 대신 간략하게 현재 연결된 agent와 MCP가 보이게". "연결된 agent"는 **쓸 수 있는
agent**(실행 파일이 잡힌 것)로 정했다(질문에 대한 답 — 지금 도는 agent만 보이는 안·둘 다 보이는 안을 버렸다).

- **FR-1.** MCP 줄이 버튼이고 글자는 `● Claude Code  ● OpenCode        ● MCP`다. 한 줄이고 MCP는 오른쪽 끝에 붙는다 — 좁으면
  agent 이름이 말줄임된다(줄바꿈하면 바닥이 들쭉날쭉하다). **포트·실행 수·대기는 글자에서 빠져 풍선과 패널로 갔다**(개정 전
  `● MCP :53021 … 실행 1/3 +2 대기`).
  - agent 칩은 `checkAgents`(빠른 칸 — 실행 파일)가 `ok`인 것이고 순서는 `AGENT_KINDS`, WSL claude는 끝에 `Claude Code (WSL)`
    (배포판은 풍선이 말한다). 판정 전이면 칩이 없고(MCP만), 하나도 없으면 `● agent 없음`(빨간 점)이다 — 둘은 다른 말이다.
  - 판정 대상은 고른 workspace, 없으면 첫 workspace다(패널과 같다). App의 `useAgentAvailability` 하나가 묻고 Sidebar의 필수 prop
    `agents`로 내린다. 다시 묻는 때는 대상이 바뀔 때, 그 workspace의 `workspace`·`repo` 바뀜 알림, 설정 화면에서 나올 때(앱 탭의
    CLI 기본 경로는 바뀜 알림이 없다 — 설정에 있는 동안은 묻지 않는다). **느린 칸(`probeAgents`)은 부르지 않는다** — 하단 줄은 늘
    떠 있어 그것을 부르면 workspace를 고를 때마다 claude init probe가 돈다(홈 준비 단계가 겪은 가짜 CLI 캡처 파일 덮기와 같은
    경합). opencode 판정의 `--version`은 (경로, 크기, mtime) 캐시라 한 번이다.
  - MCP 칩의 점 색이 MCP 상태다(초록·회색·빨강, 실패면 글자도 빨강). 도는 agent가 있으면 MCP 점이 숨쉰다(줄인 움직임 설정이면
    테두리). 실행 슬롯은 여전히 도크·설정과 같은 App의 `useQueue` 스냅샷이다.
  - 풍선: `Claude Code · OpenCode · MCP :53021 · 실행 1/3 · 대기 2 — 눌러서 에이전트 현황 보기`(판정 전이면 `agent 확인 전`, 없으면
    `쓸 수 있는 agent 없음`, 실패면 `MCP 연결 실패: <이유>`). 접힌 사이드바에서는 MCP 점만 남고 풍선이 전부를 말한다.
- **FR-2.** 버튼 이름은 `에이전트 현황` 하나로 고정이고 지금 값은 `aria-describedby`·`aria-live` 글자가 말한다. 이름에 바뀌는
  글자가 들면 매번 다른 버튼이 되고, `상태`·`설정`·`agent`·`실행 슬롯`을 품으면 e2e의 부분 일치 셀렉터(`getByLabel('상태')`·
  `{ name: '설정' }`·`getByLabel('agent')`·`{ name: '실행 슬롯' }`)에 걸린다. 글자에 `대기 N`을 쓰지 않는다 — `queue.e2e`가 화면
  전체에서 `getByText('대기 1')`로 도크의 슬롯 표시기를 잡는다(풍선은 글자가 아니라 괜찮다).

## 2. 패널 (FR-3~FR-5)

- **FR-3.** 하단 줄을 누르면 `에이전트 현황` popover가 줄의 오른쪽에 바닥을 맞춰 뜬다(anchor positioning, 최상위 레이어 —
  사이드바 안에 두면 사이드바의 overflow에 잘린다). 모달이 아니다. Esc(안쪽부터 푼다 — `preventDefault`+`stopPropagation`),
  바깥 누르기, 닫기 단추, 다시 누르기로 닫는다. 하단 줄 버튼은 바깥이 아니다(`AGENT_ACTIVITY_TRIGGER_ID`). 열린 동안만
  마운트한다 — 닫혀 있으면 CLI를 묻지 않는다. 상태(`activityOpen`)는 App이 쥐고 Sidebar의 필수 prop으로 내린다.
- **FR-4. 지금 동작** — MCP 서버(포트·실패 이유), 실행 슬롯과 기다리는 턴, 요금제 사용률(있을 때), 도는 대화(홈 요약의
  `running` — 제목·workspace·repo·지금 도는 도구·경과). 대화의 `열기`(이름 `<제목> 대화로 가기`)는 패널을 닫고 그 대화를 연다
  (리포트·홈과 같은 `openReportConversation`).
- **FR-5. 에이전트 설치 · 실행 환경** — 설치는 설정 실행 탭·홈 준비 단계와 **같은 `useCliReadiness`와 `AgentStatusRow`**다(실행
  파일 → 인증 → 모델, WSL repo가 있으면 WSL 줄). 기준 workspace는 고른 것, 없으면 첫 workspace다 — CLI 판정이 workspace의 경로
  설정을 타기 때문이다. workspace가 없으면 묻지 않는다. 실행 환경은 그 workspace의 기본 agent·모델·effort/variant·권한(이름은
  `AGENT_LABELS`·`PERMISSION_LABELS` 표)과 동시 실행 상한, 앱 버전·OS다. `설정 열기`는 패널을 닫고 설정 화면으로 간다.

## 3. 설정 파일 (FR-6~FR-9)

- **FR-6.** 목록은 셋으로 묶인다.
  - 이 장비: `~/.claude/settings.json`(Claude Code 사용자 설정) · `~/.claude.json`(전역 상태 · user 범위 MCP 서버) ·
    `~/.config/opencode/opencode.json`(→ `.jsonc` → `config.json` 중 있는 첫 것). **없는 파일도 보인다** — 어디에 두면 되는지가 쓸모다.
  - WSL repo가 도는 배포판마다 하나: 그 배포판 홈의 `~/.claude/settings.json`(UNC). 배포판 홈을 못 물으면 그 줄만 빠진다.
    WSL repo가 없으면 배포판 홈을 묻지 않는다(VM을 깨우지 않는다 — wsl-repo-setup §5의 1).
  - repo마다: `.claude/settings.json` · `.claude/settings.local.json` · `.mcp.json` · `opencode.json(c)`. **있는 것만 보인다** —
    repo마다 넷씩 "없음"이 서면 목록이 묻힌다.
  - one-desk 자신: 데이터 폴더·로그 폴더(정보 탭과 같은 `reveal`).
- **FR-7.** 렌더러는 **경로가 아니라 (종류, repo id)를 넘긴다**(`ConfigFileRef`) — 정보 탭의 `reveal`이 이름만 받는 것과 같은
  이유다. 경로를 넘길 수 있으면 IPC 한 번으로 디스크의 아무 파일이나 OS 기본 앱으로 연다(실행 파일이면 실행된다). 판정은
  `core/app/configFiles.ts`의 `parseConfigFileRef`(종류 목록·종류에 맞는 repoId 모양) → repo 조회(없으면 던진다) → 후보 중 있는
  첫 파일(없으면 던진다). electron은 `shell.openPath`만 한다.
- **FR-8.** 파일 확인은 비동기 `stat`이고 폴더는 파일로 치지 않는다 — `\\wsl$` UNC의 동기 stat이 잠든 VM을 깨우는 동안 메인
  프로세스(MCP 서버가 같이 있다)를 멈추지 않게.
- **FR-9.** 이름은 렌더러의 한 표(`renderer/configFiles.ts`의 `CONFIG_FILE_LABELS`)이고, 열기 단추 이름은 `<이름> 파일 열기`,
  repo의 것은 `<repo> · <이름> 파일 열기`다.

## 4. 사용자가 뒤집을 수 있는 결정

1. **OS 기본 앱으로 연다** — VS Code로 열지 않았다. `.json`에 연결된 앱이 없으면 Windows는 "연결 프로그램" 대화상자를 띄운다.
2. `~/.claude.json`을 목록에 넣었다 — user 범위 MCP 서버가 거기 산다. 계정 정보도 들어 있는 파일이지만 사용자 자신의 장비에서
   사용자의 편집기로 여는 것이다(어디로도 보내지 않는다).
3. 지시 파일(`CLAUDE.md`·`AGENTS.md`)은 넣지 않았다 — repo의 것은 이미 `지시 파일` asset으로 보인다.
4. 없는 설정 파일을 만들어 주지 않는다.
5. 도는 대화 목록은 홈 요약을 다시 읽는다(열린 동안 2초) — 홈과 같은 비용이다.

## 5. 검증

- 단위: `core/app/configFiles.test.ts`(13 — 모양 거부·후보·묶음·WSL 배포판 한 번·홈 실패·VM 안 깨움·pathOf),
  `core/index.test.ts`의 "설정 파일" 배선, `renderer/configFiles.test.ts`·`agentActivity.test.ts`,
  `AgentActivityPanel.test.tsx`(15), `Sidebar.test.tsx`의 "에이전트 실행 현황", `App.test.tsx`의 "에이전트 현황 배선"(6).
- 변이: App의 `queue`(사이드바·패널 각각)·`mcpStatus`·`workspaces`·`onOpenSettings`·`onOpenConversation`·토글, core의 존재 검사·
  repoId 모양 검사·배포판 중복 제거·WSL 종류 검사·`isFile`의 폴더 판정·`homeDir` 배선 — 전부 빨개지는 것을 확인했다.
- e2e: `e2e/agent-status.e2e.ts` — 하단 줄 → 패널 → repo의 `.mcp.json` 열기가 `shell.openPath`에 그 경로로 닿는지, Esc. 캡처는
  `e2e/artifacts/agent-status-panel{,-dark}.png`.
