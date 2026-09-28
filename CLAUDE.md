# one-desk

workspace/repo/issue/memo를 한 화면에서 관리하고, 필요한 맥락을 골라 CLI 코딩 agent(Claude Code, OpenCode)에게 넘겨 헤드리스로 실행한 뒤 결과를 앱에 기록하는 Electron 데스크톱 앱.

**현재 상태:** 4단계 완료(MCP 서버 — 호스트/도구 아홉 개/권한별 등록/커맨드 배선), `main`에 병합됨(`a19b4fd`). 이슈·메모 본문 편집(설계 `2026-08-14-issue-memo-body-design.md`)도 `main`에 병합됨(`c91438e`) — 저장소의 `updateIfUnchanged`로 낙관적 잠금, 선택한 패널이 커지는 동적 3컬럼, 맥락 담기와 열기 분리, `IssueDetail`·`MemoDetail` 본문 편집기, 그리고 `e2e/body.e2e.ts`가 IPC 왕복(`client.issues.updateIfUnchanged` → preload → `ipcMain.handle` → 저장소)을 실제로 검증한다. **상태 편집은 상세에만 있다** — 목록의 상태 칩은 읽기 전용 배지다(§5·§9). 3b 리뷰가 4단계로 이월한 것 둘 다 해소됐다: `core/`의 `console.error`가 주입식 `onError`로 바뀌었고, `resume`의 catch는 DB 장애를 더 이상 뭉개지 않는다.

**릴리스 파이프라인**(설계 `2026-08-14-release-pipeline-design.md`)이 붙었다. `v*` 태그를 밀면 GitHub Actions가 빌드해 draft 릴리스에 산출물을 올린다. **지금 빌드하는 것은 Windows portable `.exe`(x64) 하나뿐이다** — 받아서 쓰는 사람이 Windows뿐이고, release job이 `needs: build`라 다른 플랫폼이 깨지면 Windows 산출물까지 못 올라가기 때문이다(워크플로 matrix 주석에 되살리는 법이 적혀 있다). macOS는 개발 장비에서 `pnpm run pack`으로 언제든 만든다. **네이티브 모듈 때문에 크로스 컴파일은 불가능하므로** — `better-sqlite3`를 각 러너에서 그 플랫폼의 Electron ABI에 맞춰 컴파일한다. Windows 러너는 `windows-2022`로 고정돼 있다(최신 이미지의 Visual Studio 18을 node-gyp가 못 읽는다).

**agent는 MCP에 stdio로 붙는다**(설계 `2026-08-14-mcp-stdio-design.md`) — claude가 `core/mcp/bridge.mjs`를 자식 프로세스로 띄우고, 브리지가 앱 안의 HTTP 서버로 중계한다. 사내 프록시가 루프백 HTTP를 403으로 막던 환경 때문이다. `ONE_DESK_REAL_CLI=1 pnpm test realCli`가 진짜 CLI로 이 계약을 검증한다.

**MCP 서버는 이제 부팅과 함께 뜬다**(설계 `2026-08-14-mcp-always-on-design.md`). 전체 설계 §14의 "앱을 여는 행위가 아무것도 시작하지 않는다"를 사용자가 명시적으로 뒤집은 것이다 — 사이드바 하단이 `● MCP :53021`로 상태와 포트를 보여준다. 토큰은 여전히 run 단위라, run이 없는 동안 서버는 401만 돌려주는 껍데기다. **포트는 원래부터 동적이었다** — `listen(0)`이 OS에게 빈 포트를 받으므로 충돌이 구조적으로 불가능하다.

같은 작업에서 **Windows 실행 경로**가 처음으로 열렸다. 실행 파일 탐색이 `core/runner/executable.ts`로 떨어져 나와 `PATHEXT`와 폴백 디렉토리를 다루고, `.cmd` 설치본은 preflight가 명확한 메시지로 거부한다. 그 과정에서 로그 스트림의 미처리 오류가 메인 프로세스를 죽이던 결함도 잡혔다.

**대화(세션을 이어가는 대화)**가 10개 태스크로 완성돼 `main`에 병합됐다(`79a612e`, 설계 `2026-08-18-conversation-design.md`, 계획 `2026-08-18-conversation.md`). v0.2.0으로 릴리스됐다 — **첫 실행에 마이그레이션이 돈다**(`run.root_run_id` 추가 + 기존 행 백필). run은 더 이상 일회용이 아니라 전부 대화다: `run.rootRunId`가 턴을 한 대화로 묶고(승계 규칙은 "부모의 rootRunId, 부모가 없으면 자기 id"), 도크는 run이 아니라 대화 단위이며(`renderer/conversation.ts`의 `groupConversations` — 가로 탭이던 것이 지금은 세로 목록이다, 아래 수명 주기 절), 인박스 항목도 대화 하나당 한 줄로 그 대화의 마지막 턴을 보여준다 — "로그 보기"·"이어서 실행" 두 버튼이 "대화 열기" 하나로 합쳐졌다. **대화당 예약은 하나뿐이다**(설계 §3-2): 앞 턴이 도는 중에 다음 지시를 보내면 그 턴은 `pending`으로 걸리고(대화록이 아니라 입력칸 위 예약 칩 — 아래 대화 화면 절) 전송이 잠긴다 — `RunQueue`의 `groupKey`(대화의 root run id)가 같은 대화의 두 턴이 동시에 뜨는 것을 막는다(`claude --resume`은 이전 프로세스가 끝나야 한다). 대화록의 각 턴은 **전부 접힌 채로 시작한다 — 진행 중이어도 마찬가지다**(2026-09-22, 사용자가 설계 §4-1을 뒤집었다: 도구 호출이 흐르면 대화록이 그것으로 가득 차 지시와 답변이 밀려난다). 접힌 턴도 진행은 보여준다 — 상태 줄(경과 시간·지금 도는 도구)·활동 요약 한 줄·답 칸(진행 중이면 지금까지의 마지막 텍스트, 끝났으면 최종 답)·끝줄이고, "자세히"를 눌러야 중간 텍스트·도구 호출·diff가 보인다(아래 대화 화면 절). **펼치고 접는 것은 전부 사용자가 정한다** — 상태 전이가 그 선택을 되돌리지 않으므로 `Turn`에는 `open`을 강제하는 effect가 없다(되살리면 `Transcript.test`의 "예약된 턴이 자동으로 시작돼도 접힌 채로 남는다"가 빨개진다). `e2e/conversation.e2e.ts`가 화면을 벗어나지 않고 3턴을 실제로 주고받아 이 핵심 약속 — 특히 "앞 턴이 끝나면 예약된 턴이 자동으로 뜬다" — 을 검증한다.

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

남은 5단계 과제는 diff 뷰어 하나다 — 그 재료(줄 번호 hunk, claude의 편집 전 원본 `before`)는 `conversation-events`가 로그에 남기기 시작했다(아래 절). **착수를 막던 환경변수 결정은 해소됐다**(아래 절). 본문 작업이 넷으로 쪼갠 것 중 첫째였으므로 나머지 셋(마크다운 렌더링 · 검색/필터/정렬 · run 완료 구독)도 후보로 남아 있다. 대화 기능은 이 목록과 별개로 진행돼 완료·병합됐다(위 절). 그중 **run 완료 구독은 이미 해소됐고** 마크다운 렌더링은 agent 답에만 붙었으므로(아래 대화 화면 절) 남은 것은 검색/필터/정렬과, 이슈·메모·asset 본문의 마크다운이다.

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
실패 결과도 수동 새로고침 전까지 유지하되, **로그인하지 않은 채 난 실패는 로그인이 확인되는 순간 버린다**(`docs/sdlc/command-cache-auth/` — 실패할 때 인증 상태를 적어 두고 그 실패를 다시 내줄 때만 `auth status`를 묻는다. 설정의 `다시 확인`은 workspace의 모든 repo cwd를 비운다). probe는 init 직후 SIGKILL로 종료한다 — 일반 실행의
SIGTERM 유예를 쓰면 모델 호출까지 진행할 수 있다. OpenCode에서는 피커와 조회를 비활성화한다.
슬래시 프롬프트는 커맨드를 맨 앞에 두고 맥락·답변 필요 안내를 뒤에 붙인다. 마이그레이션 없음.
`e2e/slash.e2e.ts`가 IPC부터 실제 CLI stdin까지, 선택 실행하는 `e2e/slash-real.e2e.ts`가
실제 Claude의 첫 턴·resume 커맨드 확장을 검증한다.

**`@`로 작업 디렉토리의 파일을 짚는다** (`docs/sdlc/input-triggers/`). 마이그레이션 없음 —
`run_context_item.item_type`에 CHECK가 없어 `'file'`만 타입에 더했다. 입력칸에서 `@`를 치면(두 agent 모두)
작업 디렉토리 repo의 `git ls-files -co --exclude-standard` 목록에서 퍼지로 고르고, 고르면 `@경로 ` 글자가 들어간다.
**지시문의 멘션이 곧 맥락이다** — 파일 칩은 없고, 보낼 때 core가 원문을 다시 해석해 파일을 읽어 `<files>`에
싣고(`file` 맥락 id는 `<repoId>:<상대 경로>`), 대화 헤더에 `파일 · 경로`로 보인다. 읽기 거부(repo 밖·바이너리·
UTF-8 아님·256 KiB/턴 512 KiB/20개 초과)는 run 행을 만들기 전에 전송을 막는다. **맥락 본문의 `@`가 이제
`&#64;`로 조립된다** — 이 기능 이전부터 있던 구멍을 같이 막았다(아래 함정 절).

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
  온 취소도 표식으로 잡는다. 실행 중인 턴은 대화록 상태 줄의 "실행 중인 턴 멈추기"로
  멈춘다. 이 작업이 도크 헤더에 둔 같은 버튼은 `conversation-timeline`이 걷었다 — 지금
  멈추는 자리는 셋이다(아래 함정 절의 "멈추는 자리는 셋이고").
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
  기능(`conversation-timeline`, 바로 아래 절)이 했다. 리뷰가 재현했지만 이 spec의 결정을
  뒤집어야 해서 코드로 고치지 않은 셋(답을 보낸 뒤 시작 전 취소, `reapStale`이 내린 예약
  건너뛰기, 도크 점과 헤더의 불일치)은 spec §7에 있다 — 마지막 것은 그 기능이 풀었다(목록
  점이 도는 턴을 먼저 그린다, 2026-09-27 결정 — 아래 함정 절의 `Conversation` 항목).

**대화 화면이 OpenCode처럼 읽힌다** (`docs/sdlc/conversation-timeline/`). 마이그레이션·IPC·
스키마 변경 없음 — 이미 렌더러에 push로 와 있던 text·tool_use·tool_result를 화면이 쓰기 시작한
것이다. 의존성 둘(`react-markdown` 10.1.0 · `remark-gfm` 4.0.1, devDependencies)이 늘었고 렌더러
번들이 726,814 B → 1,164,390 B(+60%, electron-vite 기본대로 압축하지 않은 크기)다.

- **턴은 여전히 전부 접힌 채 시작하지만 접힌 턴이 보여주는 것이 늘었다** — 진행 중이면 상태
  줄(스피너 · 작업 중 · 경과 시간 · 지금 도는 도구 · 멈추기)과 지금까지의 마지막 텍스트, 끝났으면
  최종 답, 그리고 활동 요약 한 줄("도구 7회 · 실패 1")과 끝줄(상태 알약 · `agent · 모델 · 22초 ·
  effort · 권한` · 응답 복사 · 자세히). "자세히"는 OpenCode "컴팩트" 타임라인이다 — 중간 텍스트 ·
  한 줄 활동 묶음("4 읽기, Grep, 셸 사용됨") · 묶음 밖에 따로 선 실패 · 파일별 편집 diff.
  `RunLog.tsx`는 없어졌다. 턴 사이에 요청한 모델·effort가 바뀌면 가운데 공지선이 선다.
- **답은 마크다운이다** — 원시 HTML은 글자, 링크는 http(s)만, 이미지는 그리지 않고, main도 새 창·
  창 안 탐색·다운로드를 막는다(아래 함정 절).
- **입력부는 도크 바닥에 고정된 카드 하나다** — 맥락 칩 · 입력칸 · 알약 다섯(agent · 모델 ·
  effort/variant · 권한 · 작업 디렉토리) · 전송. 도는 턴이 있고 입력이 비었으면 전송이 **중지**가
  된다. 예약(이어 보낸 지시)은 대화록의 버블이 아니라 입력칸 위 칩이다. 대화마다 쓰던 지시가
  남는다 — 대화를 바꾸거나 인박스에 다녀와도.
- **대화 헤더가 생겼다** — 제목(누르면 이름 바꾸기) · `⋯` 메뉴(이름 바꾸기 · 대화 끝내기) · 부제 ·
  멈추기 · 컨텍스트 링(누르면 누적 토큰과 추정 비용). "이 대화에 담긴 것" 줄도 헤더로 올라왔다.
  lifecycle의 남은 일("끝내기가 hover에만 있다")이 이것으로 풀렸다.
- **도크 헤더는 토글 · 슬롯 표시기 · 최대화다** — 취소가 없어졌다. 최대화는 세 패널을 숨기고
  Esc로 푼다. 기본 높이가 창의 34% → 50%, 하한이 120 → 280px이다. **스크롤은 대화록만 한다** —
  헤더와 입력부가 고정이고, 바닥에 붙어 있으면 새 내용을 따라 내려가며 위로 올려 두면
  `최신으로 이동`이 뜬다.
- 실패·중단된 마지막 턴에는 **"다시 보내기"**(같은 대화에 같은 지시·맥락·조건 — `runs.resume`),
  답변 필요면 **"답하기"**(입력칸 포커스)가 붙는다. 인박스의 "다시 실행"(새 대화)은 그대로다.
- 상태 이름은 한국어 표(`renderer/runStatus.ts`) 하나, agent 이름도 표(`renderer/agents.ts`)
  하나다 — 영어 enum이 화면에 나가지 않는다. 대화 영역의 글자 `opacity`와 유니코드 글리프가
  토큰·SVG 아이콘으로 바뀌었다.
- `e2e/timeline.e2e.ts`가 가짜 CLI의 도구·마크다운 시나리오로 접힌 진행·펼친 블록·답의 보안을,
  `e2e/composer.e2e.ts`가 중지·초안·최대화·헤더 메뉴·최신으로 이동을, `e2e/nav-guard.e2e.ts`가
  main의 가드를 렌더러를 거치지 않고 검증한다.
- spec §8의 과제는 2026-09-27에 정해졌다(사용자 위임, 각 항목의 "결정") — 이어 가는 대화의 작업
  디렉토리 알약은 repo 이름이고 경로는 `title`과 곁의 `작업 디렉토리 경로 복사`다, 컨텍스트 링 곁에
  퍼센트 글자가 서고 링은 짧은 호로 그린다, 도는 턴의 끝줄 메타에는 시간이 없고(상태 줄이 말한다)
  헤더의 멈추기는 입력칸에 초안이 있을 때만 선다, 빈 입력칸은 한 줄에서 시작하고 맥락이 비면 칩 줄이
  없다(1440×900 기본 도크, 담긴 것 줄이 없는 헤더에서 입력 카드 71px · 대화록 268px), mcp 도구 이름은 백틱 없이 모노(`1 list_issues 사용됨`)이고
  꺾쇠는 글자 바로 뒤(파일 줄만 오른쪽 끝), 경로는 모노(`.path-text`)라 `₩`로 보이지 않는다, 점유를
  모르는 마지막 턴의 링은 앞 턴의 짝을 그대로 보인다(FR-36 문장을 그 동작대로 고쳤다). **여전히 남은
  것은 마크다운 예산의 대가 하나다** — 지금대로 두기로 했다.

**대화가 버리던 데이터를 싣는다** (`docs/sdlc/conversation-events/`). 마이그레이션·IPC 채널·스키마 변경
없음 — 로그는 줄 단위 JSON 그대로이고 이벤트에 선택 필드와 종류 둘(`reasoning`·`notice`)이 늘었다.
화면이 못 그리던 이유는 화면이 아니라 어댑터였다: 도구 출력은 200자 요약만 남았고, claude의
`tool_use_result`·opencode의 `state.metadata`·생각·하위 에이전트 출처·system 공지는 전부 버려졌다.

- **도구 결과가 세 겹이다** — 200자 `summary`(그대로 — 옛 소비자가 읽는다), 원문의 **끝부분** `output`
  (≤ 65,536자, 읽기 도구의 원문은 싣지 않는다 — spec §7-A), 구조화된 `detail`(`shell` 종료 코드·중단 /
  `search` 개수와 단위 / `edit` 파일별 hunk·`+N −M`·claude의 `before` / `subagent` 도구 수·시간·모델).
  CLI 방언은 어댑터 밖으로 나가지 않는다(spec NFR-2의 grep).
- **대화록에 새로 보이는 것** — 셸 줄의 출력 블록(열 때 바닥, ANSI는 화면에서만 걷는다)과 `종료 코드 N`,
  검색 줄의 `(파일 N개)`·`(N개 일치)`·`(N줄)`(TL의 `(N개 일치)`는 claude Grep 기본이 파일 수라 바로잡았다),
  편집 파일의 줄 번호 diff(`⋯ N줄`, 번호 칸은 복사에서 빠진다)와 `이전 내용 보기`, 생각 블록(`생각 · 약 4초`
  — 평문), 하위 에이전트 카드(자식 도구가 카드 안으로), 공지선(`API 재시도 중 · 2/10번째`·`대화가 압축됨`·
  `권한 때문에 막힘: Bash`·`모델 대체`), 접힌 턴 요약 `도구 7회 · 실패 1 · 권한 거부 1 · 대화 압축됨`, 창
  때문에 앞이 잘린 턴의 `앞의 기록 N개는 생략했습니다`.
- **run마다 원본 stdout 줄이 `logs/<runId>/raw.jsonl`에 남는다** — 파서가 좋아지면 지난 대화에 쓸 재료다.
  다시 파싱하는 기능과 읽는 코드는 없다(아래 함정 절).
- **opencode는 `--thinking`을 늘 붙이고, 그래서 1.1.50 미만을 preflight가 막는다** — 그 플래그가 1.1.50에서
  생겼고 모르는 옵션이면 CLI가 시작부터 exit 1이다. 같은 이유로 claude의 숨은 `--thinking-display`는 붙이지
  않는다.
- `readLog`는 파일 전체가 아니라 끝에서부터 창만큼 읽고, 렌더러 스토어와 **같은 창**을 본다(아래 함정 절).
- `e2e/events.e2e.ts`가 가짜 CLI의 `ONE_DESK_FAKE_SCRIPT=events`(claude·opencode 둘 다)로 위 화면과
  `raw.jsonl`을 검증한다. 가짜 opencode는 `--thinking`이 있을 때만 reasoning 줄을 낸다(실제 run 루프와 같게) —
  `buildCommand`에서 그 인자를 빼면 e2e가 빨개진다.
- **리뷰가 남긴 과제 다섯은 spec §9다.** 빈 claude 생각(§9의 1)은 2026-09-27에 "이벤트를 만들지 않는다"로
  정했다. 남은 것 중 둘은 spec의 결정을 다시 정해야 한다 — 화면이 쓰지 않는 Edit `before`의 무게(§9의 2),
  그리고 **`raw.jsonl`이 agent가 읽은 파일 원문(`.env` 같은 것)·생각 서명을 평문으로 무기한 남기는 것**
  (§9의 3 — 로그 보존 정책이 아직 없다. claude 자신도 `~/.claude/projects/`에 같은 원문을 남기므로 새로 생긴
  노출은 아니지만, 지우는 규칙은 `conversation-next`에서 정해야 한다). 픽스처는 합성이다 — 실제 run의
  `raw.jsonl`로 바꾸는 것이 plan의 후속 항목이다.

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

**`pnpm test:e2e`와 `pnpm dev`를 동시에 돌리지 말 것.** `test:e2e`는 `electron-vite build`로 시작하는데, 그 산출물 디렉토리가 `electron-vite dev --watch`가 감시하는 `out/`과 같아서 실행 중인 dev 앱의 main/preload가 e2e용 빌드로 갈아끼워진다. 반대 방향(dev가 떠 있어도 e2e는 정상 동작)은 검증돼 있으니, 손해를 보는 쪽은 항상 dev다. **dev를 끌 수 없으면 작업 트리를 복사한 곳에서 돌린다** — 추적 파일과 새 파일(`git ls-files -co --exclude-standard`)을 다른 디렉토리로 복사하고 `node_modules`만 저장소의 것으로 잇는 접합점(`mklink /J`)을 둔 뒤 거기서 `pnpm test:e2e`를 부른다. 드라이버가 앱 루트를 제 파일 위치에서 뽑으므로(`e2e/driver.ts`의 `APP_ROOT`) 복사본의 `out/`을 쓴다. 치울 때 접합점은 링크만 지운다(`cmd /c rmdir`) — 도구에 따라 재귀 삭제가 접합점을 따라 들어가 저장소의 `node_modules` 내용까지 지운다(Windows PowerShell 5.1의 `Remove-Item -Recurse`가 그렇다). `conversation-timeline`의 리뷰 반영과 마지막 검증이 이렇게 돌았다.

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

**`Conversation`의 턴 셋은 서로 다른 질문의 답이다 — `last`를 상태로 쓰지 말 것** (`renderer/conversation.ts`, `docs/sdlc/conversation-fixes/` FR-3·FR-11). `last`는 가장 최근에 **만든** 턴(목록 줄의 시각·repo), `state`는 대표 턴(`representativeTurn` — 답변 필요·자동 확인), `active`는 멈출 턴(running, 없으면 pending, 없으면 null)이다. **목록 줄의 상태 점은 표시용으로 `conv.active ?? conv.state`를 그린다**(2026-09-27 결정 — conversation-fixes spec §7-3을 `conversation-timeline` spec FR-45 다듬음이 풀었다) — 대표 턴만 그리면 앞 턴이 도는 동안 이어 보낸 예약이 점을 "대기 중"으로 만들어, 대화록·헤더는 실행 중이라는데 목록만 기다린다고 한다. **표시만 그렇다** — 답변 필요 표시와 자동 확인은 계속 `state`다(배지를 세는 core와 같은 턴이어야 한다). 되돌리면 `Dock.test`의 "도는 턴이 있으면 예약이 걸려 있어도 점은 실행 중이다"가 빨개진다. 예전에는 전부 `last`였다: 예약이 있으면 도크 헤더의 취소가 예약을 겨눠 **실행 중인 턴을 멈출 버튼이 없었고**, 예약을 취소하면 마지막 턴이 canceled가 되어 버튼이 사라졌다. 지금 멈추는 자리 셋(입력부 `중지`·대화 헤더 `이 대화의 실행 멈추기`·상태 줄 `실행 중인 턴 멈추기`)은 **running일 때의 `active`만** 겨누고, 예약은 입력칸 위 칩의 `예약 취소`, 슬롯을 기다리는 첫 지시는 상태 줄의 `대기 취소`다. **이름이 같으면 같은 턴이다** — 멈추는 셋의 이름에 "취소"를 넣지 않은 것은 예약·대기의 "취소"와 부분 일치로도 갈리게 하려는 것이다. `Dock.test`의 "예약이 걸린 대화에서 중지·멈추기는 도는 턴을, 예약 취소는 예약을 겨눈다"·"예약을 취소해 마지막 턴이 끝났어도 도는 턴이 있으면 중지가 남는다"가 고정한다. 자동 확인은 `INBOX_RULES[inboxCategory(conv.state)].clearsOnView`와 `conv.state.endedAt`을 본다 — 예약이 기다리거나 도는 턴이 있으면 끝난 대화가 아니다.

**workspace가 바뀌면 도크의 선택은 렌더 중에 처음으로 돌린다 — effect가 아니다** (FR-22). `view`·`pickedId`·`renaming`·`actionError`를 이전 `workspaceId`와 비교해 렌더 중에 맞춘다(React의 "prop이 바뀌면 state 조정" 패턴). effect면 옛 선택과 새 workspace가 함께 그려지는 한 프레임이 생긴다. 끝낸 대화 펼침(`showClosed`)과 도크 최대화(`maximized`)는 선택이 아니라 보기 취향이라 두고 간다(`Dock.test`의 "workspace가 바뀌어도 최대화는 남는다"). `App`의 `focusConversationId`는 **한 번 쓰면 치운다** — Dock의 필수 prop `onFocusConsumed`가 그 배선이다. 선택 prop이면 `App`의 한 줄을 지워도 조용히 컴파일되고, 그러면 다른 화면에 갔다 올 때마다 그 대화로 끌려간다(`App.test`의 "\"대화 열기\"는 한 번만 연다"). 의존성 배열에 `onFocusConsumed`를 넣지 말 것 — `App`이 매 렌더 새 함수를 넘겨 치워지기 전 렌더마다 다시 연다.

**로그 되살리기는 교체가 아니라 seq 병합이다 — 그리고 `readLog`는 비동기다** (FR-19). `useRunEvents`는 턴을 펼칠 때(`Transcript`의 펼친 몸통 — 접힌 턴은 로그를 읽지 않는다, 아래 항목) `runs.readLog`를 부르는데, 그 응답이 오는 사이 `onRunEvent` push가 계속 들어온다. 스토어의 `hydrate`가 목록을 통째로 바꾸면 그 사이 도착한 이벤트가 지워진다. 그래서 seq로 합치고 중복 seq는 하나만 남긴다(`runEvents.test`의 "로그를 읽는 사이에 push된 이벤트를 지우지 않는다"). 병합한 뒤에는 push와 같은 창(`RUN_EVENT_WINDOW`)을 건다 — 예전에는 병합에 상한이 없어 되살린 로그를 전부 들고 있었지만, 도구 출력·hunk가 실리면서 이벤트 하나가 수십만 자일 수 있게 됐다(`conversation-events` FR-31, 아래 창 항목). `readLog`는 `fs/promises`로 읽는다 — 메인 프로세스에 MCP 서버가 같이 있어 긴 로그를 동기로 읽는 동안 IPC와 agent의 MCP 호출이 전부 멈춘다(위 `execFileSync` 함정과 같은 뿌리). 파일이 없으면(ENOENT) 빈 배열이고 그 밖의 읽기 실패는 던진다 — 삼키면 로그가 원래 없던 run처럼 보인다.

**대화 이름을 비우고 저장하면 파생 제목으로 돌아간다** (FR-21, lifecycle FR-14). `RenameField`는 기본이 "빈 이름 = 취소"라 붙인 이름을 지울 길이 없었다. `allowEmpty`를 대화 이름 칸(목록 줄과 대화 헤더 — 편집 state는 Dock의 `renaming: { id, where }` 하나라 한 번에 한 자리뿐이다)에서만 켜 `rename(root, '')`를 부른다 — IPC 시그니처가 string이고 저장소가 빈 문자열을 null로 저장한다. 이름이 없던 칸을 그대로 닫으면 여전히 취소다. 같은 컴포넌트를 쓰는 workspace(`Sidebar`)·repo(`RepoStrip`) 이름에는 켜지 않는다 — 비우면 되돌아갈 파생 이름이 없다.

**`run.title`·`run.closed_at`은 뿌리 행에서만 의미가 있고 타입은 그것을 지켜주지 않는다.** 이어지는 턴의 행에도 컬럼이 있고 null일 뿐이다. 저장소의 `close`/`rename`이 `assertRoot`로 던지는 것이 유일한 방어선이다 — 조용히 엉뚱한 행에 찍히면 화면에서 영영 드러나지 않는다. 읽는 쪽도 같다: `groupConversations`는 뿌리를 **id로 찾는다**(`ordered[0]`이 아니다). 가장 오래된 행이 뿌리라는 것은 "목록이 그 대화의 모든 턴을 담고 있다"에 얹힌 가정이고, `runs.list`에 개수 제한이 붙는 날 조용히 null이 된다.

**도크 줄의 제목은 지시가 아니라 담은 맥락에서 온다.** e2e가 프롬프트 문자열로 줄을 찾으면 못 찾는다 — 이슈를 담은 대화의 제목은 그 이슈 이름이다(`core-loop.e2e.ts`·`conversation.e2e.ts`가 이것으로 한 번 깨졌다). 그리고 **제목으로 개수를 세지 말 것**: 줄 끝 액션의 접근성 이름이 `<제목> 이름 바꾸기`·`<제목> 대화 끝내기`라 제목 문자열은 줄 하나당 세 번 걸린다. 개수는 `.dock-conv`로, 제목 확인은 `.dock-conv-title`로 한다.

**`shared/`의 테스트는 `vitest.config.ts`의 include에 넣어야 돈다.** 프로젝트가 core(`core/**`)와 renderer(`renderer/**`) 둘뿐이라, `shared/x.test.ts`를 만들면 **어느 쪽에도 안 걸려 실행되지 않은 채로 통과한 것처럼 보인다.** 같은 파일의 renderer include 주석이 경고하던 그 함정이다 — 지금은 core 프로젝트가 `shared/**/*.test.ts`도 함께 잡는다.

**Windows는 열린 핸들이 있는 파일을 지우지 못한다 — 테스트가 연 DB는 반드시 닫아야 한다.** POSIX는 열려 있는 파일도 unlink되므로 macOS·Linux에서는 핸들을 흘려도 `rmSync`가 조용히 성공한다. Windows에서만 `EBUSY: resource busy or locked`로 죽고, **그래서 로컬은 전부 초록인데 릴리스 CI의 Windows 잡에서만 터진다**(v0.2.0 릴리스가 실제로 이렇게 한 번 깨졌다). `openDb`는 핸들을 돌려주지 않는 것처럼 보이지만 반환한 drizzle 인스턴스의 `$client`가 그것이다 — `core/db/open.test.ts`의 기존 테스트들이 이미 `db.$client.close()`를 쓰고 있으니 그 패턴을 따를 것. **Node의 `fs` 스트림은 이 함정에 걸리지 않는다** — libuv가 파일을 `FILE_SHARE_DELETE`로 열어, 닫지 않은 `WriteStream`이 있어도 Windows 11에서 `rmSync`가 성공한다(2026-09-27 실측). 그래서 "임시 디렉토리가 지워지는가"로는 로그 writer를 닫았는지 검증하지 못한다 — `manager.test`는 `createRawLogWriter`를 `vi.mock`으로 감싸 close가 **끝났는지**를 직접 기록한다(`conversation-events` plan 3단계의 완료 확인이 이것으로 바뀌었다).

**`productName`이 사용자 데이터 위치를 정한다 — `appId`가 아니다.** Electron은 `userData`를 `appData` + 앱 이름으로 만들고 앱 이름은 `productName`을 우선한다. `electron-builder.yml`의 `productName: one-desk`를 보기 좋게 바꾸면 기존 사용자의 DB 디렉토리를 앱이 더 이상 보지 않는다.

**MCP는 stdio로 간다 — HTTP가 아니다.** claude가 `core/mcp/bridge.mjs`를 자식 프로세스로 띄우고 표준입출력으로 JSON-RPC를 주고받으면, 브리지가 그것을 앱 안의 HTTP 서버로 중계한다. **HTTP로 직접 붙던 시절에는 사내 프록시가 루프백 요청을 403으로 막아 그 환경에서 아예 못 썼다** — 같은 포트에 `curl`은 401을 받는데 agent만 실패하는 증상이었다. Node의 `http`/`fetch`는 `HTTP_PROXY`를 자동으로 쓰지 않으므로 브리지는 통과한다. **브리지는 멍청한 파이프다** — 권한 게이팅과 도구 등록은 전부 서버에 남는다. **예외는 하나, SSE 본문에서 응답을 고르는 것이다** (`docs/sdlc/conversation-fixes/` FR-20). 서버는 응답 앞에 알림을 먼저 보낼 수 있는데 첫 `data:` 줄만 넘기면 claude가 알림을 응답으로 받고 진짜 응답은 버려진다. 그래서 이벤트 단위로 가르고(여러 줄 data·CRLF 포함) **요청 id가 같고 `method`가 없는** 메시지를 한 줄로 다시 직렬화해 보낸다. 맞는 것이 없으면 그 id로 JSON-RPC 오류를 돌려준다 — 알림을 응답 대신 넘기면 claude가 영영 기다린다. 알림과 서버발 요청은 stdio 쪽으로 전달하지 않고 버린다(서버가 sampling·elicitation·progress를 쓰기 시작하면 전달 경로가 필요하다). `bridge.test.ts`의 "응답 앞에 온 알림을 건너뛰고 요청 id와 같은 응답을 돌려준다"가 고정한다.

**브리지는 `extraResources`로 나간다.** 번들되지 않는 원본 `.mjs`이고, `command`는 Electron 바이너리에 `ELECTRON_RUN_AS_NODE=1`이다(패키징된 앱에 독립 `node`가 없다). asar 안에 두지 않는다 — asar 내부 경로를 자식 프로세스로 실행할 수 있는지가 플랫폼마다 미묘하다.

**사내 프록시가 잡힌 환경에서는 루프백을 예외로 못박아야 한다.** MCP 서버는 항상 `127.0.0.1`인데 `NO_PROXY`에 루프백이 빠져 있으면 agent의 MCP 요청이 프록시로 나가 30초 뒤 타임아웃으로 죽는다. **같은 포트에 `curl`은 401을 받는데 agent만 못 붙는 증상**으로 나타난다 — 그게 이 원인을 가리키는 신호다. `claudeCode.ts`의 `withLoopbackBypass`가 기존 값을 보존하며 `127.0.0.1`·`localhost`·`::1`을 더한다. NO_PROXY는 목적지만 정하므로 원격 호출에는 영향이 없다.

**claude는 프롬프트의 `@경로`를 도구 권한 밖에서 펼친다 — 조립기의 중화를 지우지 말 것** (`docs/sdlc/input-triggers/`
spec §6 실측, claude 2.1.283). `--tools ""`로 도구를 하나도 주지 않아도, `@`가 줄머리이거나 공백류(탭 포함) 바로
뒤면 그 파일을 읽어 첨부로 넣고, `@../x`·절대 경로로 **repo 밖**까지 읽는다. `<context>` 태그 안이든 `&lt;` 뒤든
마찬가지다. `x@…`·`(@…`·`"@…`는 펼치지 않고, `＠`(U+FF20)·`&#64;`도 펼치지 않는다. 그래서 두 겹이다: 지시문은
`shared/mentions.ts`의 `rewriteMentions`가 해석된 멘션의 `@`만 떼고 나머지 멘션의 `@`를 `＠`로 바꾸고, 맥락
본문은 `assemble.ts`의 `esc`가 모든 `@`를 `&#64;`로 바꾼다. **멘션의 경계(`(^|\s)@`)를 좁히면 중화에 구멍이
난다** — 그 경계가 claude가 펼치는 조건 그대로다. `ONE_DESK_REAL_CLI=1 pnpm test realCli`의 `core/files/realCli.test.ts`가
진짜 claude로 이것을 본다(중화를 끄면 repo 안팎의 비밀 문장을 둘 다 답한다 — 실측). opencode `run`은 `@`를 펼치지 않는다.

**`@` 피커와 보낼 때의 해석은 같은 목록 함수를 쓴다** (`core/files/list.ts`의 `listRepoFiles`). 따로 두면 피커에
없는 `.env`가 손으로 치면 실린다. 해석은 캐시가 아니라 **새 목록**이다(피커를 연 뒤 만든 파일도 잡는다). 파일
읽기는 `core/files/read.ts` 하나이고, repo 밖 판정은 **양쪽 realpath**다 — 정규화한 문자열만 보면 루트 안의
junction/심링크가 밖을 가리키는 것을 못 막는다. `..` 검사 테스트는 **없는 이름**으로 해야 한다 — 임시 폴더에 우연히
있는 이름이면 realpath 검사가 대신 막아 `..` 검사를 지워도 초록이었다(실측). `file` 맥락이 요청(`ContextItemRef`)으로
오면 core가 거부한다 — "다시 보내기"가 `file` 항목을 걸러 보내는 이유다. git이 아닌 repo에서는 `@`가 아무것도
싣지 않는다(폴백으로 디렉토리를 훑지 않는다 — `.gitignore`를 못 따른다).

**에이전트의 Bash 도구로 소스를 쓸 때 역슬래시 두 개가 하나로 접힌다** — heredoc·python 인라인으로 쓴 TS에서
`'C:\\Windows'`가 `'C:\Windows'`가 되어 `\W`가 이스케이프로 먹혔다(input-triggers 구현 중 실측). 역슬래시가 든
소스는 Write/Edit 도구로 쓴다.

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

**asset 본문은 신뢰할 수 없는 입력이다.** 외부 repo의 SKILL.md를 그대로 화면에 그리고 프롬프트에 싣는다. 조립기는 반드시 이스케이프하고, 화면은 평문으로 그린다. 마크다운은 agent 답에만 붙었다(`renderer/components/Markdown.tsx`, 아래 마크다운 항목) — asset 본문에 붙일 때는 그 컴포넌트를 쓰고 규칙을 우회하지 말 것. 렌더링에 구멍이 있으면 그 스크립트가 preload의 앱 API로 `runs.start({ permission: 'full' })`을 부를 수 있다.

**OpenCode는 설정을 병합하고, 우리가 이길 수 없는 자리가 있다.** 우선순위는 `OPENCODE_PERMISSION` 환경변수 > 프로젝트 `opencode.json` > `OPENCODE_CONFIG`가 가리키는 파일 > 전역 설정이고, `permission` 안에서 키 단위로 합쳐진다. **`"*"`는 구체 키를 이기지 못한다** — 소스 우선순위와 무관하게 구체적인 키가 와일드카드를 이긴다. 그래서 권한은 파일이 아니라 환경변수로 넘기고 알려진 키 15개를 전부 명시한다. 이름을 대지 않은 키는 남의 설정 값이 그대로 산다.

**OpenCode는 설정이 잘못돼도 조용히 무시한다.** `OPENCODE_CONFIG`가 없는 파일을 가리켜도, 거기에 인라인 JSON을 넣어도(경로만 받는다), `OPENCODE_PERMISSION`이 깨진 JSON이어도 **종료 코드 0으로 사용자 설정에 그대로 되돌아간다.** 셋 다 결과가 같다 — 사용자 설정의 `ask`가 살아남는다. **1.18.x의 `run`은 그 `ask`를 자동 거부하고 조용히 exit 0으로 끝난다**(남는 것은 도구 실패뿐이다 — 소스 `run.ts` v1.18.30:801-822, 1.18.27과 바이트 동일). 예전에 여기 적혀 있던 "헤드리스 실행이 영원히 멈추고 슬롯을 점유한다"는 틀린 서술이었다(2026-09-27 정정, `docs/sdlc/conversation-fixes/` FR-14). 멈추지 않는 대신 **agent가 그 도구를 못 쓴 run이 성공으로 기록되고** 사용자는 이유를 알 길이 없다. `opencodeAdapter.verifyRunnable`이 실행 직전에 해결된 설정을 다시 읽어 `ask`가 남았는지 보는 이유이고, 그것을 실행 전의 명시적 실패로 바꾸므로 그 검사는 여전히 선택이 아니다.

**OpenCode 2.x CLI는 preflight가 막는다 — 권한 정책이 조용히 무시될 수 있다** (`docs/sdlc/conversation-fixes/` FR-17). 데스크톱 번들의 `opencode-cli.exe` 2.0.18을 경로로 주면 `--variant`가 없고 바이너리에 `OPENCODE_PERMISSION` 문자열조차 없다 — **읽기 전용 run이 파일을 고칠 수 있다.** 그래서 preflight가 `--version` 첫 줄의 major를 보고 2 이상이면 거부한다(명시 경로와 PATH 탐색이 합류한 뒤, `.cmd` 거부 다음 — 한쪽 갈래에만 두면 다른 쪽으로 샌다). 버전을 못 읽으면 막지 않는다(게이트 전의 동작). 판정은 (경로, 크기, mtime)으로 **프로미스째** 캐시해 동시에 들어온 조회도 프로세스를 한 번만 띄운다. **못 읽은 판정(실패·시간 초과)은 캐시에서 뺀다** — 통과(fail-open)가 굳으면 Windows 백신이 새 바이너리의 첫 실행을 붙잡은 한 번의 시간 초과가 앱이 사는 동안 2.x 차단을 꺼 둔다. 되살리면 `opencode.version.test.ts`의 "못 읽은 판정은 캐시하지 않는다"가 빨개진다. **`--version`을 띄울 때도 stdin을 닫고 `agentCommand`를 거친다** — 닫지 않으면 stdin을 기다리는 CLI가 5초 타임아웃까지 매달리고, 런처 없이는 가짜 CLI(`.mjs`)가 Windows에서 뜨지 않는다. e2e에서는 두 agent가 모두 가짜 CLI에 물려 있어 설정 화면이 열리면 `node fake-claude.mjs --version`이 한 번 돈다 — 기본 시나리오를 찍으므로(버전이 아니다) 통과하고, `ONE_DESK_FAKE_DELAY_MS`만큼 첫 `checkAgents`가 늦어지며, `ONE_DESK_*_CAPTURE`를 세운 테스트라면 그 파일을 덮는다. **가짜 CLI가 `--version`에 버전 문자열을 찍게 "고치지" 말 것** — 2.x 모양이면 게이트가 e2e의 opencode 실행을 전부 막는다. 2.0.18의 `--version` 출력 형식은 실측하지 않았다 — 파서가 받는 것은 첫 줄의 `[opencode ]v?X.Y.Z`뿐이라 형식이 다르면 "못 읽음 → 통과"로 게이트가 무력해진다.

**OpenCode의 `tool_use`는 이미 끝난 도구를 보고한다.** `part.state.status`가 `completed`이고 출력까지 함께 온다(그래서 한 줄이 `tool_use`와 `tool_result` 두 이벤트가 된다). 그 대가로 **전체 설계 §553의 "쓰기 도구 호출을 감지하면 원본을 복사한다"가 OpenCode에서는 성립하지 않는다** — 복사할 시점에 원본이 이미 없다. diff 뷰어 설계에서 정면으로 다뤄야 한다. edit의 줄 번호 hunk는 이제 `metadata.filediff.patch`로 받지만 파일 원본 전체는 여전히 없다(아래 `filediff` 항목).

**OpenCode에는 claude의 `result` 같은 종료 이벤트가 없다.** 스트림이 그냥 끝난다. 그래서 어댑터가 `text` 줄마다 `result`를 함께 내고 `RunManager`가 덮어써 마지막 것이 남는다. `text`에서 `result`를 빼면 `resultText`가 영영 null이 되는데, run은 종료 코드 0이라 **성공으로 끝나고 결과만 비어 보인다.** 그 합성 result는 `status: 'succeeded'`를 싣지만 성패를 정하지 못한다 — 종료 코드가 이긴다(위 `judgeStatus` 항목). 오류는 json 모드에서 stderr가 아니라 stdout의 `{"type":"error"}` 줄로 오고, 어댑터가 그것을 error 이벤트로 낸다(메시지는 `error.data.message` → `error.message` → `error.name` → JSON 순). 1.18.30의 `run`은 error 줄을 낸 run을 `--attach`가 아니면 항상 exit 1로 끝낸다(바이너리 확인).

**같은 대화의 두 턴은 동시에 뜨면 안 된다** — `claude --resume`은 이전 프로세스가 끝나야 한다. `RunQueue`의 `groupKey`가 막고 있다.

**`root_run_id`를 NOT NULL로 "고치지" 말 것** — SQLite에서 그러려면 테이블을 다시 만들어야 하고, 그 `DROP TABLE run`이 `run_context_item`의 cascade를 태워 모든 맥락 기록을 지운다. 마이그레이션의 `PRAGMA foreign_keys=OFF`는 트랜잭션 안이라 무시된다.

**e2e에서 `getByRole('button', { name: '실행' })`은 exact 없이 쓰면 강제로 실패한다.** substring 매칭이 기본이라 슬롯 표시기(`aria-label="실행 슬롯"`)까지 같이 걸려 strict mode 위반이 된다 — 전송 버튼(`.run-start`, 이름 `실행`)을 잡으려면 `{ name: '실행', exact: true }`가 필수다(태스크 8이 라벨을 "▶ 실행"에서 "실행"으로 줄이면서 처음 생긴 충돌). **대화가 도는 동안에는 셋이 더 걸린다** — 상태 줄의 `실행 중인 턴 멈추기`(`Transcript.tsx`의 `STOP_RUNNING_TURN`), 대화 헤더의 `이 대화의 실행 멈추기`(입력칸에 초안이 있을 때만 선다), 그리고 **목록 줄 버튼 자체**다(상태 점의 이름 `실행 중`이 줄 버튼의 이름에 들어간다). 예전에는 도크 토글("▾ 실행")도 걸렸다 — 토글이 글자 "실행"을 버린 이유다(아래 "새 이름" 항목).

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

**대화의 첫 턴을 시작한 직후 도크 목록 줄 텍스트로 "떴다"고 판단하지 말 것.** Dock의 `view`/`pickedId` 전환(RunPanel의 `onStarted` 콜백, 동기)과 `runs` 목록 갱신(`useRuns`의 `onRunUpdate` IPC push, 비동기)이 서로 다른 경로로 온다. 목록 줄은 `runs`가 갱신되는 즉시 그려지지만, 그 순간 `ConversationPanel`은 아직 `key='new:<workspaceId>'`인 옛 인스턴스일 수 있다 — 줄 텍스트가 보인다고 바로 다음 입력을 채우면 곧 재마운트될 RunPanel에 채워 넣어 버려 전송이 빈 프롬프트로 막힌다(실행 버튼이 계속 disabled). 대화록 안의 `.turn-user` 텍스트로 기다려야 재마운트가 끝난 안정된 인스턴스를 보장한다(`e2e/conversation.e2e.ts`).

**대화록의 규칙은 순수 함수 `projectTurn` 하나에 있다 — 컴포넌트에 두지 말 것** (`renderer/timeline.ts`, `docs/sdlc/conversation-timeline/` spec FR-1~FR-11). 이벤트에서 블록(text·activity·edit·tool-error·error·notice, `conversation-events`가 더한 reasoning·subagent)·답 칸·활동 요약·지금 도는 도구가 전부 여기서 나오고 `Transcript`·`TimelineBlocks`는 그리기만 한다 — 렌더링 없이 경계값을 고정하려는 것이다(`timeline.test.ts`). 조용히 깨지는 셋: **끝난 턴의 답은 `resultText`뿐이다** — 스토어에 텍스트가 있어도 쓰지 않는다. 앱을 다시 켜면 스토어가 비므로 스토어에 기대면 같은 턴이 재시작 전후로 달라 보인다("끝났는데 resultText가 없으면 스토어에 text가 있어도 답이 없다"). **마지막 text 블록이 답과 같으면 뺀다** — claude는 마지막 텍스트를 흘린 뒤 result에 같은 글을 다시 담는다("마지막 text가 답과 같으면 블록에서 빠진다"). **tool_use와 tool_result는 두 번 훑어 id로 짝짓는다** — 실패 여부를 use 자리에서 알아야 실패한 도구를 묶음 밖에 세운다(한 번 훑기로 바꾸면 "실패한 도구는 묶음을 끊고 제자리에 따로 선다"를 포함해 여섯이 빨개졌다). `result` 이벤트는 그리지 않는다 — opencode가 text마다 합성하므로 같은 글이 두 번 나온다. 셸 출력은 `tool_result.output`(원문의 끝부분, `conversation-events`)이 있으면 그것이고, 없으면(옛 로그) 200자 요약이라 `…`로 끝날 때만 "출력 앞부분만 기록됩니다"를 붙인다(`isSummaryCut` — 원문이 `…`로 끝나는 것은 잘린 표시가 아니다). 검색 개수는 `detail`(search)의 `count`·`unit`이고, 없으면 claude Grep의 `Found N ` 한 형식에서만 읽는다(파일 수라 `(파일 N개)`) — 요약에서 줄을 세면 잘린 수라 거짓이다.

**접힌 턴은 로그 파일을 읽지 않는다 — 펼친 턴만 읽는다** (spec FR-14). `Turn`의 몸통이 둘로 갈린다: 접힌 몸통은 스토어 스냅샷(`useRunEventSnapshot`)만 보고, 펼친 몸통만 `useRunEvents`로 스토어가 비었을 때 `readLog`한다. 접힌 턴까지 `useRunEvents`를 걸면 대화를 열 때마다 모든 턴의 로그 파일을 읽는다(설계 §4-1). 대가로 **앱을 다시 켠 뒤의 끝난 턴은 한 번 펼치기 전까지 활동 요약이 없다**(spec §6 우려 4). 되살리면 `Transcript.test`의 "접힌 턴은 스토어만 보고 로그 파일을 읽는 훅을 걸지 않는다 — 펼친 턴만 건다"가 빨개진다. **블록의 펼침 state는 몸통이 아니라 `Turn`이 쥔다** — 몸통은 접고 펼 때마다 갈아끼워지므로 거기 두면 열어 둔 묶음이 전부 닫힌다("턴을 접었다 다시 펼쳐도 열어 둔 묶음은 그대로다"). 그리고 **열림은 블록 key가 아니라 도구 id에 매단다**(`group:<id>`·`file:<id>`·`tool:<id>`, FR-15 다듬음) — 블록 key(첫 이벤트의 seq)는 claude가 한꺼번에 낸 도구의 첫 결과가 뒤늦게 실패로 와 묶음 밖으로 빠지면 바뀐다. 블록 key로 되돌리면 "병렬 도구의 첫 항목이 실패로 빠져도 열어 둔 묶음은 닫히지 않는다"가 빨개진다. 위 대화 절의 "턴을 여는 effect가 없다"는 이 층까지 넓어졌다 — 묶음·도구 한 줄·편집 파일도 상태 전이나 새 이벤트로 열리거나 닫히지 않는다.

**원본 줄 로그(`raw.jsonl`)는 재파싱 재료다 — 읽는 코드가 없고, "모든 줄"에는 예외가 한 자리 있다** (`core/runner/logWriter.ts`, `docs/sdlc/conversation-events/` spec FR-1~6·§7-A). manager가 줄 분할기가 넘긴 stdout 줄을 **파싱하기 전에** 받은 그대로 쓴다 — JSON이 아닌 줄도, 어댑터가 버리는 줄도. 그것이 이 파일의 존재 이유라, 기록을 `parseLine` 뒤로 옮기면 `manager.test`의 "stdout 줄을 파싱하기 전에 받은 그대로 순서대로 쓴다 — 깨진 줄과 어댑터가 버리는 줄도"가 빨개진다. 분할기가 `\r`을 걷으므로 CLI가 CRLF로 써도 파일은 LF다. **예외는 `RAW_LOG_EXCLUDED_TYPES` 한 상수**(`rate_limit_event` — 구독 상태·리셋 시각, run-info spec §7이 "원본 줄이 남지 않는다"고 약속한 개인 계정 정보)다. 목록을 다른 곳에 옮겨 적지 말 것. 판정은 줄의 `type`이다 — 글자로만 거르면 그 이름을 말한 assistant 줄까지 빠진다. **상한은 run당 32 MiB**(`RAW_LOG_MAX_BYTES`, UTF-8 바이트·개행 포함): 넘는 순간 그 줄 대신 `type` 없는 표식 한 줄 `{"oneDesk":"raw-truncated",…}`을 쓰고 이후는 전부 버린다 — 마지막 `result`까지 버려진다(spec §9의 4). stderr·`preEvents`는 쓰지 않고, `readLog`는 `stream.jsonl`만 읽는다. 두 writer는 서로 독립이고(한쪽이 못 열려도 다른 쪽은 쓴다) 원본 writer의 `onError`에는 기본값이 없다 — 넘기는 한 줄을 지우면 컴파일이 깨져야 한다. **이 파일에는 개인 정보가 남는다** — Read가 연 파일 원문, 생각 서명, opencode reasoning의 암호문. 지우는 코드가 없다(spec §9의 3).

**필드마다 상한은 `core/runner/adapters/common.ts` 한 자리다 — 어댑터 밖에서 다시 자르지 말 것** (spec FR-10~12). `output`은 **끝부분** 65,536자(버린 앞 글자 수 `outputTruncated` — 자른 자리가 줄 가운데면 다음 줄바꿈까지 더 버리고 그 글자도 센다), 생각 `text`는 앞부분 65,536자(`truncated`), 편집 hunk는 결과 하나의 모든 파일을 합쳐 131,072자(파일마다 `hunksTruncated`, `+N −M`은 **자르기 전에** 센다), `before`는 131,072자를 넘으면 **싣지 않는다**(`beforeMissing: 'too_large'` — 잘린 원본은 원본이 아니다). 글자 수는 `string.length`이고 서로게이트 쌍을 가르지 않는다. **자르면 반드시 잘림 표식을 싣는다** — 화면은 그것으로 "앞부분 N자는 기록하지 않았습니다"·"뒷부분 N자는 …"·"… N줄 더"를 말한다. 표식 없이 자르면 잘린 출력이 전부처럼 보인다. manager·로그·IPC·렌더러는 이미 잘린 값만 본다 — 두 자리가 다른 수로 자르면 로그와 화면이 조용히 갈린다. 상한은 `string.length`로 재고 창의 무게는 JSON 길이라 따옴표·제어 문자가 많은 값은 그보다 무겁다(spec §9의 2).

**새 이벤트 필드는 값이 있을 때만 싣는다 — null로 채우지 말 것** (spec FR-7). 메인 스레드의 `parent_tool_use_id`는 null로 오는데 그대로 옮기면 모든 이벤트에 `"parentToolUseId":null`이 붙어 로그만 늘고 옛 로그와 모양이 갈린다(`claudeCode.parse.test`의 "메인 스레드의 이벤트에는 parentToolUseId 키 자체가 없다"). 읽는 쪽은 키가 없으면 "모른다"로 읽는다 — 그래서 **옛 로그(필드 없는 줄)가 같은 길로 그려진다**: 투영은 새 필드가 없으면 `conversation-timeline` 규칙 그대로다. 예외는 새 모양 둘(`reasoning`의 `startedAt`·`endedAt`, `ToolDetail`·`EditFileDetail`의 필드)로, null을 명시한다.

**`parentToolUseId`가 하위 에이전트의 자식을 카드 안으로 보내는 유일한 끈이다 — claude만 있다** (spec FR-16·38·39). 투영이 그 id의 호출(Agent/Task) 카드 안에 자식을 넣고(재귀 — 중첩은 카드 안의 카드, 조상을 따라가다 같은 id를 다시 만나면 멈춘다), 부모 호출이 창 밖으로 잘렸으면 자식을 버리지 않고 메인에 그린다. **접힌 턴의 "도구 N회"는 메인만 센다**(카드는 하나) — 예전에는 자식이 메인으로 섞여 수가 부풀었다. 기본 스트림에는 자식의 도구 호출만 흐른다 — 자식의 말·생각은 `--forward-subagent-text`가 있어야 오고 붙이지 않았다(spec §7-A). opencode `run`은 하위 세션의 part를 아예 내보내지 않아 부모 task 한 줄뿐이고, 카드가 `OpenCode는 하위 에이전트의 활동을 보내지 않습니다`를 말한다. 하위 에이전트는 전체 허용에서만 뜬다(`--tools` 화이트리스트에 `Agent`/`Task`가 없다). claude의 메시지 `uuid`와 opencode의 `part.messageID`는 `messageId`로 저장만 한다(되돌리기·분기의 재료, 둘 다 — §7-A).

**claude의 `tool_use_result`에는 도구 이름이 없고, 실패하면 문자열이다 — detail은 모양으로 가른다** (`core/runner/adapters/claudeCode.detail.ts`, spec FR-14). `user` 줄에는 `tool_use_id`뿐이고 `parseLine`은 앞 줄을 기억하지 않는다. 그래서 `structuredPatch` + `type`이면 Write, `structuredPatch` + `oldString`이면 Edit, `stdout`/`stderr` + `interrupted`면 셸, `filenames` + `numFiles`면 Grep·Glob … 식으로 **모양**으로 가르고, 타입이 하나라도 어긋나면 detail을 통째로 버린다(반쯤 맞는 detail은 거짓말이다). **실패한 도구의 `tool_use_result`는 객체가 아니라 `"Error: Exit code 2\n…"` 같은 문자열이다**(기록 67건 전부) — 객체라고 가정하면 실패한 도구의 detail이 조용히 사라진다. 결과 블록이 둘 이상인 `user` 줄에는 어느 블록의 것인지 몰라 `tool_use_result`를 붙이지 않고, 읽기인지 가를 수 없으므로 **원문 `output`도 싣지 않는다**(§7-A — 파일 내용이 로그·IPC로 새느니 요약만). 개수·줄 번호·도구 수는 음이 아닌 정수여야 싣는다 — `shared/events.ts`의 `isCount`가 어댑터와 렌더러의 같은 판정이다. 어댑터만 느슨하면 로그·IPC에는 실린 detail을 렌더러의 `readDetail`이 버려 화면에서만 말없이 사라진다.

**claude 셸의 종료 코드는 `content`에서만 읽는다** (spec FR-14 다듬음). Bash·PowerShell의 `tool_use_result`에는 종료 코드 필드가 없다 — 성공하면 코드를 알 길이 없어 `exitCode: null`이고 화면은 성공한 셸에 코드를 적지 않는다. 실패하면 `content`의 첫 줄이 `Exit code N`이다. **둘째 줄이 `[Request interrupted by user for tool use]`일 때만 중단이다** — 출력 속의 같은 글자는 중단이 아니다. **`timedOutAfterMs`는 시간 초과가 아니다** — "시간이 다 돼 백그라운드로 넘겼다"이고 명령은 계속 돈다(2.1.280 스키마, 늘 `backgroundTaskId`와 함께 온다). 그래서 claude의 `timedOut`은 늘 거짓이다. opencode bash는 `metadata.exit`를 준다.

**opencode 1.18.30의 `filediff`에는 `before`가 없다 — 줄 번호 hunk만 풀렸다** (`core/runner/adapters/opencode.detail.ts`, spec §2-3·FR-24). edit의 `metadata.filediff`는 `{file, patch, additions, deletions}`이고 `patch`는 unified diff다 — `parseUnifiedDiff`가 `PatchHunk`로 편다(hunk 끝은 머리의 줄 수로 찾는다 — `---`로 시작하는 본문 줄을 머리로 버리지 않게). 파일 원본은 여전히 없으므로 opencode 편집의 `before`는 늘 null(`beforeMissing: 'unavailable'`)이고 OpenCode 어댑터 설계 §10-1의 스냅샷 문제는 절반만 풀렸다(그 절의 각주). 게다가 그 `patch`는 `trimDiff`가 공통 들여쓰기를 걷은 것이라 줄 번호는 맞지만 본문이 파일과 다르다(spec §9의 5). **apply_patch의 파일별 diff는 `diff`가 아니라 `patch` 키다** — `diff`만 읽던 동안 실제 run의 apply_patch는 늘 `hunks: []`였다. write는 `exists`뿐이다(이전 내용 없음). opencode의 `read` 원문도 싣지 않는다(실패한 read의 오류 글은 싣는다 — 파일 내용이 아니다).

**생각은 텍스트만 저장한다 — 서명은 정규화 로그에 싣지 않는다** (spec E3·FR-15·FR-22·§7-A). 옛 "thinking 블록은 버린다(서명이 3~5KB)"는 `claudeCode.ts`의 주석과 2단계 계획에 있던 결정이고 이것이 대신한다. claude `thinking`의 `signature`와 opencode reasoning의 `part.metadata`(provider 서명·암호문)는 `stream.jsonl`·IPC 어디에도 없다 — `raw.jsonl`에만 남는다. **claude의 생각은 대부분 본문 없이 온다**(기록 1,851개 중 1,800개가 서명뿐) — 생각 블록이 비어 보이는 것은 결함이 아닐 수 있다. **본문이 빈(공백뿐인) claude thinking은 이벤트를 만들지 않는다**(spec §9-1 결정, 2026-09-27 — §7-A의 "빈 본문도 낸다"를 되돌렸다). 빈 생각을 줄로 내면 도구 호출마다 끼어 펼친 턴의 활동 묶음이 조각나고(reasoning은 묶음을 끊는다) 2,000개 창을 먹는다 — `claudeCode.parse.test.ts`의 "본문이 빈 thinking은 이벤트를 내지 않는다"가 고정한다. 본문이 있는 생각은 `생각 · 약 N초` 한 줄이고, claude는 시간을 주지 않아 같은 스코프의 바로 앞 이벤트 시각부터 잰다(그래서 "약", 스코프 첫 이벤트면 턴 시작이나 그 하위 에이전트 호출부터). **opencode의 공백뿐인 reasoning은 이벤트가 없다**(FR-22 — OpenAI 계열은 본문 없는 암호문이 흔해 내면 턴마다 빈 줄이 여럿 선다). 두 CLI가 다른 것은 의도다. **opencode reasoning은 `--thinking` 없이는 오지 않는다**(run 루프가 그 플래그일 때만 낸다). `redacted_thinking`은 버린다. 생각 본문은 마크다운으로 해석하지 않는다(평문 — `Transcript.test`의 "접힌 한 줄 \"생각 · 약 N초\"이고, 펼치면 본문을 마크다운이 아니라 글자 그대로 보인다").

**`readLog`와 렌더러 스토어는 `RUN_EVENT_WINDOW` 한 값을 같이 본다** (`shared/events.ts`, spec FR-29·31·33). 끝에서부터 2,000개 **그리고** 800만 자이고, 무게는 `eventWeight` = 로그 한 줄의 길이(`JSON.stringify(event).length`)다. 따로 적으면 되살린 턴과 실시간 턴의 모양이 갈린다. 개수만 세던 때와 달리 이벤트 하나가 수십만 자일 수 있다. **`readLog`는 파일 전체를 읽지 않는다** — `core/db/repositories/logTail.ts`가 끝에서부터 64KiB 덩어리로 거꾸로 읽어 창이 차면 멈추고, 줄은 바이트 `\n`으로 가른다(덩어리 경계가 여러 바이트 글자에 걸려도 온전하다). 깨진 줄은 건너뛰고 창에도 세지 않으며, 혼자서 창보다 무거운 이벤트는 **양쪽 다** 남기지 않는다(한쪽만 "하나는 남긴다"면 둘이 갈린다). 스토어는 창 밖으로 버린 seq도 기억한다 — 늦게 온 옛 이벤트가 되살아나지 않게. 창 때문에 앞이 잘린 턴은 `앞의 기록 N개는 생략했습니다`(N = 첫 이벤트의 seq)를 보인다 — 그래서 **테스트 데이터의 run 첫 seq는 0이어야 한다**(0보다 크면 그 안내가 선다 — `Transcript.test`의 `LOG_LINE`과 배치를 정확히 보는 기존 테스트 넷의 첫 seq가 이것으로 1에서 0으로 바뀌었다). "`eventWeight`가 logWriter가 쓴 줄 길이와 같다"는 `shared/events.test.ts`가 아니라 `run.test.ts`가 고정한다 — `shared/`는 renderer 타입 검사(`tsconfig.web.json`)에도 걸려 node 모듈을 import할 수 없다.

**권한 거부 공지는 로그에 두 번 올 수 있다 — 화면이 `toolUseId`로 한 번만 그린다** (spec FR-19·41·NFR-3). claude는 `system/permission_denied`(best-effort)와 `result.permission_denials`(권위 있는 기록) 둘로 알리고 `parseLine`은 한 줄만 보므로 둘 다 공지가 된다. manager에서 거르면 manager가 이벤트 내용을 판단하는 첫 자리가 된다 — 거르지 않았다. 공지는 거부된 도구의 실패 줄 바로 뒤, 같은 스코프에 선다(`timeline.test`의 "권한 거부는 그 도구의 실패 줄 바로 뒤에 한 번만 선다 — system과 result가 둘 다 알려도", e2e는 `권한 때문에 막힘: Bash`가 정확히 하나인지 본다). opencode는 오류 문구(영어 문장 — `OPENCODE_DENIED_BY_ASK`·`_BY_RULE`)로 판정하므로 CLI가 문구를 바꾸면 공지만 조용히 빠진다(도구 실패 줄은 남는다).

**agent의 답은 마크다운이지만 HTML은 아니다 — 네 가지를 되살리지 말 것** (`renderer/components/Markdown.tsx`, spec FR-20~FR-26). agent 출력은 신뢰할 수 없는 입력이다 — 렌더링에 구멍이 있으면 그 스크립트가 preload의 앱 API로 `runs.start({ permission: 'full' })`을 부른다. (1) 원시 HTML을 요소로 되살리는 rehype의 raw 플러그인도, React의 innerHTML 주입 prop도 쓰지 않는다 — HTML은 글자로 보인다(`skipHtml`도 켜지 않는다: HTML 조각을 설명하는 답에서 조각이 사라지면 답이 거짓말이 된다). (2) 링크는 `shared/links.ts`의 `externalLinkOf`를 통과한 http(s)만 `<a target="_blank">`이고 나머지(`javascript:`·`file:`·상대 경로·`#조각`·`mailto:`·사용자 정보가 붙은 `github.com@evil.com`)는 글자다 — react-markdown의 기본 `urlTransform`은 끄고 `a`·`img` 컴포넌트에서 거른다. 통과한 링크의 `title`은 agent가 적은 제목이 아니라 실제 목적지다. (3) 이미지는 그리지 않는다(`[이미지: alt]` 글자). (4) 마크다운을 쓰는 곳은 답 칸과 펼친 턴의 text 블록 둘뿐이다 — 사용자 버블·도구 입력/출력·오류 카드는 평문이다. `Markdown.test`의 "적대적인 문서 전체에서 로드·실행·앱 안 탐색이 가능한 속성이 하나도 없다"가 DOM 전체를 훑어 고정한다(raw 플러그인을 끼우면 넷, `a`의 검사를 빼면 열셋이 빨개졌다). **완료 증명의 grep은 주석에도 걸린다** — `renderer/`의 주석에 그 두 이름이나 `window.oneDesk`를 그대로 적으면 `grep -rn "dangerouslySetInnerHTML\|rehype-raw" renderer/`와 위 경계 grep이 출력을 낸다(실제로 걸렸다 — `Markdown.tsx`의 설명이 이름을 풀어 쓰는 이유다).

**main도 막는다 — 렌더러 한 겹에 기대지 않는다** (`electron/main.ts`, spec FR-24). 앱 창이 원격 문서로 넘어가면 preload가 그 문서에도 붙는다. 새 창 요청(`setWindowOpenHandler`)은 `externalLinkOf`를 통과한 것만 `shell.openExternal`하고 창은 어느 쪽이든 만들지 않는다. 창 안 탐색(`will-navigate`)은 `isAppNavigation(target, appUrl)`이 통과시킨 것만이다 — 개발 서버면 같은 origin(Vite의 전체 새로고침), `file:`이면 **같은 문서**. `file:`의 origin은 전부 불투명한 `"null"`이라 origin을 비교하면 디스크의 아무 파일로나 넘어간다(`links.test`의 "file: 앱에서 다른 file: 문서는 막는다"). **다운로드도 막는다**(`session.defaultSession`의 `will-download`) — Chromium은 Windows·Linux에서 Alt+클릭한 링크를 새 창도 탐색도 아닌 다운로드로 처리해 위 두 가드를 비켜 간다(`nav-guard.e2e`의 "Alt+클릭한 링크는 내려받지 않는다"). 판정을 `shared/links.ts`에 두는 이유는 `core/app/reveal.ts`와 같다 — main에는 단위 테스트가 없고, 렌더러와 main이 같은 함수를 써야 한다. 실제 창 동작은 `e2e/nav-guard.e2e.ts`가 렌더러의 거름을 거치지 않고 `window.open`·`location`을 직접 불러 본다.

**답의 마크다운은 파싱 전에 예산을 잰다 — 파서가 던지면 앱 창 전체가 빈다** (`renderer/markdownBudget.ts`, spec FR-20 다듬음). `- ` 1,000번(2KB)이나 `>` 3,000번이면 mdast → hast 재귀가 스택을 넘기고, 렌더 중에 던진 오류를 받을 경계가 없으면 React 19가 루트를 통째로 내린다 — 답은 DB에 남으므로 그 대화를 열 때마다 빈 화면이다. 시간도 흔한 모양에서 제곱으로 는다(여는 기호 없는 `a_ ` × 33,000 = 15초). 그래서 `fitsMarkdownBudget`이 선형으로 재 넘으면 평문(`.md-plain`)이고, 그것을 빠져나간 오류는 `Markdown`의 오류 경계가 그 답만 평문으로 떨어뜨린다. **예산은 코드 울타리를 쫓지 않는다** — 울타리 판정이 파서와 한 번이라도 어긋나면(HTML 블록 안의 ```, 목록 항목과 같이 닫히는 울타리) 그 뒤를 세지 않아 판정 전체가 뚫린다. 대가로 빈 줄 없이 수백 줄 이어지는 코드와 서식 있는 수백 행의 표는 평문으로 떨어진다(spec §8의 6). `markdownBudget.test`·`Markdown.test`의 "무너뜨리는 입력"·`Markdown.boundary.test`가 고정한다.

**입력칸의 ↑↓는 이 대화의 지시를 불러온다 — 입력칸이 비었을 때만이다** (`renderer/promptHistory.ts`, `docs/sdlc/prompt-history/`). 규칙은 순수 함수 둘(`historyOf`·`stepHistory`)에 있고 `RunPanel`은 적용만 한다. history로 보는 것은 비었거나 **불러온 글을 손대지 않았을 때**뿐이다 — 한 글자라도 고치면 초안이고 그 뒤의 ↑↓는 줄 이동이다(`onChange`가 index를 되돌리는 것이 그 규칙의 절반이다 — 지우면 "불러온 글을 다 지우면…"이 빨개진다). 피커가 열려 있으면 피커가 먼저 갖고, 불러온 글이 `/`로 시작해도 피커를 열지 않는다(`setDismissed(true)` — 열리면 다음 ↑를 피커가 먹는다). 새 대화 칸에는 history가 없다. 넘기기 상태는 저장하지 않는다.

**초안은 `main.tsx`의 스토어가 쥔다 — RunPanel의 `useState`로 되돌리지 말 것** (`renderer/store/drafts.ts`·`DraftContext.tsx`, spec FR-31). Dock은 인박스·설정에 가면 언마운트되고 `ConversationPanel`은 대화를 바꿀 때마다 key로 재마운트된다 — 그 아래 어디에 두든 쓰던 지시가 사라진다(설정 화면 FR-11과 같은 이유). App state에 두면 한 글자마다 App 전체가 다시 그려진다. 키는 대화 id, 새 대화면 `new:<workspaceId>`이고 도크의 `ConversationPanel` key도 같은 값이다 — `'new'`로 두면 새 대화 칸이 workspace를 넘어 옛 인스턴스로 남는다(`Dock.test`의 "workspace가 바뀌면 새 대화 칸도 새로 시작한다"). **전송이 성공하면 effect를 기다리지 않고 그 자리에서 비운다** — 새 대화의 첫 턴이면 `onStarted`가 입력부를 갈아끼우는데, 두 갱신이 한 번에 그려지면 방금 보낸 지시가 새 대화 칸에 되살아난다(`RunPanel.test`의 "전송이 성공한 그 순간 입력부가 갈아끼워져도 초안이 비워진다"). `useDraftStore()`는 Provider가 없으면 던진다 — 모듈 전역 기본값을 두면 Provider 한 줄을 빠뜨려도 조용히 돌고 테스트끼리 초안이 샌다. `main.tsx`의 그 한 줄은 단위 테스트가 못 잡으므로(각 테스트가 제 Provider를 세운다) `e2e/composer.e2e.ts`의 인박스 왕복이 맡는다. `useState`로 되돌리면 `RunPanel.test`의 "다시 마운트해도 쓰던 지시가 남는다"와 `App.test`의 "쓰던 지시는 인박스에 다녀와도 남는다"가 빨개진다. 남은 틈 하나: "다시 실행" 뒤 그 지시를 고치다 인박스에 다녀오면 고친 글이 원래 지시로 되돌아간다(App이 `draftPrompt`를 쥐고 있고 RunPanel의 그 effect가 마운트마다 돈다 — spec FR-31 다듬음).

**예약은 "뿌리가 아닌 pending"이다 — 대화록이 아니라 입력칸 위 칩이 그린다** (`Transcript.tsx`의 `isReservation`·`reservationOf`, spec FR-30). 대화록의 거름과 입력부의 칩이 같은 함수를 쓴다 — 따로 적으면 예약이 두 곳에 그려지거나 어디에도 없다. **뿌리 pending은 예약이 아니다** — 새 대화의 첫 지시가 슬롯을 기다리는 것까지 빼면 대화록이 비어 무엇이 걸려 있는지 보이지 않는다. 그 턴은 대화록에 **같은 `Turn`**으로 남고 상태 줄만 대기 모양(`대기 중 · 실행 슬롯이 비면 시작합니다 · 대기 취소`)이다 — 따로 그리면 시작하는 순간 다른 컴포넌트로 갈아끼워져 펼쳐 둔 것이 풀린다. 그때 입력부는 칩이 아니라 안내(`role="status"`)다. 칩의 이유는 도는 턴이 있으면 "앞 턴이 끝나면 보냅니다", 없으면 "실행 슬롯이 비면 보냅니다"다. "다시 보내기·답하기"가 붙는 "마지막 턴"도 예약을 빼고 세고, 예약이 있으면 둘 다 잠긴다(대화당 예약은 하나다). 대화록이 예약을 거르지 않으면 `Transcript.test`의 "이어 보낸 지시(뿌리가 아닌 pending)는 대화록에 없다"를 포함해 다섯, 뿌리 pending까지 거르면 셋이 빨개진다.

**멈추는 자리는 셋이고 도크 헤더에는 없다** (spec FR-28·FR-29). 입력부의 `중지`(도는 턴이 있고 입력이 비었을 때 전송 버튼 자리), 대화 헤더의 `멈추기`(이름 `이 대화의 실행 멈추기`), 대화록 상태 줄의 `멈추기`(이름 `실행 중인 턴 멈추기`)다. **입력부 중지와 헤더 멈추기는 번갈아 선다** — 헤더의 것은 입력칸에 초안이 있을 때만이다(spec §8의 3). 판정은 한 함수(`isBlankDraft`)이고 헤더는 초안 스토어를 듣는다(`useDraftFilled` — 스토어의 `subscribe`). 그래서 도는 턴 하나에 한 화면의 멈추기는 늘 둘이다. 셋 다 running일 때의 `conversation.active`만 겨누고 예약은 건드리지 않는다(예약은 이어서 뜬다 — conversation-fixes FR-9). 헤더의 것이 있어야 하는 이유: 입력칸에 초안이 있으면 전송 버튼이 실행(예약)이 되고, 대화록을 위로 올려 두면 상태 줄이 화면 밖이다. 실패는 전부 도크의 `cancel`을 타 도크 배너로 보인다. 도크 헤더에 되살리지 말 것 — `Dock.test`의 "도크 헤더에는 취소가 없다 — 토글과 슬롯 표시기뿐이다". **Esc로는 멈추지 않는다** — 이 앱의 Esc는 "안쪽부터 푼다"(아래)이고 멈춤은 되돌릴 수 없다.

**도크의 Esc는 안쪽부터 푼다 — 안쪽의 Esc는 `preventDefault`와 `stopPropagation`을 같이 한다** (spec FR-39). 순서는 피커 · 이름 편집 · 헤더 메뉴 · 사용량 팝오버 · 슬롯 상한 편집 → 도크 최대화 → App의 "열린 항목 닫기"다. 도크 `<section>`은 `e.defaultPrevented`가 아닐 때만 최대화를 풀고 자기도 둘을 한다. 안쪽 하나가 전파를 막지 않으면 같은 Esc가 최대화까지 푼다 — 슬롯 상한 편집이 실제로 그랬다(`Dock.test`의 "슬롯 상한을 고치다 누른 Esc는 편집만 닫는다"). React의 `stopPropagation`은 document까지 닿지 않으므로 App의 Esc도 같이 돌지 않는다. 메뉴의 `stopPropagation`을 빼면 "안쪽의 Esc가 먼저다 — 메뉴를 닫는 Esc는 최대화를 풀지 않는다"가 빨개진다. 최대화는 세 패널을 **숨긴다**(`.main:has(> .dock-max) > .columns { display: none }`) — 언마운트하지 않으므로 입력 중이던 이슈 본문이 남지만, **최대화한 동안은 패널의 버튼을 Playwright가 못 누른다**(맥락도 못 담는다 — 입력부 안내가 "원래 크기로 돌아가 맥락을 담으세요"로 바뀐다). 최대화한 도크를 접으면 최대화도 풀린다.

**바닥 따라가기의 계기는 내용 버전이다 — 내용의 높이 변화가 아니다** (`renderer/hooks/useFollowBottom.ts`, spec FR-42). 대화록이 바닥에서 24px 안이면 붙어 있고, 붙어 있을 때 **내용 버전**(보이는 턴마다 `id:상태:답 길이:오류 길이`와 활성 턴 이벤트의 `수:마지막 seq`)이 바뀌면 내려간다. 사용자가 턴을 펼치거나 접은 것은 버전이 아니다 — 지난 턴의 `자세히`를 눌렀는데 바닥으로 튀면 방금 누른 것이 사라진다. 그래서 ResizeObserver는 **스크롤러 자신의 상자 높이(`clientHeight`)만** 본다: 도크를 끌거나 예약 칩이 떠 칸이 줄면 scrollTop이 위를 기준으로 남아 바닥이 가려지므로(실측: 하한까지 끌면 72px 떨어졌다) 붙어 있을 때 바닥을 지키되, 칸 높이가 같으면 아무것도 하지 않는다. 내용 높이를 계기로 쓰면 `ConversationPanel.test`의 "펼쳐도 바닥으로 가지 않는다"가 빨개진다. 이벤트 수만 보면 스토어 상한(run당 2,000개·800만 자 — `RUN_EVENT_WINDOW`)에 닿은 뒤 오는 줄을 못 본다("스토어 상한에 닿은 뒤에 오는 줄도 따라간다"). 펼침에는 스크롤 이벤트가 없으므로 대화록 안을 누르면 한 프레임 뒤에 "붙어 있다"를 다시 잰다.

**대화록과 입력부는 같은 방식으로 잰다 — 폭만 맞추지 말 것** (`renderer/index.css`의 `.transcript`·`.conversation-panel .run-panel`, spec §4). 둘 다 좌우 24px 안쪽 여백 + `scrollbar-gutter: stable both-edges` + 가운데 선 최대 `--conversation-width`(1280px) 열이다. 폭만 같게 계산하던 때는 대화록에 스크롤바(Windows 15px)가 서면 턴 열만 밀리고, 예약 칩이 떠 넘치기 시작하는 순간 대화록이 옆으로 튀었다. 입력부는 그 속성이 걸리도록 `overflow: hidden`이다(피커는 최상위 레이어, 드롭다운은 네이티브라 잘릴 것이 없다). `conversation.e2e`가 하한 도크에서 턴 열과 입력 카드의 좌우 끝이 1px 안인지 본다. **모노 글꼴은 `--font-mono` 토큰이다** — generic `monospace`는 한국어 Windows에서 GulimChe라 `.`이 `,`처럼, 경로의 `\`가 `₩`로 보인다(`timeline.e2e`가 CDP로 실제 글꼴을 묻는다). UI 글꼴(`system-ui` = Malgun Gothic) 자리의 `₩`는 아직 그대로다(spec §8의 7).

**상태 이름은 한국어 표이고, e2e는 목록 줄을 문구가 아니라 클래스로 잡는다** (`renderer/runStatus.ts`·`e2e/dock.ts`, spec FR-45·§6 우려 9). 대화록의 상태 알약과 목록 점의 `aria-label`·`title`이 `RUN_STATUS_LABELS`(`대기 중`·`실행 중`·`완료`·`실패`·`취소됨`·`중단됨`)를 쓴다. agent 이름도 `renderer/agents.ts`의 `AGENT_LABELS` 한 표다(권한 이름의 `permission.ts`와 같은 이유 — 실행 패널·설정 화면·`AgentStatusList`·헤더 부제·메타 줄이 같이 쓴다). **클래스는 enum 그대로다**(`.status-<enum>`) — 색과 e2e가 거기 걸려 있다. 예전 e2e 아홉 파일은 줄 버튼의 영어 이름(`/succeeded.*제목/`)으로 잡다가 한꺼번에 깨졌다 — 지금은 `convRow(page, text)`(`.dock-conv` + `hasText`)와 `waitConvStatus(page, text, status)`(그 줄의 `.status-dot.status-<enum>`)를 쓴다. 한국어 정규식으로 옮기지 말 것 — 문구가 바뀔 때마다 또 깨진다. `e2e/dock.ts`는 `RunStatus`를 옮겨 적는다(eslint가 e2e의 `@shared` import를 막는다).

**e2e 셀렉터가 이렇게 바뀌었다** (`docs/sdlc/conversation-timeline/`).

- 가짜 CLI의 텍스트 "작업 중"이 상태 줄의 "작업 중"과 겹친다 — `page.getByText('작업 중')`은 strict 위반이다. 접힌 턴은 `.turn-answer`, 펼친 턴은 `.tl-text`로 좁힌다(core-loop는 흐르는 답을 볼 창을 벌려고 `ONE_DESK_FAKE_DELAY_MS=4000`이다 — 끝나면 최종 답으로 바뀌어 사라진다).
- 예약은 대화록에 없다 — 이어 보낸 턴은 칩(`.composer-queue`)을 먼저 기다리고, 시작된 뒤 대화록의 `.turn-user`를 기다린다. `page.getByText('대기 중')`은 칩의 단독 span(`.composer-queue-label`) 하나에 걸린다(상태 알약의 `대기 중`은 뿌리 pending에서만 대화록에 나온다).
- 새 대화는 `{ name: '새 대화', exact: true }`(옛 `＋ 새 대화`), 도크 토글은 `대화창 숨기기`/`대화창 보이기`, 옛 `.turn-info`는 `.turn-meta`다. 컨텍스트 점유는 턴이 아니라 헤더 링의 이름(`사용량, 컨텍스트 5%`)으로 잡는다. `.run-settings`·`.run-log`·`.log-*`·`.dock-cancel`·`.turn-pending`은 없어졌다. 작업 디렉토리 옵션의 글자는 repo 이름뿐이라 경로는 옵션의 `title`로 본다(settings·triage가 이것으로 한 번 깨졌다).
- 도크를 하한까지 끌 때는 `e2e/dock.ts`의 `dragDockToMin`을 쓴다 — 창 밖까지 끌면 그쪽 pointermove가 전달되지 않거나 합쳐져, 멈추는 높이가 실행마다 280px과 306px 사이에서 흔들렸다.
- `ONE_DESK_FAKE_SCRIPT=timeline`이면 가짜 CLI가 기본 시나리오 대신 도구·편집·mcp와 적대적인 마크다운 답을 낸다(줄 사이 `ONE_DESK_FAKE_STEP_MS`, 기본 300ms). **기본 시나리오를 건드리지 말 것** — 기존 e2e 전부가 거기 기댄다.
- `https` 링크를 누르는 e2e는 `app.electron.evaluate`로 main의 `shell.openExternal`을 기록만 하게 바꿔 세운다 — e2e가 사용자의 브라우저를 열면 안 된다. 코드 복사를 보는 e2e는 사용자의 클립보드를 덮으므로 `finally`에서 되돌린다.

**새 이름이 늘었다 — 부분 일치로 부딪히지 않게 고른 것들이다** (spec NFR-6). `중지`·`실행 중인 턴 멈추기`·`이 대화의 실행 멈추기`·`예약 취소`·`대기 취소`·`다시 보내기`·`답하기`·`응답 복사`·`코드 복사`·`명령 복사`·`대화 메뉴`·`이름 바꾸기`(menuitem)·`대화 끝내기`(menuitem)·`사용량, 컨텍스트 …`·`최신으로 이동`·`대화창 최대화`·`대화창 원래 크기로`·`대화창 숨기기`·`대화창 보이기`·`새 대화`·`작업 디렉토리 경로 복사`. **`작업 디렉토리 경로 복사`는 알약의 이름 `작업 디렉토리`를 부분 문자열로 품는다** — 이어 가는 대화에서 `getByLabel('작업 디렉토리')`는 반드시 `{ exact: true }`로 쓴다. 피한 충돌: **도크 토글에서 글자 "실행"을 버렸다** — 아이콘이 `aria-hidden`이면 토글 이름이 정확히 "실행"이 되어 전송 버튼의 exact와도 부딪힌다. **"접기"/"펼치기"도 쓰지 않는다**(턴의 `접기`). **최대화의 반대는 "축소"가 아니라 "원래 크기로"다**(패널의 `축소`를 e2e가 exact로 잡는다). **대화 제목은 버튼이 아니다** — 접근성 이름이 제목과 같은 버튼이 생기면 이슈 줄(`{ name: <이슈 이름>, exact: true }`)과 부딪힌다(대화 제목이 곧 담은 이슈 이름이다). 키보드 경로는 `⋯` 메뉴다. `자세히`·`응답 복사`는 턴마다 하나라 e2e는 턴으로 좁혀 잡는다. 이름 편집 칸은 목록 줄과 헤더가 같은 이름(`<제목> 새 이름`)이지만 편집 state가 하나(`renaming: { id, where }`)라 한 번에 한 자리뿐이다.

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
테스트가 그 글자를 텍스트로 잡고 있어서 남겨 두었다. 입력부의 빈 맥락 안내문("왼쪽 항목의 ＋를
눌러…")은 없어졌다 — 칩 줄은 담은 것이 있을 때만 선다(conversation-timeline spec §8의 4). 도크의 `▾`·
`＋ 새 대화`·끝낸 대화 토글의 `▸`는 `conversation-timeline`이 아이콘으로 바꿨다.

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
| `docs/sdlc/conversation-timeline/` | OpenCode처럼 읽히는 대화 화면 — intent·spec·plan. 턴 투영이 순수 함수인 이유(spec FR-1), 접힌 턴의 여섯 칸(FR-12)과 로그를 읽지 않는 이유(FR-14), 열림을 도구 id에 매다는 이유(FR-15 다듬음), 마크다운 보안·파싱 예산과 main의 탐색 가드(FR-20~24), 멈추는 자리 셋(FR-29)·예약 칩(FR-30)·초안 스토어(FR-31), 대화 헤더와 컨텍스트 링(FR-33~36), 최대화와 Esc(FR-38·39), 바닥 따라가기(FR-42), 상태 이름 표(FR-45), 치수(§4), 리뷰가 남긴 과제(§8). plan의 완료 증명에 단계별 변이 결과와 번들 크기 |
| `docs/sdlc/conversation-events/` | 대화가 버리던 데이터 — intent·spec·plan. 두 CLI가 이미 보내는 것의 실측 표(spec §2 — 스키마·기록·바이너리, 리뷰의 정정 포함), 이벤트 모델(§3), 원본 줄 로그와 상한(FR-1~6), 필드별 상한(FR-10), claude detail을 모양으로 가르는 표(FR-14)·공지 문구(FR-18), opencode detail(FR-24)·거부 공지(FR-26), 창(FR-29~34), 투영과 화면(FR-35~53), 크기 추정(§5), 우려에 대한 결정(§7-A), 리뷰가 남긴 과제(§9). plan의 완료 증명에 기준선·변이 결과·로그 크기 |
| `docs/sdlc/command-cache-auth/` | 로그인한 뒤에도 슬래시 커맨드 실패가 남던 결함 — spec·plan(backlog §1에서 뗌). 실패 캐시에 인증 상태를 적는 규칙(FR-2~4), slash-commands FR-13 개정 |
| `docs/sdlc/prompt-history/` | 입력칸의 ↑로 이전 지시 불러오기 — intent·spec·plan. 비었을 때만·이 대화만(intent의 결정), 불러온 글을 고치면 초안(FR-2), 피커 억제(FR-6) |
| `docs/sdlc/input-triggers/` | `@` 파일 참조 — intent(OpenCode 트리거·UI 조사)·spec·plan. claude가 `@경로`를 권한 밖에서 펼친다는 실측표(spec §6), 멘션이 곧 맥락인 이유(§7의 6), 중화 두 겹(FR-12·§7의 2), 읽기 거부 규칙(FR-10·FR-13) |
| `docs/backlog.md` | **백로그** — 설계를 바꾸지 않고 할 수 있는데 아직 손대지 않은 작업. 착수하면 `docs/sdlc/<기능>/`로 뗀다 |
| `docs/windows-setup.md` | **Windows 개발 환경 이관 가이드** — 빌드 도구(VS 2022 고정), 앱 데이터 옮기기와 경로 재지정(§4), Windows에서 다르게 도는 것(§5), git이 안 실어 나르는 것(§6) |
| `docs/diagrams/` | 아키텍처 다이어그램 — `one-desk-architecture.html`(단독 실행 가능)과 그것을 만든 archify 사양 `one-desk.architecture.json`. `main`에 들어가면 `.github/workflows/pages.yml`이 GitHub Pages로 올린다 |

**설계 문서의 결정을 코드에서 임의로 바꾸지 않는다.** 설계에 구멍이 보이면 고치지 말고 지적할 것 — 그게 더 값지다.
