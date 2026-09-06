# OpenCode 어댑터 설계

작성일 2026-09-06. 5단계("나머지" — OpenCode 어댑터 · asset 스캔 · diff 뷰어)의 **첫 번째** 하위 과제.

전체 설계 `2026-08-07-one-desk-design.md` §5·§7·§14를 따른다. 이 문서는 그 설계가
"5단계 착수 전에 반드시 실행 검증한다"고 남겨둔 §346의 미지를 실측으로 걷어내고,
그 결과가 강제하는 설계 변경을 기록한다.

## 1. 범위

**포함한다.**

- `core/runner/adapters/opencode.ts` — `AgentAdapter` 두 번째 구현체
- `core/runner/permission.ts`에 OpenCode 권한 정책 추가
- `core/index.ts`의 임시 매핑(`opencode: claudeCodeAdapter`) 교체
- `core/runner/types.ts`에 선택적 `verifyRunnable`, `core/execution.ts`에 그 호출
- `core/mcp/`의 설정 파일 쓰기를 agent 종류별로 가름
- OpenCode용 MCP 설정 파일 형식
- 실측 스트림 픽스처와 파싱 테스트

**빠진다.**

- **대화형 권한 응답.** OpenCode는 실행 중 권한 질문을 이벤트로 내보내고 답을
  되돌려 받는 API를 갖고 있다(§10-2). 그 흐름을 붙이면 어댑터 인터페이스를
  양방향으로 넓혀야 하고 분량이 대략 두 배가 된다. 별도 과제로 뺀다.
- asset 스캔, diff 뷰어. 5단계의 나머지 두 하위 과제.
- **마이그레이션 없음.** 스키마에 `workspace.defaultAgentKind`(enum에 `opencode`
  포함), `defaultModelOpencode`, `opencodePath`, `run.agentKind`가 이미 있다.

## 2. 실측 — 설정 병합 규칙 (§346의 답)

전체 설계 §346은 "생성한 설정이 사용자 설정을 대체하는지 병합하는지"를 열어 두고,
병합이면 §7의 "ask 금지"가 깨진다고 적었다. **병합된다.** 그리고 상황은 그 문장이
예상한 것보다 나쁘다 — 우리가 이길 수 없는 자리가 있다.

`opencode debug config`(해결된 설정을 그대로 출력한다)로 확인했다. 모델 호출이
없어 비용이 들지 않는다. opencode 1.18.27 / macOS 기준.

### 2-1. 우선순위

| 순위 | 소스 | 비고 |
|---|---|---|
| 1 (가장 셈) | `OPENCODE_PERMISSION` 환경변수 | 권한 전용 |
| 2 | 프로젝트 `opencode.json` (run의 cwd) | repo가 소유 |
| 3 | `OPENCODE_CONFIG`가 가리키는 파일 | one-desk가 만드는 것 |
| 4 (가장 약함) | 전역 `~/.config/opencode/opencode.json` | |

합침은 `permission` 객체 **안에서 키 단위 deep merge**다. 이름을 대지 않은 키는
아래 소스의 값이 그대로 살아남는다.

### 2-2. `"*"`는 구체 키를 이기지 못한다

소스 우선순위와 무관하게, **구체적인 키가 와일드카드를 이긴다.** 우리가
`OPENCODE_CONFIG`에 `{"*":"deny"}`를 써도 프로젝트 설정의 `{"webfetch":"ask"}`가
남는다. `"*"`만으로는 아무것도 보장하지 못한다.

### 2-3. `OPENCODE_CONFIG`로는 repo를 이길 수 없다

우리 파일에 `{"webfetch":"deny"}`를 **명시해도** 프로젝트 설정의 `"ask"`가 이겼다.
따라서 §346이 상정한 "run마다 임시 설정 파일을 만들어 넘긴다"만으로는 §7을
보장할 수 없다.

### 2-4. `OPENCODE_PERMISSION`은 repo도 이긴다

권한 전용 환경변수가 따로 있고, 이것은 프로젝트 설정보다 세다. repo가
`{"bash":"ask","webfetch":"ask"}`인 디렉토리에서 환경변수로 두 키를 `deny`로
지정하자 `deny`가 남았다.

**이것이 이 설계의 중심 발견이다.** 권한은 파일이 아니라 환경변수로 넘긴다.

### 2-5. 재현 방법

```bash
# 해결된 설정 출력 (모델 호출 없음)
opencode debug config | jq '.permission'

# 소스별 비교
OPENCODE_CONFIG=/path/ours.json opencode debug config | jq '.permission'
OPENCODE_PERMISSION='{"bash":"deny"}' opencode debug config | jq '.permission'
```

## 3. 권한

### 3-1. 키 목록은 유한하고 스키마에 있다

`https://opencode.ai/config.json`의 `$defs.PermissionConfig`가 키를 열거한다
(1.18.27 기준 15개).

```
bash  doom_loop  edit  external_directory  glob  grep  list  lsp
question  read  skill  task  todowrite  webfetch  websearch
```

값은 `ask` / `allow` / `deny` 셋뿐이다. 추가 키(`*`, MCP 도구 이름 등)도 허용된다.

**one-desk는 15개를 전부 명시한다.** 이름을 대지 않으면 아래 소스의 `ask`가
그대로 살아남기 때문이다. `"*"`도 함께 넣지만 그것은 미래의 새 키를 위한 것이지
보호 수단이 아니다(§2-2).

### 3-2. 세 단계 매핑

전체 설계 §374~376의 의미를 그대로 옮긴다. claude 쪽 `READ_ONLY_TOOLS` /
`EDIT_TOOLS`와 대응이 어긋나지 않게 유지한다.

| 키 | 읽기 전용 | 편집 허용 | 전체 허용 |
|---|---|---|---|
| `read` `glob` `grep` `list` `lsp` `todowrite` `webfetch` `websearch` | allow | allow | allow |
| `edit` | deny | **allow** | allow |
| `bash` | deny | deny | allow |
| `task` `skill` `external_directory` `doom_loop` | deny | deny | allow |
| `question` | deny | deny | allow |
| `*` | deny | deny | allow |

전체 허용은 여기에 `--auto`를 더한다(§376).

**`question`을 막는 이유.** OpenCode에는 agent가 사람에게 되묻는 도구가 따로
있는데, 헤드리스에서 이것이 열려 있으면 답할 사람 없이 멈춘다. 내용 질문은
§394의 흐름 — 최종 응답 첫 줄에 `[NEEDS_ANSWER]`를 남기고 **종료** — 으로만
받는다. 도구를 막으면 모델이 그 경로를 택할 수밖에 없다.

**`bash`가 편집 허용에서도 deny인 이유.** 전체 설계 §7의 "파일 수정 자동 승인,
그 외 차단"을 그대로 따른다. claude 어댑터도 편집 허용에서 Bash를 뺀다.

### 3-3. preflight의 `ask` 검사 — 선택이 아니라 필수

15개를 다 명시해도 구멍이 셋 남는다.

1. opencode가 **나중에 추가하는 새 권한 키**는 우리가 모른다.
2. `OPENCODE_PERMISSION`이 **깨진 JSON이면 조용히 무시된다**(§8).
3. MCP 도구 이름 같은 임의 키에 `ask`가 걸릴 수 있다.

셋 다 증상이 같다 — **헤드리스 실행이 아무 말 없이 영원히 멈추고 동시 실행
슬롯을 계속 점유한다.** 그래서 preflight가 마지막에 한 번 확인한다.

**run의 cwd에서, 실제로 실행에 쓸 환경변수를 그대로 실어 `opencode debug config`를
돌린다.** 해결된 `permission`에 `ask`가 하나라도 있으면 실행을 거부하고 어떤 키인지
그대로 보여준다. 모델을 호출하지 않으므로 비용도 지연도 작다.

거부 메시지는 `.cmd` 거부와 같은 톤으로, 사람이 고칠 수 있는 것을 가리킨다.

> `<key>` 권한이 '물어보기'로 남아 있어 실행할 수 없습니다. 헤드리스 실행에는
> 답할 사람이 없어 멈춥니다. `<cwd>/opencode.json`에서 해당 항목을 지우거나
> allow/deny로 바꾸세요.

키 목록을 미리 알 필요가 없는 검사라 opencode가 권한 종류를 늘려도 깨지지 않는다.

**어디에 붙는가.** `preflight`는 cwd를 받지 않는다(실행 파일을 찾는 일에 cwd가
필요 없기 때문이다). 이 검사는 cwd와 권한 단계가 둘 다 있어야 하므로 별도
지점으로 둔다 — **어댑터의 선택적 메서드**로 만들고, `core/execution.ts`가
preflight 직후·MCP 준비 앞에서 있을 때만 부른다.

```ts
/** 실행 직전 마지막 확인. 필요한 어댑터만 구현한다. */
verifyRunnable?(input: {
  executable: string
  cwd: string
  permission: Permission
}): Promise<PreflightResult>
```

그 자리를 고른 이유는 preflight와 같다 — 실행 파일도 권한도 확인되지 않은 run이
포트를 열거나 슬롯을 잡았다 놓는 낭비를 만들지 않고, 실패가 `startedAt`이 null인
실패로 남는다. 실패 처리는 preflight 실패와 같은 경로(`markFinished`)를 그대로
쓰고, `reason`이 사용자에게 그대로 보인다.

claude 어댑터는 구현하지 않는다. 권한 플래그를 우리가 전부 소유하므로 합쳐질
남의 설정이 없다. **선택적 메서드는 "OpenCode에만 있는 확인 단계"를 있는 그대로
표현한 것이지 편의가 아니다.**

## 4. 커맨드 조립

```
opencode run --format json [-m <provider/model>] [--session <id>] [--auto]
```

- **프롬프트는 stdin으로 넘긴다.** 인자 없이 실행하면 stdin을 읽는다(실측 확인).
  맥락이 합쳐지면 수십 KB가 되는데 인자에는 OS별 길이 제한이 있다. claude와 같은
  이유·같은 방식이다. **띄운 뒤 반드시 `stdin.end()`를 부른다.**
- 모델은 `provider/model` 형식이다(§199). `workspace.defaultModelOpencode`가 그
  형식으로 저장된다. `model`이 없으면 플래그를 붙이지 않고 opencode 기본값에 맡긴다.
- 이어서 실행은 `--session <external_session_id>`.
- `--auto`는 전체 허용에서만.
- env: `process.env`에 `OPENCODE_PERMISSION`, (MCP를 쓰면) `OPENCODE_CONFIG`를
  얹고, claude와 같은 루프백 NO_PROXY 우회(`withLoopbackBypass`)를 적용한다.
  사내 프록시가 잡힌 환경에서 MCP 브리지가 죽는 것을 막는 장치이며, 어느 CLI를
  쓰든 이유가 같으므로 공용 헬퍼로 쓴다.

preflight의 실행 파일 탐색은 claude와 같은 `findExecutable`를 `'opencode'`로
부르고, `.cmd`/`.bat` 배치 shim은 같은 이유로 거부한다(Node의 spawn이 `EINVAL`이고,
`shell: true`를 켜면 취소가 자식에 닿지 않는다).

## 5. MCP

OpenCode의 MCP 설정은 형식이 다르다.

```json
{ "mcp": { "one-desk": {
  "type": "local",
  "command": ["<execPath>", "<bridgePath>"],
  "environment": { "ELECTRON_RUN_AS_NODE": "1",
                   "ONE_DESK_MCP_URL": "...", "ONE_DESK_MCP_TOKEN": "..." },
  "enabled": true,
  "timeout": 30000
} } }
```

claude의 `mcpServers.<name>.{command,args,env}`와 키 이름·구조가 모두 다르다.
`command`가 배열이고 `env`가 `environment`다. 전송은 똑같이 stdio이므로
`bridge.mjs`는 그대로 쓴다.

**`timeout`을 명시한다.** 지정하지 않으면 기본 5초인데, 브리지가 앱 안의 HTTP
서버로 한 번 더 중계하는 구조라 여유를 둔다.

**설정 파일은 지금처럼 MCP 호스트가 쓴다.** `RunContext`에 `agentKind`를 더해
호스트가 형식을 갈라 쓴다. 0600 강제, run 종료 시 삭제, 부팅 시 지난 파일 정리가
이미 한자리에 모여 있으므로 그것을 쪼개지 않는다. **권한은 이 파일에 넣지
않는다** — 환경변수로 가야 repo를 이기고(§2-4), MCP를 끈 실행에서도 권한은
필요하기 때문이다. 두 관심사가 서로 다른 통로로 가는 것이 오히려 자연스럽다.

**`--strict-mcp-config`에 해당하는 것이 없다.** 설정이 병합되므로 사용자의 개인
MCP 서버가 함께 올라온다. 권한 구멍은 아니고 agent에게 여분의 도구가 보이는
잡음이다. 알려진 차이로 남긴다.

## 6. 이벤트 스트림과 파싱

`--format json`의 출력은 **NDJSON**이다 — 한 줄이 완결된 JSON 객체 하나. 줄 단위인
`parseLine` 계약과 그대로 맞는다.

관측된 `type`은 넷이다: `step_start`, `tool_use`, `step_finish`, `text`.
모든 줄이 `type` / `timestamp`(epoch ms) / `sessionID` / `part`를 갖는다.

### 6-1. 정규화 대응

| OpenCode | one-desk 이벤트 | 근거 |
|---|---|---|
| `step_start` | `session` | `sessionID`가 모든 줄에 있다 |
| `tool_use` | `tool_use` + `tool_result` | 한 줄에 입력과 결과가 함께 온다 |
| `text` | `text` + `result` | §7 |
| `step_finish` | (없음) | 토큰·비용은 아직 쓰는 곳이 없다 |
| 파싱 실패 | `raw` | 한 줄이 깨졌다고 run을 죽이지 않는다 |

**`session`은 `step_start`에서만 낸다.** `sessionID`가 모든 줄에 있어 어디서든
집을 수 있지만, 줄마다 내면 같은 값이 로그를 채운다.

**`tool_use` 한 줄이 두 이벤트가 된다.** `part.state.status`가 `completed`이고
`input`과 `output`을 함께 담고 있다. 인터페이스가 "한 줄이 여러 이벤트로 갈라질
수 있다"를 이미 허용한다.

- `name` = `part.tool` (소문자다 — `read`, `write`)
- `effect` = `read`/`glob`/`grep`/`list` → `read`, `write`/`edit`/`patch` → `write`,
  `bash` → `execute`, 그 외 `other`
- `targetPaths` = `part.state.input.filePath`가 있으면 그 하나
- `toolUseId` = `part.callID`
- `tool_result.ok` = `part.state.status === 'completed'`

도구 이름 판정이 어댑터에 있는 것은 전체 설계 §329가 요구하는 바다 — 어느 도구가
파일을 쓰는지 아는 것은 어댑터의 책임이고, runner와 UI는 agent 종류를 모른다.

### 6-2. 실측 픽스처

무료 모델로 뜬다. 비용이 들지 않는다.

```bash
opencode run --format json -m opencode/nemotron-3.5-lightning-free \
  "Read notes.txt, then create summary.txt whose entire contents are exactly: OK"
```

읽기 한 번·쓰기 한 번·최종 응답이 모두 들어 있는 12줄이 나온다. 이것을
`core/runner/adapters/fixtures/`에 저장하고 정규화 결과와 대조한다(§593).

## 7. 종료 처리 — `result`를 합성한다

**OpenCode에는 claude의 `result` 같은 종료 이벤트가 없다.** 스트림이 그냥 끝나고
프로세스가 종료한다. 마지막 `step_finish`에 `reason: "stop"`이 있지만 최종
텍스트를 담고 있지 않고, `parseLine`은 앞 줄을 기억하지 못한다.

**어댑터가 `text` 줄마다 `text`와 `result`를 함께 낸다.** `RunManager`가 `result`를
볼 때마다 `resultText`를 덮어쓰므로 자연히 마지막 것이 남는다. runner를 건드리지
않고, claude 어댑터와 모양이 같아진다. `RunLog`에는 이미 직전 `text`와 같은 내용의
`result`를 상태 라벨로 접는 처리(`repeated`)가 있어 화면도 깨지지 않는다.

`[NEEDS_ANSWER]` 표식 처리(§394)는 claude와 똑같이 어댑터가 한다 — `result`를
만들 때 첫 줄을 검사해 `needsAnswer`를 세우고 표식은 지운다.

`status`는 `succeeded`로 낸다. 실제 판정은 종료 코드를 보는 runner가 한다.

## 8. 조용히 깨지는 것 셋

전부 실측으로 밟았다. 세 가지 모두 **증상이 같다 — 아무 오류 없이 사용자의
`ask` 설정으로 되돌아간다.**

1. **`OPENCODE_CONFIG`가 없는 파일을 가리키면 조용히 무시된다.** 임시 설정 파일
   쓰기가 실패했는데 그냥 진행하면 MCP도 못 붙고 사용자 설정이 그대로 산다.
   **쓰기 실패는 반드시 run 실패로 처리한다.**
2. **`OPENCODE_CONFIG`는 인라인 JSON을 받지 않는다.** 경로만 받는다. 본문을 넣으면
   조용히 무시된다.
3. **`OPENCODE_PERMISSION`이 깨진 JSON이면 조용히 무시된다.** 종료 코드도 0이다.

§3-3의 preflight 검사가 셋 모두를 마지막에 잡는다. 그것이 이 검사를 선택이 아니라
필수로 만드는 이유다.

## 9. 테스트

- **권한:** 세 단계가 만드는 `OPENCODE_PERMISSION` 본문에 `ask`가 없음을 고정한다.
  전체 설계 §382가 "이 규칙은 테스트로 고정한다"고 요구한 그것이다. 15개 키가
  빠짐없이 들어 있는지도 함께 본다 — 하나라도 빠지면 그 키로 `ask`가 새어든다.
- **preflight:** 해결된 설정에 `ask`가 남으면 거부하고, 키 이름이 메시지에
  들어가는지 확인한다. `opencode debug config` 호출은 주입 가능한 이음매로 둔다.
- **파싱:** §6-2의 실측 픽스처를 정규화 결과와 대조한다. 특히 `write` 도구가
  `effect: 'write'`와 `targetPaths`를 내는지 — 그것이 앞으로 diff 뷰어의 입력이다.
- **커맨드:** 세 권한 단계와 이어서 실행 조합에서 인자와 환경변수가 기대대로
  조립되는지. `--auto`가 전체 허용에서만 붙는지.
- **e2e:** 가짜 opencode CLI 픽스처가 필요하다. 기존 가짜 claude와 같은 자리에
  두되 **서버 이름을 리터럴로 박지 않는다**(과거에 `.mcpServers.onedesk` 하드코딩이
  단위 테스트 412개가 초록인 채로 e2e를 통째로 깨뜨린 적이 있다).
- **배선:** `core/index.ts`의 `adapters` 맵에서 `opencode`가 새 어댑터를 가리키는지.
  그 한 줄은 그 자체로 되돌릴 수 있는 변이다.

## 10. 다른 설계로 넘기는 발견

이번 범위 밖이지만, 여기서 드러났으므로 기록해 둔다.

### 10-1. diff 뷰어의 before 스냅샷이 OpenCode에서는 설계대로 안 된다

전체 설계 §553은 "runner가 스트림에서 파일 수정 도구 호출을 감지하면, 해당
파일이 아직 스냅샷되지 않았을 경우 원본을 `logs/<run_id>/before/`에 복사한다"고
정했다. **OpenCode의 `tool_use`는 이미 `status: "completed"`로 온다** — 쓰기가
끝난 뒤다. 복사할 원본이 그 시점에 이미 없다.

같은 §559가 경고한 실패 양상 그대로다: 이미 수정된 내용을 "원본"으로 저장하면
diff가 비어 보이고 사용자는 "agent가 아무것도 안 바꿨다"고 잘못 읽는다.
**틀린 정보는 정보 없음보다 나쁘다.**

diff 뷰어를 설계할 때 정면으로 다뤄야 한다. 후보는 §564의 "의심 표시"를
OpenCode에서는 기본값으로 두는 것, 또는 `--format json` 대신 서버 모드의
이벤트 스트림에서 시작 상태를 받는 것이다. 여기서 고르지 않는다.

### 10-2. 대화형 권한·질문 응답이 가능하다

OpenCode의 로컬 서버 API에 다음이 있다.

- `permission.v2.asked` 이벤트 — `action`, `resources`, `sessionID`, 요청 id
- `POST /api/session/{sessionID}/permission/{requestID}/reply` — `once`/`always`/`reject`
- `/api/session/{sessionID}/question/{requestID}/reply` — 내용 질문도 **구조화**돼 있다
- `/api/event` — SSE 이벤트 스트림
- `opencode run`은 이미 자기 안에 서버를 띄운다(`--port`)

즉 "agent가 물으면 대화창에 띄우고 사용자가 답하면 이어간다"가 OpenCode에서는
구현 가능하다. 이것이 붙으면 §3-3의 preflight 거부가 대부분 불필요해지고,
§394가 스스로 "견고하지 않다"고 인정한 `[NEEDS_ANSWER]` 프롬프트 표식도
OpenCode에서는 구조화된 질문으로 대체할 수 있다.

**대가도 분명하다.** (1) claude에는 이 창구가 없어 두 agent의 능력이 갈리고, 전체
설계 §331의 "UI와 저장 로직은 agent 종류를 모른다"가 흔들린다. (2) 현재 어댑터
인터페이스(`preflight`/`buildCommand`/`parseLine`)는 한 방향이라 되돌려 보낼
자리가 없다. (3) 사람 답을 기다리는 run이 동시 실행 슬롯을 계속 점유한다.

별도 설계에서 다룬다. 이 어댑터가 먼저 돌아야 양방향 설계도 근거를 갖는다.

## 11. 전체 설계 문서 정정

`2026-08-07-one-desk-design.md` §346은 이렇게 적혀 있다.

> OpenCode에는 `--mcp-config`에 해당하는 플래그가 없다. 설정 파일에 `mcp` 섹션을
> 쓰고 `OPENCODE_CONFIG` 환경변수로 그 경로를 지정한다. (…) **생성한 설정이 사용자
> 설정을 대체하는지 병합하는지를 5단계 착수 전에 반드시 실행 검증한다.**

앞 두 문장은 맞다. 마지막 요구는 이 문서 §2가 수행했고, 결과는 **병합**이다.
§346에 다음을 덧붙여야 한다.

- 병합이며, `permission` 안에서 키 단위로 합쳐진다
- `OPENCODE_CONFIG`는 프로젝트 `opencode.json`을 이기지 못한다
- 권한은 `OPENCODE_PERMISSION` 환경변수로 넘긴다 — 그것만이 프로젝트 설정을 이긴다
- `"*"`는 구체 키를 이기지 못하므로 알려진 키를 전부 명시한다
- 그럼에도 남는 구멍은 preflight의 `ask` 검사가 막는다
