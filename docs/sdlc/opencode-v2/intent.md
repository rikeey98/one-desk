# Intent: OpenCode 2.x CLI 지원 — 막아 둔 게이트를 풀 수 있게

- 출처: 대화 (2026-11-19) — "opencode에서는 / 기능이 없어?" → "opencode를 2 버전으로 최신 업데이트 먼저하고 조사해" → "2.x 지원부터"
- 작성자: 권용현 (초안: Claude)
- 상태: **승인됨** (2026-11-19, 사용자 "승인, spec 쓰기" — 1.x도 계속 지원, 전체 허용은 `--auto` 없이 규칙으로) — spec은 `spec.md`
- **정정 (spec 0-1)**: 아래 "프로젝트 설정이 다시 열지 못한다"는 최상위 `permissions`끼리만 맞다. 프로젝트의 `agents.<id>.permissions`와
  `default_agent`는 환경변수의 최상위 규칙을 넘는다(실측). 막는 방법은 spec FR-5·6·8이다.
- 작성일: 2026-11-19
- 관계: `conversation-fixes` FR-17(2.x를 preflight가 막는다)을 뒤집는다. OpenCode 슬래시 커맨드는 이 작업 뒤의 별도 사이클이다(아래 범위 밖).

## 문제

1. **OpenCode를 최신으로 올리면 one-desk에서 OpenCode를 못 쓴다.** winget의 `opencode`는 이제 2.x(`Anomaly.OpenCode` 2.3.2)이고,
   one-desk의 preflight는 major 2 이상을 거부한다. 이 장비가 지금 그 상태다 — PATH의 `opencode`가 2.3.2다.
2. **게이트를 그냥 풀 수는 없다.** 게이트의 이유(권한 정책이 무시될 수 있다)는 사실이었다 — 2.3.2에는 `OPENCODE_PERMISSION`이
   없다. 지금 어댑터로 2.x를 띄우면 읽기 전용 실행이 파일을 고친다(아래 실측: 아무 설정 없이 셸과 쓰기가 그대로 돈다).
3. 인자도 맞지 않는다. 지금 붙이는 `--variant`·`--dangerously-skip-permissions`가 2.x에 없어 시작부터 실패한다.

## 현황 (실측, 2026-11-19 — opencode 2.3.2 · Windows · 모델 `opencode/big-pickle`)

실측 스크립트는 일회용이었다(저장소에 없다). spec 단계에서 `realOpencode` 테스트로 옮긴다.

**깨지는 것**

| 지금 어댑터가 쓰는 것 | 2.3.2 |
|---|---|
| `OPENCODE_PERMISSION` 환경변수 | **없다**(바이너리에 문자열이 없다) |
| 권한 모양 `{ bash: 'deny', … }` | 순서 있는 규칙 목록 `permissions: [{ action, resource, effect }]`, **뒤에 온 규칙이 이긴다** |
| `--variant <값>` | 없다 → `--model provider/model#variant` |
| `--dangerously-skip-permissions` | 없다 → `--auto` |
| `opencode debug config`의 `permission` 키 (`verifyRunnable`) | 출력이 설정 **출처 목록**(배열)이다 — 지금 검사는 아무것도 못 보고 통과한다 |
| MCP 설정 `mcp.<이름>` | `mcp.servers.<이름>` (서버 모양은 재지 않았다) |
| 도구 이름 `bash`, 입력 키 `filePath`, 호출 id `part.callID` | `shell`, `path`, `part.id` |
| `--session <없는 id>` → 오류 | **그 id로 새 세션을 만든다**(도움말에 명시) — 끊긴 대화가 조용히 새로 시작한다 |

**그대로인 것**

- `run --format json`의 줄 종류(`step_start`·`text`·`tool_use`·`step_finish`·`error`)와 `sessionID`, 토큰 수치 모양.
- 프롬프트를 stdin으로 받는다(메시지 인자 없이 `STDIN-OK` 확인).
- `--session`으로 잇는다(앞 턴의 암호를 뒤 턴이 답했다). `--thinking`·`--model`·`--format`은 남아 있다.
- 물어보기(`ask`)는 여전히 자동 거부되고 exit 0이다(stderr에 `permission requested: …; auto-rejecting`).
- 오류는 stdout의 `{"type":"error"}` 줄 + exit 1이다(무료 한도 초과로 확인).

**권한을 강제할 통로가 있다 — 1.x보다 단단하다**

`OPENCODE_CONFIG_CONTENT` 환경변수에 `{"permissions":[{"action":"*","resource":"*","effect":"deny"},{"action":"read","resource":"*","effect":"allow"}]}`를 넣고 "셸 명령을 돌리고 파일을 만들라"고 시켰다.

| 경우 | 셸 | 파일 생성 |
|---|---|---|
| 아무 설정 없음 (기본 agent는 `* * allow`) | 실행됨 | 만들어짐 |
| 환경변수 deny | 도구가 모델에게서 사라짐 | 안 만들어짐 |
| 환경변수 deny + 프로젝트 `opencode.json`의 `* * allow` | 막힘 | 안 만들어짐 |
| 환경변수 deny + 프로젝트의 구체 allow(`shell`·`edit`·`write`) | 막힘 | 안 만들어짐 |
| 환경변수 deny + `--auto` | 막힘 | 안 만들어짐 |

`opencode debug agents`가 해결된 규칙을 순서대로 보여 준다: 프로젝트 규칙 뒤에 환경변수 규칙이 붙는다
(`… shell * allow | edit * allow | … | * * deny | read * allow | …`). 1.x에서는 남의 설정의 구체 키가 우리 와일드카드를
이겨 키 15개를 전부 적어야 했는데, 2.x는 마지막 규칙이 이기므로 **우리 `* * deny` 하나가 앞의 것을 전부 덮는다.**

**구조가 달라진 것**

- 기본이 **백그라운드 서비스**에 붙는다(`opencode service …`). `--standalone`을 주면 그 실행만의 사설 서버로 돈다 — 실측은 전부
  `--standalone`이었다. 서비스에 붙으면 run의 프로세스 트리 밖에서 agent가 돌아 취소·환경변수가 닿지 않을 수 있다(재지 않았다).
- 데이터 폴더(`~/.local/share/opencode`)를 1.x와 같이 쓴다. 2.x를 돌린 뒤에도 1.18.30이 정상으로 돌았다.
- 전역 설정의 옛 키(`provider`·`command`)는 읽을 때 새 이름으로 바꿔 받아 준다. 파일은 고쳐 쓰지 않았다.

## 원하는 결과

- PATH의 opencode가 2.x여도 one-desk에서 OpenCode로 대화가 돈다. 설정 화면의 CLI 상태가 초록이고 실행 버튼이 막히지 않는다.
- **권한 세 단계가 2.x에서도 지켜진다.** 읽기 전용은 파일을 못 고치고 셸을 못 돌린다. 편집 허용은 셸을 못 돌린다. 프로젝트나
  전역 설정이 그것을 다시 열지 못한다. 읽기 전용·편집 허용에서도 one-desk MCP 도구는 쓸 수 있다(지금과 같다).
- 1.x(1.4.0 이상)는 지금 그대로 돈다 — npm의 `opencode-ai` 최신이 아직 1.19.6이다.
- 대화 화면이 2.x의 도구 줄을 지금처럼 그린다(셸 출력·종료 코드, 편집 diff, 읽기·검색 묶음, 권한 거부 공지).
- 모델 variant, 세션 잇기, 실패 이유, 사용량이 지금처럼 동작한다.

## 뒤집는 결정

- **conversation-fixes FR-17 "OpenCode 2.x CLI는 preflight가 막는다"** → 지원하는 2.x는 통과시킨다. 근거: 막은 이유는 "권한을
  강제할 길이 없다"였는데, 실측에서 길이 있고 1.x보다 단단하다. 게이트 자체는 남는다 — 검증한 범위 밖의 버전(추정: 3.x, 그리고
  `OPENCODE_CONFIG_CONTENT`가 생기기 전의 2.x)은 계속 막는다.

## 제약

- **권한이 먹히는지 확인하지 못한 2.x는 띄우지 않는다.** 2.0.18(데스크톱 번들의 CLI)이 같은 통로를 갖는지 모른다 — 최소 2.x
  버전을 실측으로 정한다. 못 읽은 버전 판정은 지금처럼 캐시하지 않는다.
- **`verifyRunnable`을 비워 두지 않는다.** 실행 직전에 해결된 권한을 다시 읽어, 우리가 기대한 규칙이 마지막에 있는지와 `ask`가
  살아 있는지 본다(재료: `debug agents`). 지금 코드는 2.x 출력에서 조용히 통과한다 — 그 상태로 게이트만 풀면 안 된다.
- 생성하는 권한에 `ask`를 넣지 않는다(지금 규칙 그대로). 기본 agent의 `read *.env ask`는 우리 규칙이 뒤에서 덮는다.
- 설정 화면과 실행이 같은 판정을 쓴다(둘 다 preflight). 버전 갈래가 생겨도 한 자리다.
- **버전 방언은 어댑터 밖으로 나가지 않는다**(conversation-events NFR-2). manager·투영·화면은 `bash`/`shell`을 모른다.
- 프로세스 하나가 run 하나다 — 취소가 그 트리를 끝내고, 앱 종료가 남기지 않는다. 백그라운드 서비스에 기대지 않는다(`--standalone`).
- 가짜 CLI의 기본 시나리오와 `--version` 동작은 그대로 둔다(기존 e2e가 기댄다).
- 세 경계, 주석·오류 메시지 한국어, TDD.

## 범위 밖

- **OpenCode 슬래시 커맨드.** 실측은 끝났다 — 1.x는 `run --command <이름>`으로 펼쳐지고 목록은 `serve`의 `GET /command`, 2.x는
  `run`에 통로가 없고 서버 API(`command.list`, `POST /api/session/{id}/command`)뿐이다. 어느 버전도 메시지 맨 앞의 `/이름`은
  펼치지 않는다. 2.x 지원이 끝난 뒤 따로 intent를 쓴다.
- 2.x의 서버 API로 실행 구조를 바꾸는 것(세션 생성·이벤트 구독). 슬래시 커맨드가 그것을 요구하는지는 그 사이클에서 본다.
- WSL repo의 OpenCode(지금도 막혀 있다).
- 2.x의 새 기능(`goal` 커맨드, worktree, 서비스 페어링, skill API).
- diff 뷰어, OpenCode 하위 에이전트 활동.

## 미해결 질문

사용자가 정할 것:

- [ ] **1.x를 계속 지원하나.** 권장: 둘 다(버전으로 갈라 한 어댑터 안에 두 방언). 2.x만 남기면 코드가 줄지만 npm 설치본(1.19.6)이
  막힌다.
- [ ] **전체 허용에서 `--auto`를 붙이나.** 2.x 기본 agent가 이미 `* * allow`라 없어도 돈다. 권장: 붙이지 않고 규칙으로
  `* * allow`를 넣는다 — 권한의 출처가 환경변수 하나가 된다.

spec에서 실측으로 정할 것:

- [ ] 지원하는 가장 낮은 2.x — `OPENCODE_CONFIG_CONTENT`·`permissions` 규칙·`--standalone`이 생긴 버전.
- [ ] 편집 허용의 규칙 목록 — 파일을 쓰는 action 이름 전부(`edit`·`write`·…)와 `external_directory`.
- [ ] MCP — `mcp.servers`의 서버 모양, `OPENCODE_CONFIG_CONTENT`에 같이 실을 수 있는지, MCP 도구의 action 이름과 그것만 여는 규칙.
- [ ] `--standalone`의 프로세스 트리와 취소(`taskkill /T`), 백그라운드 서비스가 이미 떠 있을 때의 동작.
- [ ] `--session`이 없는 id로 새 세션을 만드는 것을 어떻게 막나(잇기 전에 세션이 있는지 확인할 통로).
- [ ] 2.x의 도구 결과 `metadata` 모양(셸 종료 코드, 편집 `filediff`, 검색 개수) — detail 파서의 두 번째 방언.
- [ ] `--thinking`의 reasoning 줄, 권한 거부 오류 문구(공지 판정이 문구에 기댄다), `--version` 첫 줄(`opencode v2.3.2` — 지금
  파서가 읽는다).
- [ ] 설정 화면의 인증·모델 조회(`auth list`·`models`)가 2.x에서 같은 출력인지.

## 성공 기준

- 2.3.2에서 읽기 전용으로 "셸을 돌리고 파일을 만들라"고 시키면 둘 다 일어나지 않고, 프로젝트 `opencode.json`에 allow를 적어도
  같다. 편집 허용은 파일만 만들고, 전체 허용은 둘 다 한다(`realOpencode` 테스트, 진짜 CLI).
- 2.3.2로 one-desk에서 첫 턴과 이은 턴이 돌고, 대화록에 셸·편집·읽기 줄이 1.x와 같은 모양으로 선다.
- 1.18.30의 기존 테스트와 `realOpencode`가 그대로 통과한다.
- 지원 범위 밖의 버전은 설정 화면과 실행이 같은 문장으로 거부한다.
- `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 전부 통과.
