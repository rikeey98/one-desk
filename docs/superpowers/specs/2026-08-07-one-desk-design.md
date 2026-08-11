# one-desk 설계 문서

작성일: 2026-08-07

## 1. 문제

여러 갈래의 업무를 동시에 진행할 때, 필요한 것들이 서로 다른 도구에 흩어져 있다. 터미널 창 수십 개, 메모 앱 여러 개, 편집기 여러 개, 브라우저 탭 여러 개. 무언가를 시작하려면 먼저 흩어진 맥락을 머릿속에서 다시 모아야 하고, 그 비용이 실제 작업보다 커진다. 그 결과 무엇을 하려다 빠뜨리고, 결국 아무것도 진전되지 않는다.

CLI 형태의 코딩 agent는 이 문제를 부분적으로 덜어주지만, 새로운 문제를 만든다. agent에게 배경을 설명하려면 매번 같은 내용을 다시 써야 하고, agent가 낸 결과는 터미널 스크롤 안에만 남는다. 여러 개를 동시에 돌리면 어느 창에서 무엇이 끝났는지 확인하려고 창 사이를 옮겨 다니게 된다.

## 2. 목표

작업에 필요한 맥락 — repo, 이슈, 메모, skill, agent 정의 — 을 한 곳에 모으고, 그중 필요한 것을 클릭으로 골라 CLI agent에게 넘긴다. agent는 앱이 직접 실행하고, 실행 기록과 결과는 앱의 구조화된 데이터로 남는다. 여러 개가 동시에 돌아가더라도 "지금 내 손이 필요한 것"이 한 곳에 모여서, 결과를 놓치거나 찾아다닐 일이 없다.

### 선행 버전에서 배운 것

이전 버전은 앱 안에 터미널을 넣고 사용자가 거기서 직접 agent를 실행하는 방식이었다. 이 구조에서는 앱과 agent 사이의 통로가 MCP뿐이어서 세 가지가 막혔다.

1. 실행 **전에** 맥락을 자동으로 주입할 수 없었다. 매번 사람이 설명하거나 복사해 붙여야 했다.
2. 실행 **결과**를 앱의 데이터로 되돌리려면 agent가 MCP 도구를 호출해주기를 기다려야 했다.
3. 앱이 실행 자체를 제어할 수 없었다. 동시 실행, 중단, 스케줄링이 모두 사용자의 수동 조작에 묶였다.

이번 버전은 터미널을 없애고 앱이 agent 프로세스를 직접 소유한다.

## 3. 범위

### 이번 스펙에 포함

- workspace 생성 및 전환
- workspace에 로컬 디렉토리(repo) 등록
- issue, memo 작성 및 repo 태깅
- skill / agent 정의 등록 (파일 스캔 + 앱 자체 작성)
- GUI에서 맥락을 선택해 Claude Code 또는 OpenCode를 헤드리스로 실행
- 실행 중 로그 실시간 표시, 동시 실행
- MCP를 통해 agent가 issue/memo를 읽고 쓰기
- 결과 인박스 및 후속 처리
- 세션 이어서 실행

### 이번 스펙에서 제외

- **자율 실행 / 스케줄링.** "이슈만 등록하면 주기적으로 agent가 알아서 처리"는 별도 스펙으로 다룬다. 다만 이번 설계는 그 확장을 막지 않도록 구성한다 (섹션 4의 `core/` 분리 규칙 참고).
- Claude Code, OpenCode 외의 agent 지원
- 팀 공유, 동기화, 원격 접속
- OS 레벨 알림

## 4. 아키텍처

### 프로세스 구성

Electron main 프로세스가 단일 백엔드 역할을 한다. SQLite, agent 프로세스 오케스트레이션, 로컬 MCP 서버를 모두 소유한다. 렌더러는 Vite + React이며 UI만 담당한다.

```
one-desk/
├─ electron/
│  ├─ main.ts        앱 생명주기, 윈도우, IPC 등록
│  ├─ preload.ts     contextBridge로 OneDeskClient 노출
│  └─ ipc/           core 호출을 감싸는 얇은 핸들러
├─ core/             Electron 비의존
│  ├─ db/            SQLite 연결, 마이그레이션, 리포지토리
│  ├─ context/       선택 항목 → 프롬프트 조립
│  ├─ runner/        agent 어댑터, 프로세스 관리, 스트림 파싱
│  └─ mcp/           로컬 HTTP MCP 서버
├─ renderer/         Vite + React
└─ shared/           core ↔ renderer 공용 타입
```

### 규칙 1 — `core/`는 `electron`을 import하지 않는다

이 규칙이 두 가지를 보장한다. 첫째, `core/`의 모든 로직을 Electron 없이 순수 Node로 테스트할 수 있다. 둘째, 자율 실행이 필요해지는 시점에 `core/`를 그대로 별도 데몬 프로세스로 옮길 수 있다. 이 규칙이 깨지면 그때 처음부터 다시 짜야 한다.

빌드 시 `core/` 디렉토리에서 `electron` import를 금지하는 린트 규칙으로 강제한다.

### 규칙 2 — 렌더러는 전송 계층을 모른다

`shared/`에 `OneDeskClient` 인터페이스를 정의하고, 렌더러는 오직 이 인터페이스만 사용한다. 현재 구현체는 IPC를 쓰지만, 나중에 데몬 구조로 가면 HTTP 구현체로 갈아끼우기만 하면 된다. 렌더러 코드는 그대로 남는다.

```ts
interface OneDeskClient {
  workspaces: { list(): Promise<Workspace[]>; create(...): Promise<Workspace>; /* … */ }
  issues:     { list(q: IssueQuery): Promise<Issue[]>; /* … */ }
  runs:       { start(spec: RunSpec): Promise<Run>; cancel(id: string): Promise<void>; /* … */ }
  events:     { onRunEvent(cb: (e: RunEvent) => void): Unsubscribe }
}
```

렌더러는 `nodeIntegration: false`, `contextIsolation: true`로 동작한다. DB 접근도, node 모듈 import도 구조적으로 불가능하다.

### 이벤트 흐름

단방향으로 흐른다.

```
core/runner (EventEmitter)
    → electron/ipc (webContents.send)
        → renderer (구독만)
```

데몬화 시점에 바뀌는 곳은 중간 한 지점뿐이다.

### 기술 선택

- **패키지 매니저 / 테스트**: pnpm + Vitest
- **빌드**: electron-vite (개발·빌드) + electron-builder (배포)
- **DB**: better-sqlite3 + Drizzle ORM. 동기 API라 IPC 핸들러에서 다루기 쉽고, Drizzle이 타입 안전한 쿼리와 마이그레이션을 제공한다. 네이티브 모듈이므로 `electron-rebuild` 설정이 초기 세팅에 필요하다.
- **렌더러**: Vite + React.

렌더러에 Next.js를 쓰지 않기로 한 이유를 남겨둔다. 초기 구상은 Next.js였으나 두 가지가 걸렸다.

첫째, electron-vite는 렌더러를 Vite 기반 + `index.html` 진입점으로 전제한다. Next.js는 자체 빌드 파이프라인을 갖고 있어 이 자리에 들어가지 않으며, 병행하려면 빌드 파이프라인 두 개와 dev/prod 로딩 분기를 떠안아야 한다.

둘째, 그 비용을 치르고 얻는 것이 없다. 이 앱의 화면은 사이드바 + 메인 + 하단 도크의 단일 레이아웃이라 파일 기반 라우팅이 쓰일 곳이 없고, 데스크톱 앱이므로 SSR·서버 컴포넌트·API routes·이미지 최적화가 모두 비활성이거나 무의미하다. 남는 역할은 React 빌드 도구뿐인데, Electron 환경에서는 Vite가 그 역할을 더 잘한다.

React 컴포넌트 코드 자체는 어느 쪽이든 동일하므로, 나중에 웹 배포가 필요해지면 그 시점에 옮기는 비용이 크지 않다.

## 5. 데이터 모델

```
workspace ──┬── repo            로컬 디렉토리 (git 여부 무관)
            ├── issue           ──┐
            ├── memo            ──┼── repo 태그 (N:M)
            ├── asset           ──┘  kind: skill | agent
            └── run                  실행 기록
```

### 테이블

```sql
workspace(
  id, name, description,
  default_agent_kind,     -- 'claude-code' | 'opencode'
  default_model_claude,   -- 예: 'sonnet'
  default_model_opencode, -- 예: 'anthropic/claude-sonnet-4-5'
  default_permission,     -- 'read_only' | 'edit' | 'full'
  claude_path,            -- NULL이면 PATH에서 탐색
  opencode_path,
  created_at, updated_at
)

repo(
  id, workspace_id, name,
  path,                   -- 로컬 절대 경로
  description, sort_order, created_at
)

issue(
  id, workspace_id, title, body,
  status,                 -- 'open' | 'doing' | 'done'
  created_at, updated_at, closed_at
)

memo(id, workspace_id, title, body, created_at, updated_at)

issue_repo(issue_id, repo_id)
memo_repo(memo_id, repo_id)

asset(
  id, workspace_id,
  kind,                   -- 'skill' | 'agent'
  source,                 -- 'discovered' | 'authored'
  name, description,
  repo_id,                -- discovered일 때 발견된 repo
  file_path,              -- discovered일 때 경로
  content,                -- authored일 때 본문
  last_seen_at, created_at
)

run(
  id, workspace_id,
  agent_kind, model, cwd,
  permission,             -- 이 run이 실제로 사용한 권한
  user_prompt,            -- 사용자가 입력한 원문
  assembled_prompt,       -- 맥락이 합쳐진 최종 프롬프트
  status,                 -- 'pending' | 'running' | 'succeeded'
                          -- | 'failed' | 'canceled' | 'interrupted'
  external_session_id,    -- Claude/OpenCode가 발급한 세션 id
  parent_run_id,          -- 이어서 실행한 경우 원본 run
  result_text,            -- 최종 응답 요약 ([NEEDS_ANSWER] 표식은 제거된 상태)
  needs_answer,           -- agent가 사용자 결정을 요청하고 종료했는가. 섹션 7 참고
  timeout_ms,             -- NULL이면 무제한
  exit_code, error_message,
  log_path,               -- logs/<run_id>/stream.jsonl
  reviewed_at,            -- 사용자가 인박스에서 내린 시각. NULL이면 인박스에 남음
  reviewed_kind,          -- 'confirmed' | 'archived'
  started_at, ended_at, created_at
)

run_context_item(run_id, item_type, item_id)
                          -- item_type: 'repo' | 'issue' | 'memo' | 'asset'

run_file_change(run_id, file_path, change_type, before_path, suspect)
                          -- change_type: 'created' | 'modified' | 'deleted'
                          -- before_path: 스냅샷된 원본 파일 위치.
                          --   created인 경우 NULL
                          -- suspect: 원본 보존을 확신할 수 없음. 섹션 10 참고

app_setting(key, value)   -- 앱 전역 설정. 동시 실행 상한 등
```

모델 기본값을 agent별로 나눈 이유는 두 CLI의 모델 지정 형식이 다르기 때문이다. Claude Code는 `sonnet` 같은 별칭을 쓰고 OpenCode는 `provider/model` 형식을 쓴다. 컬럼 하나에 담으면 agent를 바꿨을 때 상대에게 유효하지 않은 문자열이 전달된다.

### 파일 저장 위치

DB와 로그는 Electron의 `app.getPath('userData')` 아래에 둔다.

```
<userData>/
├─ one-desk.db
└─ logs/
   └─ <run_id>/
      ├─ stream.jsonl      정규화된 실행 이벤트
      └─ before/           수정 전 파일 스냅샷
```

`core/`는 이 경로를 인자로 받는다. `app.getPath`를 직접 호출하면 섹션 4의 규칙 1을 위반한다.

### 설계 판단

**issue와 memo는 workspace가 소유하고, repo 연결은 N:M 태그다.** 하나의 이슈가 여러 repo에 걸치는 경우가 실제로 자주 발생하고, 태그가 하나도 없으면 그것이 곧 "workspace 공통" 항목이 된다. 계층 구조로 강제하면 이 두 경우를 모두 표현할 수 없다.

**skill과 agent를 하나의 `asset` 테이블로 합친다.** 둘 다 "run에 첨부하는 프롬프트 재료"라는 점에서 UI에서도 맥락 조립에서도 동일하게 다뤄진다. 실행 시점의 취급 차이(예: OpenCode의 `--agent` 플래그)는 어댑터가 `kind`를 보고 판단한다.

**`discovered` asset의 본문은 DB에 저장하지 않는다.** 경로와 메타데이터만 기록하고, 본문은 실행 시점에 디스크에서 읽는다. 파일이 수정되어도 항상 최신이 반영된다.

스캔 대상 경로는 다음과 같다. 각 repo의 루트를 기준으로 하며, 스캔은 repo 등록 시와 사용자가 새로고침을 누를 때 수행한다.

| kind | 경로 |
|---|---|
| skill | `.claude/skills/*/SKILL.md` |
| agent | `.claude/agents/*.md` |
| agent | `.opencode/agent/*.md` |

각 파일의 YAML frontmatter에서 `name`과 `description`을 읽어 목록에 표시한다. frontmatter가 없으면 파일명을 이름으로 쓰고 설명은 비워둔다. 파일이 사라진 asset은 삭제하지 않고 "없음" 표시만 하며, `last_seen_at`으로 판단한다. 삭제해버리면 그 asset을 첨부했던 과거 run의 기록이 끊긴다.

**`user_prompt`와 `assembled_prompt`를 모두 저장한다.** 나중에 "왜 이렇게 동작했는지"를 추적하려면 agent가 실제로 받은 것이 필요하고, 사용자에게 보여주거나 재사용할 때는 원문이 필요하다.

**실행 로그는 DB가 아니라 파일에 쓴다.** agent 실행 한 번에 수천 개의 스트리밍 이벤트가 발생한다. 이를 모두 SQLite에 넣으면 DB가 빠르게 비대해지고 쓰기 부하가 커진다. `logs/<run_id>/stream.jsonl`에 append하고, DB의 `run` 행에는 로그 경로와 결과 요약, 종료 코드만 저장한다.

#### `run_context_item`에는 cascade를 적용하지 않는다

1단계의 외래키는 전부 `ON DELETE cascade`다. workspace를 지우면 그 안의 repo·issue·memo가 함께 사라지는 것이 맞기 때문이다.

**`run_context_item`은 예외다.** 같은 관례를 적용하면 이슈를 지웠을 때 그 이슈를 첨부했던 과거 run의 기록이 조용히 사라진다. run 기록은 "무엇을 근거로 이 작업을 시켰는가"의 증거이고, 근거가 된 항목이 지워졌다고 증거까지 지울 이유가 없다.

`ON DELETE SET NULL`로 두고 `item_id`를 nullable로 만든다. 화면에서는 "삭제된 이슈"로 표시한다. 무엇이 첨부됐었는지는 `item_type`과 run의 `assembled_prompt`에 남아 있다.

## 6. Agent 실행 파이프라인

### 흐름

```
[실행 패널]  agent · 모델 · 작업 디렉토리 · 권한 · 프롬프트 · 맥락
     ↓
[context]   선택 항목을 구조화된 프롬프트로 조립
     ↓
[mcp]       run 전용 토큰 발급 → MCP 설정 생성
     ↓
[runner]    어댑터가 커맨드 조립 → 프로세스 spawn
     ↓
[stream]    stdout JSONL 파싱 → 정규화 이벤트 ─┬→ 렌더러 실시간 표시
                                              ├→ logs/<run_id>/stream.jsonl
                                              └→ 파일 수정 감지 시 원본 스냅샷
     ↓
[완료]      status · result_text · session_id · 변경 파일 목록 저장
```

### 실행 단위

실행 단위는 **자유 프롬프트에 맥락을 첨부한 것**이다. 이슈는 첨부 가능한 항목 중 하나일 뿐, 실행의 필수 조건이 아니다. 조사, 질문, 일회성 작업처럼 이슈로 만들 만하지 않은 일이 실제 사용의 상당 부분을 차지하기 때문이다.

### 맥락 조립

선택된 항목들은 구조화된 태그 형식으로 프롬프트 앞에 붙는다.

```xml
<context>
  <repos>
    <repo name="api-server" path="/Users/…/api-server">설명</repo>
  </repos>
  <issues>
    <issue id="42" status="doing" repos="api-server">
      <title>인증 토큰 만료 버그</title>
      <body>…</body>
    </issue>
  </issues>
  <memos>…</memos>
  <skills>
    <skill name="release-checklist">…본문…</skill>
  </skills>
  <agents>…</agents>
</context>

<task>
사용자가 입력한 프롬프트
</task>
```

자연어로 풀어쓰는 것보다 경계가 명확해서, agent가 "어디까지가 배경이고 어디부터가 지시인지"를 혼동하지 않는다. `discovered` asset의 본문은 이 시점에 디스크에서 읽는다.

시스템 프롬프트에는 one-desk MCP 도구의 존재와 사용 지침을 덧붙인다 (Claude Code는 `--append-system-prompt`).

### 어댑터

어댑터는 두 가지 일만 한다: 커맨드 조립과 이벤트 정규화.

```ts
interface AgentAdapter {
  kind: AgentKind
  preflight(): Promise<PreflightResult>          // 실행 파일 존재 확인
  buildCommand(spec: ResolvedRunSpec): SpawnSpec // cmd, args, env, mcp config
  parseLine(line: string): RunEvent[]            // 정규화. 없으면 빈 배열
}
```

`parseLine`이 배열을 반환하는 이유는 실측 때문이다. Claude Code의 `assistant` 이벤트 하나에 텍스트 블록과 도구 호출 블록이 함께 담겨 오므로, 한 줄이 여러 개의 정규화 이벤트로 갈라진다. 반환 타입을 단일 값으로 잡으면 그중 하나를 버리게 된다.

정규화된 이벤트는 다음 여섯 가지다.

| 이벤트 | 내용 |
|---|---|
| `session` | 외부 세션 id 확보 |
| `text` | agent의 텍스트 출력 |
| `tool_use` | 도구 호출 (이름, 입력) |
| `tool_result` | 도구 결과 (성공 여부) |
| `error` | 오류 |
| `result` | 최종 결과 및 종료 |

모든 이벤트는 run 내에서 단조 증가하는 `seq`를 갖는다. UI의 리스트 key, 중복 제거, 순서 보장에 쓰인다.

`tool_use` 이벤트에는 CLI별 원본 도구 이름과 별도로 **어댑터가 판정한 `effect`와 `targetPaths`를 담는다.** `effect`가 `'write'`이면 `targetPaths`의 파일들이 스냅샷 대상이다. 도구 이름은 CLI마다 다르므로(`Edit` vs `edit`) 이름을 보고 판정하는 로직이 runner에 있으면 "UI와 저장 로직은 agent 종류를 모른다"는 원칙이 깨진다. **어느 도구가 파일을 쓰는지 아는 것은 어댑터의 책임이다.**

UI와 저장 로직은 agent 종류를 알 필요가 없다. 세 번째 agent를 추가할 때도 어댑터 파일 하나만 작성하면 된다.

### 두 CLI의 대응 관계

| | Claude Code | OpenCode |
|---|---|---|
| 헤드리스 실행 | `claude -p` | `opencode run` |
| 스트리밍 JSON | `--output-format stream-json --verbose` | `--format json` |
| 세션 이어하기 | `--resume <id>` | `--session <id>` |
| 원격 MCP | `--mcp-config` | `OPENCODE_CONFIG` 환경변수 + 임시 설정 파일 |

실측으로 확인한 두 가지를 명시해둔다.

**`--output-format stream-json`은 `--verbose` 없이는 실행이 거부된다.** 빠뜨리면 프로세스가 즉시 오류로 종료한다.

**OpenCode에는 `--mcp-config`에 해당하는 플래그가 없다.** 설정 파일에 `mcp` 섹션을 쓰고 `OPENCODE_CONFIG` 환경변수로 그 경로를 지정한다. run마다 임시 설정 파일을 만들어 넘기고 종료 시 삭제한다. 이때 사용자의 전역 설정이 병합되어 `"ask"` 권한이 섞여 들어올 수 있으므로, **생성한 설정이 사용자 설정을 대체하는지 병합하는지를 5단계 착수 전에 반드시 실행 검증한다.** 병합된다면 섹션 7의 "ask 금지" 규칙이 깨진다.

### 동시 실행

`RunManager`가 실행 중인 프로세스를 Map으로 관리한다. 기본 동시 실행 상한은 3이며, 앱 설정에서 변경할 수 있다. 초과분은 `pending` 상태로 대기하다가 슬롯이 나면 FIFO 순으로 시작한다. 상한이 없으면 이슈 몇 개를 던져놓고 머신이 멎는 상황이 실제로 발생한다.

> **상한과 대기열의 위치는 3단계에서 달리 갔다.** 여기 적힌 대로 `RunManager`에 두지 않고 별도의 `core/runner/queue.ts`로 분리했다 — 근거는 `docs/superpowers/specs/2026-08-10-stage3a-run-queue-design.md` §10에 있다. 이 문단의 나머지 결정(기본 3, 앱 전역, FIFO, 초과분은 `pending`)은 그대로다.

상한은 workspace가 아니라 앱 전역에 적용된다. 제약의 근거가 머신의 자원이기 때문이다.

취소는 SIGTERM 후 유예를 두고 SIGKILL. 앱 종료 시 실행 중인 모든 프로세스를 정리한다.

### 세션 이어서 실행

run 상세의 "이어서 실행"은 저장된 `external_session_id`로 `--resume` / `--session`을 붙여 새 run을 만들고, `parent_run_id`로 원본을 가리킨다. 이전 대화 맥락이 이미 세션에 있으므로 맥락은 기본적으로 다시 첨부하지 않으며, 필요하면 추가로 선택할 수 있다.

이어서 실행할 때 **`agent_kind`와 `cwd`는 잠긴다.** 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 다른 조합으로 이어받을 수 없다. **`model`, `permission`, 맥락, 프롬프트는 변경할 수 있다.** 특히 `permission` 변경은 섹션 7이 명시적으로 요구하는 흐름이다 — 권한 부족으로 멈춘 run을 권한을 올려 이어서 실행하는 경우다.

새 세션으로 시작하는 것도 항상 가능하다. 세션이 길어져 맥락이 오염됐을 때 깨끗이 다시 시작할 수단이 필요하다.

## 7. 권한 모델

헤드리스 실행에서 agent가 권한을 물으면 응답할 사람이 없어 프로세스가 그대로 멈춘다. 따라서 권한은 실행 전에 결정되어 설정으로 전달되어야 한다.

### 세 단계

| one-desk | 의미 | Claude Code | OpenCode |
|---|---|---|---|
| 읽기 전용 | 조사·분석. 파일 수정 불가 | 읽기 도구만 화이트리스트 | `{"*":"deny","read":"allow",…}` |
| 편집 허용 | 파일 수정 자동 승인, 그 외 차단 | `--permission-mode acceptEdits` | `{"*":"deny","edit":"allow",…}` |
| 전체 허용 | 모든 도구 자동 승인 | `--permission-mode bypassPermissions` | `--auto` + `{"*":"allow"}` |

기본값은 **편집 허용**이다. 대부분의 작업이 여기 해당하고, 셸 명령까지 무조건 여는 것은 로컬 디렉토리를 다루는 도구에서 위험하다.

### 규칙 — 생성하는 설정에 `ask`를 절대 넣지 않는다

모든 정책이 `allow` 아니면 `deny`로만 떨어져야 한다. 헤드리스에서 `ask`는 곧 무한 대기다. 이 규칙은 테스트로 고정한다.

### 전체 허용 사용

실행 패널의 권한 드롭다운에서 선택하며, **그 run에만 적용된다.** 다음 실행에서는 workspace 기본값으로 돌아간다. workspace 기본값 자체를 전체 허용으로 바꾸려면 설정 화면에서 별도 확인 절차를 거친다.

각 run은 실제로 사용한 권한을 `run.permission`에 기록하므로, 나중에 문제가 생겼을 때 추적할 수 있다.

### agent의 질문 처리

agent의 질문은 두 종류이며 다르게 처리된다.

**권한 질문**은 위 방식으로 원천 차단된다. 차단된 도구를 호출하면 agent는 거부 응답을 받고, "이 작업에는 셸 실행 권한이 필요합니다"와 같은 내용을 결과에 남기고 종료한다. 사용자는 권한을 올려 이어서 실행한다.

**내용 질문**("A와 B 중 어느 쪽으로 할까요?")은 헤드리스의 기본 동작을 그대로 쓴다. agent가 질문을 남기고 run이 종료되면, 그 질문이 `result_text`가 되고 인박스에 `답변 필요` 상태로 올라온다. 사용자가 답을 쓰고 "답하고 이어서"를 누르면 세션이 이어진다.

#### 질문한 run을 어떻게 식별하는가

실제 CLI 출력을 검증한 결과, **agent가 질문을 남기고 끝난 run과 작업을 마치고 끝난 run은 종료 데이터상 구분되지 않는다.** Claude Code의 `result` 이벤트는 두 경우 모두 `subtype: "success"`, `is_error: false`를 반환한다. 따라서 상태를 자동으로 판별할 수단이 없다.

시스템 프롬프트로 표식을 강제해서 해결한다. 맥락 조립 시 다음 지시를 덧붙인다.

> 사용자의 결정이 필요해 작업을 진행할 수 없으면, 최종 응답의 **첫 줄**에 `[NEEDS_ANSWER]` 만 단독으로 출력하고 그 다음 줄부터 질문을 쓸 것. 작업을 마쳤다면 이 표식을 쓰지 말 것.

runner는 `result_text`의 첫 줄이 `[NEEDS_ANSWER]`인지 검사해 `run.needs_answer`를 설정하고, 표식은 제거한 뒤 저장한다. 사용자에게는 표식이 보이지 않는다.

이 방식은 agent가 지시를 따르지 않으면 실패한다. 그때는 `완료 · 미확인`으로 인박스에 올라오므로 **결과를 놓치는 일은 없고, 라벨만 부정확해진다.** 사용자가 결과를 읽고 "이어서 실행"을 누르면 되므로 실질적 손해가 없다. 반대 방향의 오류(질문이 아닌데 표식을 붙임)도 마찬가지다.

프롬프트에 의존하는 판별이 견고하지 않다는 점은 인정한다. 다만 대안(별도 프로브 실행, 구조화 출력 스키마 강제)은 비용이 크고, 실패 시 손해가 라벨 하나에 그치므로 이 정도가 적절한 균형이다.

프로세스를 살려두고 대기시키는 방식보다 이쪽을 택한 이유는, 여러 run이 동시에 도는 상황에서 모달이 튀어나오면 오히려 흐름이 끊기기 때문이다. 질문도 다른 결과와 똑같이 인박스에 쌓이는 편이 일관적이다.

## 8. MCP 서버

`core/mcp`가 HTTP MCP 서버 하나를 `127.0.0.1`의 임의 포트에 띄운다. run을 시작할 때마다 랜덤 토큰을 발급하고, agent에게는 `Authorization: Bearer <token>` 헤더가 포함된 MCP 설정을 전달한다. 토큰은 run 종료와 함께 폐기된다.

### 토큰은 run에 묶인다

서버는 토큰으로부터 "이 호출은 workspace 3의 run 87"임을 알아낸다. 따라서 agent는 자신의 workspace 밖 데이터를 읽을 수도 수정할 수도 없다. 다른 로컬 프로세스가 포트에 접근해도 토큰 없이는 거부된다.

### 도구 목록

```
읽기   list_repos()
       list_issues(status?, repo?)      get_issue(id)
       list_memos(repo?)                get_memo(id)

쓰기   create_issue(title, body, repo_ids?)
       update_issue(id, status?, body?)
       create_memo(title, body, repo_ids?)
       update_memo(id, title?, body?)
```

맥락으로 이미 첨부한 항목을 다시 조회할 수 있어야 하는 이유는 두 가지다. agent가 작업 중 관련된 다른 이슈를 찾아봐야 할 수 있고, 향후 자율 실행에서는 이 읽기 도구들이 진입점이 된다.

### 권한 정책이 도구 노출을 통제한다

읽기 전용으로 실행한 run에는 쓰기 도구를 목록에서 제외한다. 파일은 수정하지 못하는데 이슈 상태는 바꿀 수 있다면 "읽기 전용"이라는 표현을 신뢰할 수 없게 된다.

**이 서버측 필터링은 선택이 아니라 유일한 수단이다.** 실측 결과 Claude Code의 도구 화이트리스트 옵션은 `mcp__*` 도구를 걸러내지 못한다. 따라서 MCP 도구의 노출 범위는 우리 서버가 토큰을 보고 결정하는 수밖에 없다. 토큰이 읽기 전용이면 도구 목록 응답에서 쓰기 도구를 빼고, 그럼에도 호출이 들어오면 거부한다. 목록에서 빼는 것만으로는 부족하다 — 도구 이름을 추측해 직접 호출할 수 있기 때문이다.

한편 **`--permission-mode`는 MCP 도구를 자동 승인하지 않는다.** `acceptEdits`로 실행해도 MCP 도구 호출은 미승인으로 거부된다. 커맨드 조립 시 `--allowedTools`에 MCP 서버를 서버 단위로 명시해 승인해야 한다. 이것을 빠뜨리면 agent가 issue/memo를 전혀 수정하지 못하며, 실패가 조용해서 원인을 찾기 어렵다.

### 감사 기록

모든 MCP 호출은 run 로그(JSONL)에 기록된다. "이 이슈가 왜 done이 되었는가"를 추적하면 "run 87이 `update_issue`를 호출했고, 그 run은 이런 프롬프트로 시작했다"까지 거슬러 올라갈 수 있다.

## 9. UI 구조

### 전체 레이아웃

```
┌────────────┬──────────────────────────────────────────────┐
│ 📥 받은결과 │  사내 플랫폼   [repo 3] [open 7]      ▶ 실행  │
│  ③        ├──────────────────────────────────────────────┤
│            │  ┌ api-server ┐┌ web-client ┐┌ infra ┐ + repo │
│ WORKSPACES │  └────────────┘└────────────┘└───────┘        │
│ 사내플랫폼② ├────────────┬────────────┬───────────────────┤
│ one-desk ① │  ISSUES    │  MEMOS     │  SKILLS / AGENTS  │
│ 개인실험실  │  …         │  …         │  …                │
│            ├────────────┴────────────┴───────────────────┤
│            │ [●run 87] [●run 88] [◷run 89] [+ 새 실행]    │
│            │ → Edit src/auth/token.ts (+12 −4)            │
└────────────┴──────────────────────────────────────────────┘
```

**왼쪽 사이드바**는 인박스 진입점과 workspace 목록만 담는다. 얇게 유지한다.

**메인 상단**은 선택된 workspace 이름, 요약 칩, 실행 버튼.

**repo는 가로 스트립**으로 배치한다. repo는 "읽는 대상"이 아니라 "선택하는 대상"이므로 세로 컬럼 하나를 차지할 이유가 없다. 각 카드에 해당 repo의 이슈 수를 표시하고, 카드를 클릭하면 아래 issue/memo가 그 repo로 필터링된다.

**repo 필터는 태그가 없는 항목(workspace 공통)도 함께 보여준다.** 섹션 5에서 "태그 없음 = 공통"으로 정의했으므로, 공통 항목을 걸러내면 그 정의가 무의미해진다. 필터는 "이 repo에 관련된 것"이지 "이 repo에만 속한 것"이 아니다.

**본문은 3컬럼** — Issues / Memos / Skills+Agents. 제목이 긴 이슈와 메모가 잘리지 않도록 폭을 확보한다.

**하단 도크는 agent 탭**이다. 탭 하나가 run 하나이며, 클릭하면 해당 run의 실시간 로그로 전환된다. 도크는 접어서 숨길 수 있다. 도크에는 현재 workspace의 run만 표시된다.

### 스트리밍 렌더링

run 하나가 수천 개의 이벤트를 내므로, 이벤트마다 React 상태를 갱신하면 화면이 멈춘다. 세 가지로 처리한다.

1. **이벤트는 React 상태 밖의 스토어에 쌓는다.** 컴포넌트는 `useSyncExternalStore`로 구독한다. 배열을 매번 새로 만드는 방식(`setEvents(prev => [...prev, e])`)은 이벤트 수에 대해 제곱으로 비싸진다.
2. **프레임 단위로 묶어 알린다.** 스토어는 이벤트를 받을 때마다 알리지 않고 `requestAnimationFrame`으로 모아서 한 번 알린다.
3. **표시 개수에 상한을 둔다.** 화면에는 최근 N개만 렌더링하고, 전체는 로그 파일에서 열어 본다.

종료된 run의 탭을 다시 열면 `stream.jsonl`을 읽어 같은 스토어를 채운다. **출처가 파일이든 IPC든 스토어 이후의 경로는 동일하므로 표시 컴포넌트는 하나로 유지된다.**

### 실행 구성

실행 패널은 **하단 도크가 확장된 형태**로 열린다. 우상단 `▶ 실행` 버튼과 도크의 `+ 새 실행` 탭이 같은 패널을 연다. 별도 모달을 쓰지 않는 이유는, 모달이 뜨는 순간 뒤의 issue/memo 목록을 클릭해서 맥락을 담을 수 없게 되기 때문이다. 도크 확장 방식은 왼쪽 패널이 계속 살아 있다.

실행하면 패널이 그 run의 탭으로 바뀌고 로그가 흐르기 시작한다.

패널은 네 부분으로 구성된다.

1. **실행 설정** — agent 종류, 모델, 작업 디렉토리, 권한
2. **맥락** — 담긴 항목이 칩으로 표시되며, 각 칩은 개별 제거 가능
3. **지시** — 자유 텍스트
4. **실행** — `⌘↵`

맥락을 담는 방법은 두 가지다. 왼쪽 패널에서 항목을 클릭하거나, 지시문 안에서 `@`를 입력해 자동완성으로 선택한다. **`@`로 넣은 항목도 동일하게 맥락 칩이 된다.** 인라인으로 박힌 참조와 위에 담긴 목록이 따로 관리되면, "지금 무엇이 넘어가는지"를 두 군데서 확인해야 하고 결국 다시 혼란스러워진다.

## 10. 결과 인박스

이 앱의 핵심 기능이다. run의 상태를 표시하는 것만으로는 "결과가 나온 줄 몰라서 확인하러 돌아다니는" 문제가 풀리지 않는다. 필요한 것은 **지금 사용자의 손이 필요한 run만 모인 큐**다.

### 인박스에 들어오는 조건

`reviewed_at IS NULL` 이면서 다음 중 하나인 run:

- **답변 필요** — agent가 질문을 남기고 종료
- **완료 · 미확인** — 정상 종료했으나 사용자가 확인하지 않음
- **실패** — 비정상 종료 또는 오류
- **중단됨** — 앱 강제 종료 등으로 끊김

인박스는 **모든 workspace를 가로지른다.** 여러 repo, 여러 workspace에서 동시에 돌린 결과가 한 리스트로 모인다. 어느 workspace에 처리할 것이 쌓였는지는 사이드바 배지로 보인다.

### 규칙 — run은 "확인함"을 누를 때까지 사라지지 않는다

읽지 않은 메일과 같다. 이 규칙이 있어야 결과를 놓칠 수 없다. 자동으로 사라지면 인박스는 다시 그냥 로그 목록이 된다.

### 상태별 후속 행동

결과를 읽은 뒤 무엇을 할지 다시 판단하는 것 자체가 피로의 원인이므로, 상태별로 다음 수를 미리 제시한다.

| 상태 | 행동 |
|---|---|
| 답변 필요 | 답하고 이어서 · 로그 보기 · 보관 |
| 완료 · 미확인 | 변경 보기 · 이어서 실행 · 관련 이슈 닫기 · 확인함 |
| 실패 | 로그 보기 · 다시 실행 · 이슈로 만들기 · 보관 |
| 중단됨 | 로그 보기 · 다시 실행 · 보관 |

"보관"과 "확인함"은 모두 `reviewed_at`을 설정해 인박스에서 내린다. 두 의도(결과를 받아들였는가, 그냥 치웠는가)는 `reviewed_kind`로 구분해 기록한다. 지금 화면에서 다르게 쓰이지는 않지만, 컬럼을 나중에 추가하면 마이그레이션이 한 번 더 필요하고 그 이전 기록은 복구할 수 없다.

**"관련 이슈 닫기"는 `run_context_item`에 첨부된 이슈가 있을 때만 표시된다.** 첨부 이슈가 여럿이면 각각에 대해 표시한다.

**실패한 run을 이슈로 전환**하는 경로가 특히 중요하다. 실패는 대개 나중에 다뤄야 할 일인데, 그것이 인박스에서 사라지면 그대로 잊힌다.

### 알림

OS 알림은 사용하지 않는다. 앱 내부 표시만으로 처리한다.

- 사이드바 인박스 항목에 전체 미처리 건수
- 사이드바 각 workspace에 해당 workspace의 미처리 건수
- 하단 도크 탭에 run별 상태 아이콘

### 변경 확인 (diff)

"변경 보기"는 앱 안의 diff 뷰어를 연다. 간단한 확인을 위해 편집기를 여는 것 자체가 맥락 전환이기 때문이다.

repo가 git repo가 아닐 수 있으므로 변경 추적은 다음과 같이 한다. **runner가 스트림에서 파일 수정 도구 호출을 감지하면, 해당 파일이 아직 스냅샷되지 않았을 경우 원본을 `logs/<run_id>/before/`에 복사한다.** run 종료 후 before와 현재를 비교해 diff를 생성한다. git 여부와 무관하게 동작한다.

#### 경쟁 조건과 그 처리

이 방식에는 경쟁 조건이 있다. `tool_use` 이벤트가 stdout에 나오는 시점과 agent가 실제로 파일에 쓰는 시점 사이에 동기화가 없다. 우리가 원본을 복사하기 전에 파일이 이미 덮어써질 수 있다.

**더 나쁜 것은 이 실패가 조용하다는 점이다.** 이미 수정된 내용을 "원본"으로 저장하면 diff가 비어 보이고, 사용자는 "agent가 아무것도 안 바꿨다"고 잘못 읽는다. 틀린 정보를 보여주는 것은 정보를 안 보여주는 것보다 나쁘다.

두 가지로 방어한다.

1. **동기 복사.** 스냅샷은 `copyFileSync`로 처리하고 이벤트 루프를 양보하지 않는다. 비동기 복사는 창을 넓힐 뿐이다.
2. **의심 표시.** 복사 직전에 읽은 파일의 mtime이 run 시작 시각보다 나중이면 `run_file_change.suspect`를 세운다. 이 경우 diff 화면에 "이 파일의 원본을 확실히 보존하지 못했습니다"를 명시하고, git repo라면 `git diff` 결과를 우선 표시한다.

즉 **확실하지 않을 때는 확실하지 않다고 말한다.** 조용히 틀린 diff를 보여주지 않는다.

#### 셸 변경

agent가 셸 명령으로 파일을 바꾸면 이 방식으로는 감지되지 않는다. repo가 git repo인 경우 `git diff` 결과를 함께 표시해 이 구멍을 메운다. git repo가 아니면서 셸로 변경된 파일은 추적되지 않으며, 이는 알려진 한계로 남긴다.

## 11. 에러 처리

실패는 조용히 넘어가지 않고 run에 기록된다.

| 상황 | 처리 |
|---|---|
| CLI 실행 파일을 찾을 수 없음 | 실행 전 프리플라이트로 확인하고 실행 버튼 단계에서 차단. workspace 설정에서 경로 직접 지정 가능 |
| repo 경로가 존재하지 않음 | 실행 전 확인. 로컬 디렉토리는 언제든 이동·삭제될 수 있다 |
| 앱 강제 종료 후 남은 run | 앱 시작 시 `running` **또는 `pending`** 상태인 run을 `interrupted`로 정리. 대기 큐는 메모리에만 존재하므로 재시작하면 사라진다. `pending`을 빼먹으면 영원히 시작되지 않는 유령 run이 남는다 |
| 스트림 JSON 파싱 실패 | 해당 줄을 raw 텍스트로 로그에 남기고 계속 진행. 한 줄 때문에 run 전체를 실패시키지 않는다 |
| MCP 포트 충돌 | 임의 포트 사용, 실패 시 재시도 |
| DB 마이그레이션 | 적용 전 DB 파일 백업. 로컬 SQLite 하나에 모든 기록이 들어 있다 |
| agent가 종료하지 않음 | run별 타임아웃 설정(기본 비활성). 초과 시 취소와 동일하게 처리 |

## 12. 테스트 전략

`core/`가 Electron에 의존하지 않는다는 규칙 덕분에 대부분의 테스트가 순수 Node에서 실행된다.

| 대상 | 방법 |
|---|---|
| 맥락 조립 | 입력 항목 → 최종 프롬프트 문자열 스냅샷 테스트. 프롬프트가 의도치 않게 변하는 것을 잡는다 |
| 어댑터 파싱 | Claude Code / OpenCode의 실제 출력을 픽스처로 저장하고 정규화 이벤트와 대조. 두 CLI가 스키마를 변경하면 여기서 걸린다 |
| 권한 설정 생성 | 생성된 모든 설정에 `ask`가 없음을 검증 |
| runner 생명주기 | 진짜 CLI 대신 **가짜 CLI 스크립트**(JSON 몇 줄을 출력하고 종료하는 셸 스크립트) 사용. 동시 실행 상한, 대기 큐, 취소, 타임아웃을 실제 agent 호출 없이 빠르게 검증 |
| MCP 서버 | HTTP 요청을 직접 전송해 "다른 run의 토큰으로 타 workspace 데이터에 접근되는가"를 검증. 보안 경계이므로 반드시 테스트로 고정 |
| 인박스 조건 | 상태 조합별로 인박스 포함 여부 검증 |
| DB | 인메모리 SQLite로 리포지토리 계층 테스트 |
| UI | `OneDeskClient`를 목으로 대체해 Electron 없이 렌더링 테스트 |

## 13. 구현 순서

이 스펙은 한 번에 구현하기에 크다. 아래 순서로 나누며, **각 단계는 그 자체로 동작하는 앱**이어야 한다. 다음 단계가 없어도 쓸 수 있는 상태로 끝나야 한다는 뜻이다.

**1단계 — 뼈대와 데이터**
Electron + Vite + React 셸, SQLite 연결과 마이그레이션, `OneDeskClient` 인터페이스와 IPC 구현체. workspace / repo / issue / memo의 생성·조회·수정. 섹션 9의 레이아웃(사이드바, repo 스트립, 3컬럼)까지. 이 단계가 끝나면 agent 없이도 쓸 수 있는 메모·이슈 관리 앱이 된다.

**2단계 — 단일 agent 실행**
`AgentAdapter` 인터페이스와 Claude Code 어댑터, 맥락 조립, 프로세스 spawn과 스트림 파싱, 하단 도크와 실시간 로그. 동시 실행 없이 한 번에 하나만.

권한은 이 단계에서 **CLI 플래그 계층까지만** 구현한다. 즉 세 단계가 파일 접근과 셸 실행을 실제로 통제하는 데까지다. 섹션 8의 "권한이 MCP 도구 노출을 통제한다"는 MCP 서버가 존재하는 4단계에서 완성된다.

권한을 2단계와 4단계로 쪼개는 것이 어색해 보이지만, 대안이 더 나쁘다. 권한을 통째로 4단계로 미루면 2·3단계 내내 모든 run이 무제한 권한으로 돌아가고, 그 상태로 실제 코드베이스를 건드리게 된다. 반대로 MCP를 2단계로 당기면 아직 검증되지 않은 어댑터 인터페이스 위에 서버를 얹게 된다.

**2단계 완료 시점에 권한 모델은 의도적으로 부분 구현 상태다.** 4단계 전까지는 MCP 도구가 없으므로 통제할 대상 자체가 없어 실질적 공백은 없다.

**3단계 — 동시 실행과 인박스**
`RunManager`의 상한과 대기 큐, 결과 인박스, 사이드바 배지, 상태별 후속 행동, 세션 이어서 실행. 이 단계가 이 앱의 핵심 가치를 완성한다.

**4단계 — MCP 서버**
HTTP MCP 서버, run 토큰, 도구 구현, 권한 연동. agent가 issue/memo를 직접 수정할 수 있게 된다.

**5단계 — 나머지**
OpenCode 어댑터, asset 스캔, diff 뷰어.

OpenCode 어댑터를 뒤로 미루는 이유는, 어댑터 인터페이스가 실제 사용을 거치며 다듬어진 뒤에 두 번째 구현체를 만드는 편이 낫기 때문이다. 다만 인터페이스 자체는 2단계에서 두 CLI를 모두 염두에 두고 설계한다.

## 14. 향후 확장 (이번 스펙 제외)

**자율 실행.** 이슈를 등록해두면 스케줄러가 주기적으로 가져가 agent를 실행하고 결과를 저장한다. 이때 `core/`를 별도 데몬으로 분리해 앱이 닫혀 있어도 동작하게 한다. 이번 설계의 두 규칙(`core/`의 Electron 비의존, `OneDeskClient`의 전송 계층 추상화)이 이 전환을 기계적인 작업으로 만든다.

**agent 추가.** `AgentAdapter` 구현체를 추가하면 된다.
