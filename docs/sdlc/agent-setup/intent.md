# Intent: agent를 무엇으로 돌릴지 정하고, 지금 돌 수 있는지 안다

- 작성자: 권용현
- 상태: 승인됨 (2026-09-22)
- 작성일: 2026-09-22

## 문제

**대화를 한 번 돌려보기 전에는 agent가 어떤 상태인지 알 수 없다.** 사용자의 말 그대로:

> "opencode와 claude의 모델과 effort를 설정하기 힘들고, 실제로 대화 하기 전에는
> 모델이 제대로 붙어있는지 무슨 모델인지 파악이 안 되는 게 문제야"

갈래가 셋이다.

### 1. 설정 화면의 "CLI 상태"가 보장하는 것은 파일 존재뿐이다

`core.workspaces.checkAgents`는 어댑터의 `preflight`를 그대로 탄다 — 실행을 막는 것과 같은
판정이라는 설계 의도(전체 설계 §595)는 지켜지고 있지만, **그 판정의 내용이 "실행 파일이
거기 있고 `.cmd`가 아니다"까지다.** 그래서 이 장비에서 지금:

- `claude.exe` → 초록
- `opencode.exe` → **초록**. 그런데 `opencode auth list`는 **`0 credentials`**다.
  **자격 증명이 하나도 없어 어떤 모델로도 돌 수 없는데 설정 화면은 초록이다.**

`CLAUDE.md`가 경계하던 "설정 화면은 초록인데 실행 버튼은 막힌다"의 한 칸 더 안쪽이다 —
실행 버튼도 막히지 않는다. 실행이 시작되고 나서야 깨진다.

### 2. 모델은 자유 텍스트인데, 무엇을 넣어야 하는지 알려주는 것이 없다

설정 화면과 실행 패널 모두 모델이 `<input>`이고 placeholder가 전부다
(`예: sonnet`, `예: anthropic/claude-sonnet-4-5`). 두 CLI의 형식이 다르다는 것은
전체 설계 §199가 정해 두었고 칸도 agent별로 갈라 두었지만, **그 칸에 무엇이 들어갈 수
있는지는 앱 어디에도 없다.** 오타를 내도 앱은 아무 말 없이 그대로 CLI에 넘긴다.

### 3. effort는 앱에 개념 자체가 없다

컬럼도, UI도, CLI 인자도 없다. 두 CLI 모두 지원하는 것을 `run-info` intent가 실측해
두었고, 같은 문서가 "어느 쪽도 되돌려 주지 않으므로 보여주려면 **앱이 먼저 고르고
넘겨야 한다**"며 범위 밖으로 빼면서 "필요해지면 별도 intent로 연다"고 적었다.
**그 별도 intent가 이 문서다.**

## 실측 — 2026-09-22, 이 장비 (claude 2.1.278, opencode 1.18.30)

### 모델 이름을 아는 길이 두 CLI가 정반대다

| | 목록 조회 | 해석된 이름 관측 |
|---|---|---|
| Claude Code | **없음.** 서브커맨드에 `models`가 없다(`agents`·`auth`·`doctor`·`mcp`·`plugin`·`project`·… 전부 확인) | **된다** — `system/init`의 `model` |
| OpenCode | **`opencode models`** → `provider/model` **382줄, 1.6초** | 안 된다 — 스트림에 모델이 없다(`run-info` 실측) |

`claude --help`는 별칭(`fable`·`opus`·`sonnet`)과 전체명(`claude-fable-5`)을 문장으로만
설명한다 — 기계가 읽을 목록이 아니다.

**서로의 구멍을 서로가 메운다.** claude는 목록을 못 주지만 해석 결과를 주고, opencode는
해석 결과를 못 주지만 목록을 준다.

### claude의 init probe: 1초, 요금 없음, 그러나 검증은 아니다

슬래시 커맨드 probe와 **같은 인자**(`-p --output-format stream-json --verbose --tools ""
--strict-mcp-config`)로 띄워 `system/init`에서 끊었다. `init` 줄이 실어 오는 것:

```
type subtype cwd session_id tools mcp_servers model permissionMode slash_commands
terminal_slash_commands apiKeySource claude_code_version output_style agents skills
plugins capabilities analytics_disabled product_feedback_disabled uuid memory_paths
messaging_socket_path fast_mode_state fast_mode_disabled_reason powershell_path
```

`--model`을 바꿔 가며 잰 값:

| 넘긴 값 | `init.model` | 걸린 시간 |
|---|---|---|
| (없음) | `claude-opus-5[1m]` | 983ms |
| `sonnet` | `claude-sonnet-5` | 938ms |
| `gpt-9` | **`gpt-9`** | 887ms |

**읽어야 할 두 가지.**

- **별칭이 풀려서 온다.** 모델 칸을 비웠을 때 실제로 무엇이 붙는지(`claude-opus-5[1m]`)를
  대화 전에 정확히 알 수 있다. 이것이 사용자가 말한 "무슨 모델인지 파악이 안 된다"의 답이다.
- **init은 모델을 검증하지 않는다.** 없는 이름 `gpt-9`가 그대로 되돌아온다. 즉 probe는
  "**무엇이 붙는가**"에는 완전한 답이지만 "**그것이 유효한가**"에는 답하지 못한다 —
  유효성은 첫 API 호출에서야 드러난다. 화면의 문구가 이 차이를 넘어서면 안 된다.

`claude_code_version`(`2.1.278`)도 같은 줄에 온다.

### **init은 인증도 보지 않는다 — probe만으로는 이 문제를 못 고친다**

사용자가 "토큰이 아예 없으면 probe를 못 쓰는 것 아니냐"고 물어 재봤다. **못 쓰는 것이
아니라, 쓰이는데 아무것도 못 잡는다** — 그래서 더 나쁘다.

`--bare`(OAuth·키체인을 읽지 않고 `ANTHROPIC_API_KEY`만 본다고 `--help`가 명시)로
그 변수 없이 띄운 것이 "토큰 없음"이다.

| | 인증 있음 | **토큰 없음** |
|---|---|---|
| `init` 도착 | 912ms | **384ms** (훅을 타지 않아 오히려 빠르다) |
| `model` | `claude-opus-5[1m]` | `claude-opus-5[1m]` |
| `apiKeySource` | `none` | `none` |

**`apiKeySource: "none"`은 "API 키 환경변수에서 오지 않았다"는 뜻이지 "인증이 없다"가
아니다.** 두 경우의 init은 의미 있는 필드가 전부 같다.

즉 **probe만 붙이면 아무것도 못 돌리는 사람에게 초록으로 모델 이름을 자신 있게 띄운다** —
이 작업이 고치려던 "opencode는 자격 증명 0개인데 초록"을 claude 쪽에 그대로 복제하는 셈이다.

### 빠져 있던 칸: `claude auth status`

`--json`이 **기본 출력**이고 **0.24초**다. SessionStart 훅도 타지 않고 모델도 부르지 않는다.

```json
{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
  "subscriptionType": "max", "email": "…", "orgId": "…", "orgName": "…" }
```

그래서 판정은 **세 칸으로 쌓인다.** probe가 인증 판정을 대신하는 것이 아니라, **인증이
확인된 뒤에만 돈다** — 로그인이 안 돼 있으면 probe를 건너뛰어 0.9초와 훅 한 번을 아낀다.

| 칸 | 수단 | 비용 | 답하는 것 |
|---|---|---|---|
| 1 | `preflight` (기존) | 파일 검사 | 실행 파일이 있나 |
| 2 | `claude auth status --json` | 0.24초 | **로그인돼 있나** |
| 3 | init probe | 0.9초 | 무슨 모델이 붙나 |

opencode의 같은 칸은 `opencode auth list`다(실측 `0 credentials`).

### 토큰이 없을 때 지금 앱은 어떻게 되나

깨지지는 않는다. 자격 증명 없이 한 턴을 실제로 돌려 봤다.

- exit code **1**
- `init`은 정상으로 오고 `model: claude-sonnet-5`까지 찍힌다
- `model: "<synthetic>"`인 assistant 메시지가 `"Not logged in · Please run /login"`을 낸다
- `result`는 `subtype: "success"`인데 **`is_error: true`**다

어댑터가 이미 `is_error`를 읽어 `failed`로 떨어뜨리므로(`claudeCode.ts`) run 상태는 옳다.
**문제는 그것을 알려면 한 바퀴를 돌아야 하고, 실패가 모델의 답변처럼 읽힌다는 것이다** —
사용자가 말한 "실제로 대화 하기 전에는 파악이 안 된다"가 바로 이 자리다.

`result.subtype`이 `"success"`인 채로 `is_error: true`가 오는 것도 기록해 둔다. `subtype`을
성공 판정에 쓰면 안 된다.

### effort / variant

| | 플래그 | 값 |
|---|---|---|
| Claude Code | `--effort <level>` | `low` `medium` `high` `xhigh` `max` — `--help`가 다섯 개를 열거한다 |
| OpenCode | `--variant <string>` | "model variant (provider-specific reasoning effort, e.g., high, max, minimal)" — **provider마다 값이 다르고 열거되지 않는다** |

`run-info` intent의 실측대로 **어느 쪽도 스트림으로 되돌려 주지 않는다.** 앱이 보낸 값만이
기록의 유일한 출처다.

### opencode의 준비 상태

`opencode models`는 **인증과 무관하게** 382개를 돌려준다 — 목록은 이름표지 준비 상태가
아니다. 준비 상태는 `opencode auth list`가 안다(`0 credentials`). 다만 그 출력은 ANSI
장식이 붙은 박스 그림이고 `--json` 같은 기계용 형식이 없다(`auth --help` 확인).

## 원하는 결과

**대화를 시작하기 전에, 지금 이 설정으로 무엇이 돌지가 화면에 적혀 있다.**

- 설정 화면의 CLI 상태가 "파일이 있다"가 아니라 **"이 workspace로 지금 대화하면 모델 X로
  돈다"** 또는 **"돌지 않는다, 이유는 이것이다"**를 말한다. 위의 opencode처럼 실행 파일은
  있는데 자격 증명이 없는 경우가 초록으로 지나가지 않는다.
- 모델 칸이 **무엇을 넣을 수 있는지 스스로 알려준다.** 그러면서도 **자유 입력은 남는다** —
  새 모델이 나온 날 앱을 고치지 않고 바로 쓸 수 있어야 한다.
- **effort를 고를 수 있다.** claude는 다섯 단계 중에서 고르고, workspace 기본값으로도
  저장된다. 지난 대화가 무슨 effort로 돌았는지 기록에 남는다.

## 결정 (2026-09-22, 사용자)

세 갈래 각각에 대해 사용자가 골랐다.

### 1. CLI 상태 — **init probe로 실제 모델까지 보여준다**

슬래시 커맨드 probe와 같은 기계를 재사용해 claude는 `init`의 `model`과
`claude_code_version`을, opencode는 목록 조회를 읽어 상태 줄에 띄운다. claude 약 1초,
opencode 약 1.6초, **요금 없음**(모델 호출 전에 끊는다).

**단, 그 앞에 인증 칸이 온다** (위 실측). 사용자의 지적으로 드러난 것이고, 이것이 빠지면
결정이 고치려던 문제를 그대로 남긴다.

```
CLI 상태                          [다시 확인]

● Claude Code   claude-opus-5[1m]
  C:\Users\rikee\.local\bin\claude.exe · v2.1.278
  로그인됨 (claude.ai · max)

○ Claude Code   로그인 필요                    ← 토큰이 없을 때
  C:\Users\rikee\.local\bin\claude.exe · v2.1.278
  `claude auth login`으로 로그인하세요
  (모델은 확인하지 않았습니다)                 ← probe를 건너뛴다

● OpenCode      모델 없음
  ...\WinGet\Links\opencode.exe
  자격 증명 0개 — `opencode auth login`이 필요합니다
  (모델 382개 조회됨)
```

**실제로 한 마디를 호출해 검증하는 안은 고르지 않았다.** 없는 모델·만료된 토큰까지 전부
잡는 유일한 길이지만 요금이 들고 느리다. 그래서 이 화면이 못 잡는 것이 둘 남는다 —
**없는 모델 이름**(`gpt-9` 실측)과 **로그인은 돼 있는데 토큰이 만료된 경우**다. 문구가
그것을 넘어서 약속하면 안 된다.

### 2. 모델 — **자동완성을 붙이되 자유 입력을 유지한다**

칸은 `<input>` 그대로 두고 제안 목록을 붙인다. opencode는 `opencode models`가 준 값을,
claude는 조회할 수 없으므로 별칭 표를 제안으로 둔다.

```
모델  [sonn                    ▾]
      ┌──────────────────────────┐
      │ sonnet        별칭       │
      │ claude-sonnet-5          │
      └──────────────────────────┘
      → claude-sonnet-5 로 해석됩니다

(빈 칸 = CLI 자신의 기본값, 지금과 동일)
```

**드롭다운으로 강제하는 안은 고르지 않았다.** claude 쪽 목록을 앱이 하드코딩해야 하는데,
그 표가 낡으면 새 모델을 **아예 못 쓰게** 된다. 자유 입력이 남으면 표가 낡아도 막히지
않는다 — 이것이 이 선택의 핵심이다.

### 3. effort — **claude만 다섯 단계 드롭다운, workspace 기본값까지**

claude에 `--effort` 드롭다운(`low`·`medium`·`high`·`xhigh`·`max`)을 붙이고 workspace
기본값으로 저장한다. **opencode의 `--variant`는 자유 입력 칸으로 둔다** — provider마다
값이 달라 같은 다섯 단계 표로 묶으면 그 표가 거짓말이 된다.

```
agent  [Claude Code ▾]
model  [sonnet        ]
effort [high        ▾]   low / medium / high / xhigh / max

─ OpenCode를 고르면 ─
variant [              ] provider별 값
```

이 결정이 `run-info`가 미뤄 둔 "앱이 먼저 고르고 넘긴다"를 채운다.

## 영향 범위

- **`core/commands/probe.ts` 근처** — `system/init`을 읽어 즉시 죽이는 기계가 이미 있고
  `model`을 버리고 있다. 재사용할 것인지 형제 함수를 둘 것인지는 Design의 몫이지만,
  **CLI를 띄우는 방식이 두 벌이 되어서는 안 된다.**
- **`core/index.ts`의 `workspaces.checkAgents`** — 지금 preflight만 부른다. 인증 조회와
  모델 probe가 그 뒤에 붙고, 결과 타입 `AgentStatus`가 넓어진다(`shared/models.ts`).
  **인증 조회는 probe와 별개의 호출이다** — 수단도(`auth status` vs `-p` 실행) 비용도
  (0.24초 vs 0.9초) 다르고, 인증이 없으면 probe를 돌리지 않는다.
- **`core/runner/adapters/*`** — `--effort`/`--variant`를 인자로 붙인다. `buildCommand`와
  `*.command.test.ts`가 바뀐다. `run-info`가 "실행 인자는 건드리지 않는다"고 잠가 둔
  자리를 이번에 연다.
- **`core/db/schema.ts` + 마이그레이션 `0006`** — workspace에 effort 기본값, run에 요청
  effort. **`actualModel`과 달리 관측본이 없다** — 앱이 보낸 값만 남는다.
- **렌더러** — `SettingsPanel`의 실행 탭(상태 줄·모델 칸·effort 칸)과 `RunPanel`.
- **건드리지 않기를 바라는 것**: 권한, 맥락 조립, 큐, 대화록. 이 작업은 **실행을 시작하기
  전의 준비**이지 실행이나 그 관측이 아니다.

## 제약

- `core/`는 `electron`을 import하지 않고, `renderer/`는 `core/`를 import하지 않으며,
  IPC 핸들러는 얇다(`CLAUDE.md` 경계 셋).
- **probe는 요금을 만들지 않는다.** 슬래시 커맨드 `FR-10`이 걸어 둔 규칙과 같다 —
  init을 받는 즉시 `SIGKILL`. 일반 실행의 `SIGTERM` 유예를 쓰면 모델 호출까지 간다.
- **probe는 `RunManager`를 타지 않는다.** 슬롯·큐·`run` 테이블·`onRunUpdate` 어디에도
  흔적이 남으면 안 된다(슬래시 커맨드 `FR-11`과 같은 규칙).
- **`checkAgents`는 실행과 같은 판정을 유지한다.** 넓히더라도 `resolveAgentPath` → 어댑터
  `preflight`가 앞단에 그대로 있어야 한다. 새 정보는 그 **뒤에** 붙는 것이지 대신하는
  것이 아니다 — 갈라지면 설정 화면과 실행 버튼이 다른 말을 한다.
- **화면이 검증하지 않은 것을 검증했다고 말하지 않는다.** init은 모델 이름을 확인하지
  않는다(`gpt-9` 실측). "이 모델로 돕니다"가 아니라 "이 이름으로 넘어갑니다"에 가까운
  문구여야 한다.
- **자격 증명을 읽어 화면·로그·DB 어디에도 남기지 않는다.** opencode 준비 상태는 개수와
  provider 이름까지다. `claude auth status`는 `email`·`orgId`·`orgName`까지 돌려주는데,
  **DB와 로그에는 넣지 않는다** — 화면에 어디까지 올릴지는 Design에서 정한다.
- **인증 확인이 모델 확인보다 앞선다.** init은 인증을 보지 않으므로(실측) probe 결과만으로
  "쓸 수 있다"고 말하면 안 된다. 로그인이 확인되지 않았으면 모델 이름을 단정하지 않는다.
- **하드코딩한 모델 표가 자유 입력을 막지 않는다.** 표에 없는 이름도 그대로 넘어간다.
- 마이그레이션은 **컬럼 추가만.** `run` 테이블을 다시 만들면 `DROP TABLE`이
  `run_context_item`의 cascade를 태워 맥락 기록이 전부 지워진다(`CLAUDE.md`).
- **probe는 실행을 막지 않는다.** 조회가 실패해도(오프라인, 느린 훅) 실행 버튼은 지금처럼
  동작해야 한다. 상태 줄은 모르면 모른다고 적는다.

## 성공 기준

- 자격 증명이 없는 opencode가 설정 화면에서 **초록이 아니다**, 그리고 무엇을 해야 하는지가
  그 자리에 적혀 있다.
- **로그인하지 않은 claude도 초록이 아니다.** init이 모델 이름을 되돌려 주더라도
  (실측: 토큰 없이도 `claude-opus-5[1m]`가 온다) 화면은 "로그인 필요"를 먼저 말한다.
  이 기준이 통과하는지는 `claude auth logout` 없이도 검증할 수 있어야 한다 —
  조회를 주입할 수 있는 이음매가 있어야 한다는 뜻이다.
- 모델 칸을 **비운 채로** 설정 화면을 열면 claude가 실제로 쓸 모델 이름이 보인다.
- 모델 칸에서 몇 글자를 치면 후보가 보이고, **후보에 없는 이름도 그대로 저장돼 실행에
  쓰인다.**
- claude로 effort를 골라 돌리면 그 값이 `--effort`로 넘어가고, 앱을 껐다 켜도 그 대화가
  무슨 effort로 돌았는지 남아 있다.
- 상태 조회가 실패하거나 느려도 실행은 지금과 똑같이 된다.
- 상태 조회로 `run` 행이 생기지 않고 실행 슬롯이 점유되지 않는다.
- 기존 e2e가 전부 통과한다.

## 미해결 질문

Design에서 정한다. 범위를 바꾸는 것은 없다.

- [ ] **opencode의 준비 상태를 무엇으로 판정할지.** `auth list`의 출력은 ANSI 장식이 붙은
      박스 그림이고 기계용 형식이 없다. 출력을 파싱할지, `auth.json`의 **키만** 읽을지
      (값은 절대 읽지 않는다), 아니면 준비 상태 판정을 포기하고 모델 목록만 보여줄지.
- [ ] **상태 조회를 언제 도는지.** 지금 `checkAgents`는 workspace를 고를 때마다 돈다 —
      값싼 파일 검사였기 때문이다. probe는 1~1.6초이고 사용자의 `SessionStart` 훅을
      깨운다. 자동으로 돌지, 버튼으로만 돌지, 캐시를 둘지(슬래시 커맨드는 cwd마다 캐시).
      **세 칸의 비용이 다르므로 칸마다 답이 다를 수 있다** — `auth status`는 0.24초에
      훅도 안 타므로 자동으로 돌려도 무리가 없지만 probe는 다르다.
- [ ] **`auth status`의 계정 정보를 화면에 얼마나 올릴지.** `subscriptionType`("max")은
      쓸모가 있고 `email`은 "어느 계정으로 붙어 있나"에 답한다. 다만 개인 정보이고,
      DB·로그에 넣지 않는 것은 이미 제약으로 정해져 있다.
- [ ] **만료된 토큰은 어떻게 할지.** `loggedIn: true`인데 토큰이 만료된 경우는 실제 호출
      전까지 드러나지 않는다. 이번 범위에서 못 잡는 것으로 두되, 실행이 그 이유로 실패했을
      때 화면이 알아보게 할지는 열려 있다(`result.is_error`에 `"Not logged in"`이 온다).
- [ ] **probe에 어느 cwd를 쓸지.** 슬래시 커맨드 probe는 실행할 repo에서 돈다. 설정
      화면에는 "그 repo"가 없다 — workspace의 첫 repo인지, repo 없이 도는지.
- [ ] **claude 별칭 표를 어디에 둘지.** 하드코딩은 낡는다. `--help` 출력을 파싱하는 길이
      있는지, 아니면 `renderer/permission.ts`처럼 표시용 표 하나로 둘지.
- [ ] **effort 기본값을 무엇으로 할지.** CLI에 맡기는 빈 값(모델 칸과 같은 규칙)인지,
      `medium`을 명시할지. 빈 값이면 드롭다운에 "기본값" 항목이 하나 더 필요하다.
- [ ] **opencode의 `--variant`를 이번에 넘길지.** 칸은 두기로 했지만 저장 자리
      (workspace 기본값 컬럼)를 effort와 공유할지 따로 둘지가 남는다.
- [ ] **실행 패널에도 상태를 보여줄지.** 결정은 설정 화면을 그렸다 — 실행 직전에 같은
      정보가 필요한지는 Design에서 본다.
