# Plan: 슬래시 커맨드

- 출처: `intent.md`, `spec.md` (2026-09-15 승인)
- 작성자: 권용현
- 상태: 승인됨
- 작성일: 2026-09-15

## spec에서 다듬은 것

구현하며 드러난 두 가지다. spec의 결정을 뒤집지 않고 모양만 맞춘다.

1. **`commands.list`는 `workspaceId`도 받는다.** spec은 `list(cwd)`로 적었으나, 실행 파일
   경로가 workspace의 `claudePath`에서 오므로(`core/runner/agentPath.ts`) workspace를 알아야
   한다. `list({ workspaceId, cwd })`로 한다. **캐시 키는 여전히 `cwd` 하나다.**
2. **`CommandInfo`는 `shared/models.ts`에 둔다.** 렌더러가 쓰는 타입이므로 `core/`에 두면
   경계 규칙 2를 어기게 된다.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `core/context/assemble.ts` | 수정 | 슬래시로 시작하면 순서를 바꾼다. 아니면 지금 그대로 (FR-7·FR-8) |
| `core/context/assemble.test.ts` | 수정 | 슬래시 케이스를 **추가**한다. 기존 5개는 한 글자도 고치지 않는다 |
| `core/commands/types.ts` | 신규 | 내부 타입(`ProbeResult`). 공개 타입은 `shared/models.ts` |
| `core/commands/probe.ts` | 신규 | cwd에서 CLI를 띄워 `system/init`만 받고 **즉시 죽인다** |
| `core/commands/probe.test.ts` | 신규 | 종료 검증, 실패 내성 |
| `core/commands/describe.ts` | 신규 | 이름 → 설명·인자 사용 여부. `parseFrontmatter` 재사용 |
| `core/commands/describe.test.ts` | 신규 | 5개 자리, 플러그인 이름 규칙, 못 읽는 파일 |
| `core/commands/service.ts` | 신규 | probe+describe 합성, cwd 키 메모리 캐시 |
| `core/commands/service.test.ts` | 신규 | 캐시가 probe 호출을 1회로 묶는지 |
| `core/index.ts` | 수정 | `commands` 표면 추가. **`settings` 아래, `assetService` 근처** |
| `core/index.test.ts` | 수정 | 배선과 FR-11(슬롯·큐·run 불변) |
| `core/runner/fixtures/fake-claude.mjs` | 수정 | `--scenario commands` 추가 |
| `core/runner/fixtures.test.ts` | 수정 | 새 시나리오의 실행 권한·shebang |
| `shared/models.ts` | 수정 | `CommandInfo` 타입 |
| `shared/channels.ts` | 수정 | `commandsList`·`commandsRefresh` |
| `shared/client.ts` | 수정 | `commands` 네임스페이스 |
| `electron/ipc/commands.ts` | 신규 | 핸들러 둘. core 호출만 |
| `electron/ipc/index.ts` | 수정 | `registerCommandHandlers(core)` 한 줄 |
| `electron/preload.ts` | 수정 | `commands` 브리지 |
| `renderer/slash.ts` | 신규 | 커서 기준 `/토큰` 판정과 삽입. 순수 함수 |
| `renderer/slash.test.ts` | 신규 | 줄머리·공백 뒤·줄 중간·스택 |
| `renderer/hooks/useCommands.ts` | 신규 | `useAssets` 모양 |
| `renderer/hooks/useCommands.test.ts` | 신규 | cwd 변경 시 재조회 |
| `renderer/components/CommandPicker.tsx` | 신규 | 목록·필터·키 조작·불러오는 중 |
| `renderer/components/CommandPicker.test.tsx` | 신규 | FR-3·4·5·6 |
| `renderer/components/RunPanel.tsx` | 수정 | 피커 연결, Enter 가로채기, 인자 경고, **opencode면 피커 비활성** |
| `renderer/components/RunPanel.test.tsx` | 수정 | 통합 동작을 **추가**. 기존 테스트는 유지 |
| `e2e/slash.e2e.ts` | 신규 | 한 바퀴 |

**건드리지 않는 파일(중요).** `core/runner/adapters/claudeCode.ts`, `core/runner/types.ts`,
`core/execution.ts`, `drizzle/`. 새 CLI 플래그가 없으므로 어댑터와 `RunSpec`은 그대로이고,
마이그레이션도 없다. **이 목록에 손이 가면 설계가 어긋난 것이다.**

## 작업 순서

1. **`assemble.ts` 슬래시 분기** — 슬래시면 `[trimStart된 지시, <context>, 안내문]` 순,
   아니면 지금 그대로. **완료 확인**: 새 테스트 4개(슬래시 첫 글자, **앞 공백이 있어도 첫
   글자가 `/`**, 맥락이 뒤, 안내문이 뒤)가 통과하고 **기존 `assemble.test.ts` 5개가 수정 없이
   통과**한다. 분기를 지우면 새 테스트가 실패한다.

2. **`describe.ts`** — spec 표의 5개 자리를 훑어 이름 → `{description, usesArguments}`.
   `parseFrontmatter` 재사용, 어떤 경우에도 던지지 않는다. **완료 확인**: 임시 디렉토리
   픽스처로 repo 커맨드·홈 커맨드·스킬·플러그인(`plugin:name`)이 각각 잡히고, 없는 경로와
   깨진 파일에서 빈 결과가 나온다. `$ARGUMENTS`가 있는 파일만 `usesArguments: true`다.

3. **픽스처 확장 + `probe.ts`** — `fake-claude.mjs`에 `--scenario commands`를 더한다:
   `slash_commands`·`terminal_slash_commands`·`plugins`가 든 init을 뱉고, **200ms 뒤
   `ONE_DESK_PROBE_MARKER` 경로에 파일을 만든다.** `probe.ts`는
   `resolveAgentPath`+`findExecutable`로 실행 파일을 찾아 `--tools ""`로 띄우고, init을 읽는
   즉시 죽인다. **완료 확인**: probe가 돌아온 뒤 **마커 파일이 없다.** 종료 코드를 지우면
   마커가 생겨 테스트가 실패한다. 10초 타임아웃·실행 파일 없음·깨진 JSON 셋 다 던지지 않고
   빈 목록을 준다.

4. **`service.ts`** — probe+describe를 합쳐 `CommandInfo[]`를 만들고 cwd로 캐시한다.
   `terminal_slash_commands`를 뺀다. **완료 확인**: 같은 cwd로 세 번 불러도 probe가 **1회**만
   불리고, 다른 cwd면 다시 불린다. `refresh`는 캐시를 버린다. 목록에 터미널 전용 이름이 없다.

5. **`core/index.ts` 표면** — `commands: { list, refresh }`를 붙인다. `homeDir`를 describe에
   넘기고, `workspaces`로 실행 파일 경로를 푼다. **완료 확인**: `core.commands.list`가
   동작하고, **호출 전후로 `queue.snapshot()`과 `runs.list()`가 같다**(FR-11). 부팅이
   여전히 되는지도 본다 — 선언을 `settings` 위로 올리면 TDZ로 죽는 것을 확인한다.

6. **IPC 왕복** — `channels`·`client` 타입·`ipc/commands.ts`·`ipc/index.ts` 한 줄·`preload`.
   **완료 확인**: `grep -rn "from 'electron'" core/`가 비어 있고, 핸들러 본문이 core 호출
   한 줄이다. 타입체크가 통과한다.

7. **`renderer/slash.ts`** — 커서 위치에서 여는 토큰을 찾는 순수 함수와, 고른 이름을 끼워
   넣는 순수 함수. **완료 확인**: 줄머리 `/`는 열리고, 공백 뒤 `/`도 열리고(=스택),
   `abc/def`의 `/`는 **열리지 않는다**. 삽입하면 `/이름 `과 커서 위치가 맞다.

8. **`useCommands`** — `useAssets` 모양(목록·오류·refresh). **완료 확인**: cwd가 바뀌면 다시
   읽고, cwd가 빈 문자열이면 아무것도 부르지 않는다.

9. **`CommandPicker`** — 이름+설명, 필터, ↑↓/Enter/Tab/Esc, "불러오는 중". **완료 확인**:
   FR-3(설명 없는 항목이 남는다)·FR-4·FR-5·FR-6 각각의 테스트가 통과한다.

10. **`RunPanel` 통합** — 피커를 붙이고, 지금 작업 디렉토리(대화 중이면 `conversation.last.cwd`)
    로 `useCommands`를 부르고, **피커가 열린 동안 Enter를 가로채고**, 인자 커맨드면 경고를
    띄운다. **`agentKind`가 `opencode`면 피커를 열지 않고 목록도 얻지 않는다**(spec 범위 밖).
    **완료 확인**: `/`를 치면 목록이 뜨고, Enter로 고르면 삽입되며 **실행이 일어나지 않는다**.
    작업 디렉토리를 바꾸면 목록이 바뀐다(FR-12). **agent를 OpenCode로 바꾸면 `/`를 쳐도 피커가
    열리지 않고 `commands.list`가 불리지 않는다.** 기존 RunPanel 테스트가 전부 통과한다.

11. **`e2e/slash.e2e.ts`** — 가짜 CLI로 한 바퀴. **완료 확인**: 화면에서 `/`→피커→삽입→실행을
    하고, 가짜 CLI가 받은 프롬프트의 **첫 글자가 `/`**이며 그 뒤에 `<context>`와
    `[NEEDS_ANSWER]`가 있다. 실행 버튼은 `{ name: '실행', exact: true }`로 잡는다.

## 리스크

| 리스크 | 영향 | 완화 방법 |
| --- | --- | --- |
| probe가 init 뒤 프로세스를 못 죽여 **실제 모델 호출이 나간다** | 사용자에게 요금. 실패가 조용하다 | 3단계의 마커 파일 테스트. 종료를 지우면 반드시 실패한다 |
| 판정(`trimStart`)과 전송이 어긋난다 | 커맨드는 확장 안 되는데 맥락만 뒤로 밀린다. 조용하다 | 1단계에 앞 공백 케이스를 넣는다 |
| 캐시를 렌더러로 옮기고 싶어진다 | `Dock`의 `key` 재마운트마다 probe가 돌아 훅이 반복 실행된다 | 캐시는 `service.ts`에만. 4단계가 호출 횟수를 센다 |
| `core/index.ts` 선언 순서로 TDZ | 부팅이 죽는다 | CLAUDE.md의 `settings`↔`assetService` 사례와 같은 함정. 5단계에서 순서를 확인한다 |
| Enter가 피커와 실행 양쪽에 걸린다 | 커맨드를 고르려다 빈 프롬프트로 실행된다 | 10단계 테스트가 "Enter로 골라도 start가 안 불린다"를 단언 |
| e2e에서 `실행` 버튼이 strict mode 위반 | e2e가 통째로 깨진다 | CLAUDE.md 경고대로 `exact: true` (도크 토글·슬롯 표시기와 충돌한다) |
| 내장 커맨드는 파일이 없어 인자 사용 여부를 모른다 | 경고를 못 띄운다 | `usesArguments: false`로 둔다. spec FR-9가 "경고하지 않는다"로 이미 정의 |
| Windows에서 실행 파일을 못 찾는다 | 목록이 빈다 | 새 탐색 로직을 쓰지 않고 `core/runner/executable.ts`를 그대로 재사용 |
| 픽스처가 서버 이름·필드를 리터럴로 박는다 | 단위는 초록인데 e2e만 깨진다 | CLAUDE.md의 `fake-claude-mcp.mjs` 사례. init 필드를 인자로 받게 한다 |
| `<context>`가 앞에 오는 회귀 | 슬래시 기능 전체가 조용히 죽는다 | 11단계 e2e가 프롬프트 첫 글자를 단언한다 |

## 완료 증명

- [ ] `pnpm test` — 전부 초록. 기존 `assemble.test.ts` 5개가 **수정 없이** 통과
- [ ] `pnpm typecheck` — 오류 없음
- [ ] `pnpm lint` — 오류 없음
- [ ] `pnpm test:e2e` — `slash.e2e.ts` 포함 전부 통과
- [ ] `grep -rn "from 'electron'" core/` — 출력 없음
- [ ] `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [ ] `ls drizzle/*.sql | wc -l` — 작업 전과 같은 수 (마이그레이션 없음)
- [ ] `git diff --stat` 에 `core/runner/adapters/`·`core/execution.ts`·`core/runner/types.ts`가
      **없다** (어댑터 무변경)
- [ ] **변이 검증** — 아래 6개를 하나씩 망가뜨려 각각 실패하는 테스트가 있는지 확인한다.
      살아남는 것이 있으면 그 자리의 테스트를 먼저 보강한다
  - [ ] `assemble.ts`의 슬래시 판정 분기
  - [ ] `assemble.ts`의 `trimStart()`
  - [ ] `probe.ts`의 init 수신 후 종료
  - [ ] `describe.ts`의 인자 placeholder 탐지
  - [ ] `RunPanel`이 작업 디렉토리가 바뀔 때 목록을 다시 얻는 배선
  - [ ] `terminal_slash_commands` 제외
  - [ ] `RunPanel`의 opencode 차단 (지우면 OpenCode에서도 피커가 열려야 실패)
- [ ] **수동 확인** — `pnpm dev`로 띄워 실제 claude로 한 번 돌린다. `/`를 쳐서 목록이 뜨고,
      `/code-review` 같은 실제 커맨드를 골라 실행했을 때 로그에 **커맨드가 확장된 결과**가
      나온다(`/code-review`라는 글자가 그대로 모델에게 가지 않는다). 이 확인만은 가짜 CLI로
      대신할 수 없다 — 실측 두 건(`--resume`의 시스템 프롬프트, `[NEEDS_ANSWER]` 유지)이
      모두 1회 관측이기 때문이다

## 계획 이탈 기록

- **3단계 픽스처 (사전 점검, 2026-09-15):** `--scenario commands`를 추가하지 않고, `fake-claude.mjs`의
  init이 **모든 시나리오에서** `slash_commands`·`terminal_slash_commands`·`plugins`를 싣게 했다.
  e2e 드라이버는 시나리오를 넘길 수 없고 기본 픽스처를 그대로 spawn하므로, 시나리오로 가르면
  11단계에서 피커가 빈다. 마커 파일은 env `ONE_DESK_PROBE_MARKER`가 있을 때만 쓴다.
- **`CommandInfo`의 소유 (사전 점검):** plan이 어느 단계가 `shared/models.ts`에 추가하는지 적지
  않았다. 4단계가 추가한다.
- **11단계 검증 방법 (사전 점검):** "가짜 CLI가 받은 프롬프트"는 e2e가 `dataDir`의 SQLite에서
  `run.assembled_prompt`를 직접 읽어 확인한다(픽스처 변경 불필요).
- **FR-1 정정 (1단계 리뷰, 2026-09-15):** 피커의 여는 조건을 "줄머리 또는 공백 바로 뒤"에서
  "앞이 비었거나 슬래시 토큰뿐일 때"로 좁혔다. 7단계 `findSlashToken`이 이 규칙을 따른다. 상세는
  spec FR-1의 정정 주석.
- **3단계 probe 플래그 (3단계 구현자 우려 → 실측, 2026-09-15):** probe 명령에 `--strict-mcp-config`를
  더한다(`--mcp-config`는 여전히 없음). 없으면 사용자의 개인 MCP 서버가 probe마다 뜬다(실측 9개,
  5.82초 → 0개, 1.16초). 상세는 spec NFR-3의 정정 주석.
