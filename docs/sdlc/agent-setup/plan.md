# Plan: agent 준비 상태와 실행 조건(모델·effort)

- 출처: `intent.md`, `spec.md` (2026-09-22 승인)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-22)
- 작성일: 2026-09-22

## spec에서 다듬은 것

spec의 결정을 뒤집지 않고 모양만 맞춘다.

1. **마이그레이션 번호는 `0007`이다.** spec 초안이 `0006`으로 적었으나 그 번호는 `run-info`가
   이미 썼다(`drizzle/0006_naive_dormammu.sql` — `actual_model` 외 9개). spec을 고쳤다.
2. **`core/runner/manager.ts`의 `StartSpec`에도 `effort`가 필요하다.** spec은 어댑터의
   `ResolvedRunSpec`만 적었지만, 실행 경로가 `execution.ts` → `queue` → `manager.start` →
   `buildCommand`라 중간의 `StartSpec`을 지나야 한다. **값을 나르기만 한다 — 판단은 없다.**
3. **인증·모델 목록 조회는 `core/agent/`에 새로 둔다.** `core/commands/probe.ts`는
   **그 자리에 그대로 두고 결과만 넓힌다**(NFR-3). 이름이 약간 어긋나 보이지만
   (agent 서비스가 commands 서비스를 쓴다) **한 번의 CLI 기동이 슬래시 커맨드와 모델을
   함께 주는 것이 핵심**이고, 옮기면 이미 검증된 슬래시 커맨드 경로를 흔든다.
4. **`AgentProbe`에 `executable`을 넣지 않는다.** 그것은 `checkAgents`의 몫이고
   (NFR-4), 두 곳에서 같은 값을 주면 화면이 어느 쪽을 믿을지 모호해진다.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `drizzle/0007_*.sql` | 신규 | 컬럼 셋 추가. `pnpm db:generate`가 만든다 |
| `core/db/schema.ts` | 수정 | `workspace.default_effort_claude`·`default_variant_opencode`, `run.effort` |
| `core/db/repositories/workspace.ts` | 수정 | `updateDefaults`가 두 값을 **더 받는다**(부분 갱신 없음) |
| `core/db/repositories/workspace.test.ts` | 수정 | 두 값의 왕복과 "전부 받는다" 규칙 |
| `core/db/repositories/run.ts` | 수정 | `create`가 `effort`를 저장, `hydrate`가 `Run`에 싣는다 |
| `core/db/repositories/run.test.ts` | 수정 | `effort` 왕복. **기존 "아홉 컬럼이 새지 않는다"는 수정하지 않는다** |
| `core/runner/types.ts` | 수정 | `ResolvedRunSpec.effort` |
| `core/runner/manager.ts` | 수정 | `StartSpec.effort` — 나르기만 한다 |
| `core/runner/adapters/claudeCode.ts` | 수정 | `if (spec.effort) args.push('--effort', spec.effort)` |
| `core/runner/adapters/opencode.ts` | 수정 | `if (spec.effort) args.push('--variant', spec.effort)` |
| `core/runner/adapters/claudeCode.command.test.ts` | 수정 | 붙는다·안 붙는다 |
| `core/runner/adapters/opencode.command.test.ts` | 수정 | 〃 (`--variant`) |
| `core/execution.ts` | 수정 | `effort`를 입력 → 저장 → spec으로 나른다. resume도 |
| `core/execution.test.ts` | 수정 | 배선. resume이 effort를 이어받지 **않고** 새로 받는지 |
| `core/agent/auth.ts` | 신규 | `claude auth status --json` · `opencode auth list`. 던지지 않는다 |
| `core/agent/auth.test.ts` | 신규 | 셋(ok·none·unknown), ANSI 제거, 파싱 실패 |
| `core/agent/models.ts` | 신규 | `opencode models` 조회. 실행 파일마다 캐시 |
| `core/agent/models.test.ts` | 신규 | 캐시 1회, 실패 시 빈 목록 |
| `core/agent/service.ts` | 신규 | 세 칸 합성. **인증이 `none`이면 모델 probe를 부르지 않는다** |
| `core/agent/service.test.ts` | 신규 | FR-1·FR-2·FR-3 |
| `core/commands/types.ts` | 수정 | `ProbeResult`에 `model`·`version` |
| `core/commands/probe.ts` | 수정 | `parseInit`이 둘을 더 꺼낸다. **인자는 한 글자도 안 바뀐다** |
| `core/commands/probe.test.ts` | 수정 | 둘이 실려 오는지, 없으면 null |
| `core/commands/service.ts` | 수정 | 캐시가 둘을 함께 나르도록 결과 타입만 넓힌다 |
| `core/index.ts` | 수정 | `workspaces.probeAgents`. **`checkAgents`는 손대지 않는다** |
| `core/index.test.ts` | 수정 | 배선, FR-5(슬롯·큐·run 불변) |
| `core/runner/fixtures/fake-claude.mjs` | 수정 | init에 `model`·`claude_code_version` |
| `core/runner/fixtures/fake-auth.mjs` | 신규 | 인증 조회용 가짜 CLI(세 갈래를 인자로 고른다) |
| `core/runner/fixtures.test.ts` | 수정 | 새 픽스처의 실행 권한·shebang |
| `shared/models.ts` | 수정 | `AgentAuth`·`AgentModel`·`AgentProbe`·`AgentProbes`, 입력 타입에 `effort` |
| `shared/channels.ts` | 수정 | `workspacesProbeAgents` |
| `shared/client.ts` | 수정 | `workspaces.probeAgents` |
| `electron/ipc/workspaces.ts` | 수정 | 핸들러 한 줄. core 호출만 |
| `electron/preload.ts` | 수정 | 브리지 한 줄 |
| `renderer/models.ts` | 신규 | claude 별칭 표(표시용). `permission.ts`와 같은 성격 |
| `renderer/models.test.ts` | 신규 | 표가 비어 있지 않고 중복이 없다 |
| `renderer/effort.ts` | 신규 | 다섯 단계 + `기본값`(빈 값) |
| `renderer/effort.test.ts` | 신규 | 순서와 빈 값 항목 |
| `renderer/components/ModelField.tsx` | 신규 | 입력 + `datalist` + 해석 결과 줄. 두 화면이 같이 쓴다(FR-11) |
| `renderer/components/ModelField.test.tsx` | 신규 | FR-8·FR-9·FR-10 |
| `renderer/components/AgentStatusList.tsx` | 신규 | 세 칸을 문장으로. `실행` 탭이 쓴다 |
| `renderer/components/AgentStatusList.test.tsx` | 신규 | FR-3의 세 문구가 서로 다르다 |
| `renderer/components/SettingsPanel.tsx` | 수정 | 상태 블록·`다시 확인`·effort/variant 칸 |
| `renderer/components/SettingsPanel.test.tsx` | 수정 | 저장 왕복, 느린 칸이 뒤따라 채워짐 |
| `renderer/components/RunPanel.tsx` | 수정 | effort/variant 칸, `ModelField`로 교체 |
| `renderer/components/RunPanel.test.tsx` | 수정 | agent를 바꾸면 값이 새지 않는다(수용 기준 7) |
| `renderer/index.css` | 수정 | 상태 줄 토큰. **hex 직접 사용 금지** |
| `e2e/agent-setup.e2e.ts` | 신규 | 수용 기준 1·5·6 |

**건드리지 않는 파일(중요).** `core/mcp/`, `core/context/`, `core/runner/queue.ts`,
`core/runner/permission.ts`, `renderer/permission.ts`, `renderer/components/Transcript.tsx`,
`core/assets/`. 권한·맥락 조립·큐·대화록은 이 작업의 범위 밖이다(spec 범위 밖).
**이 목록에 손이 가면 설계가 어긋난 것이다.**

## 작업 순서

각 단계는 **실패를 먼저 확인하고** 구현한다. 회귀 테스트는 대상 코드를 잠시 망가뜨려
실제로 빨개지는지 본다(CLAUDE.md 컨벤션).

1. **마이그레이션 `0007` + 스키마 + 저장소.** `workspace`에 둘, `run`에 하나.
   `updateDefaults`가 여섯 값을 **전부** 받는다(부분 갱신 금지 규칙 유지).
   **완료 확인**: `pnpm db:generate`가 만든 SQL이 `ALTER TABLE ... ADD` 셋뿐이고
   `DROP TABLE`이 없다. 기존 DB 파일을 열어 마이그레이션이 돌고 기존 run 행이 그대로다.
   `updateDefaults`에 다섯 값만 넘기면 타입 오류가 난다.

2. **어댑터 인자.** `ResolvedRunSpec.effort` → claude `--effort`, opencode `--variant`.
   **완료 확인**: `*.command.test.ts`가 값이 있을 때 인자가 `--model` 옆에 붙고, null이면
   **그 인자가 통째로 없는 것**을 각각 확인한다. `if`를 지우면 둘 다 빨개진다.

3. **`StartSpec`·`execution.ts` 배선.** 입력 → `run.create` 저장 → `ResolvedRunSpec`.
   resume도 같은 길로 받는다(agentKind·cwd와 달리 **잠기지 않는다** — 모델과 같은 규칙).
   **완료 확인**: `execution.test.ts`가 (a) 넘긴 effort가 저장되고 (b) 어댑터까지 닿는지
   본다. `execution.ts`의 전달 한 줄을 지우면 빨개진다.

4. **인증 조회 `core/agent/auth.ts`.** 프로세스 기동은 주입받는다 — 그래야 로그아웃하지
   않고도 `none`을 검증할 수 있다(spec 수용 기준 2가 요구한 이음매).
   - claude: `auth status --json`. `loggedIn` 참 → `ok`, 거짓 → `none`, **그 외 전부
     `unknown`**(비정상 종료, JSON 아님, 필드 없음).
   - opencode: `auth list` → ANSI 제거 → `N credentials`. `0` → `none`, `≥1` → `ok`,
     **못 읽으면 `unknown`**.
   **완료 확인**: 여섯 경우(두 CLI × ok·none·unknown)가 각각 다른 상태를 낸다. ANSI가 붙은
   실제 출력 문자열(intent에 실측본이 있다)을 그대로 넣어도 `0`을 읽는다. **`unknown`을
   `none`으로 바꾸면 빨개지는 테스트가 있다.**

5. **`opencode models` 조회 `core/agent/models.ts`.** 실행 파일마다 한 번, 프로세스 수명
   캐시. 실패는 빈 목록이고 **던지지 않는다.**
   **완료 확인**: 두 번 불러도 기동이 1회다. 실패해도 호출자가 살아 있다.

6. **probe 결과 확장.** `parseInit`이 `model`·`claude_code_version`을 더 꺼낸다.
   **인자는 바꾸지 않는다** — 바꾸면 슬래시 커맨드의 실측 근거(`--strict-mcp-config`로
   9개→0개)가 무효가 된다.
   **완료 확인**: `probe.test.ts`에 둘이 실려 오는 케이스와 필드가 없을 때 `null`인 케이스.
   **기존 probe 테스트가 한 글자도 수정 없이 통과한다.**

7. **합성 `core/agent/service.ts` + `workspaces.probeAgents`.** 세 칸을 쌓는다.
   - `preflight` 실패 → 뒤의 둘을 **돌리지 않는다**
   - 인증 `none` → 모델 probe를 **돌리지 않는다**(FR-2), `model.state = 'skipped'`
   - cwd(= workspace 첫 repo)가 없으면 `skipped`
   - 늦게 온 결과가 최신을 덮지 않도록 호출자가 순번을 쥔다
   **완료 확인**: 인증이 `none`인 스텁으로 부르면 **probe 스텁이 한 번도 호출되지 않는다**
   (수용 기준 12). `checkAgents`는 시그니처·동작 모두 그대로이고 기존 테스트가 수정 없이
   통과한다(NFR-4).

8. **shared 타입 + IPC + preload.** 채널 하나, 핸들러 한 줄.
   **완료 확인**: `core/index.test.ts`가 배선을 잡는다. `grep -rn "from 'electron'" core/`가
   비어 있다. 조회를 돌려도 `run` 행 수와 큐 스냅샷이 그대로다(FR-5, 수용 기준 10).

9. **표 둘 — `renderer/models.ts`·`renderer/effort.ts`.** 표시용 상수. `permission.ts`와
   같은 자리·같은 이유(두 화면이 같은 값을 다른 말로 부르지 않게).
   **완료 확인**: effort 표의 첫 항목이 **빈 값(`기본값`)**이고 다섯 단계가 그 뒤에 온다.

10. **`ModelField` 컴포넌트.** 입력 + `datalist` + 해석 결과 줄. **자유 입력을 막지
    않는다** — `datalist`를 고른 것이지 `select`가 아니다.
    **완료 확인**: 목록에 없는 문자열을 쳐도 `onChange`가 그대로 올라온다(FR-8).
    해석 결과 줄의 문구가 "**이 이름으로 넘어갑니다**" 쪽이고 "이 모델로 돕니다"가 아니다
    (FR-10 — spec이 문구를 제약으로 걸었다).

11. **`AgentStatusList` + `SettingsPanel`.** 빠른 칸은 즉시, 느린 칸은 뒤따라. `다시 확인`
    버튼. effort/variant 칸이 **agent에 따라 바뀐다.**
    **완료 확인**: `probeAgents`가 아직 안 온 동안 실행 파일 줄이 이미 보인다(FR-7).
    `none`·`unknown`·`ok` 세 문구가 **서로 다르다**(FR-3). agent를 opencode로 바꾸면
    effort 드롭다운이 사라지고 variant 칸이 나온다.

12. **`RunPanel`.** effort/variant 칸을 붙이고 모델 칸을 `ModelField`로 바꾼다. 기본값은
    workspace에서 오고 **지금 고른 agent에 따라 다른 칸에서** 온다(모델이 이미 그렇다).
    **완료 확인**: claude에 `high`를 넣고 opencode로 바꾸면 variant 칸이 **비어 있다**
    (수용 기준 7). 되돌리면 `high`가 그대로다.

13. **e2e `agent-setup.e2e.ts`.** 설정 화면을 실제로 클릭한다 — 상태 줄이 뜨고, 모델 칸에
    목록에 없는 이름을 넣어 저장하면 그대로 남고, effort를 골라 실행하면 가짜 CLI가 받은
    인자에 `--effort high`가 있다.
    **완료 확인**: 가짜 CLI가 받은 인자를 파일로 남겨 e2e가 읽는다(슬래시 커맨드 e2e가
    stdin을 그렇게 확인한 전례가 있다).

## 리스크

- **`opencode auth list` 파싱이 버전에 묶인다.** 기계용 형식이 없다(intent 실측).
  → 깨지면 `unknown`으로 떨어지게 설계했다. **거짓을 말하지 않는 것**까지가 보장이다.
  4단계의 테스트가 실측 출력 문자열을 그대로 들고 있어 회귀를 잡는다.
- **claude 별칭 표가 낡는다.** → 자유 입력이 남아 **막히지는 않는다**(FR-8). 표 갱신 책임이
  없다는 부채는 spec의 확인 필요 항목에 적혀 있다.
- **설정 화면을 여는 것만으로 `SessionStart` 훅이 돈다.** 실행 패널에서 이미 일어나는
  일이지만 자리가 하나 는다. → 캐시를 공유하므로 같은 cwd에서 두 번 돌지 않는다.
  훅이 무거운 환경에서 문제가 되면 `다시 확인` 버튼 전용으로 좁힌다(spec 확인 필요 항목).
- **이 장비에서 opencode를 끝까지 못 돈다.** 자격 증명 0개다. → `models`·`auth list`
  경로는 실측으로 확인되고, `--variant`를 실은 실행은 **가짜 CLI로 인자 조립까지만** 고정한다.
- **Windows에서 가짜 CLI는 spawn조차 되지 않는다**(CLAUDE.md). → 새 픽스처
  `fake-auth.mjs`를 쓰는 테스트는 **단위 테스트에서 주입**으로 검증하고 e2e에 의존하지
  않는다.
- **`run.effort`가 `Run`에 실려 IPC로 나간다.** 스프레드가 새 컬럼을 흘려보내기 때문이다
  (CLAUDE.md). → **이번에는 의도한 것이다**(`model`과 같은 성격). 다만 `run.test.ts`의
  "아홉 컬럼이 낱개로 새지 않는다"가 이 컬럼 때문에 흔들리지 않는지 확인한다.

## 완료 증명

- [x] `pnpm test` — 1180 통과 / 31 스킵. 기준선(v0.14.0)의 1069에서 **+111**
- [x] `pnpm typecheck` — 오류 0
- [x] `pnpm lint` — 오류 0
- [x] `pnpm test:e2e` — 17 파일 통과 / 2 스킵, `agent-setup.e2e.ts` 4개 포함
- [x] `grep -rn "from 'electron'" core/` — 출력 없음
- [x] `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [x] `drizzle/0007_quick_falcon.sql` — `ALTER TABLE ... ADD` 셋뿐, `DROP TABLE` 0건
- [x] **실제 DB 복사본으로 확인** — 마이그레이션 7→8, run 2행·`run_context_item` 1행·
      asset 9개가 그대로. 과거 run의 `effort`는 전부 NULL(백필 없음)
- [x] `core/mcp/host.ts`·`tools.ts`·`core/context/assemble.ts`·`core/runner/queue.ts`·
      `permission.ts`·`renderer/permission.ts`·`Transcript.tsx` **무변경**
      (MCP 테스트 둘은 spec 헬퍼에 `effort: null` 한 줄씩만)
- [x] `checkAgents`의 시그니처와 동작이 **무변경**이고 그 테스트가 수정 없이 통과
- [x] **변이 검증** — 하나씩 망가뜨려 각각 빨개지는지 확인했다
  - [x] `workspace.ts`의 `defaultEffortClaude` 저장 → 2개 실패
  - [x] 어댑터의 `--effort`/`--variant` 분기 → 3개 실패 (2단계에서 먼저 확인)
  - [x] `execution.ts`가 effort를 `manager.start`로 나르는 줄 → 3개 실패
  - [x] `manager.ts`의 `buildCommand` effort → **typecheck가 막는다**(필수 필드)
  - [x] `probe.ts`의 `model` 추출 → 2개 실패
  - [x] `auth.ts`의 opencode `unknown` 분기(0개로 단정) → 1개 실패
  - [x] `auth.ts`의 claude `unknown` 분기(`none`으로 단정) → 2개 실패
  - [x] `service.ts`의 "인증이 `none`이면 probe를 건너뛴다" → 1개 실패
  - [x] `service.ts`의 "preflight가 실패하면 뒤를 돌리지 않는다" → 1개 실패
  - [x] `RunPanel`의 effort effect에서 `agentKind` 의존성 제거 → 2개 실패
  - [x] `RunPanel`의 `start` 인자 effort → 3개 실패
  - [x] `RunPanel`의 `resume` 인자 effort → **처음엔 살아남았다**(아래 이탈 기록)
- [x] **실제 CLI 확인** — 두 갈래로 했다.
  - core 직접 호출: claude `{state:'ok', method:'claude.ai', plan:'max'}` **204ms**,
    opencode `{state:'none'}` + 안내 **1004ms**, `opencode models` **382개/1464ms**,
    claude 목록 0개(조회 수단 없음)
  - 빌드된 앱을 `agentPath: ''`로 띄워 진짜 CLI를 잡게 하고 화면을 찍었다.
    상태 줄이 `● Claude Code claude-opus-5[1m] / v2.1.278 / 로그인됨 (claude.ai · max)`,
    `○ OpenCode 로그인 필요`와 `opencode auth login` 안내를 보여준다 — **이 장비의 실제 상태(자격 증명 0개)를 정확히 잡아냈고 초록이 아니다.**
    실행 패널은 claude에서 `EFFORT` 드롭다운, opencode로 바꾸면 `VARIANT` 자유 입력으로
    바뀌며 claude의 값이 따라오지 않는다.
- [x] **CLAUDE.md 갱신** — 함정 셋을 적었다: `init`은 인증을 보지 않는다(`apiKeySource`가
      같다), 모델 유효성도 보지 않는다(`gpt-9` 통과), `result.subtype`이 `"success"`인 채로
      `is_error: true`가 온다. `--effort`를 CLI가 검증하지 않는다는 것도 함께 적었다.

## 계획 이탈 기록

- **`core/commands/probe.ts`의 `parseInit`을 내보내고 `parseInit.test.ts`를 새로 뒀다.**
  계획에 없던 파일이다. `probe.test.ts`는 shebang 스크립트를 실행 파일로 직접 spawn하므로
  **Windows에서 통째로 스킵된다**(기존 규칙) — 개발 장비가 Windows라 새 파싱을 한 건도
  검증하지 못하는 상태였다. 순수 함수로 빼면 플랫폼과 무관하게 고정된다
  (`core/app/reveal.ts`가 같은 이유로 순수 함수다).

- **`createCommandService`의 캐시 값이 `CommandListResult`에서 내부 `Entry`로 바뀌었다.**
  계획은 "결과 타입만 넓힌다"고 적었으나, 커맨드 목록과 agent 정보를 **한 캐시에서** 꺼내려면
  캐시가 둘을 함께 들고 있어야 했다. 공개 표면(`list`/`refresh`)의 시그니처는 그대로이고
  `agentInfo`·`invalidate`가 더해졌다.

- **`AgentProbeService`에 자체 캐시를 뒀다가 걷어냈다.** model과 version을 따로 묻느라
  `agentInfo`를 두 번 부르게 되어 캐시를 하나 더 두었는데, 그러면 `다시 확인`이
  커맨드 서비스 캐시만 비워 **옛 모델 이름이 남는다.** 한 번만 물어 둘을 함께 꺼내도록
  고쳐 캐시를 없앴다.

- **`core/agent/` 배선을 `core/index.ts`의 `adapters` 선언 뒤로 옮겼다.** 처음엔 `commands`
  바로 아래에 두었는데 그 클로저가 `adapters`를 잡는다 — CLAUDE.md가 경고한 TDZ 자리와
  같은 모양이라(설정 화면이 부팅 중에 부르면 터진다) 선언 순서를 지켰다.

- **`RunPanel`의 `resume` 인자 배선이 변이 검증에서 살아남았다.** `start`와 `resume` 두
  자리 중 `start`만 테스트가 덮고 있었다 — `resume` 쪽을 지워도 전부 초록이었다. "이어가는
  턴도 고른 effort를 싣는다"와 "이어가는 턴은 effort를 이어받지 않는다" 둘을 추가해 막았다.
  **plan이 변이 목록에 이 자리를 적어두지 않았다면 그대로 새어나갔을 것이다.**

- **`fake-claude.mjs`에 `ONE_DESK_ARGS_CAPTURE`를 더했다.** 어댑터가 조립한 인자가 실제로
  CLI까지 닿는지는 `buildCommand`의 반환값만 보는 단위 테스트로는 알 수 없다 —
  슬래시 커맨드가 stdin을 파일로 남겨 확인한 것과 같은 방법이다.

- **일괄 패치가 파일을 CRLF로 바꿔 무관한 테스트 67개가 diff에 잡혔다.** 전부 LF로
  되돌렸다. 최종 변경은 43 파일 수정 + 23 파일 추가다.
