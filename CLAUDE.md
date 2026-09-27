# one-desk

workspace/repo/issue/memo를 한 화면에서 관리하고, 필요한 맥락을 골라 CLI 코딩 agent(Claude Code, OpenCode)에게 넘겨 헤드리스로 실행한 뒤 결과를 앱에 기록하는 Electron 데스크톱 앱.

**현재 상태:** 4단계 완료(MCP 서버 — 호스트/도구 아홉 개/권한별 등록/커맨드 배선), `main`에 병합됨(`a19b4fd`). 이슈·메모 본문 편집(설계 `2026-08-14-issue-memo-body-design.md`)도 `main`에 병합됨(`c91438e`) — 저장소의 `updateIfUnchanged`로 낙관적 잠금, 선택한 패널이 커지는 동적 3컬럼, 맥락 담기와 열기 분리, `IssueDetail`·`MemoDetail` 본문 편집기, 그리고 `e2e/body.e2e.ts`가 IPC 왕복(`client.issues.updateIfUnchanged` → preload → `ipcMain.handle` → 저장소)을 실제로 검증한다. **상태 편집은 상세에만 있다** — 목록의 상태 칩은 읽기 전용 배지다(§5·§9). 3b 리뷰가 4단계로 이월한 것 둘 다 해소됐다: `core/`의 `console.error`가 주입식 `onError`로 바뀌었고, `resume`의 catch는 DB 장애를 더 이상 뭉개지 않는다.

**릴리스 파이프라인**(설계 `2026-08-14-release-pipeline-design.md`)이 붙었다. `v*` 태그를 밀면 GitHub Actions가 빌드해 draft 릴리스에 산출물을 올린다. **지금 빌드하는 것은 Windows portable `.exe`(x64) 하나뿐이다** — 받아서 쓰는 사람이 Windows뿐이고, release job이 `needs: build`라 다른 플랫폼이 깨지면 Windows 산출물까지 못 올라가기 때문이다(워크플로 matrix 주석에 되살리는 법이 적혀 있다). macOS는 개발 장비에서 `pnpm run pack`으로 언제든 만든다. **네이티브 모듈 때문에 크로스 컴파일은 불가능하므로** — `better-sqlite3`를 각 러너에서 그 플랫폼의 Electron ABI에 맞춰 컴파일한다. Windows 러너는 `windows-2022`로 고정돼 있다(최신 이미지의 Visual Studio 18을 node-gyp가 못 읽는다).

**agent는 MCP에 stdio로 붙는다**(설계 `2026-08-14-mcp-stdio-design.md`) — claude가 `core/mcp/bridge.mjs`를 자식 프로세스로 띄우고, 브리지가 앱 안의 HTTP 서버로 중계한다. 사내 프록시가 루프백 HTTP를 403으로 막던 환경 때문이다. `ONE_DESK_REAL_CLI=1 pnpm test realCli`가 진짜 CLI로 이 계약을 검증한다.

**MCP 서버는 이제 부팅과 함께 뜬다**(설계 `2026-08-14-mcp-always-on-design.md`). 전체 설계 §14의 "앱을 여는 행위가 아무것도 시작하지 않는다"를 사용자가 명시적으로 뒤집은 것이다 — 사이드바 하단이 `● MCP :53021`로 상태와 포트를 보여준다. 토큰은 여전히 run 단위라, run이 없는 동안 서버는 401만 돌려주는 껍데기다. **포트는 원래부터 동적이었다** — `listen(0)`이 OS에게 빈 포트를 받으므로 충돌이 구조적으로 불가능하다.

같은 작업에서 **Windows 실행 경로**가 처음으로 열렸다. 실행 파일 탐색이 `core/runner/executable.ts`로 떨어져 나와 `PATHEXT`와 폴백 디렉토리를 다루고, `.cmd` 설치본은 preflight가 명확한 메시지로 거부한다. 그 과정에서 로그 스트림의 미처리 오류가 메인 프로세스를 죽이던 결함도 잡혔다.

**대화(세션을 이어가는 대화)**가 10개 태스크로 완성돼 `main`에 병합됐다(`79a612e`, 설계 `2026-08-18-conversation-design.md`, 계획 `2026-08-18-conversation.md`). v0.2.0으로 릴리스됐다 — **첫 실행에 마이그레이션이 돈다**(`run.root_run_id` 추가 + 기존 행 백필). run은 더 이상 일회용이 아니라 전부 대화다: `run.rootRunId`가 턴을 한 대화로 묶고(승계 규칙은 "부모의 rootRunId, 부모가 없으면 자기 id"), 도크는 run이 아니라 대화 단위 탭이며(`Dock.tsx`의 `groupConversations`), 인박스 항목도 대화 하나당 한 줄로 그 대화의 마지막 턴을 보여준다 — "로그 보기"·"이어서 실행" 두 버튼이 "대화 열기" 하나로 합쳐졌다. **대화당 예약은 하나뿐이다**(설계 §3-2): 앞 턴이 도는 중에 다음 지시를 보내면 그 턴은 `pending`으로 대기 버블만 만들고 전송이 잠긴다 — `RunQueue`의 `groupKey`(대화의 root run id)가 같은 대화의 두 턴이 동시에 뜨는 것을 막는다(`claude --resume`은 이전 프로세스가 끝나야 한다). 대화록의 각 턴은 **전부 접힌 채로 시작한다 — 진행 중이어도 마찬가지다**(2026-09-22, 사용자가 설계 §4-1을 뒤집었다: 도구 호출이 흐르면 대화록이 그것으로 가득 차 지시와 답변이 밀려난다). "자세히"를 눌러야 도구 호출 같은 세부가 보이고, 최종 답변과 상태 배지는 항상 보인다. **펼치고 접는 것은 전부 사용자가 정한다** — 상태 전이가 그 선택을 되돌리지 않으므로 `Turn`에는 `open`을 강제하는 effect가 없다(되살리면 `Transcript.test`의 "예약된 턴이 자동으로 시작돼도 접힌 채로 남는다"가 빨개진다). `e2e/conversation.e2e.ts`가 화면을 벗어나지 않고 3턴을 실제로 주고받아 이 핵심 약속 — 특히 "앞 턴이 끝나면 예약된 턴이 자동으로 뜬다" — 을 검증한다.

**5단계의 첫 하위 과제인 OpenCode 어댑터가 붙었다**(설계 `2026-09-06-opencode-adapter-design.md`, 계획 `2026-09-06-opencode-adapter.md`). 마이그레이션은 없다 — 스키마에 이미 `defaultAgentKind`·`defaultModelOpencode`·`opencodePath`가 있었다. 실행 패널의 agent 드롭다운이 열렸고(그전까지 `disabled`였다), 대화를 이어갈 때만 잠긴다. 5단계는 세 하위 시스템이 서로 독립이라 **하나의 스펙으로 묶지 않고 각각 spec → plan → 구현 사이클을 따로 돈다.**

**asset 스캔도 붙었다**(설계 `2026-09-07-asset-scan-design.md`, 계획 `2026-09-07-asset-scan.md`). **첫 실행에 마이그레이션 `0004`가 돈다** — `asset` 테이블 하나가 추가된다. repo의 `.claude/skills/*/SKILL.md`·`.claude/agents/*.md`·`.opencode/agent/*.md`를 훑어 목록에 띄우고(`discovered`), 앱에서 직접 쓴 것(`authored`)과 함께 맥락에 담아 실행에 실어 보낸다. `SKILLS / AGENTS` 패널의 자리표시자가 사라졌다.

**asset 범위가 글로벌까지 넓어졌다**(intent·spec·plan은 `docs/sdlc/asset-scope/`). **첫 실행에 마이그레이션 `0005`가 돈다** — 동일성 인덱스를 갈아끼우고 그 전에 중복 행을 정리한다. repo 루트뿐 아니라 `~/.claude/skills` 같은 **글로벌 경로**도 훑고, 그 경로는 **설정 화면의 앱 탭**에서 claude용·opencode용을 따로 정한다. 목록은 repo를 고르면 글로벌 + 그 repo만 보여주고, run이 끝나면 그 workspace를 다시 훑는다.

**workspace 실행 기본값이 배선됐다** (2026-09-19). `default_model_claude`·
`default_model_opencode`·`default_agent_kind` 세 컬럼은 스키마에만 있고 **읽는 코드가
없거나(모델 둘) 바꿀 UI가 없어(agent)** 모델을 고정하려면 매 실행마다 손으로 쳐야 했다.
전체 설계 §131·§199가 컬럼을, §403이 "workspace 기본값은 설정 화면에서 바꾼다"를 이미
정해 두었으므로 **설계가 버린 것이 아니라 구현이 빠진 자리였다** — 지워야 할 컬럼이
아니라 이어야 할 배선이었다. 마이그레이션은 없다. 설정 화면 아래에 절이 하나 붙어
(글로벌 asset 경로는 앱 전역, 이 절은 **고른 workspace 하나**의 범위다) agent와 모델 둘을
저장하고, 실행 패널의 모델 칸이 **지금 고른 agent에 따라** 해당 칸에서 기본값을 가져온다.
저장소 메서드는 `update`가 아니라 `updateDefaults`이고 **부분 갱신을 받지 않는다** —
세 값을 전부 받아 무엇이 덮이는지가 흐려지지 않게 한다(`rename`만 열어 두었던 이유와
같다). 빈 모델은 null로 저장한다(null = "CLI 자신의 기본값"). `e2e/workspace-defaults.e2e.ts`가
설정 저장 → 실행 패널 반영까지 IPC 왕복을 실제로 검증한다.

**같은 모양의 구멍 둘도 이어서 메웠다.** 이제 workspace 설정은 세 절이고 **절마다 저장이
따로다.** `default_permission`은 실행 기본값 절에 들어갔고, 전체 설계 §403이 요구한
**별도 확인 절차**는 `ConfirmButton`(두 번 누르기)과 경고 문장으로 붙었다 — 다만
**전체 허용으로 "올릴 때"만 묻는다.** 이미 전체 허용인 workspace에서 모델만 고칠 때까지
확인을 요구하면 사람이 확인 자체를 읽지 않게 되기 때문이다. `claude_path`·`opencode_path`는
"CLI 경로" 절이 따로 받고(`updatePaths`), 그 아래에 **지금 무엇이 잡히는지**를
`core.workspaces.checkAgents`로 보여준다 — 전체 설계 §595가 그린 고리("실행이 막힘 →
설정에서 경로 지정")의 마지막 칸이다.

**경로 절과 기본값 절을 한 저장으로 합치지 말 것.** 고치는 때가 다르다 — 경로는 PATH가
깨졌을 때 한 번 고치는 것이고 기본값은 계속 손보는 것이라, 합치면 경로를 고치러 온 사람이
모델 기본값까지 함께 덮어쓴다. 저장소의 `updateDefaults`/`updatePaths`도 같은 이유로
갈라져 있고, 각자 **부분 갱신을 받지 않는다**(자기 몫의 값을 전부 받는다).

**`checkAgents`는 실행과 같은 판정을 써야 한다.** `resolveAgentPath` → 어댑터 `preflight`를
그대로 탄다(`ONE_DESK_AGENT_PATH`가 workspace 설정을 이기는 것까지 같다). 따로 구현하면
**설정 화면은 초록인데 실행 버튼은 막히는** 상태가 생긴다. claude는 프로세스를 띄우지 않아
값싸다. **opencode는 처음 한 번 `--version`을 띄운다** — 2.x를 막는 버전 게이트가 preflight
안에 있기 때문이다(`docs/sdlc/conversation-fixes/` FR-17). 같은 판정을 쓰는 규칙은 게이트를
preflight에 둔 것으로 지켜진다 — `core/index.test.ts`의 "opencode 2.x는 설정 화면과 실행이
같은 이유로 막고, 버전은 한 번만 읽는다"가 사유의 글자까지 비교한다. 결과는 (경로, 크기,
mtime)으로 캐시하므로 그 뒤로는 stat뿐이다.
e2e에서 진짜 경로를 넣어 검증하려면 `launchApp({ agentPath: '' })`로 그 변수를 비워야 한다 —
비우지 않으면 무엇을 넣든 가짜 CLI가 이긴다.

**설정 화면은 네 탭이다**(intent·spec·plan은 `docs/sdlc/settings-screen/`). 실행 · 앱 · repo ·
정보 — **탭은 값의 범위로 가른다.** 실행과 repo는 지금 고른 workspace 하나에, 앱은 장비
전체에 걸리고, 정보는 읽기 전용이다. 위에서 "세 절"이라 부른 것이 탭으로 갈라졌다 —
실행 기본값(권한 포함)과 CLI 경로는 **실행 탭**에, 글로벌 asset 경로는 **앱 탭**에 있고
동시 실행 상한이 앱 탭에 더해졌다. **절마다 저장이 따로인 것은 그대로다.** 정보 탭은
MCP 상태와 포트 · DB 파일 · 로그 디렉토리 · 앱 버전을 보여주고 데이터/로그 폴더를 연다 —
여는 대상은 경로가 아니라 **이름**(`'data'`·`'logs'`)으로 넘긴다. 임의 경로를 여는 통로를
만들지 않기 위해서고, 그 검증은 `core/app/reveal.ts`의 순수 함수다(electron IPC에는 테스트가
없어 main에 두면 아무것도 고정하지 못한다 — `core/editor/vscodeUrl.ts`와 같은 구조).

**초안 state는 전부 `SettingsPanel`이 쥔다 — 절을 자식 컴포넌트로 떼면서 state를 함께
내리지 말 것.** 탭 전환이 곧 언마운트가 되어 고치던 입력이 사라진다(spec FR-11). `RepoTab`·
`InfoTab`이 떨어져 나가 있는 것은 **state 없이 그리기만 하기 때문**이다. e2e "탭을 옮겼다
돌아와도 고치던 입력이 그대로다"가 이것을 고정한다.

**repo 이름·경로·설명은 이제 repo 탭에서 고친다** — 그전에는 DB를 SQL로 직접 고쳐야 했다.
경로를 바꾸면 그 repo의 asset `file_path`가 같은 트랜잭션에서 따라 옮겨간다(아래 함정 절).

**문서 체계가 하나 늘었다.** 이 작업부터 `docs/sdlc/<기능>/`에 intent → spec → plan 세 artifact를 두고 각각 사람의 승인을 받는다. 기존 `docs/superpowers/{specs,plans}/`는 그대로 두고 새 작업만 이쪽을 쓴다.

남은 5단계 과제는 diff 뷰어 하나다. **착수를 막던 환경변수 결정은 해소됐다**(아래 절). 본문 작업이 넷으로 쪼갠 것 중 첫째였으므로 나머지 셋(마크다운 렌더링 · 검색/필터/정렬 · run 완료 구독)도 후보로 남아 있다. 대화 기능은 이 목록과 별개로 진행돼 완료·병합됐다(위 절). 그중 **run 완료 구독은 이미 해소됐으므로** 남은 것은 마크다운 렌더링과 검색/필터/정렬 둘이다.

**이슈 훑기**가 붙었다(설계 `2026-08-27-issue-triage-design.md`, 계획 `2026-08-27-issue-triage.md`). **첫 실행에 마이그레이션 `0003`이 돈다** — 컬럼 다섯 추가 + 기존 이슈의 `triaged_at` 백필. 이슈를 제목 한 줄로 던져 넣고 분류는 나중에 훑기로 몰아서 한다. 목록은 축(급함·출처·성격·repo)으로 묶고 접되 **접혀도 개수는 보이며**, 그룹 안은 `seenAt` 오래된 순이다. MCP `create_issue`가 축을 받으므로 agent가 회의 메모를 이슈로 쪼개며 분류까지 끝낼 수 있다.

**asset 종류가 셋이다** (2026-09-21, `docs/sdlc/repo-instructions/`). `skill`·`agent`에 더해
repo 루트의 `CLAUDE.md`·`AGENTS.md`가 `instructions`로 목록에 오른다. **보기 전용이다** —
CLI가 실행할 때 알아서 읽는 파일이라 담으면 두 번 들어가므로, 패널에 담기 버튼이 없고
core의 `collectContext`가 그 id를 거부한다(`assertFound`와 같은 자리에서 `start`가 던진다).
앱에서 작성할 수도 없다. 같은 작업에서 **discovered asset의 본문이 드디어 보인다** —
`assets.readBody(id)`가 파일의 지금 내용을 읽어 온다. **id로만 받는다**: 렌더러가 경로를
넘기는 통로는 없다(`core/app/reveal.ts`가 이름만 받는 것과 같은 원칙). 읽기 함수는
`core/assets/body.ts` 하나이고 실행 서비스도 그것을 쓴다. 마이그레이션 없음 — `kind`에
CHECK 제약이 없다.

**agent 준비 상태와 실행 조건이 붙었다** (`docs/sdlc/agent-setup/`). **첫 실행에
마이그레이션 `0007`이 돈다** — 컬럼 셋 추가(`workspace.default_effort_claude`·
`default_variant_opencode`, `run.effort`). 설정 화면의 CLI 상태가 **세 칸이 쌓인 판정**을
보여준다: 실행 파일(기존 `checkAgents`, 값싸다) → 인증(`auth status`/`auth list`) →
모델(`init`의 `model`). **`checkAgents`는 그대로 두고 `probeAgents`를 옆에 놓았다** —
느린 칸(1~1.6초)을 합치면 workspace를 고를 때마다 실행 파일 줄까지 비어 있게 된다.
**모델 probe는 슬래시 커맨드 probe와 같은 기동·같은 캐시다**(`commands.agentInfo`) —
CLI가 새로 뜨지 않는다. 모델 칸은 `<datalist>`가 붙은 자유 입력이고(opencode는
`opencode models`의 382개, claude는 `renderer/models.ts`의 별칭 표), **목록에 없는 이름도
그대로 실행에 쓰인다** — 드롭다운으로 강제하면 표가 낡은 날 새 모델을 아예 못 쓴다.
effort는 claude만 다섯 단계 드롭다운이고 opencode의 `--variant`는 자유 입력이다
(provider마다 값이 다르다).

**슬래시 커맨드가 붙었다** (`docs/sdlc/slash-commands/`). Claude Code 실행 입력에서 `/`로
커맨드를 검색하고 ↑↓·Enter/Tab으로 삽입한다. 목록은 cwd마다 한 번 얻어 core에 캐시하며,
실패 결과도 수동 새로고침 전까지 유지한다. probe는 init 직후 SIGKILL로 종료한다 — 일반 실행의
SIGTERM 유예를 쓰면 모델 호출까지 진행할 수 있다. OpenCode에서는 피커와 조회를 비활성화한다.
슬래시 프롬프트는 커맨드를 맨 앞에 두고 맥락·답변 필요 안내를 뒤에 붙인다. 마이그레이션 없음.
`e2e/slash.e2e.ts`가 IPC부터 실제 CLI stdin까지, 선택 실행하는 `e2e/slash-real.e2e.ts`가
실제 Claude의 첫 턴·resume 커맨드 확장을 검증한다.

**대화에 수명 주기와 정체성이 생겼다** (`docs/sdlc/conversation-lifecycle/`). **첫 실행에
마이그레이션 `0008`이 돈다** — `run.title`·`run.closed_at` 두 컬럼 추가(백필 없음). 증상은
셋이었지만 뿌리는 하나였다: 대화가 저장되지 않는 파생값이라 "끝났다"도 "무엇에 관한
것이다"도 어디에도 없었다.

- **빨간 배지는 이제 행동을 요구하는 것만 센다** — 답변 필요·실패·중단됨. 완료·미확인은
  세지 않는다(예전에는 대화 수만큼 단조 증가했다). 인박스 *목록*은 그대로다.
- **본 대화는 저절로 확인된다.** 도크 목록에서 대화를 **명시적으로 누르면** 뿌리에
  확인 표시가 찍힌다. 되돌리는 자리는 원래 있었다 — `create(parentRunId)`가 뿌리의
  `reviewedAt`을 지우므로 새 턴이 오면 배지에 다시 오른다. **열어 봐도 남는 것은 답변
  필요뿐이다** — 실패·중단은 배지에 세지만 열면 내려간다(2026-09-27, `conversation-fixes`).
- **대화를 끝낼 수 있다.** 줄 끝 체크(`IconCheck` — ×는 삭제로 읽힌다)가 `closed_at`을
  찍고 **같은 트랜잭션에서 확인도 겸한다.** 끝낸 대화는 목록 아래 "끝낸 대화" 토글로
  내려가고, 턴을 이으면 되살아난다.
- **도크가 세로 목록이다.** 가로 탭 스트립(`.dock-tabs`)이 사라지고 본문이 좌우로
  갈렸다(`.dock-side`/`.dock-main`). 줄마다 제목·상태·repo·턴 수·시각이 보인다.
- **제목은 폴백 사다리다** — 사용자가 붙인 이름 > 담긴 첫 이슈·메모(`이름 +N`) >
  첫 repo 이름 > 첫 지시의 첫 줄.

**대화의 확인된 결함 묶음을 고쳤다** (`docs/sdlc/conversation-fixes/`). 마이그레이션 없음.

- **대화의 상태는 대표 턴이다** — 가장 최근 턴이 아니라 `representativeTurn`(아래 함정 절).
  도크 목록의 점·답변 필요·자동 확인과 인박스·배지가 같은 턴을 본다.
- **취소는 누른 그 턴을 누른 순간에 멈춘다.** launch 중(행은 있고 큐에는 아직 없다)에
  온 취소도 표식으로 잡는다. 실행 중인 턴은 대화록과 도크 헤더의 "실행 중인 턴 멈추기"로
  멈춘다 — 헤더는 대화의 활성 턴(running 우선)을 겨누고, 이름이 곧 겨누는 턴이다.
- **취소가 뿌리에 찍는 것은 그 대화에 다른 활성 턴이 없을 때만이다.** 실행 중에 멈춘
  턴은 그 프로세스가 취소로 끝날 때 한 번 더 판정하고(두 취소가 겹쳐도 찍힌다), 이미
  끝난 턴에 온 취소는 아무것도 하지 않는다. **타임아웃은 failed다.**
- **run의 성패는 종료 코드가 이긴다** — opencode가 text 줄마다 합성하는 succeeded가
  exit 1을 못 이긴다. opencode의 `{"type":"error"}` 줄은 실패 이유가 된다.
- **세션 id는 도는 중에 저장된다**(`saveExternalSessionId`) — 첫 턴이 앱 종료로 끊겨도
  이을 수 있다. 종료 기록의 null은 그 값을 지우지 않는다.
- **OpenCode 2.x는 preflight가 막는다**(권한 환경변수를 따른다는 보장이 없다). 판정은
  (경로, 크기, mtime)으로 캐시하되 못 읽은 판정은 캐시하지 않는다.
- **Windows 취소는 taskkill `/T /F`로 트리째 죽인다.** 앱 종료 경로(`cancelAll`)는 그것을
  기다린다(아래 함정 절).
- **읽기 전용·편집 허용에도 할 일 도구가 산다** — `--tools` 화이트리스트에 `Task*` 넷을
  더했다(아래 함정 절).
- 작은 것 넷: `readLog`가 비동기이고 로그 되살리기는 seq 병합이다, 브리지가 SSE에서 요청
  id에 맞는 응답을 고른다, 대화 이름을 비우면 파생 제목으로 돌아간다, workspace를 바꾸면
  도크의 선택·이름 칸·오류 배너가 처음 상태로 돌아간다.
- **화면에 새로 생긴 것은 "실행 중인 턴 멈추기" 버튼 하나다** — 대화록 재구성은 다음
  기능(`conversation-timeline`)이다. 리뷰가 재현했지만 이 spec의 결정을 뒤집어야 해서
  코드로 고치지 않은 셋(답을 보낸 뒤 시작 전 취소, `reapStale`이 내린 예약 건너뛰기,
  도크 점과 헤더의 불일치)은 spec §7에 있다.

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

**Node는 22다.** 루트의 `.nvmrc`가 고정한다 — Node 26은 renderer 테스트 78개를 깬다(회귀가 아니다). CI도 22로 돈다.

**Windows 장비에서 처음 셋업한다면 `docs/windows-setup.md`를 먼저 읽을 것.** 빌드 도구는 Visual Studio Build Tools **2022**여야 하고(최신 VS 18은 node-gyp가 못 읽는다), 앱 데이터를 옮겨 왔다면 repo 경로를 다시 지정해야 한다 — 설정 화면의 **repo 탭**에서 고친다(전에는 SQL로 직접 고쳐야 했다).

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

**반대로, 하나의 enum을 옮겨 적은 표는 공유한다.** 권한 세 단계의 화면 이름은
`renderer/permission.ts` 하나뿐이고 실행 패널과 설정 화면이 같이 쓴다 — 따로 두면 같은
값을 두 화면이 다른 말로 부르게 되고, "편집 허용"으로 기본값을 정해 둔 사람이 실행 패널에서
다른 이름을 본다. 위 규칙과 어긋나 보이지만 다루는 것이 다르다: issue/memo는 **앞으로 갈라질
두 도메인**이고 이것은 **갈라질 일이 없는 표시 문자열**이다.

**대칭은 공통 필드에서 끝난다 (2026-08-27).** `title`·`body`·`repoIds`·삭제·낙관적 잠금은 계속 대칭으로 유지한다. 그러나 **분류 축(`source`·`kind`·`priority`)·`triagedAt`·`seenAt`·훑기는 이슈 전용이고, 메모에 옮기지 않는다.** 이 절이 예고한 갈림길("이슈에는 앞으로 상태 전이, run 연결이 붙지만 메모에는 붙지 않는다")에 실제로 도착한 것이다 — 메모는 *적어두는 것*이고 이슈는 *처리해야 하는 것*이라, 분류·우선순위·방치 판정은 전부 처리에 딸린 개념이다. **어긋난 것을 "고치려" 하지 말 것.** 설계 `2026-08-27-issue-triage-design.md` §9.

## 밟으면 조용히 깨지는 것들

전부 실제로 겪은 것들이다.

**preload 경로는 `../preload/index.mjs`다.** `package.json`에 `"type": "module"`이 있어 electron-vite가 preload를 `.mjs`로 내보낸다. `.js`로 "고치면" **창은 정상적으로 뜨는데 `contextBridge`가 실행되지 않아 `window.oneDesk`가 영원히 `undefined`**가 된다. 흰 창만 보고는 못 잡는다.

**`--output-format stream-json`은 `--verbose` 없이는 실행이 거부된다.** Claude Code 실측 확인.

**Claude Code는 프롬프트를 인자로 줘도 stdin을 읽는다.** 닫지 않으면 3초 대기 후 진행한다. 프로세스를 띄운 뒤 반드시 `stdin.end()`를 부를 것.

**Dynamic Workflows는 `claude -p`에서 돌지 않는다.** 헤드리스에는 워크플로 도구가 노출되지 않아 `ultracode` 키워드도 `--effort ultracode`도 무력하다(v2.1.226 실측). one-desk가 띄우는 실행에는 해당 없음.

**생성하는 권한 설정에 `ask`를 절대 넣지 않는다.** 헤드리스에서 물어보면 응답할 사람이 없다 — 멈추든(claude, 실측 기록 없음) 조용히 거부하고 성공으로 끝나든(opencode 1.18.x, 아래 OpenCode 절) 결과가 틀린다. 모든 정책은 `allow` 아니면 `deny`로만 떨어져야 한다. **테스트에서 `ask`를 부분 문자열로 찾지 말 것** — `TaskCreate`·`TaskList`가 `ask`를 품어 멀쩡한 인자에 걸린다. `permission.test.ts`의 `mentionsAsk`가 낱말로만 본다.

**Vite dev 서버는 `127.0.0.1`로 고정돼 있다.** 기본값으로 두면 IPv6 `[::1]`에만 바인딩하는데 macOS는 `localhost`를 양쪽으로 해석해서 Electron이 `ERR_TIMED_OUT`으로 멈춘다. `electron.vite.config.ts`의 `server.host`를 지우지 말 것.

**better-sqlite3는 외래키를 기본으로 끄고 시작한다.** `openDb`의 `pragma('foreign_keys = ON')`이 없으면 스키마의 `onDelete: 'cascade'`가 전부 무효가 된다.

**`pnpm test:e2e`와 `pnpm dev`를 동시에 돌리지 말 것.** `test:e2e`는 `electron-vite build`로 시작하는데, 그 산출물 디렉토리가 `electron-vite dev --watch`가 감시하는 `out/`과 같아서 실행 중인 dev 앱의 main/preload가 e2e용 빌드로 갈아끼워진다. 반대 방향(dev가 떠 있어도 e2e는 정상 동작)은 검증돼 있으니, 손해를 보는 쪽은 항상 dev다.

**`dev` 스크립트의 `--watch`를 지우지 말 것.** `electron-vite dev`는 `--watch` 없이는 **main과 preload를 시작할 때 딱 한 번만 빌드한다.** 렌더러는 HMR로 즉시 반영되므로 화면은 멀쩡해 보이는데, `core/`나 `electron/`을 고쳐도 앱은 낡은 코드를 계속 돌린다. 2단계에서 어댑터를 고치고도 반영이 안 돼 한참 헤맸다 — `out/main/index.js`의 mtime이 소스보다 오래됐는지 보면 바로 드러난다.

**MCP 서버의 응답은 SSE(`text/event-stream`)다.** `StreamableHTTPServerTransport`가 그렇게 응답한다. `res.json()`으로 바로 파싱하면 깨진다 — 본문을 텍스트로 받아 `data:`로 시작하는 줄을 찾아 그 뒤를 JSON.parse해야 한다. `core/runner/fixtures/fake-claude-mcp.mjs`가 그 패턴이다.

**`vscode://file/...`로는 새 창을 못 연다.** URL 스킴은 마지막으로 쓰던 창을 재사용해 그
폴더를 덮어쓴다 — 보고 있던 작업이 사라진다. URL에 새 창 옵션을 달라는 요청은 아직 열려
있다(microsoft/vscode#141548). 그래서 repo 열기는 CLI의 `--new-window`를 spawn한다.
**Windows에서 PATH의 `code`는 `<설치>in\code.cmd`라 그대로 spawn하면 `EINVAL`이다** —
다행히 그 shim이 부르는 `Code.exe`가 `bin`의 부모에 있어 거기서 유도한다
(`core/editor/vscodeLaunch.ts`). CLI를 못 찾으면 URL로 되돌아간다 — 기존 창에 열리더라도
아무 일도 안 일어나는 것보다 낫다(macOS에서 "Install 'code' command in PATH"를 누른 적
없는 경우).

**`--tools`와 `--allowedTools`는 다른 일을 한다.** `--tools`는 도구 자체를 존재하지 않게 만들어 모델이 시도조차 못 하게 하고, `--allowedTools`는 존재하는 도구를 묻지 않고 승인한다. **MCP 도구는 `--permission-mode`로 자동 승인되지 않는다** — `mcp__<serverName>` 접두사를 `--allowedTools`에 직접 얹어야 하고, 빠뜨리면 agent가 MCP 도구를 전혀 못 쓰는데 실패가 조용하다(`core/runner/adapters/claudeCode.ts`의 `mcpToolPrefixes`).

**할 일 도구는 `TodoWrite`만이 아니다 — `--tools` 화이트리스트에 `Task*` 넷이 있어야 한다.** Claude Code 2.1.280은 기본이 `TaskCreate`·`TaskGet`·`TaskUpdate`·`TaskList`이고 `TodoWrite`는 `CLAUDE_CODE_ENABLE_TASKS`가 false일 때만 켜진다. `--tools`는 이름을 대지 않은 도구를 **존재하지 않게** 만들므로, 넷이 빠지면 읽기 전용·편집 허용에서 할 일 도구가 하나도 남지 않는데 모델은 그런 도구가 있는 줄도 모르니 실패가 조용하다. `TodoWrite`는 구버전·환경변수 경로를 위해 남긴다(`core/runner/permission.ts`의 `READ_ONLY_TOOLS`, `docs/sdlc/conversation-fixes/` FR-15). 빼면 `permission.test.ts`의 "%s에 할 일 도구(Task*·TodoWrite)가 살아 있다"가 빨개진다. CLI가 기본 도구 이름을 또 바꾸면 여기가 가장 먼저 조용히 낡는다.

**agent가 MCP로 만든 데이터는 run이 끝나면 화면에 나타난다.** `useIssues`/`useMemos`가 `onRunUpdate`를 구독해, **같은 workspace의 끝난 run**에 대해 목록을 다시 읽는다. 4단계 설계 §1이 "UI 변경 없음"으로 미뤄뒀던 경계였고, MCP가 실제로 돌기 시작하면서 매번 걸려 해소했다. 같은 run의 후속 갱신(확인함/보관)으로는 다시 읽지 않는다. **`e2e/mcp.e2e.ts`는 화면을 벗어나지 않고 확인한다** — 예전처럼 인박스에 갔다 돌아오면 패널이 다시 마운트돼 구독이 죽어도 통과해 버린다.

**`Run`을 만드는 스프레드는 새 컬럼을 그대로 흘려보낸다.** `hydrate`의
`{ ...row, contextItems }`는 초과 속성 검사를 받지 않으므로, run 테이블에 컬럼을 더하면
그것이 **말없이 `Run`에 실려 IPC로 나간다.** 사용량 아홉 컬럼은 `usage` 하나로 접어
보내는데, 접기만 하고 원본을 빼지 않으면 같은 값이 두 벌 나가고 나중에 누가
`run.inputTokens`를 쓰기 시작하면 출처가 갈린다. 타입은 끝까지 아무 말도 하지 않는다 —
`core/db/repositories/run.test.ts`의 "아홉 컬럼이 Run에 낱개로 새지 않는다"가 그것을 잡는다.

**사용량의 합계와 컨텍스트 점유는 다른 수다.** 토큰 합계로 창 대비 비율을 그리면 도구를
여러 번 쓴 턴에서 **100%를 넘는다.** 점유는 마지막 요청의 프롬프트 크기이고(claude는
`usage.iterations`의 마지막, opencode는 마지막 `step_finish`), **캐시를 빼면 안 된다** —
실측에서 `input_tokens`가 2인데 캐시 읽기 15,428 + 캐시 쓰기 37,917이라 실제 프롬프트는
53,347토큰이었다. 병합 규칙도 그래서 필드마다 다르다(`mergeUsage`): 토큰·비용은 더하고,
모델·컨텍스트는 마지막 non-null이 이긴다.

**`--effort`는 어느 CLI도 스트림으로 되돌려 주지 않는다.** claude는 `--effort`를,
opencode는 `--variant`를 받지만 `init`에도 `result`에도 그 값이 없다(2026-09-21 실측).
그래서 "무슨 effort로 돌았나"는 **앱이 보낸 값으로만** 알 수 있다 — `run.effort`가 기록의
전부이고 `actual_model` 같은 관측본 컬럼이 없는 이유다. **CLI는 값을 검증하지도 않는다**
(`--effort bogus`도 오류 없이 통과, 2026-09-22 실측) — 화면의 드롭다운이 유일한 가드다.

**`system/init`은 인증도 모델 유효성도 보지 않는다.** 토큰이 하나도 없어도 init은 정상으로
오고 `model`까지 실려 온다(`--bare`로 OAuth·키체인을 막고 실측: 384ms, `claude-opus-5[1m]`).
`apiKeySource: "none"`은 "API 키 환경변수에서 오지 않았다"는 뜻이지 "인증이 없다"가 **아니다**
— 로그인한 경우와 값이 같다. 그래서 준비 상태는 `claude auth status --json`(JSON이 기본 출력,
실측 0.24초, 훅을 타지 않는다)이 먼저 보고, **그것이 `ok`일 때만** init probe를 돌린다
(`core/agent/service.ts`). 이 순서를 뒤집거나 probe만으로 판정하면 **아무것도 못 돌리는
사람에게 초록으로 모델 이름을 띄운다.** 모델 이름 역시 검증이 아니다 — 없는 이름 `gpt-9`도
그대로 되돌아오므로 화면은 "이 이름으로 넘어갑니다"까지만 말한다.

**`result`는 `subtype: "success"`인 채로 `is_error: true`가 올 수 있다.** 로그인하지 않고
한 턴을 돌리면 그렇게 온다(exit 1, 답변 텍스트는 `model: "<synthetic>"`의
`"Not logged in · Please run /login"`). **성공 판정에 `subtype`을 쓰지 말 것** — 어댑터는
`is_error`를 본다.

**run의 성패는 종료 코드가 어댑터의 보고를 이긴다** (`core/runner/manager.ts`의 순수 함수
`judgeStatus`, `docs/sdlc/conversation-fixes/` FR-12). 순서가 곧 규칙이다: 취소 → `canceled`,
타임아웃 → `failed`, 종료 코드가 0이 아니거나 null(신호로 죽음) → `failed`, 그 밖에만
`reportedStatus ?? 'succeeded'`. 예전에는 보고를 먼저 봐서 **opencode가 `text` 줄마다 합성하는
succeeded가 exit 1을 이겼다** — 중간 답을 내고 죽은 run이 성공으로 기록됐다. 반대 방향은
그대로다: exit 0인데 claude가 `is_error`로 실패를 보고하면 보고가 이긴다. **타임아웃은
`canceled`가 아니다** — 사용자가 누른 취소와 섞이면 인박스에 "대기 중 취소됨"으로 떠 배지에서
빠진다. 취소와 타임아웃이 겹치면 취소가 이긴다. `manager.test.ts`의 "어댑터가 succeeded를
보고해도 종료 코드가 0이 아니면 failed다"·"취소가 타임아웃보다, 타임아웃이 종료 코드보다
먼저다"가 이 순서를 고정한다. 실패 이유(`errorMessage`)는 **어댑터가 인정한 마지막 error
이벤트 → stderr 앞 2000자** 순이다(아래 "실패 이유는 어댑터가 인정한" 항목).

**`updatedAt`은 단조 증가해야 낙관적 잠금이 성립한다.** 같은 밀리초 안에 두 번 쓰면 `Date.now()`만으로는 이전 값과 같아져 "그 사이 바뀌었다"를 놓친다. `updateIfUnchanged`의 `buildPatch`는 `Math.max(Date.now(), previousUpdatedAt + 1)`로 반드시 이전 값보다 크게 만든다(`core/db/repositories/issue.ts`·`memo.ts`).

**성공한 저장이 기대값(`expected.current`)을 갱신하지 않으면 두 번째 저장이 자기 자신과 충돌한다.** `IssueDetail`/`MemoDetail`의 `persist()`는 매 성공 응답의 `result.issue.updatedAt`(또는 `memo`)으로 `expected.current`를 다시 세운다 — 안 하면 디바운스로 이어지는 다음 자동 저장이 이미 낡은 `expectedUpdatedAt`을 들고 가 스스로와 충돌 배너를 띄운다.

**`node:path`의 기본 `join`은 실행 중인 OS를 따른다.** macOS에서 `join('C:\\bin', 'claude.exe')`는 `C:\bin/claude.exe`가 되고, posix로 `C:\...`를 PATH 구분자(`:`)로 쪼개면 경로가 두 동강 난다. Windows 경로 규칙을 다루는 코드는 `win32`/`posix` 변형을 **platform 인자로** 골라야 개발 장비에서 검증할 수 있다(`core/runner/executable.ts`). 반대로 **진짜 파일을 만들어 탐색시키는 테스트는 호스트 플랫폼을 그대로 써야 한다** — 실제 경로에 다른 플랫폼 규칙을 씌우면 검증하려던 것과 다른 것을 보게 된다.

**`access(path, X_OK)`는 Windows에서 실행 권한을 보지 않는다.** 파일시스템에 그 개념이 없어 존재 여부(`F_OK`)처럼 동작한다. 그래서 Windows에서는 `PATHEXT` 확장자를 붙인 후보만 만들고 확장자 없는 이름은 아예 제외한다 — 만들면 npm이 Git Bash용으로 함께 까는 sh 스크립트를 실행 파일로 골라버린다.

**`.cmd`/`.bat`는 `shell: true` 없이 spawn하면 `EINVAL`이다**(Node 18.20.2+ / 20.12.2+, CVE-2024-27980). shell을 켜면 인자가 cmd.exe의 인용 규칙을 타고, `terminate`가 죽이는 대상이 cmd.exe 껍데기가 되어 취소가 자식에 닿지 않는다. 그래서 켜지 않고 **preflight가 거부한다** — npm 전역 설치 대신 네이티브 설치 스크립트(`claude.exe`)를 쓰게 안내한다.

**`createWriteStream`의 open은 비동기다 — `error` 리스너가 없으면 앱이 죽는다.** `mkdirSync`가 방금 만든 디렉토리라도 그 사이에 사라질 수 있고, 디스크가 차거나 권한이 막혀도 실패한다. 리스너가 없으면 처리되지 않은 예외가 되어 Electron 메인 프로세스가 통째로 내려간다. `core/runner/logWriter.ts`가 이를 `ErrorSink`로 흘려보내고, 실패한 뒤 `close()`가 매달리지 않게 한다(매달리면 run이 안 끝나 동시 실행 슬롯이 영영 점유된다).

**Windows 취소는 `taskkill /PID <pid> /T /F`로 트리째 죽인다** (`core/runner/terminate.ts`, `docs/sdlc/conversation-fixes/` FR-18). `child.kill()`은 직계만 즉시 강제 종료하므로 Bash 도구가 띄운 손자(dev 서버 등)가 주인 없이 남는다. taskkill이 실패하거나 pid가 없으면(spawn 실패) `child.kill()`로 되돌아가고, Windows 갈래에는 SIGKILL 유예 타이머가 없다(`/F`가 이미 강제다). 플랫폼과 트리 종료 함수는 인자로 주입해 개발 장비에서 두 갈래를 다 본다. **진짜 트리를 죽여 보는 테스트는 손자를 `detached`로 띄워야 한다** — detached가 아닌 손자는 libuv가 부모와 같은 job에 넣어 부모가 죽을 때 같이 죽으므로, 옛 `child.kill()` 코드에서도 테스트가 초록이다(실측). `terminate.test.ts`의 "자식이 띄운 손자 프로세스까지 죽인다"가 그 모양이다.

**앱 종료 경로의 taskkill은 기다려야 한다 — 비동기면 손자가 남는다.** libuv는 detached가 아닌 자식을 "부모가 죽으면 같이 죽는" job에 넣는데 taskkill 자신도 그 자식이다. will-quit의 `core.shutdown()` → `manager.cancelAll()`이 비동기 taskkill만 띄우고 돌아오면 메인 프로세스가 끝나며 taskkill도 함께 죽는다 — 직계 agent는 job 때문에 죽지만, job을 빠져나간 손자(Bash 도구의 dev 서버 등)는 남는다(2026-09-27 실측: 비동기 8/8 생존, 동기 8/8 종료). 그래서 `cancelAll`만 `taskkillTreeSync`를 쓴다. **일반 취소에 동기판을 쓰지 말 것** — 아래 `execFileSync` 함정 그대로 MCP 서버가 멈춘다. `manager.test.ts`의 Windows 전용 테스트 "돌아오기 전에 agent가 띄운 손자까지 죽인다 — 앱이 곧바로 끝나도 남지 않는다"가 **돌아온 순간 손자가 이미 죽어 있는지**로 고정한다(기다려서 확인하면 비동기판도 통과한다).

**실패 이유는 어댑터가 인정한 error 이벤트만 된다** (`AgentAdapter.errorEventsAreFailureReasons`). error 이벤트의 뜻이 어댑터마다 다르다: opencode는 json 모드에서 오류를 stdout의 error 줄로만 내고(켠다), claude의 error는 init의 MCP 연결 경고뿐이다(켜지 않는다). 켜면 사내 프록시 환경처럼 MCP 경고가 늘 붙는 곳에서 **다른 이유로 실패한 run이 전부 "MCP 서버에 연결하지 못했습니다"로 기록된다** — stderr의 진짜 원인이 가려진다. spawn 오류(`ENOENT` 등)는 어댑터와 무관하게 늘 실패 이유다. 실행 서비스가 흘리는 `preEvents`의 error(맥락 파일을 못 읽었다는 알림 — run을 실패시키지 않는다)는 후보가 아니다(`manager.test.ts`의 "실행 전에 흘린 error(preEvents)는 실패 이유가 되지 않는다"). 성공한 run에서는 error 이벤트가 있어도 `errorMessage`를 비워 둔다.

**Windows에서 가짜 CLI는 spawn조차 되지 않는다 — run은 `start()`가 resolve되기도 전에 끝난다.** 픽스처가 `.mjs`라 Windows가 직접 실행하지 못해 spawn이 즉시 실패하고, `markFinished`와 그에 딸린 `onRunUpdate`(인박스 push, asset 재스캔)가 **`await core.execution.start(...)` 안에서 이미 다 지나간다.** 그래서 두 가지가 따라온다. 첫째, run 상태는 항상 `failed`다 — `core/index.test.ts`의 run 테스트들이 `succeeded`가 아니라 `endedAt`만 보는 이유다. 둘째, **`start()` 뒤에 만든 파일은 그 run의 재스캔이 영영 못 본다** — "실행 중에 생긴 파일"을 흉내내려면 run을 띄우기 **전에** 써 둬야 한다. macOS에서는 가짜 CLI가 실제로 100ms쯤 돌아 순서가 늘 맞아떨어지므로 **로컬은 초록인데 릴리스 CI만 깨진다**(v0.7.0·v0.7.1 릴리스 빌드가 이것으로 연속해서 깨졌다). 로컬에서 재현하려면 `ONE_DESK_AGENT_PATH`를 없는 경로로 주면 된다.

**그 함정은 e2e에는 해당하지 않는다 — `e2e/driver.ts`가 `ONE_DESK_AGENT_LAUNCHER`로 node를 물린다.** 그래서 **e2e의 run은 두 플랫폼에서 똑같이 성공한다.** 위 항목이 말하는 "항상 `failed`"는 `ONE_DESK_AGENT_PATH`만 세우는 **단위 테스트**(`core/index.test.ts`)의 이야기다. 둘을 섞으면 반대 방향으로 두 번 틀린다: 단위 테스트에 `succeeded`를 못 박으면 macOS에서만 초록이고, e2e에서 "어차피 실패하니까"로 판단을 건너뛰면 실제로는 성공하는 경로를 검증하지 못한다. **단위 테스트에서 run 결과에 기대는 단언은 카테고리를 실제 행에서 다시 계산해 쓴다**(`core/index.test.ts`의 "run이 끝나면 인박스 카운트를 push한다"가 그 모양이다).

**배지가 세는 것과 열었을 때 자동 확인되는 것은 `INBOX_RULES` 한 표의 두 칸이다** (`shared/inbox.ts`, `docs/sdlc/conversation-fixes/` FR-4). core의 `inboxCounts()`는 `badge` 칸을, renderer의 `Dock`은 `clearsOnView` 칸을 본다 — 표를 두 곳에 적으면 **어느 쪽에도 안 걸리는 카테고리**가 생겨 그 대화는 인박스 목록에만 영원히 남는다. `shared/`에 둔 이유가 이것이다. 예전의 한 칸짜리 `ACTIONABLE`에서는 두 판정이 서로의 부정이었지만 **이제 아니다** — 실패·중단은 배지에 세면서 열면 확인된다(2026-09-27 결정). 부정 관계가 풀린 자리는 `inbox.test.ts`의 불변식 둘이 지킨다: 배지에 세지 않는 것은 반드시 열면 확인되고, 열어 봐도 남는 것은 답변 필요 하나뿐이다. **표를 다시 한 칸으로 접지 말 것.** 같은 파일의 `representativeTurn`이 **대화의 상태를 정하는 한 함수**다 — 시작하지 못하고 취소된 턴을 건너뛴 가장 최근 턴이고, core의 인박스·배지(`lastTurnsOf`)와 renderer의 도크 목록(`Conversation.state`)이 같이 쓴다. 따로 적으면 배지와 도크가 다른 턴을 본다. `inboxCategory`·`representativeTurn`이 `Run`이 아니라 `{ status, needsAnswer }`·`{ status, startedAt }`만 받는 것도 의도다 — `inboxCounts`의 슬림한 select가 그대로 들어가야 `assembled_prompt`를 나르지 않는다.

**자동 확인을 `Dock`의 `selected`나 마운트 effect에 걸지 말 것.** `pickedId`가 null이면 `selected`는 `openConversations[0]`으로 떨어지므로, **도크를 열기만 해도** 최근 대화가 조용히 인박스에서 내려간다 — 사용자는 그 대화를 본 적이 없다. 목록 줄의 클릭 핸들러(`pick`)에만 건다. 되살리면 `Dock.test`의 "마운트만으로는 찍지 않는다"·"focusConversationId로 열려도 찍지 않는다"가 빨개진다.

**`Conversation`의 턴 셋은 서로 다른 질문의 답이다 — `last`를 상태로 쓰지 말 것** (`renderer/conversation.ts`, `docs/sdlc/conversation-fixes/` FR-3·FR-11). `last`는 가장 최근에 **만든** 턴(목록 줄의 시각·repo), `state`는 대표 턴(`representativeTurn` — 줄의 상태 점·답변 필요·자동 확인), `active`는 멈출 턴(running, 없으면 pending, 없으면 null — 도크 헤더의 취소). 예전에는 전부 `last`였다: 예약이 있으면 헤더 취소가 예약을 겨눠 **실행 중인 턴을 멈출 버튼이 없었고**, 예약을 취소하면 마지막 턴이 canceled가 되어 헤더 버튼이 사라졌다. 헤더 버튼의 접근성 이름이 겨누는 턴을 말한다 — 실행 중이면 "실행 중인 턴 멈추기"(보이는 글자 "멈추기"), 예약이면 "취소". **이름이 같으면 같은 턴이다** — 헤더가 실행 중인 턴을 겨누면서 "취소"라 부르면 예약 버블의 "취소"와 이름이 같아 다른 턴을 멈춘다. `Dock.test`의 "헤더 취소는 예약이 아니라 실행 중인 턴을 겨눈다"·"헤더 버튼의 이름이 겨누는 턴을 말한다"가 고정한다. 자동 확인은 `INBOX_RULES[inboxCategory(conv.state)].clearsOnView`와 `conv.state.endedAt`을 본다 — 예약이 기다리거나 도는 턴이 있으면 끝난 대화가 아니다.

**workspace가 바뀌면 도크의 선택은 렌더 중에 처음으로 돌린다 — effect가 아니다** (FR-22). `view`·`pickedId`·`renamingId`·`actionError`를 이전 `workspaceId`와 비교해 렌더 중에 맞춘다(React의 "prop이 바뀌면 state 조정" 패턴). effect면 옛 선택과 새 workspace가 함께 그려지는 한 프레임이 생긴다. 끝낸 대화 펼침(`showClosed`)은 선택이 아니라 보기 취향이라 두고 간다. `App`의 `focusConversationId`는 **한 번 쓰면 치운다** — Dock의 필수 prop `onFocusConsumed`가 그 배선이다. 선택 prop이면 `App`의 한 줄을 지워도 조용히 컴파일되고, 그러면 다른 화면에 갔다 올 때마다 그 대화로 끌려간다(`App.test`의 "\"대화 열기\"는 한 번만 연다"). 의존성 배열에 `onFocusConsumed`를 넣지 말 것 — `App`이 매 렌더 새 함수를 넘겨 치워지기 전 렌더마다 다시 연다.

**로그 되살리기는 교체가 아니라 seq 병합이다 — 그리고 `readLog`는 비동기다** (FR-19). `useRunEvents`는 대화를 열 때 `runs.readLog`를 부르는데, 그 응답이 오는 사이 `onRunEvent` push가 계속 들어온다. 스토어의 `hydrate`가 목록을 통째로 바꾸면 그 사이 도착한 이벤트가 지워진다. 그래서 seq로 합치고 중복 seq는 하나만 남긴다(`runEvents.test`의 "로그를 읽는 사이에 push된 이벤트를 지우지 않는다"). 병합에는 `maxPerRun` 상한을 걸지 않는다(되살린 로그를 전부 보여주던 동작). `readLog`는 `fs/promises`로 읽는다 — 메인 프로세스에 MCP 서버가 같이 있어 긴 로그를 동기로 읽는 동안 IPC와 agent의 MCP 호출이 전부 멈춘다(위 `execFileSync` 함정과 같은 뿌리). 파일이 없으면(ENOENT) 빈 배열이고 그 밖의 읽기 실패는 던진다 — 삼키면 로그가 원래 없던 run처럼 보인다.

**대화 이름을 비우고 저장하면 파생 제목으로 돌아간다** (FR-21, lifecycle FR-14). `RenameField`는 기본이 "빈 이름 = 취소"라 붙인 이름을 지울 길이 없었다. `allowEmpty`를 대화 목록에서만 켜 `rename(root, '')`를 부른다 — IPC 시그니처가 string이고 저장소가 빈 문자열을 null로 저장한다. 이름이 없던 칸을 그대로 닫으면 여전히 취소다. 같은 컴포넌트를 쓰는 workspace(`Sidebar`)·repo(`RepoStrip`) 이름에는 켜지 않는다 — 비우면 되돌아갈 파생 이름이 없다.

**`run.title`·`run.closed_at`은 뿌리 행에서만 의미가 있고 타입은 그것을 지켜주지 않는다.** 이어지는 턴의 행에도 컬럼이 있고 null일 뿐이다. 저장소의 `close`/`rename`이 `assertRoot`로 던지는 것이 유일한 방어선이다 — 조용히 엉뚱한 행에 찍히면 화면에서 영영 드러나지 않는다. 읽는 쪽도 같다: `groupConversations`는 뿌리를 **id로 찾는다**(`ordered[0]`이 아니다). 가장 오래된 행이 뿌리라는 것은 "목록이 그 대화의 모든 턴을 담고 있다"에 얹힌 가정이고, `runs.list`에 개수 제한이 붙는 날 조용히 null이 된다.

**도크 줄의 제목은 지시가 아니라 담은 맥락에서 온다.** e2e가 프롬프트 문자열로 줄을 찾으면 못 찾는다 — 이슈를 담은 대화의 제목은 그 이슈 이름이다(`core-loop.e2e.ts`·`conversation.e2e.ts`가 이것으로 한 번 깨졌다). 그리고 **제목으로 개수를 세지 말 것**: 줄 끝 액션의 접근성 이름이 `<제목> 이름 바꾸기`·`<제목> 대화 끝내기`라 제목 문자열은 줄 하나당 세 번 걸린다. 개수는 `.dock-conv`로, 제목 확인은 `.dock-conv-title`로 한다.

**`shared/`의 테스트는 `vitest.config.ts`의 include에 넣어야 돈다.** 프로젝트가 core(`core/**`)와 renderer(`renderer/**`) 둘뿐이라, `shared/x.test.ts`를 만들면 **어느 쪽에도 안 걸려 실행되지 않은 채로 통과한 것처럼 보인다.** 같은 파일의 renderer include 주석이 경고하던 그 함정이다 — 지금은 core 프로젝트가 `shared/**/*.test.ts`도 함께 잡는다.

**Windows는 열린 핸들이 있는 파일을 지우지 못한다 — 테스트가 연 DB는 반드시 닫아야 한다.** POSIX는 열려 있는 파일도 unlink되므로 macOS·Linux에서는 핸들을 흘려도 `rmSync`가 조용히 성공한다. Windows에서만 `EBUSY: resource busy or locked`로 죽고, **그래서 로컬은 전부 초록인데 릴리스 CI의 Windows 잡에서만 터진다**(v0.2.0 릴리스가 실제로 이렇게 한 번 깨졌다). `openDb`는 핸들을 돌려주지 않는 것처럼 보이지만 반환한 drizzle 인스턴스의 `$client`가 그것이다 — `core/db/open.test.ts`의 기존 테스트들이 이미 `db.$client.close()`를 쓰고 있으니 그 패턴을 따를 것.

**`productName`이 사용자 데이터 위치를 정한다 — `appId`가 아니다.** Electron은 `userData`를 `appData` + 앱 이름으로 만들고 앱 이름은 `productName`을 우선한다. `electron-builder.yml`의 `productName: one-desk`를 보기 좋게 바꾸면 기존 사용자의 DB 디렉토리를 앱이 더 이상 보지 않는다.

**MCP는 stdio로 간다 — HTTP가 아니다.** claude가 `core/mcp/bridge.mjs`를 자식 프로세스로 띄우고 표준입출력으로 JSON-RPC를 주고받으면, 브리지가 그것을 앱 안의 HTTP 서버로 중계한다. **HTTP로 직접 붙던 시절에는 사내 프록시가 루프백 요청을 403으로 막아 그 환경에서 아예 못 썼다** — 같은 포트에 `curl`은 401을 받는데 agent만 실패하는 증상이었다. Node의 `http`/`fetch`는 `HTTP_PROXY`를 자동으로 쓰지 않으므로 브리지는 통과한다. **브리지는 멍청한 파이프다** — 권한 게이팅과 도구 등록은 전부 서버에 남는다. **예외는 하나, SSE 본문에서 응답을 고르는 것이다** (`docs/sdlc/conversation-fixes/` FR-20). 서버는 응답 앞에 알림을 먼저 보낼 수 있는데 첫 `data:` 줄만 넘기면 claude가 알림을 응답으로 받고 진짜 응답은 버려진다. 그래서 이벤트 단위로 가르고(여러 줄 data·CRLF 포함) **요청 id가 같고 `method`가 없는** 메시지를 한 줄로 다시 직렬화해 보낸다. 맞는 것이 없으면 그 id로 JSON-RPC 오류를 돌려준다 — 알림을 응답 대신 넘기면 claude가 영영 기다린다. 알림과 서버발 요청은 stdio 쪽으로 전달하지 않고 버린다(서버가 sampling·elicitation·progress를 쓰기 시작하면 전달 경로가 필요하다). `bridge.test.ts`의 "응답 앞에 온 알림을 건너뛰고 요청 id와 같은 응답을 돌려준다"가 고정한다.

**브리지는 `extraResources`로 나간다.** 번들되지 않는 원본 `.mjs`이고, `command`는 Electron 바이너리에 `ELECTRON_RUN_AS_NODE=1`이다(패키징된 앱에 독립 `node`가 없다). asar 안에 두지 않는다 — asar 내부 경로를 자식 프로세스로 실행할 수 있는지가 플랫폼마다 미묘하다.

**사내 프록시가 잡힌 환경에서는 루프백을 예외로 못박아야 한다.** MCP 서버는 항상 `127.0.0.1`인데 `NO_PROXY`에 루프백이 빠져 있으면 agent의 MCP 요청이 프록시로 나가 30초 뒤 타임아웃으로 죽는다. **같은 포트에 `curl`은 401을 받는데 agent만 못 붙는 증상**으로 나타난다 — 그게 이 원인을 가리키는 신호다. `claudeCode.ts`의 `withLoopbackBypass`가 기존 값을 보존하며 `127.0.0.1`·`localhost`·`::1`을 더한다. NO_PROXY는 목적지만 정하므로 원격 호출에는 영향이 없다.

**`execFileSync`는 이벤트 루프를 막는다 — 같은 프로세스의 서버를 죽인다.** MCP 서버가 붙어 있는 테스트에서 CLI를 동기로 띄우면 서버가 연결을 하나도 받지 못해 클라이언트가 30초 타임아웃으로 죽는다. **제품이 멀쩡한데 `status: failed`가 나온다.** 실제로 이 함정에 빠져 존재하지 않는 결함을 한참 쫓았다 — `core/mcp/realCli.test.ts`가 비동기 `spawn`을 쓰는 이유다.

**픽스처에 서버 이름을 리터럴로 박지 않는다.** `fake-claude-mcp.mjs`가 `.mcpServers.onedesk`를 하드코딩하고 있어서 `MCP_SERVER_NAME`을 바꾸자 `cfg`가 `undefined`가 되고 e2e가 통째로 깨졌다. **단위 테스트 412개는 전부 초록이었다.** 지금은 `Object.values(...)[0]`로 유일한 값을 집는다.

**ad-hoc 서명(`identity: '-'`)은 hardened runtime의 라이브러리 검증에 걸린다.** Team ID가 없어 Electron Framework조차 로드되지 않고 앱이 아예 안 뜬다 — `build/entitlements.mac.plist`의 `com.apple.security.cs.disable-library-validation`이 그것을 푼다. **설정이 문법에 맞는 것과 앱이 열리는 것은 다르다** — DMG를 실제로 열어봐야만 드러난다.

**asset의 동일성 키는 `(workspace_id, file_path)`다 — `repo_id`를 넣지 말 것.** 글로벌 asset은 `repo_id`가 NULL인데 SQLite가 유니크 인덱스에서 NULL을 서로 다르게 취급한다. 키에 `repo_id`가 남아 있으면 스캔마다 같은 글로벌 skill이 새 행으로 쌓이는데, 목록이 조금씩 길어질 뿐 오류가 없어 한참 모른다. **저장소의 조회도 같은 키를 봐야 한다** — `eq(asset.repoId, null)`은 SQL에서 `repo_id = NULL`이 되어 절대 참이 되지 않으므로, 글로벌이 매번 INSERT를 시도하다 유니크 인덱스에 걸려 스캔이 통째로 죽는다. authored는 `file_path`가 NULL이라 여전히 여러 개 만들 수 있다.

**repo 경로를 바꾸면 그 아래 asset의 `file_path`가 전부 달라진다** — 동일성 키가 그것이라, 아무것도 안 하면 옛 행이 "없음"으로 남고 재스캔이 새 행을 쌓아 **목록이 조용히 두 벌이 된다.** 그래서 `repo.update`는 `asset.moveAssetPathPrefix`로 그 repo의 `file_path`를 **같은 트랜잭션에서** 새 접두사로 옮기고(행은 그대로 — 과거 run이 첨부한 기록이 id로 이어진다), core가 그 뒤에 재스캔한다. 치환은 경로 경계에서만 맞는다(`/tmp/api`가 `/tmp/api2`를 끌고 가지 않는다). 글로벌 행은 `repo_id`가 NULL이라 `eq(asset.repoId, repoId)`에 걸리지 않는 것이 **의도다** — `isNull`이나 `or`로 넓히면 글로벌이 딸려 온다. 설계 `docs/sdlc/settings-screen/spec.md` FR-9.

**`createSettingRepository`와 `CoreOptions`는 `homeDir`를 필수로 받는다.** 글로벌 경로의 기본값이 홈 기준인데 `core/`에서 `os.homedir()`를 부르면 **테스트가 개발자의 실제 홈을 훑어** 사람마다 결과가 달라진다. 선택 인자로 바꾸지 말 것 — 빠뜨리면 글로벌 경로가 조용히 비고, 그게 이 기능이 고치려던 증상 그 자체다.

**`core/index.ts`에서 `settings`는 `assetService`보다 먼저 선언해야 한다.** asset 서비스의 `globalRoots`가 `settings`를 닫아 잡는데, repo가 하나도 없는 workspace에서는 부팅 스캔이 같은 틱에 그 함수를 불러 **TDZ 오류**가 난다.


**스캔은 `authored` 행을 건드리면 안 된다.** `source`로 갈라 보지 않으면 앱에서 쓴 asset이 첫 스캔에 전부 "없음"이 된다 — 파일이 없으니 당연히 안 보인다. 같은 이유로 화면의 "없음" 판정도 `source === 'discovered'`를 먼저 본다.

**사라진 asset을 지우지 않는다.** `last_seen_at`으로 "없음"만 표시한다. 지우면 그 asset을 첨부했던 과거 run의 기록이 끊긴다(전체 설계 §232).

**한 번의 스캔은 시각 하나를 찍는다 — 배치마다 `Date.now()`를 따로 찍지 말 것.** 화면의 "없음"은 그 workspace에서 가장 최근에 본 `lastSeenAt`보다 오래된 discovered asset이다(엄격 비교). `scanWorkspace`가 repo 하나·글로벌 루트 하나마다 시각을 새로 찍으면, 먼저 훑은 repo의 asset이 나중에 훑은 글로벌보다 몇 ms 오래돼 **방금 본 파일에 "없음"이 붙는다.** 글로벌 skill이 많은 장비일수록 걷는 데 1ms를 넘겨 잘 나고, 단위 테스트는 임시 디렉토리가 작아 시각이 같아져 조용히 초록이다 — `core/assets/service.test.ts`는 그래서 `Date.now`를 호출마다 1ms씩 흐르는 시계로 바꿔 결정적으로 잡는다. `scanRepo`(등록·경로 변경)는 그 repo만 훑는 부분 스캔이라 이 규칙 밖이다 — 그 뒤에는 같은 workspace의 나머지(글로벌 포함)가 상대적으로 오래돼 다음 전체 스캔까지 "없음"으로 보일 수 있다. 설계 §3-2("등록할 때 — 그 repo만")가 정한 것이라 코드에서 바꾸지 않았다.

**`core.repos.create`는 스캔을 await한다 — 이 `await`는 어떤 테스트도 고정하지 못한다.** 기다리지 않으면 화면이 목록을 다시 읽는 시점에 스캔이 아직 안 끝나 있어 방금 등록한 repo의 asset이 새로고침 전까지 안 보인다. 그런데 스캔이 워낙 빨라 e2e는 `await`를 빼도 통과한다(실측). 지우지 말 것 — 통과는 경합에서 이긴 것이지 옳아서가 아니다.

**asset 목록은 repo 목록이 바뀌면 다시 읽어야 한다.** `useAssets`가 `repoKey`(repo id를 이어붙인 문자열)를 의존성으로 받는 이유다. 이것이 빠지면 repo를 등록해도 asset이 화면에 나타나지 않는다 — 실제로 e2e가 여기서 걸렸다.

**asset 본문은 신뢰할 수 없는 입력이다.** 외부 repo의 SKILL.md를 그대로 화면에 그리고 프롬프트에 싣는다. 조립기는 반드시 이스케이프하고, 화면은 평문으로 그린다. 나중에 마크다운 렌더링을 붙일 때 이 자리를 먼저 다뤄야 한다 — 렌더링에 구멍이 있으면 그 스크립트가 `window.oneDesk`로 `runs.start({ permission: 'full' })`을 부를 수 있다.

**OpenCode는 설정을 병합하고, 우리가 이길 수 없는 자리가 있다.** 우선순위는 `OPENCODE_PERMISSION` 환경변수 > 프로젝트 `opencode.json` > `OPENCODE_CONFIG`가 가리키는 파일 > 전역 설정이고, `permission` 안에서 키 단위로 합쳐진다. **`"*"`는 구체 키를 이기지 못한다** — 소스 우선순위와 무관하게 구체적인 키가 와일드카드를 이긴다. 그래서 권한은 파일이 아니라 환경변수로 넘기고 알려진 키 15개를 전부 명시한다. 이름을 대지 않은 키는 남의 설정 값이 그대로 산다.

**OpenCode는 설정이 잘못돼도 조용히 무시한다.** `OPENCODE_CONFIG`가 없는 파일을 가리켜도, 거기에 인라인 JSON을 넣어도(경로만 받는다), `OPENCODE_PERMISSION`이 깨진 JSON이어도 **종료 코드 0으로 사용자 설정에 그대로 되돌아간다.** 셋 다 결과가 같다 — 사용자 설정의 `ask`가 살아남는다. **1.18.x의 `run`은 그 `ask`를 자동 거부하고 조용히 exit 0으로 끝난다**(남는 것은 도구 실패뿐이다 — 소스 `run.ts` v1.18.30:801-822, 1.18.27과 바이트 동일). 예전에 여기 적혀 있던 "헤드리스 실행이 영원히 멈추고 슬롯을 점유한다"는 틀린 서술이었다(2026-09-27 정정, `docs/sdlc/conversation-fixes/` FR-14). 멈추지 않는 대신 **agent가 그 도구를 못 쓴 run이 성공으로 기록되고** 사용자는 이유를 알 길이 없다. `opencodeAdapter.verifyRunnable`이 실행 직전에 해결된 설정을 다시 읽어 `ask`가 남았는지 보는 이유이고, 그것을 실행 전의 명시적 실패로 바꾸므로 그 검사는 여전히 선택이 아니다.

**OpenCode 2.x CLI는 preflight가 막는다 — 권한 정책이 조용히 무시될 수 있다** (`docs/sdlc/conversation-fixes/` FR-17). 데스크톱 번들의 `opencode-cli.exe` 2.0.18을 경로로 주면 `--variant`가 없고 바이너리에 `OPENCODE_PERMISSION` 문자열조차 없다 — **읽기 전용 run이 파일을 고칠 수 있다.** 그래서 preflight가 `--version` 첫 줄의 major를 보고 2 이상이면 거부한다(명시 경로와 PATH 탐색이 합류한 뒤, `.cmd` 거부 다음 — 한쪽 갈래에만 두면 다른 쪽으로 샌다). 버전을 못 읽으면 막지 않는다(게이트 전의 동작). 판정은 (경로, 크기, mtime)으로 **프로미스째** 캐시해 동시에 들어온 조회도 프로세스를 한 번만 띄운다. **못 읽은 판정(실패·시간 초과)은 캐시에서 뺀다** — 통과(fail-open)가 굳으면 Windows 백신이 새 바이너리의 첫 실행을 붙잡은 한 번의 시간 초과가 앱이 사는 동안 2.x 차단을 꺼 둔다. 되살리면 `opencode.version.test.ts`의 "못 읽은 판정은 캐시하지 않는다"가 빨개진다. **`--version`을 띄울 때도 stdin을 닫고 `agentCommand`를 거친다** — 닫지 않으면 stdin을 기다리는 CLI가 5초 타임아웃까지 매달리고, 런처 없이는 가짜 CLI(`.mjs`)가 Windows에서 뜨지 않는다. e2e에서는 두 agent가 모두 가짜 CLI에 물려 있어 설정 화면이 열리면 `node fake-claude.mjs --version`이 한 번 돈다 — 기본 시나리오를 찍으므로(버전이 아니다) 통과하고, `ONE_DESK_FAKE_DELAY_MS`만큼 첫 `checkAgents`가 늦어지며, `ONE_DESK_*_CAPTURE`를 세운 테스트라면 그 파일을 덮는다. **가짜 CLI가 `--version`에 버전 문자열을 찍게 "고치지" 말 것** — 2.x 모양이면 게이트가 e2e의 opencode 실행을 전부 막는다. 2.0.18의 `--version` 출력 형식은 실측하지 않았다 — 파서가 받는 것은 첫 줄의 `[opencode ]v?X.Y.Z`뿐이라 형식이 다르면 "못 읽음 → 통과"로 게이트가 무력해진다.

**OpenCode의 `tool_use`는 이미 끝난 도구를 보고한다.** `part.state.status`가 `completed`이고 출력까지 함께 온다(그래서 한 줄이 `tool_use`와 `tool_result` 두 이벤트가 된다). 그 대가로 **전체 설계 §553의 "쓰기 도구 호출을 감지하면 원본을 복사한다"가 OpenCode에서는 성립하지 않는다** — 복사할 시점에 원본이 이미 없다. diff 뷰어 설계에서 정면으로 다뤄야 한다.

**OpenCode에는 claude의 `result` 같은 종료 이벤트가 없다.** 스트림이 그냥 끝난다. 그래서 어댑터가 `text` 줄마다 `result`를 함께 내고 `RunManager`가 덮어써 마지막 것이 남는다. `text`에서 `result`를 빼면 `resultText`가 영영 null이 되는데, run은 종료 코드 0이라 **성공으로 끝나고 결과만 비어 보인다.** 그 합성 result는 `status: 'succeeded'`를 싣지만 성패를 정하지 못한다 — 종료 코드가 이긴다(위 `judgeStatus` 항목). 오류는 json 모드에서 stderr가 아니라 stdout의 `{"type":"error"}` 줄로 오고, 어댑터가 그것을 error 이벤트로 낸다(메시지는 `error.data.message` → `error.message` → `error.name` → JSON 순). 1.18.30의 `run`은 error 줄을 낸 run을 `--attach`가 아니면 항상 exit 1로 끝낸다(바이너리 확인).

**같은 대화의 두 턴은 동시에 뜨면 안 된다** — `claude --resume`은 이전 프로세스가 끝나야 한다. `RunQueue`의 `groupKey`가 막고 있다.

**`root_run_id`를 NOT NULL로 "고치지" 말 것** — SQLite에서 그러려면 테이블을 다시 만들어야 하고, 그 `DROP TABLE run`이 `run_context_item`의 cascade를 태워 모든 맥락 기록을 지운다. 마이그레이션의 `PRAGMA foreign_keys=OFF`는 트랜잭션 안이라 무시된다.

**e2e에서 `getByRole('button', { name: '실행' })`은 exact 없이 쓰면 강제로 실패한다.** substring 매칭이 기본이라 도크 토글("▾ 실행"/"▴ 실행")과 슬롯 표시기(`aria-label="실행 슬롯"`)까지 같이 걸려 strict mode 위반이 된다 — run-start 버튼을 잡으려면 `{ name: '실행', exact: true }`가 필수다(태스크 8이 라벨을 "▶ 실행"에서 "실행"으로 줄이면서 처음 생긴 충돌). **"실행 중인 턴 멈추기"(대화록·도크 헤더, `Transcript.tsx`의 `STOP_RUNNING_TURN`)도 "실행"을 품는다** — 대화가 도는 동안에는 exact 없는 셀렉터에 하나 더 걸린다.

**이 함정은 "실행"만의 것이 아니다 — 짧은 라벨을 새로 붙일 때마다 기존 e2e가 깨진다.** 설정 화면에 "기본값 저장"을 더하자 글로벌 경로의 `{ name: '저장' }`이 둘을 잡아 `asset.e2e.ts`가 깨졌다. `getByLabel`도 같다 — "Skills / Agents" 패널이 `getByLabel('agent')`에 걸린다. **Vitest/RTL의 `getByLabelText`는 전체 일치라 단위 테스트는 전부 초록인 채로 넘어간다.** 새 라벨이 기존 라벨의 부분 문자열이면 e2e를 먼저 돌려볼 것. 그리고 `<label>`이 `<select>`를 감싸고 있으면 Playwright가 계산하는 접근성 이름에 `<option>` 텍스트까지 빨려 들어가므로(`"agentClaude CodeOpenCode"`), 그런 컨트롤에는 `aria-label`을 명시한다.

**줄 끝의 아이콘은 폭 0으로 접혀 있어 Playwright가 직접 hover할 수 없다.** 이슈·메모 줄의
삭제(`.item-actions`)와 repo 줄의 열기·이름 바꾸기·삭제(`.repo-actions`)는 hover·포커스에만
폭이 풀린다 — 접힌 상태의 버튼은 폭이 0이라 `.hover()`가 "li.item intercepts pointer events"로
막힌다(실측). **줄 끝 버튼은 `e2e/rowAction.ts`의 `clickRowAction(row, name)`으로 누른다**
(`docs/sdlc/conversation-fixes/` FR-23, 대화 줄의 `.dock-conv-actions`도 같다). 줄을 한 번
hover하고 바로 누르면 가끔 깨진다 — 눌리지 않은 click이 스크롤 방식을 바꿔 다시 시도하는
동안 목록이 스크롤되면 줄이 멈춘 마우스 밑에서 빠져나가 hover가 풀리고, 그다음 시도는
전부 같은 이유로 막힌다. 헬퍼는 **매번 줄을 다시 hover하고 시험 클릭(`click({ trial: true })`)이
통과할 때까지 기다린 뒤** 누른다 — "폭을 얻었는가"를 CSS 구조가 아니라 Playwright 자신의
판정으로 기다린다. 시험 클릭은 이벤트를 보내지 않으므로 "정말 삭제?" 같은 두 번 누르기
버튼이 미리 무장되지 않는다. 문자열 `name`은 **전체 일치**다: 접근성 이름이
`<제목> 삭제`라 상세의 `삭제`와 갈린다 — RTL의 이름 매칭은 전체 일치라 단위 테스트는 안
부딪히지만, Playwright는 부분 일치이므로 `{ name: '삭제' }`로 잡으면 둘 다 걸린다.

**대화의 첫 턴을 시작한 직후 도크 탭 텍스트로 "떴다"고 판단하지 말 것.** Dock의 `view`/`pickedId` 전환(RunPanel의 `onStarted` 콜백, 동기)과 `runs` 목록 갱신(`useRuns`의 `onRunUpdate` IPC push, 비동기)이 서로 다른 경로로 온다. 도크 탭(`conversations.map(...)`)은 `runs`가 갱신되는 즉시 그려지지만, 그 순간 `ConversationPanel`은 아직 `key='new'`인 옛 인스턴스일 수 있다 — 탭 텍스트가 보인다고 바로 다음 입력을 채우면 곧 재마운트될 RunPanel에 채워 넣어 버려 전송이 빈 프롬프트로 막힌다(실행 버튼이 계속 disabled). 대화록 안의 `.turn-user` 텍스트로 기다려야 재마운트가 끝난 안정된 인스턴스를 보장한다(`e2e/conversation.e2e.ts`).

**인박스 소속은 뿌리의 `reviewedAt`으로 판정한다.** 확인·보관·취소 같은 "인박스에서 내리는" 동작은 전부 **뿌리(root run) id**에 찍어야 한다. 턴 id에 찍으면 아무 일도 일어나지 않는다 — 대화는 인박스에 그대로 남는다. 실제로 `execution.cancel()`이 이 자리에서 걸렸다: 예약된 뒤 턴을 취소하면서 그 턴의 id에 확인 표시를 찍었더니, 뿌리는 계속 미확인으로 남아 대화 전체가 "대기 중 취소됨"으로 인박스에 다시 떴다(C-1-a). 반대로 뿌리에 찍는 것만으로는 새 문제가 생긴다 — `markReviewed`는 한 번 찍히면 스스로 지워지지 않으므로, 뿌리(=첫 턴)를 실행 중에 취소하면 그 대화는 세션이 살아 있어 계속 이어갈 수 있는데도 이후 어떤 턴도(`needs_answer`로 멈춘 턴을 포함해) 인박스에도 배지에도 다시 나타나지 않는다(C-1-b). 그래서 반대쪽 절반이 반드시 같이 있어야 한다: **`create()`가 `parentRunId`를 받으면(=기존 대화에 새 턴을 잇는 것이면) 뿌리의 `reviewedAt`/`reviewedKind`를 지운다.** 확인 표시를 찍는 자리(취소·확인함·보관)와 지우는 자리(새 턴 생성)가 항상 짝을 이뤄야 한다 — 한쪽만 고치면 반대 방향으로 조용히 깨진다.

**취소가 뿌리에 찍는 것은 그 대화에 취소 대상 말고 활성 턴(running·pending)이 없을 때만이다** (`core/execution.ts`의 `archiveRootIfIdle`, `docs/sdlc/conversation-fixes/` FR-8). 찍는 자리는 여전히 뿌리다 — 바뀐 것은 **언제** 찍느냐다. 예전에는 어느 분기든 찍어서, 2턴이 도는 중 예약한 3턴을 취소했을 뿐인데 2턴이 답변 필요·실패로 끝나도 인박스·배지에 안 떴다. 판정은 누른 순간 한 번으로 끝나지 않는다: **실행 중에 멈춘 턴은 그 프로세스가 `canceled`로 끝날 때(`finish`, `stopRequested`) 한 번 더 판정한다** — 도는 턴을 멈추고 프로세스가 내려가기 전에 예약까지 취소하면 두 판정이 서로를 활성으로 보고 아무도 찍지 않는다. 멈추지 못하고 제 결과로 끝났으면 찍지 않는다. **멈출 프로세스가 없는 취소는 아무것도 하지 않는다**(`manager.isRunning` 가드) — 턴이 실패로 끝나는 순간과 누른 순간이 겹치면, 렌더러가 종료 push를 받기 전에 온 취소가 방금 생긴 결과를 인박스에서 조용히 뺀다. 이 셋을 되돌리면 `execution.test.ts`의 "도는 턴 뒤의 예약을 취소해도 뿌리에 찍지 않는다"·"도는 턴을 멈추고 그 프로세스가 끝나기 전에 예약까지 취소해도, 대화가 인박스에 남지 않는다"·"이미 끝난 턴에 뒤늦게 온 취소는 뿌리에 찍지 않는다"가 빨개진다. **다른 활성 턴이 없는 경우의 C-1("취소하면 대화째 빠진다")은 그대로다** — 같은 파일의 "(C-1)" 두 테스트가 좁혀진 채 지킨다.

**launch 중인 run도 취소를 받는다 — 행은 있고 큐에는 아직 없는 틈이다** (FR-7). `launch`는 pending 행을 만들어 먼저 알린 뒤 실행 파일 확인·`verifyRunnable`(opencode는 `opencode debug config` 프로세스)·MCP 준비를 await하고 나서야 enqueue한다. 그 틈의 취소는 큐에도 manager에도 닿지 않아 **턴이 그대로 돌았다.** 그래서 `launching` 표식에 요청만 기록하고, launch가 await 뒤마다(그리고 enqueue 직전에) 요청을 보고 토큰을 폐기한 뒤 `canceled`(`startedAt` null)로 끝낸다. 요청이 있으면 그 단계가 실패했더라도 실패가 아니라 취소로 끝난다. **표식은 launch의 모든 출구에서 지운다**(try/finally) — 새도 동작으로는 드러나지 않아 `launchingCount()`가 테스트에서 지킨다("launch가 어느 출구로 끝나든 표식을 남기지 않는다"). 대기 중 취소와 launch 중 취소는 같은 `finishUnstarted`를 탄다 — 그것이 `representativeTurn`이 건너뛰는 "시작하지 못하고 취소된 턴"을 만드는 유일한 자리다.

**세션 id는 도는 중에 저장한다 — 종료 기록까지 기다리지 않는다** (FR-16). 예전에는 session 이벤트의 id가 manager 지역 변수와 로그에만 있다가 `markFinished`에서야 DB에 들어가, 첫 턴이 도는 중 앱을 끄면 `reapStale`이 interrupted로 내린 행에 세션이 없어 그 대화를 이으면 "이어받을 세션이 없습니다"로 실패했다. 이제 manager가 새 세션 id를 알게 되는 즉시 run마다 넘긴 `StartSpec.onSession`을 부르고 실행 서비스가 `runs.saveExternalSessionId`로 쓴다(`external_session_id IS NULL`일 때만, 빈 문자열은 무시). 콜백이 던지면 manager가 삼켜 `onError`로 보낸다 — 스트림 data 핸들러 안이라 새면 메인 프로세스가 죽는다. **짝이 되는 규칙: `markFinished`의 `externalSessionId: null`은 있던 값을 지우지 않는다** — manager.start가 세션을 배운 뒤 거부되면 실행 서비스는 null로 끝내는데, 덮으면 이을 수 있던 대화가 끊긴다. `execution.test.ts`의 "첫 턴이 도는 중 앱이 꺼져도 그 대화를 이을 수 있다 (FR-16)"·"세션을 배운 뒤 manager.start가 거부돼도 도는 중에 남긴 세션을 지우지 않는다"가 고정한다.

**`updatedAt`으로 "사람이 마지막으로 본 시각"을 판정하면 안 된다.** agent가 MCP `update_issue`로 본문을 고쳐도 `updatedAt`이 올라가므로, 사람이 그 이슈를 본 적이 없는데 "방금 본 것"이 된다. **agent가 건드린 이슈일수록 조용해진다** — 정확히 거꾸로다. 그래서 `seenAt`이 따로 있고, `markSeen`은 `buildPatch`를 타지 않는다. 이슈 목록 정렬은 `updatedAt DESC`가 아니라 **`seenAt` 오래된 순**이다(안 본 것이 위로). 되돌리지 말 것.

**`markSeen` 뒤에 목록을 다시 읽으면 안 된다.** 정렬이 `seenAt` 오래된 순이라, 이슈를 여는 순간 목록을 갱신하면 **방금 클릭한 항목이 눈앞에서 맨 아래로 점프한다.** `IssueDetail`의 `markSeen` effect가 `onChanged`를 부르지 않는 이유다.

**"정리 안 됨"과 "미지정"은 다른 말이다.** 전자는 훑기 대기열(`triagedAt IS NULL`), 후자는 지금 묶은 축의 값이 비었다는 뜻이다. 마이그레이션 `0003`이 백필한 이슈는 `triagedAt`은 있는데 축이 비어 있어 두 값이 갈린다 — 같은 단어로 쓰면 "정리 안 됨 0건인데 미분류 그룹에 3개"라는 화면이 나온다.

**색은 `renderer/index.css` 맨 위의 `:root` 토큰에서만 나온다 — 규칙 안에 hex를 직접 쓰지 말 것.**
다크 스킴(`prefers-color-scheme: dark`)은 같은 이름의 값만 바꾸므로, hex를 하나라도 직접 쓰면
그 자리만 다크에서 흰 채로 남는다. 새 색이 필요하면 토큰을 더하고 다크 값도 같이 정한다.
글꼴 크기는 rem이다. 안내문·빈 상태를 `opacity`로 흐리게 하지 않는다(대비 4.5:1 아래로
떨어진다) — `--text-muted`를 쓴다. 규칙은 `DESIGN.md`.

**슬래시 피커는 `popover` + CSS anchor positioning으로 최상위 레이어에 뜬다.** 인라인이면
"/"를 칠 때마다 위 내용이 밀리고, 도크 안에 `position: absolute`로 두면 `.dock-body`의
overflow에 잘린다. jsdom에는 `togglePopover`가 없어 옵셔널 호출이다 — 단위 테스트에서는
그냥 보통 요소로 보인다. 입력창의 `aria-controls`·`aria-activedescendant`가 피커의 id를
가리키므로 option의 id 규칙(`optionId`)을 바꾸면 그 둘도 같이 본다.

**맥락 칩의 접근성 이름은 `<이름> 맥락에서 빼기`다.** 보이는 글자에는 동작이 없으니 e2e와
`App.test`가 이 이름으로 칩을 잡는다. 담기 토글(`맥락에 담기`)과 부분 문자열이 겹치지
않게 고른 것이다. 실행 단축키 안내는 `renderer/shortcut.ts`가 플랫폼에 따라 정한다 —
placeholder에 ⌘를 직접 쓰면 Windows 사용자에게 없는 키를 가리킨다.

**아이콘은 `renderer/components/icons.tsx`에서만 온다.** 유니코드 글리프(✎ 🗑 ⧉ ▾)를 버튼에
직접 넣지 않는다 — 글꼴마다 굵기가 달라 한 줄에서 어긋난다. 아이콘은 전부 `aria-hidden`이라
버튼의 이름은 반드시 `aria-label`이 준다. 예외는 담기 토글의 `✓`와 훑기 배너의 `⚠`인데,
테스트가 그 글자를 텍스트로 잡고 있어서 남겨 두었다.

**그룹 헤더의 개수는 괄호가 아니라 알약이다.** 접근성 이름이 `"긴급 (2)"`가 아니라 `"긴급 2"`다 —
`IssuePanel.test`의 정규식이 그것을 본다. `Panel`의 `count` prop과 asset 절 제목의 개수도
같은 `.group-count` 알약이고, asset 절은 개수를 `h3` 밖에 둔다(제목 이름이 "SKILLS 3"이 되면
안 된다).

**항목을 열면 그 패널이 남는 폭을 다 쓰고, 나머지 둘은 180px 목록 열로 옆에 남는다**
(2026-09-22, CSS `.columns:has(> .panel-expanded)`). 2026-08-14 본문 설계의 "선택한 패널이 커지는
동적 3컬럼"(flex: 3)을 사용자가 뒤집은 것이다: 셋이 비율로 남으면 상세가 좁아 갑갑했고, 둘을
아예 숨겨 봤더니 다른 패널에 뭐가 있는지 안 보여 답답했다. **열린 패널 안에는 상세만 남는다** — 목록(`.panel-split-list`)은 CSS `:has(+ .panel-split-detail)`로
숨긴다(DOM에는 남아 입력 중이던 추가 칸이 지워지지 않는다). 그래서 **열린 동안은 그 패널의 담기
토글·제목을 Playwright가 못 누른다** — e2e는 Esc나 축소로 닫고 나서 누른다(`e2e/body.e2e.ts`).
좁은 열은 줄 오른쪽 표식(`.item-meta`)·묶기·배너·asset 설명을 숨겨 제목만 남기고, 창 폭 1280px 아래에서는 둘을 숨긴다 — **그 폭에서는 숨은 패널의
버튼을 Playwright가 못 누른다.** 돌아오는 길은 축소 버튼(아이콘, 이름은 aria-label "축소")과 Esc다. `AssetPanel`도 `Panel`에 `expanded`를 넘긴다(그전엔 빠져 있어
skill 상세가 세 번째 칸 안에서만 보였다). 이슈 상세의 상태·축·repo는 `.detail-meta` 한 줄이다 —
세로로 쌓으면 본문이 그만큼 밀려 내려간다.

**repo 목록은 사이드바의 고른 workspace 아래에 붙는다** (2026-09-22). `App`이 `RepoStrip`을
`Sidebar`의 `repoTree` prop으로 넘기고, 사이드바가 `selectedId`인 workspace 줄 밑에 그린다 —
본문 상단의 전체 폭 줄은 없어졌다. **등록 폼은 "repo 등록"을 눌러야 펼쳐지고 등록이 끝나면
접힌다.** 그래서 repo를 등록하는 e2e·단위 테스트는 전부 `getByRole('button', { name: 'repo 등록' })`를
먼저 누른다. 토글 이름에 "추가"를 넣지 않은 것은 폼의 "추가" 버튼을 부분 일치로 잡는 e2e와
부딪히기 때문이다. repo 카드의 접근성 이름은 `"<이름> repo"`다 — 이름만이면 상세의 repo 태그
칩("api")과 같아져 스크린리더도 테스트도 못 가른다. 경로는 화면에 없고 카드의 `title`로만 닿는다.
등록 폼의 경로 칸 옆 폴더 아이콘(이름 "폴더 선택")이 `app.pickDirectory`로 OS 대화상자를 띄우고,
이름이 비어 있으면 폴더 이름으로 채운다. 경로 칸은 직접 치는 용도로 남아 있다(e2e가 그것을 쓴다).
네이티브 대화상자는 Playwright가 못 누르므로 `e2e/repo-pick.e2e.ts`는 `app.electron.evaluate`로
main의 `dialog.showOpenDialog`만 바꿔 세우고 IPC 왕복은 진짜로 탄다.
줄 끝의 열기·이름 바꾸기·삭제 아이콘은 줄 위에 겹치지 않고 폭 0으로 접혀 있다가 hover·포커스에
펼쳐진다 — 겹치면 이름 가운데를 누르는 클릭을 아이콘이 가로챈다(실측).

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
| `docs/superpowers/specs/2026-08-27-issue-triage-design.md` | 이슈 훑기 설계 — 분류 축, `triagedAt` 파생(§3), `seenAt`과 방치(§3), 훑기 UI(§4), 대칭 규칙의 끝(§9) |
| `docs/superpowers/plans/2026-08-27-issue-triage.md` | 이슈 훑기 구현 계획 (9개 태스크) |
| `docs/superpowers/specs/2026-09-06-opencode-adapter-design.md` | OpenCode 어댑터 설계 — 설정 병합 규칙 실측(§2), 권한과 `ask` 검사(§3), 스트림 파싱(§6), 다른 설계로 넘긴 발견(§10) |
| `docs/superpowers/plans/2026-09-06-opencode-adapter.md` | OpenCode 어댑터 구현 계획 (9개 태스크) |
| `docs/superpowers/specs/2026-09-07-asset-scan-design.md` | asset 스캔 설계 — 데이터 모델과 `updated_at`(§2), 스캔 시점과 동일성(§3), frontmatter 파서(§4), 맥락 조립(§5), UI와 평문 렌더(§6) |
| `docs/superpowers/plans/2026-09-07-asset-scan.md` | asset 스캔 구현 계획 (10개 태스크) |
| `docs/sdlc/asset-scope/` | asset 범위 확장 — intent(문제)·spec(FR/NFR과 정책 검토)·plan(12단계). 글로벌 경로, 설정 화면, repo 필터 |
| `docs/sdlc/settings-screen/` | 탭 기반 설정 화면 — intent·spec·plan. 탭을 값의 범위로 가르는 근거(spec FR-2), 초안 state와 탭 전환(FR-11), repo 경로 변경과 asset 이동(FR-9) |
| `docs/sdlc/slash-commands/` | 슬래시 커맨드 — intent·spec·plan. 커맨드 조회와 캐시, 피커, 프롬프트 조립 |
| `docs/sdlc/conversation-context/` | 대화에 담긴 맥락 표시 — intent·spec·plan. 담긴 것의 합집합을 어디에 두는지, 이름을 core가 붙이는 이유, 지워진 asset 필터링 개정 |
| `docs/sdlc/run-info/` | 대화에 실행 정보 표시 — intent·spec·plan. 두 CLI가 주는 것의 실측 표, 합계와 컨텍스트 점유를 가르는 근거(spec §3-2), 필드마다 다른 병합 규칙(§3-3) |
| `docs/sdlc/agent-setup/` | agent 준비 상태와 실행 조건 — intent·spec·plan. 세 칸이 쌓이는 판정(FR-1), init이 인증·모델을 보지 않는 실측, 자유 입력을 남긴 근거(FR-8), effort/variant를 가른 이유(FR-13) |
| `docs/sdlc/repo-instructions/` | repo의 지시 파일 보기 — intent·spec·plan. discovered 본문 읽기 통로(`readBody`, id로만), `instructions` 종류가 맥락에 담기지 않는 이유(FR-9) |
| `docs/sdlc/conversation-lifecycle/` | 대화의 수명 주기와 정체성 — intent·spec·plan. 배지가 세는 것과 자동 확인이 한 표의 양면인 근거(spec FR-3), 종료가 확인을 겸하는 이유(FR-12), 찍는 자리와 지우는 자리의 짝(FR-13), 제목 폴백 사다리(FR-11) |
| `docs/sdlc/conversation-fixes/` | 대화의 확인된 결함 묶음 — intent·spec·plan. 대표 턴(spec FR-1), 두 칸짜리 인박스 표(FR-4), 취소가 뿌리에 찍는 조건(FR-8), 종료 코드가 이기는 판정(FR-12), OpenCode 버전 게이트(FR-17), Windows 트리 종료(FR-18) |
| `docs/windows-setup.md` | **Windows 개발 환경 이관 가이드** — 빌드 도구(VS 2022 고정), 앱 데이터 옮기기와 경로 재지정(§4), Windows에서 다르게 도는 것(§5), git이 안 실어 나르는 것(§6) |
| `docs/diagrams/` | 아키텍처 다이어그램 — `one-desk-architecture.html`(단독 실행 가능)과 그것을 만든 archify 사양 `one-desk.architecture.json`. `main`에 들어가면 `.github/workflows/pages.yml`이 GitHub Pages로 올린다 |

**설계 문서의 결정을 코드에서 임의로 바꾸지 않는다.** 설계에 구멍이 보이면 고치지 말고 지적할 것 — 그게 더 값지다.
