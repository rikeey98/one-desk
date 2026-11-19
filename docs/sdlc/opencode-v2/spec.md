# Spec: OpenCode 2.x CLI 지원

- intent: `intent.md` (승인 2026-11-19 — "승인, spec 쓰기". 같은 답으로 정해진 것: **1.x도 계속 지원한다**, **전체 허용에 `--auto`를
  붙이지 않고 규칙으로 연다**)
- 상태: **승인됨** (2026-11-19, 사용자 "승인, plan 쓰기") — plan은 `plan.md`. plan을 쓰며 고친 것 셋은 plan §0에 있다(FR-8a의 안내
  자리, FR-14를 두 버전 다, §5의 1을 닫음).
- 작성일: 2026-11-19
- 개정 (2026-11-19, 사용자 "2.0.18도 지원"): 지원 범위를 2.3.2 이상에서 **2.0.18 이상**으로 넓혔다. 2.0.18을 다시 실측했고(0-5),
  그 결과 실행 직전 확인이 버전에 따라 갈린다(FR-8·FR-8a). 이어서 사용자가 정했다("전체 허용만") — **실행 직전 확인을 못 하는
  바이너리(2.0.18)는 전체 허용만 돌린다**(§5의 4).
- 뒤집는 결정: `conversation-fixes` FR-17(2.x 차단) — 지원 범위의 2.x는 통과시킨다. OpenCode 어댑터 설계 §2("권한은
  `OPENCODE_PERMISSION` 환경변수로")는 1.x 방언에만 남는다.

## 0. 실측 (2026-11-19, opencode 2.3.2 · Windows 11 · 모델 `opencode/big-pickle`)

스크립트와 원본 출력은 `probes/`에 있다(다시 돌릴 수 있다 — `node probes/probe3-mcp-shapes-tree.cjs <opencode.exe> <빈 폴더> probes/mcp-ping.cjs`).
모든 실행은 `run --standalone --format json`이었다. intent의 현황 표에 더해 spec 단계에서 잰 것만 적는다.

### 0-1. 권한 규칙의 순서 — intent의 한 문장이 틀렸다

intent는 "프로젝트나 전역 설정이 다시 열지 못한다"고 적었다. **최상위 `permissions`끼리만 맞는 말이다.** `opencode debug agents`가
보여 주는 해결된 순서는 이렇다(뒤가 이긴다):

```
agent 기본값 → 프로젝트 최상위 permissions → 환경변수 최상위 permissions
            → 프로젝트 agents.<id>.permissions → 환경변수 agents.<id>.permissions → agent 꼬리(browser deny 등)
```

| 프로젝트 `opencode.json` | 환경변수(`OPENCODE_CONFIG_CONTENT`) | 인자 | 셸·파일 생성 |
|---|---|---|---|
| `agents.build.permissions: [shell allow, edit allow]` | 최상위 deny만 | — | **실행됨 · 만들어짐** (구멍) |
| 같음 | 최상위 deny + `agents.build.permissions` deny | — | 막힘 |
| `default_agent: loose` + `agents.loose`(shell·edit allow) | 최상위 + `agents.build` deny | — | **실행됨 · 만들어짐** (구멍) |
| 같음 | 같음 | `--agent build` | 막힘 |

그래서 우리 규칙은 **두 자리(최상위와 `agents.build`)에 넣고 agent를 `build`로 못박는다**(FR-5·6). 그래도 남는 순서의 놀람은
실행 직전 확인(FR-8)이 잡는다.

### 0-2. action 이름과 도구

`* * ask`로 돌려 stderr의 `permission requested: <action> (<resource>)`를 읽었다.

| 도구 | action | 비고 |
|---|---|---|
| `read` · `grep` · `glob` | 같은 이름 | |
| `edit` · `write` | **둘 다 `edit`** | `edit * allow` 하나가 두 도구를 연다(실측: 편집 허용 규칙에서 a.txt 고침 · b.txt 생성 · 셸 없음) |
| `shell` | `shell` | 1.x의 `bash` |
| MCP 도구 | `<서버>_<도구>` (`onedesk_ping`) | action에 와일드카드가 된다 — `onedesk_* * allow` 실측 |
| `execute` | `execute` | 전부 허용이면 모델이 MCP 도구를 **`execute`의 JS 코드**(`tools.onedesk.ping()`)로 부른다. 서버 설정에 **`codemode: false`** 를 걸면 어느 단계든 MCP 도구가 직접(`onedesk_ping`) 선다(두 버전 실측, `probe7`). 걸지 않으면 2.3.2는 `execute`가 막혔을 때만 직접 서고, **2.0.18은 아예 서지 않는다** |
| `skill` | (재지 않음) | `* * deny`에서도 도구 목록에 남는다. 없는 skill을 부르면 `Unable to load skill …` |

**deny는 도구를 모델에게서 지운다**(모델이 "그런 도구가 없다"고 답한다). **`ask`는 샌다** — `* * ask`에서 `echo SHELL-OK`는 자동
거부됐는데 `exit 3`은 **묻지 않고 실행됐다**(셸이 명령에서 resource를 못 뽑으면 물을 것이 없다). `execute`도 `ask` 아래에서
`completed`로 끝나고 안쪽 MCP 호출만 거부된다. → 우리 규칙은 `ask`를 쓰지 않고, resource는 `*`만 쓴다(FR-4).

`execute`의 코드는 갇혀 있다(`probe6`, 읽기 전용 + `execute`·`onedesk_*` allow, 두 버전): `tools.onedesk.ping()`은 되고,
`tools.write`·`tools.shell`은 `Unknown tool`, `require('fs')`는 거부, 파일은 하나도 안 생겼다. 그래도 **`execute`는 열지 않는다** —
`codemode: false`로 필요가 없어졌고, 가둔 벽을 한 가지 방법으로만 두드려 봤다.

### 0-3. 스트림 모양

| | 1.18.30 | 2.3.2 |
|---|---|---|
| 호출 id | `part.callID` | `part.id` (`partID`가 따로 있다) |
| 파일 경로 입력 | `input.filePath` | `input.path` |
| 세부 | `state.metadata.{exit,matches,count,filediff,…}` | **한 겹 더** — `state.metadata.metadata.{exit,matches,count,files,…}` (바깥에는 `content`·`rawInput`·`providerCall`) |
| 셸 | `bash`, `metadata.exit` | `shell`, `metadata.metadata.exit`. `exit 3`은 `status: completed` + `exit: 3` |
| 편집 | `metadata.filediff{file,patch,additions,deletions}` | `metadata.metadata.files[]{file,patch,status,additions,deletions}` (`status: "modified"`) |
| 쓰기 | `metadata.{filepath,exists}` | `metadata.metadata.{truncated}`뿐 — 새 파일인지는 출력 글(`Created file successfully: b.txt`)에만 있다 |
| 검색 | `metadata.matches` / `metadata.count` | `metadata.metadata.matches` / `.count` |
| `execute` | 없음 | `input.code`, `metadata.metadata.toolCalls[]{tool,status}`, 안쪽이 실패하면 `metadata.metadata.error: true`인데 **`status`는 `completed`** |
| 생각 | `reasoning` 줄(`--thinking`) | 같다 (`part.text`·`part.time`·`part.metadata`) |
| 자동 거부 문구 | `The user rejected permission to use this specific tool call` | `This non-interactive run cannot ask the user for permission, so the request was rejected.` |
| 오류 줄 | `error{name,data.message}` | `error{type,message}` (`provider.no-route`, `provider.free-limit`) |
| `step_finish`의 토큰 | `part.tokens`·`part.cost` | 같다 |

### 0-4. 프로세스·명령

- **`--standalone` run의 트리**: `opencode.exe`(run) → `opencode.exe`(사설 서버) → `opencode-pty.exe` → `powershell.exe` → `PING.EXE`.
  `taskkill /PID <run> /T /F` 뒤 2.5초에 **전부 없다**.
- **`--standalone`을 빼면 백그라운드 서비스가 뜬다** — `auth list`·`models`를 인자 없이 부른 뒤 `opencode.exe` 하나가 남아 있었다
  (`opencode service stop`으로 내렸다). 어느 명령이 띄웠는지는 가르지 않았다.
- `debug agents --standalone`: 1.4~1.8초, 모델 호출 없음, 해결된 규칙을 agent마다 준다.
- `--model opencode/big-pickle#high` → `{"type":"error","error":{"type":"provider.no-route","message":"Variant unavailable for …: high"}}` + exit 1.
- `--session <없는 id>` → 그 id로 **새 세션을 만든다**(`session list`에 `ses_doesnotexist…`가 생겼다). `session list --format json`이 있다.
- `auth list`(자격 증명 0개) → `No authenticated integrations`, exit 0. 로그인된 출력은 재지 못했다(자격 증명이 없다).
- `models` → 한 줄에 하나, 374줄. 1.x와 같은 모양.
- `--version` → `opencode v2.3.2` (지금 파서가 읽는다).

### 0-5. 2.0.18 (데스크톱 번들의 `opencode-cli.exe`)

범위를 넓히며 `probe3`·`probe5`·`probe6`·`probe7`을 이 바이너리로 다시 돌렸다.

**2.3.2와 같은 것**: 0-1의 구멍 둘과 막는 방법 둘(네 경우 결과가 같다), 권한 단계(읽기 전용은 읽기만, 편집 허용은 파일만), 0-3의
스트림 모양 전부(원본은 `probes/out-shapes-2.0.18.jsonl`), `--standalone` run의 트리와 `taskkill /T`(전부 끝남),
`model#variant`·`--thinking`·`--agent`, `execute`의 갇힘, `codemode: false`.

**다른 것**

| | 2.0.18 | 2.3.2 |
|---|---|---|
| `debug agents --standalone` | **`Unrecognized flag: --standalone`** (exit 1) | 된다 |
| `debug agents` (옵션 없이) | 백그라운드 서비스를 띄우고 붙는다. 첫 호출은 `[]`, 그 뒤에는 **서비스가 뜰 때의 환경**으로 답한다 — 부른 쪽의 `OPENCODE_CONFIG_CONTENT`가 아니다 | (같은 구조, 쓰지 않는다) |
| `api --standalone agent.list` | `[]` (사설 서버가 막 떠서 아직 읽지 않았다) | (재지 않음) |
| `serve`를 띄워 `/api/agent`를 묻기 | 두 번째 요청에 `build`가 오지만 **기본 규칙뿐** — 프로젝트·환경변수 규칙이 아직 없다(2.3.2도 같다) | 같다 |
| MCP 도구 (`codemode` 기본값) | 읽기 전용에서 **안 선다**(`NO-TOOL`) | 직접 선다 |
| `--archived` | 없다 | 있다 (우리는 쓰지 않는다) |
| 기본 agent 규칙 | 머리에 `external_directory * ask`와 allow 넷이 더 있고 꼬리가 없다 | 꼬리에 `browser deny` 둘 |

→ **2.0.18에는 "이 run의 환경으로 해결된 권한"을 믿을 만하게 묻는 길이 없다.** 서비스에 붙는 조회는 남의 환경을 보여 주고,
사설 서버에 붙는 조회는 설정을 읽기 전의 상태를 보여 준다(언제 다 읽었는지 알 길이 없어 기다려도 소용없다). FR-8a가 그 결과다.

2.0.18과 2.3.2 사이의 버전(2.1.x~2.3.1)은 재지 않았다. `--session`에 없는 id를 줬을 때의 동작도 2.0.18에서는 재지 않았다.

## 1. 범위

**한다**: opencode 2.x(FR-1의 범위)로 실행·이어 가기·취소·권한 세 단계·MCP·대화록 표시·설정 화면의 CLI 상태.

**안 한다**(intent의 범위 밖 그대로): 슬래시 커맨드, 서버 API 실행 구조, WSL repo의 OpenCode, 2.x의 새 기능, `execute` 안쪽
호출을 하위 카드로 그리기.

## 2. 설계

### 2-1. 방언 — 한 어댑터, 버전이 가른다

`AgentKind`는 `opencode` 하나 그대로다(스키마·화면·설정이 안 바뀐다). 어댑터 안에 **방언 `'v1' | 'v2'`** 가 생긴다.

- **명령을 만드는 쪽(인자·환경변수·실행 직전 확인)은 방언을 알아야 한다.** preflight가 버전을 읽을 때 방언을 정해 결과에 싣고,
  실행 서비스가 그것을 `verifyRunnable`·`buildCommand`에 넘긴다.
- **줄을 읽는 쪽(`parseLine`·detail)은 방언을 가르지 않는다.** 두 모양을 다 읽는다(`callID ?? id`, `filePath ?? path`,
  `bash`·`shell`, 세부는 한 겹 안쪽이 있으면 그것). `parseLine`은 줄과 runId만 받고 앞 줄을 기억하지 않는다 — 방언을 실어 나를
  자리가 없고, 두 모양이 겹치는 키가 없어 가를 이유도 없다.

버린 안: (a) agent 종류를 둘로(`opencode-v2`) — 저장된 기본 agent·정기 실행·화면 표가 전부 갈린다. (b) 2.x만 지원 — npm
설치본(1.19.6)이 막힌다(사용자 결정). (c) 두 방언의 환경변수를 한꺼번에 싣기 — 인자가 어차피 다르고, 1.x가 2.x 키를 든
`OPENCODE_CONFIG_CONTENT`를 어떻게 읽는지 모른다.

### 2-2. 틀린 방언이 조용히 열리지 않게 — 긍정 확인

지금 버전을 못 읽으면 통과시킨다(백신이 첫 실행을 붙잡는 한 번의 시간 초과로 멀쩡한 설치본을 막지 않으려는 것이고, e2e의 가짜
CLI가 그 길로 지나간다). 방언이 둘이 되면 그 통과가 위험해진다: **2.x를 v1 방언으로 띄우면 `OPENCODE_PERMISSION`이 무시돼 읽기
전용이 전부 허용으로 돈다.**

그래서 못 읽은 버전의 정책은 그대로 두고(방언 `v1`), **실행 직전 확인을 "ask가 없다"에서 "우리가 보낸 것이 실제로 걸려 있다"로
바꾼다**(FR-8·9). 2.x에 v1 확인(`debug config`)을 걸면 출력이 배열이라 우리 권한을 찾지 못하고 **실패한다** — 지금은 그 자리에서
조용히 통과한다.

## 3. 요구사항

### 버전과 방언

- **FR-1 (지원 범위)** 1.x는 지금 그대로 1.4.0 이상. 2.x는 **2.0.18 이상, major 2**. 2.0.0~2.0.17과 3.x 이상은 preflight가
  거부한다. 문장은 두 가지다 — 낮으면 "2.0.18 이상으로 올리거나 1.x를 쓰세요", 높으면 "아직 지원하지 않습니다". 설정 화면과
  실행이 같은 문장을 쓴다(둘 다 preflight). 실측한 것은 2.0.18과 2.3.2 둘이다 — 그 사이는 FR-8의 능력 판정이 가른다. 하한을
  더 내리려면 `realOpencode` 묶음(FR-24)을 그 바이너리로 돌려 통과시킨 뒤 상수를 내린다.
- **FR-2 (방언 판정)** 버전의 major가 2면 `v2`, 1이면 `v1`, 못 읽었으면 `v1`. 판정은 버전 게이트와 같은 캐시·같은 한 번의
  `--version`이다(프로세스를 더 띄우지 않는다). 못 읽은 판정을 캐시하지 않는 규칙은 그대로다.
- **FR-3 (방언은 필수로 흐른다)** preflight 결과의 방언이 `verifyRunnable` 입력과 `buildCommand` 입력에 **필수 필드**로 간다.
  선택이면 한 자리를 빠뜨려도 컴파일되고 그 길만 v1로 2.x를 띄운다. claude 어댑터는 그 필드를 보지 않는다.

### 권한 (v2)

- **FR-4 (규칙 목록)** 권한 단계 → 규칙 목록. `ask`를 만들지 않고 resource는 전부 `*`다.

  | 단계 | 규칙 (순서대로) |
  |---|---|
  | 읽기 전용 | `* deny` · `read allow` · `grep allow` · `glob allow` · `webfetch allow` · `websearch allow` · `<MCP 서버>_* allow` |
  | 편집 허용 | 읽기 전용 + `edit allow` |
  | 전체 허용 | `* allow` |

  MCP 키는 `MCP_SERVER_NAME`에서 만든다(리터럴 금지 — v1과 같은 이유). `execute`·`shell`·`subagent`·`skill`·`external_directory`·
  `question`은 읽기 전용·편집 허용에서 `* deny`에 맡긴다. 1.x의 `list`·`lsp`·`todowrite`에 해당하는 2.x action은 plan 0단계에서
  이름을 확인해 있으면 더한다(§6의 2).
- **FR-5 (두 자리)** 같은 목록을 `OPENCODE_CONFIG_CONTENT`의 **최상위 `permissions`와 `agents.build.permissions` 두 곳**에 넣는다(0-1).
- **FR-6 (agent 고정)** v2 run은 늘 `--agent build`를 붙인다. 프로젝트의 `default_agent`가 다른 agent로 돌리지 못한다.
- **FR-7 (`--auto` 없음)** 어느 단계에도 `--auto`를 붙이지 않는다. 전체 허용은 FR-4의 `* allow`다.
- **FR-8 (실행 직전 확인 — v2)** `debug agents --standalone`을 run과 **같은 환경변수·같은 cwd**로 띄워 `build` agent의 해결된
  규칙을 읽는다. 통과 조건은 둘 다다.
  1. 우리 목록이 그 순서대로 이어져 들어 있다(마지막으로 나타난 자리를 본다).
  2. 그 **뒤에** 오는 규칙이 전부 `deny`다(뒤의 `allow`·`ask`는 우리 것을 다시 연다).

  아니면 실행 전에 실패하고 이유를 말한다(무엇이 뒤에 붙었는지 — `shell * allow`). 출력을 못 읽거나 `build`가 없어도 실패다.
  모델을 부르지 않는다(실측 1.4~1.8초).
- **FR-8a (확인할 수 없는 바이너리)** `debug agents --standalone`이 **`Unrecognized flag: --standalone`** 으로 거부되면(2.0.18) 그
  바이너리는 "실행 직전 확인을 못 하는 2.x"다. **그 바이너리는 전체 허용만 돌린다**(사용자 결정, §5의 4). 읽기 전용·편집 허용은
  실행 전에 실패한다: `OpenCode <버전>은 실행 전에 권한을 확인할 수 없어 읽기 전용·편집 허용으로 돌릴 수 없습니다. 2.3.2 이상으로
  올리거나 전체 허용으로 실행하세요.` 전체 허용은 확인 없이 시작한다 — `* allow`라 열릴 것이 없다(FR-5·6은 그대로 건다).
  `--standalone` 없는 `debug agents`로 대신 묻지 않는다(서비스를 띄우고, 남의 환경을 답한다).
  - 막는 자리는 실행 직전 확인(`verifyRunnable`)이다 — 권한 단계를 아는 첫 자리다. preflight는 권한을 모르므로 실행 파일 줄은
    초록으로 남는다.
  - 판정은 그 문구 하나뿐이다. 다른 실패(시간 초과, 깨진 출력, 다른 오류)는 전부 FR-8의 실패다 — "못 묻는다"와 "물었는데
    틀렸다"를 섞지 않는다. 문구에 기대도 되는 이유: 그 문구를 찍는 것은 이미 나온 옛 바이너리뿐이고, 새 바이너리는 옵션을 받는다.
  - 판정을 (경로, 크기, mtime)으로 캐시한다(버전 게이트와 같은 규칙 — 못 읽은 판정은 캐시하지 않는다).
  - 설정 화면의 CLI 상태가 이 사실을 미리 말한다: `전체 허용만 실행됩니다 — 읽기 전용·편집 허용은 2.3.2 이상`. 실행 버튼을
    누르기 전에 알 수 있어야 한다(전체 설계 §595의 고리). **자리는 실행 파일 줄이 아니라 느린 칸이다**(plan §0의 1 — 능력 판정이
    프로세스를 한 번 띄우므로 빠른 칸에 걸지 않는다).
  - 정기 실행·"다시 보내기"처럼 사람이 권한을 다시 고르지 않는 길도 같은 문장으로 실패한다(조용히 전체 허용으로 올리지 않는다).
- **FR-9 (실행 직전 확인 — v1을 긍정 확인으로)** `debug config`의 `permission`이 **객체이고 우리가 보낸 키·값을 전부 그대로
  담고 있어야** 통과다. `ask`가 남았으면 지금 문장 그대로 실패, 우리 값이 없으면(배열 출력 = 2.x, 또는 환경변수가 무시됨) 새
  문장으로 실패한다. `permission`이 없으면 통과하던 지금 갈래를 없앤다.

### 명령 (v2)

- **FR-10 (인자)** `run --standalone --format json --thinking --agent build` + 모델이 있으면 `-m <model>`(variant가 있으면
  `<model>#<variant>`) + 이으면 `--session <id>`. `--variant`·`--dangerously-skip-permissions`를 붙이지 않는다. v1의 인자는 한
  글자도 안 바뀐다. **variant만 있고 모델이 없으면** `#`을 붙일 자리가 없다 — 그 실행은 시작 전에 "variant를 쓰려면 모델을
  지정하세요"로 실패한다(조용히 버리지 않는다).
- **FR-11 (`--standalone`은 전부)** one-desk가 2.x를 띄우는 **모든** 자리(run · `debug agents` · 세션 확인 · 설정 화면의 조회)에
  `--standalone`을 붙인다. one-desk 때문에 백그라운드 서비스가 뜨면 안 된다. `auth list`·`models`·`--version`이 `--standalone`을
  받는지와 서비스를 띄우는지는 plan 0단계에서 확인한다(§6의 4).
- **FR-12 (환경변수)** v2는 `OPENCODE_PERMISSION`을 싣지 않고 `OPENCODE_CONFIG_CONTENT`를 싣는다. **토큰·URL은 거기 넣지
  않는다** — 환경변수는 agent의 셸 도구가 띄우는 자식에게 물려진다. 루프백 예외(`withLoopbackBypass`)·`userProcessEnv`는 그대로다.
- **FR-13 (MCP)** MCP 서버는 지금처럼 0600 설정 **파일**로 가고(`OPENCODE_CONFIG`가 가리킨다) 모양만 v2다 —
  `mcp.servers.<이름>: { type: 'local', command: [...], environment: {...}, codemode: false }`. **`codemode: false`는 필수다** — 없으면
  2.0.18의 읽기 전용·편집 허용에서 MCP 도구가 사라지고, 전체 허용에서는 두 버전 다 `execute` 한 줄로 보인다(0-2). 파일을 쓰는 자리(`core/mcp/configFile.ts`)가 방언을
  받는다. `OPENCODE_CONFIG`가 2.3.2에서 파일을 읽는지는 plan 0단계의 첫 확인이다 — 안 읽으면 `OPENCODE_CONFIG_DIR`로 간다(§6의 1).
- **FR-14 (세션 잇기)** v2에서 이을 때는(확인 가능한 버전이든 아니든) 실행 직전 확인이 **그 세션이 있는지**도 본다
  (`api --standalone session.get` — plan §0). 없으면 "이어받을 세션이 없습니다"로 실패한다
  — 지금 세션 id가 없을 때와 같은 문장, 같은 자리. `--session`이 새 세션을 만들게 두지 않는다. 확인 명령은 plan 0단계에서 고른다
  (`session list --format json` 또는 `api session.get` — §6의 3).

### 스트림 (두 방언 공통 파서)

- **FR-15 (호출 id·경로)** 도구 호출 id는 `part.callID ?? part.id`, 경로는 `input.filePath ?? input.path`다. id가 비면 지금처럼
  빈 문자열이 아니라 그 줄의 `partID`로 떨어진다 — 빈 id는 한 턴의 모든 도구를 같은 호출로 묶는다.
- **FR-16 (세부의 자리)** `state.metadata.metadata`가 객체면 그것이 세부, 아니면 `state.metadata`다. 그 뒤의 판정(셸 종료 코드,
  검색 개수)은 한 벌이다.
- **FR-17 (도구 효과)** `shell`·`execute`는 `execute` 효과다. 이름은 CLI가 준 그대로 싣는다(원본 로그와 같게). 화면이 `shell`을
  `bash`와 같은 말로 부르는지는 plan에서 렌더러의 이름 표를 확인해 맞춘다 — 방언은 어댑터와 그 표 밖으로 나가지 않는다.
- **FR-18 (편집)** 편집 세부가 `files[]`(항목 `{file, patch, status, additions, deletions}`)면 파일마다 hunk를 편다(지금
  `apply_patch` 갈래와 같은 규칙 — 항목 하나라도 모양이 다르면 세부 전체를 버린다). `status`가 `added`/`deleted`류인지는 plan
  0단계에서 값을 모은다. 이전 내용은 여전히 없다(`beforeMissing: 'unavailable'`).
- **FR-19 (쓰기)** v2 쓰기에는 새 파일 표식이 없다. 세부는 경로(입력의 `path`)와 `operation: 'overwrite'`·hunk 없음으로 싣는다.
  **출력 글자로 새 파일을 판정하지 않는다**(문구가 바뀌면 조용히 틀린다). 대가: 2.x의 새 파일이 "덮어씀"으로 보인다(§5의 2).
- **FR-20 (`execute`)** `execute`의 결과는 `metadata.metadata.error === true`면 **실패**다(`status`가 `completed`여도). 입력의
  `code`가 입력으로 보인다. 안쪽 호출(`toolCalls`)은 그리지 않는다.
- **FR-21 (읽기 원문)** `read`의 원문은 지금처럼 싣지 않는다. v2는 같은 글이 `metadata.content`에도 있다 — 세부로 옮기지 않는다.
- **FR-22 (거부 공지)** v2의 자동 거부 문구(0-3)로 시작하는 실패는 지금과 같은 공지(`권한 때문에 막힘: <도구> (묻는 권한은
  헤드리스에서 자동으로 거부됩니다)`)다. 문구는 상수이고 테스트가 `probes/`의 원문으로 고정한다. deny 규칙은 도구를 지우므로
  공지가 없다.

### 설정 화면

- **FR-23 (CLI 상태)** 실행 파일 줄은 지원 범위의 2.x에서 초록이고 버전을 보인다. 인증 줄은 `No authenticated integrations`를
  "로그인 필요"로, 그 밖에 읽지 못한 출력은 지금처럼 "확인 불가"로 둔다(막지 않는다). 모델 목록은 그대로 읽는다. 전부 FR-11을
  따른다.

### 테스트

- **FR-24 (진짜 CLI)** `ONE_DESK_REAL_CLI=1 pnpm test realOpencode`가 v2에서 다음을 본다(어댑터의 `buildCommand`·권한 함수로
  띄운다 — 손으로 쓴 인자가 아니다). 실행 파일은 환경변수로 고른다. **1~7은 2.3.2로 돈다.** 2.0.18로는 셋을 본다 — 실행 직전
  확인이 읽기 전용·편집 허용을 FR-8a의 문장으로 막는다, 전체 허용은 돌고 셸·파일 생성이 된다, 전체 허용에서 one-desk MCP 도구가
  `execute`가 아니라 직접 불린다.
  1. 읽기 전용: 셸을 돌리고 파일을 만들라는 지시에 둘 다 일어나지 않는다.
  2. 같은 지시, 프로젝트가 최상위 `permissions`로 allow.
  3. 같은 지시, 프로젝트가 `agents.build.permissions`로 allow (0-1의 구멍).
  4. 같은 지시, 프로젝트가 `default_agent`로 느슨한 agent를 지정 (0-1의 구멍).
  5. 편집 허용: 파일은 만들고 셸은 못 돌린다.
  6. 읽기 전용에서 one-desk MCP 도구를 부른다(지금 있는 테스트의 v2판).
  7. 실행 직전 확인이 3·4의 프로젝트에서 통과하고(우리 규칙이 뒤에 있다), 환경변수의 `agents.build`를 뺀 변이에서 실패한다.
- **FR-25 (단위)** 파서·세부는 `probes/out-*.jsonl`의 원본 줄을 픽스처로 쓴다. v1 테스트는 그대로 통과한다. 새 판정마다 변이를
  돌려 테스트가 빨개지는지 본다(특히 FR-5의 두 자리 중 하나 빼기, FR-6의 `--agent` 빼기, FR-8의 조건 2 빼기, FR-9의 긍정 확인을
  "ask 없음"으로 되돌리기).
- **FR-26 (e2e)** 가짜 CLI의 기본 시나리오·`--version` 동작은 그대로다. v2 방언의 e2e는 가짜 CLI가 `ONE_DESK_FAKE_OPENCODE_VERSION`
  같은 스위치가 있을 때만 버전을 찍게 해서 한 시나리오(첫 턴 + 이은 턴, 대화록의 셸·편집 줄)를 본다. FR-9 때문에 가짜
  `debug config`가 받은 권한을 되돌려 줘야 한다 — 지금 무엇을 찍는지 plan에서 확인한다(§6의 6).

### 비기능

- **NFR-1** 방언은 `core/runner/adapters/opencode*.ts`·`core/runner/permission.ts`·`core/mcp/configFile.ts` 밖으로 나가지 않는다.
  manager·실행 서비스는 방언 값을 **나르기만** 한다.
- **NFR-2** 실행 한 번에 더 띄우는 프로세스는 v2에서 `debug agents` 하나(이으면 세션 확인 하나 더)다. v1은 지금과 같다.
- **NFR-3** 권한을 못 확인한 실행은 시작하지 않는다(실패가 열림보다 낫다). 조용히 낮추거나 넘어가지 않는다. 예외가 없다 —
  확인할 길이 없는 바이너리는 막을 것이 없는 단계(전체 허용)만 돈다(FR-8a).
- **NFR-4** 마이그레이션·IPC·스키마 변경 없음.

## 4. 문서

- CLAUDE.md: 현재 상태 절에 한 단락, 함정 절의 "OpenCode 2.x CLI는 preflight가 막는다"를 "지원 범위 밖만 막는다"로, "OpenCode는
  설정을 병합하고…"에 v2의 순서(0-1)와 두 자리 규칙을 더한다.
- `conversation-fixes` spec FR-17에 이 spec을 가리키는 개정 한 줄.
- `docs/releases/<태그>.md`: 2.x 지원, 최소 2.3.2.

## 5. 우려

1. ~~`skill` 도구가 `* deny`에서도 남는다~~ — 닫음(plan §0): 도구는 보이지만 실제 skill을 싣지 못한다(`skill:error`). 아래는 닫기
   전의 글이다. 실측은 없는 skill의 실패뿐이다. skill을 싣는 것은 글을 읽는 것이라 파일을 고치지
   못하지만, 읽기 전용의 뜻("이름 댄 것만 있다")과 어긋난다. plan 0단계에서 실제 skill이 실리는지 보고, 실리면 `skill * deny`를
   규칙 끝에 명시해 다시 잰다. 그래도 남으면 대가로 적고 받는다.
2. **2.x의 새 파일이 "덮어씀"으로 보인다**(FR-19). CLI가 표식을 주지 않는다. 편집 diff 화면에는 영향이 없다(쓰기에는 hunk가 없다).
3. ~~전체 허용에서 MCP 도구가 `execute` 한 줄로 보인다~~ — `codemode: false`로 풀렸다(FR-13, 두 버전 실측). 사용자가 다른 MCP
   서버를 자기 설정에 달아 두었으면 그 서버의 도구는 전체 허용에서 `execute` 줄로 보인다(FR-20이 그 줄을 그린다).
4. **2.0.18(실행 직전 확인을 못 하는 2.x)은 전체 허용만 돈다 (FR-8a) — 2026-11-19 사용자 결정.** 버린 안은 "확인 없이 세 단계
   다 돌리기"다: 실측한 네 경우에서 구성(두 자리 + agent 고정)이 구멍을 막았지만, 우리가 모르는 순서의 놀람(전역 설정·플러그인·
   agent 파일이 규칙을 뒤에 붙이는 길)이 있으면 읽기 전용 run이 조용히 열린 채 돈다. 이 앱에서 읽기 전용은 "파일을 못 고친다"는
   약속이라, 확인 없이 그 약속을 하는 자리를 만들지 않는다. 대가: **데스크톱 번들 CLI(2.0.18)로는 읽기 전용·편집 허용 대화를 못
   한다.** 데스크톱 앱을 2.3.2로 올리면 풀린다(winget에 `Anomaly.OpenCode.Desktop` 2.3.2 — 그 번들의 CLI가 `debug agents
   --standalone`을 받는지는 재지 않았다). workspace의 기본 권한이 읽기 전용·편집 허용인 사람은 2.0.18을 잡으면 실행마다 그
   문장을 본다 — 설정 화면의 안내(FR-8a)가 그것을 미리 말한다.
5. **2.x는 빨리 바뀐다**(2.0.18 → 2.3.2 사이에 `--session`의 뜻과 `--archived`가 달라졌다). FR-8·FR-9의 긍정 확인이 "권한이 안
   걸린 채 도는" 쪽을 막지만, 스트림 모양이 바뀌면 화면의 세부만 조용히 빠진다(요약·출력은 남는다).
6. **데이터 폴더를 1.x와 같이 쓴다.** 한 장비에서 두 버전을 번갈아 쓰면 세션 DB를 서로 건드린다. 실측에서는 2.x 뒤에 1.18.30이
   돌았다. one-desk가 풀 문제는 아니고 릴리스 노트에 적는다.

## 6. plan 0단계에서 잴 것

모델 호출이 필요한 것은 `opencode/big-pickle`로 된다(무료, 분당 한도가 있어 한 번에 몰아 돌리지 않는다).

1. `OPENCODE_CONFIG`(파일)가 2.3.2에서 `mcp.servers`를 읽는가, 그 파일의 순서상 자리. 안 되면 `OPENCODE_CONFIG_DIR`.
2. 1.x의 `list`·`lsp`·`todowrite`에 해당하는 2.x 도구·action 이름(전부 allow로 돌린 도구 목록에서).
3. 세션이 있는지 묻는 가장 싼 명령과 그 출력.
4. `auth list`·`models`·`--version`·`debug agents`가 `--standalone` 없이 서비스를 띄우는가, `--standalone`을 받는가.
5. `skill`이 deny 아래에서 실제 skill을 싣는가(§5의 1). (`codemode: false`는 spec 단계에서 쟀다 — 0-2.)
6. 가짜 CLI(`fake-opencode.mjs`·e2e의 `fake-claude.mjs`)가 `debug config`·`debug agents`에 무엇을 찍는가.
7. 편집 `files[].status`의 값들(새 파일·삭제), `apply_patch`에 해당하는 2.x 도구의 세부.
8. 취소: one-desk의 `terminate`로 도는 v2 run을 멈춘 뒤 남는 프로세스(0-4는 손으로 부른 `taskkill`이었다), 앱 종료 경로.
9. 로그인된 `auth list`의 모양(자격 증명이 생기면).
10. 2.0.18: `--session`에 없는 id를 줬을 때, 세션 확인 명령(3)이 `--standalone`으로 되는가, `OPENCODE_CONFIG` 파일(1), `auth list`·
    `models`가 서비스를 띄우는가(4). 2.0.18에서 서비스 없이 못 하는 조회는 설정 화면에서 "확인 불가"로 둔다.

## 7. 성공 기준

intent의 성공 기준 그대로이고, 다음을 더한다.

- FR-24가 2.3.2(일곱 가지)와 2.0.18(세 가지)에서 통과한다.
- 2.0.18에서 읽기 전용으로 실행하면 agent 프로세스를 띄우기 전에 FR-8a의 문장으로 실패한 턴이 되고(지금 `ask` 검사가 실패하는
  것과 같은 자리 — run 행은 생긴 뒤다), 전체 허용은 돈다.
- 2.x 바이너리를 v1 방언으로 띄우려 하면(버전을 못 읽은 것을 흉내) 실행 직전 확인이 막는다.
- one-desk로 OpenCode 대화를 한 번 돌린 뒤 `opencode.exe`가 하나도 남지 않는다(백그라운드 서비스 포함).
