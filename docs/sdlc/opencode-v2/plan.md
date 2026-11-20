# Plan: OpenCode 2.x CLI 지원

- spec: `spec.md` (승인 2026-11-19 — "승인, plan 쓰기")
- 상태: **승인됨** (2026-11-19, 사용자 "승인, 구현 시작")
- 작성일: 2026-11-19
- 마이그레이션·IPC 채널·스키마 변경 없음. 한 브랜치, 단계마다 커밋 하나.

## 0. plan을 쓰며 잰 것과 spec을 고친 것

spec §6의 열 가지 중 plan을 가르는 것을 먼저 쟀다(`probes/probe8-plan-step0.cjs`, 원본 `probes/out-probe8-report-2.3.2.json`).

| spec §6 | 결과 (2.3.2) | plan에 미친 것 |
|---|---|---|
| 1. `OPENCODE_CONFIG` 파일 | **읽는다** — 파일의 `mcp.servers`로 MCP 도구가 섰다 | FR-13 그대로. `OPENCODE_CONFIG_DIR` 대안은 버린다 |
| (새로) 서버 이름의 하이픈 | 서버 `one-desk`의 도구·action은 **`one-desk_ping`**, 와일드카드 `one-desk_*`가 먹힌다 | 규칙의 MCP 키는 `` `${MCP_SERVER_NAME}_*` `` (v1과 같은 모양) |
| 2. 도구 이름 | 전부 허용의 도구: `edit` `glob` `grep` `question` `read` `shell` `skill` `subagent` `webfetch` `websearch` `write` `execute` `experimental_image_generate` + `opencode.*`. **`list`·`lsp`·`todowrite`는 없다** | FR-4의 읽기 전용 목록에 더할 것이 없다 |
| 3. 세션 확인 | `api --standalone session.get --param sessionID=<id>` — 있으면 exit 0, 없으면 **exit 1 + `SessionNotFoundError`**, 0.57초 | FR-14의 명령 |
| 4. 서비스 | `models`·`auth list`·`debug config`는 `--standalone` **없으면 서비스를 띄우고**, 있으면 안 띄운다. `--version`은 무관 | FR-11 그대로 — 설정 화면의 두 조회에 방언이 필요하다(6단계) |
| 5. `skill` | `* deny` 아래에서 도구는 보이지만 실제 skill(`demo`)을 **못 싣는다**(`skill:error`) | §5의 1은 닫는다. 규칙을 더하지 않는다 |
| 6. 가짜 CLI | `fake-opencode.mjs`는 `--version`에 `1.18.30`, `debug config`에 받은 `OPENCODE_PERMISSION`을 되돌려 준다 | FR-9(긍정 확인)가 가짜를 고치지 않고 통과한다. v2는 스위치를 더한다(8단계) |

2.0.18(모델 없이 되는 것만): `session list`·`api session.get`·`models`는 `--standalone`을 받는다. **`debug config --standalone`은 받지
않는다**(도움말 + exit 1) — v2에서는 `debug config`를 쓰지 않으므로 영향 없다.

**아직 못 잰 것**(무료 모델의 분당 한도에 닿았다 — 1단계에서 잰다): 2.0.18의 `OPENCODE_CONFIG` 파일과 `--session`에 없는 id,
2.0.18의 `auth list --standalone`, 편집 `files[].status`의 다른 값(새 파일·삭제)과 여러 파일 패치 도구, one-desk의 `terminate`로
멈춘 뒤 남는 프로세스, 로그인된 `auth list`의 모양.

**spec을 고친 것** (같은 커밋에서 spec도 고친다)

1. **FR-8a의 안내는 실행 파일 줄이 아니라 느린 칸이다.** 능력 판정은 `debug agents --standalone`을 한 번 띄운다(1.4~1.8초).
   실행 파일 줄은 `checkAgents`(빠른 칸)가 그리므로 거기 걸면 workspace를 고를 때마다 그 시간만큼 줄이 빈다(agent-setup이
   `checkAgents`와 `probeAgents`를 가른 이유). 안내는 `probeAgents`의 결과(`AgentProbe.note`)에 싣고 `AgentStatusRow`가 그린다.
2. **FR-14의 세션 확인은 두 버전 다 한다.** 2.0.18의 `--session`이 없는 id를 어떻게 다루는지 몰라도 확인이 먼저 막는다.
3. **§5의 1(skill)을 닫는다** — 위 표.

## 1. 설계 — 타입과 흐르는 길

```ts
// core/runner/types.ts
export type OpencodeDialect = 'v1' | 'v2'

export interface PreflightResult {
  ok: boolean
  executable?: string
  reason?: string
  /** opencode만 싣는다. 버전을 못 읽었으면 'v1' (spec FR-2) */
  dialect?: OpencodeDialect
}

export interface VerifyRunnableInput {
  executable: string
  cwd: string
  permission: Permission
  dialect: OpencodeDialect | null      // 필수 (FR-3). claude는 null
  resumeSessionId: string | null        // 필수 (FR-14)
}

export interface ResolvedRunSpec { /* … */ dialect: OpencodeDialect | null }   // 필수
```

`StartSpec`(manager)과 MCP 호스트의 `prepare` 입력에도 같은 필수 필드가 붙는다. 흐름은 한 줄이다:

```
preflight(dialect) → execution.prepareAndEnqueue → verifyRunnable({dialect, resumeSessionId})
                                                 → mcp.prepare({dialect}) → writeMcpConfig(…, dialect)
                                                 → manager.start({dialect}) → adapter.buildCommand({dialect})
```

**`dialect`가 null인데 opencode면 어댑터가 던진다**(`buildCommand`·`verifyRunnable`) — 조용히 v1로 떨어지지 않는다. WSL 판정
(`wslPreflight.claude`)은 `dialect`를 싣지 않는다.

권한은 순수 함수 둘이다(`core/runner/permission.ts`).

```ts
export interface OpencodeRule { action: string; resource: '*'; effect: 'allow' | 'deny' }
export function opencodeV2Rules(permission: Permission): OpencodeRule[]            // FR-4
export function opencodeV2Config(permission: Permission): {                        // FR-5 — OPENCODE_CONFIG_CONTENT에 실을 객체
  permissions: OpencodeRule[]
  agents: { build: { permissions: OpencodeRule[] } }
}
```

`resource`의 타입이 리터럴 `'*'`이고 `effect`에 `'ask'`가 없다 — spec FR-4의 두 금지가 타입이다.

실행 직전 확인의 판정도 순수 함수로 뗀다(프로세스를 띄우는 것과 가른다 — 지금 `ConfigProbe` 이음매와 같은 모양).

```ts
// core/runner/adapters/opencode.verify.ts (새 파일 — opencode.ts가 이미 570줄이다)
export function judgeV1Config(raw: string, sent: Record<string, 'allow' | 'deny'>): PreflightResult      // FR-9
export function judgeV2Agents(raw: string, sent: OpencodeRule[]): PreflightResult                         // FR-8
export type V2Capability = 'verifiable' | 'unverifiable'                                                  // FR-8a
export function capabilityOf(result: { exitCode: number | null; stdout: string; stderr: string }): V2Capability | null  // null = 판정 실패
```

## 2. 단계

단계마다: 실패하는 테스트 → 구현 → `pnpm test <파일>` · `pnpm typecheck` → 그 단계의 변이를 돌려 빨개지는지 확인 → 커밋.

### 1단계 — 남은 실측과 픽스처

- [ ] §0의 "아직 못 잰 것"을 잰다. 모델 호출은 한 번에 네 개 이하로, 한도에 닿으면 1분 쉰다. 결과를 §0 표에 더한다.
- [ ] `probes/out-shapes-2.3.2.jsonl`·`out-shapes-2.0.18.jsonl`·`out-ask-all-2.3.2.jsonl`에서 줄을 골라
  `core/runner/fixtures/opencode-v2/`에 둔다(경로의 사용자 폴더 이름을 `C:\\work\\repo`로 바꾼다 — 원본은 `probes/`에 남는다).
  새 파일·삭제·여러 파일 편집 줄을 잰 것으로 더한다.
- 완료: 픽스처 파일이 있고, 2.0.18에서 MCP 파일과 `--session`의 동작이 §0에 적혀 있다. 2.0.18이 `OPENCODE_CONFIG`를 안 읽으면
  **멈추고 사용자에게 알린다**(FR-13의 전제가 깨진다).

### 2단계 — 버전과 방언 (spec FR-1·2)

- `opencode.ts`: `FIRST_UNSUPPORTED_MAJOR`를 3으로, `MIN_SUPPORTED_V2 = [2, 0, 18]`. `judgeVersion`이 거부 사유와 함께 방언을
  돌려준다. 게이트의 캐시 항목이 `{ rejected, dialect }`를 담는다(프로세스는 여전히 한 번).
- `preflight`가 통과할 때 `dialect`를 싣는다.
- 테스트(`opencode.version.test.ts`): 2.3.2 → 통과·`v2` / 2.0.18 → 통과·`v2` / 2.0.17 → 거부("2.0.18 이상으로") / 3.0.0 →
  거부("아직 지원하지 않습니다") / 1.18.30 → `v1` / 못 읽음 → 통과·`v1` / 못 읽은 판정은 캐시하지 않는다(있는 테스트 유지).
  "2.x를 막는다"는 기존 테스트는 2.0.17과 3.0.0으로 옮긴다. `core/index.test.ts`의 "opencode 2.x는 설정 화면과 실행이 같은 이유로
  막고…"는 버전을 3.0.0으로 바꿔 살린다(같은 문장 비교는 그대로).
- 변이: `MIN_SUPPORTED_V2`를 `[2,0,0]`으로 / major 3 거부를 지운다 / `dialect`를 늘 `v1`로.

### 3단계 — 타입을 흐르게 (FR-3)

- `types.ts`에 §1의 필드. `execution.ts`가 `preflight.dialect ?? null`과 `spec.resumeSessionId`를 `verifyRunnable`·`mcp.prepare`·
  `manager.start`에 넘긴다. `manager.ts`가 `buildCommand`에 넘긴다. `core/index.ts`의 `verifyRunnable` 배선은 입력을 그대로 넘기므로
  안 바뀐다.
- 컴파일이 깨지는 테스트 자리(`ResolvedRunSpec`·`VerifyRunnableInput`을 만드는 곳)를 채운다 — claude 쪽은 `dialect: null`.
- 테스트(`execution.test.ts`): preflight가 준 `dialect`가 `verifyRunnable`과 `manager.start`에 그대로 도착한다 / 이어 가는 턴의
  `resumeSessionId`가 `verifyRunnable`에 도착한다. `manager.test.ts`: `StartSpec.dialect`가 `buildCommand`에 도착한다.
- 변이: `execution.ts`에서 `dialect: null`을 넘긴다 / `manager.ts`에서 `dialect`를 빼고 넘긴다(필수라 컴파일이 깨져야 한다 —
  깨지는 것을 확인으로 친다).

### 4단계 — 권한 규칙 (FR-4·5)

- `permission.ts`에 `opencodeV2Rules`·`opencodeV2Config`. v1 함수는 그대로.
- 테스트(`permission.test.ts`): 세 단계의 규칙 목록이 spec 표와 같다 / `ask`가 없다(`mentionsAsk`) / resource가 전부 `*` /
  MCP 키가 `MCP_SERVER_NAME`에서 온다 / 읽기 전용·편집 허용의 첫 규칙이 `* deny`다 / `opencodeV2Config`의 두 자리가 같은 목록이다.
- 변이: `agents.build`를 뺀다 / 편집 허용에 `shell allow`를 더한다 / MCP 키를 리터럴 `'onedesk_*'`로.

### 5단계 — 명령과 실행 직전 확인 (FR-6~12·14)

- `buildCommand`가 방언으로 갈린다. v2: `run --standalone --format json --thinking --agent build` + `-m model[#variant]` +
  `--session`. 환경변수는 `OPENCODE_CONFIG_CONTENT`(4단계의 객체) + (MCP가 있으면) `OPENCODE_CONFIG`. `OPENCODE_PERMISSION`은 없다.
  variant만 있고 모델이 없으면 던진다 — `verifyRunnable`이 먼저 같은 문장으로 막으므로(아래) 여기까지 오는 것은 버그다.
- `opencode.verify.ts`의 판정 함수 셋(§1)과 `verifyRunnable`의 두 갈래.
  - v1: `debug config` → `judgeV1Config`(보낸 키·값이 전부 그대로 있어야 통과, `ask`가 남으면 지금 문장).
  - v2: (variant만 있으면 실패) → `debug agents --standalone`을 run과 같은 env·cwd로 → `capabilityOf` →
    `unverifiable`이면 전체 허용만 통과(FR-8a의 문장) / `verifiable`이면 `judgeV2Agents` → 이으면
    `api --standalone session.get`(exit 1 + `SessionNotFoundError`면 "이어받을 세션이 없습니다", 다른 실패는 "세션을 확인하지
    못했습니다").
  - 능력 판정의 캐시는 버전 게이트와 같은 열쇠(경로·크기·mtime), 판정 실패는 캐시하지 않는다.
  - `VerifyRunnableInput`에 모델·variant가 없다 → "variant만 있고 모델 없음"은 `execution.ts`가 아니라 **입력에 `model`·`effort`를
    더해** 어댑터가 본다(방언은 어댑터 밖으로 나가지 않는다 — NFR-1).
- 테스트
  - `opencode.command.test.ts`: v2 인자 전체 일치(세 권한 × 모델·variant·이어 가기) / `--auto`·`--variant`·
    `--dangerously-skip-permissions`가 없다 / `OPENCODE_PERMISSION`이 없다 / `OPENCODE_CONFIG_CONTENT`에 토큰·URL이 없다 / v1 인자는
    기존 테스트 그대로 / `dialect: null`이면 던진다.
  - `opencode.verify.test.ts`: v1 — 배열 출력(2.x 모양)은 실패, `permission` 없음은 실패, 값 하나가 다르면 실패, 그대로면 통과,
    `ask`는 지금 문장. v2 — spec 0-1의 해결된 목록 넷을 픽스처로: 우리 규칙 뒤에 `shell * allow`면 실패(이유에 그 규칙이 있다),
    뒤가 `browser * deny`뿐이면 통과, 우리 규칙이 없으면 실패, `build`가 없으면 실패, 깨진 JSON이면 실패. 능력 — `Unrecognized
    flag: --standalone`이면 `unverifiable`, 다른 exit 1은 판정 실패(= 실행 실패). `unverifiable` + 읽기 전용 → FR-8a 문장, +
    전체 허용 → 통과. 세션 — 없음·있음·조회 실패 셋.
- 변이: `--agent build`를 뺀다 / `--standalone`을 뺀다 / `judgeV2Agents`의 "뒤는 전부 deny" 조건을 뺀다 / `judgeV1Config`를 "ask
  없음"으로 되돌린다 / `unverifiable`에서 권한을 안 본다 / 세션 확인을 뺀다 / 판정 실패를 `unverifiable`로 친다.

### 6단계 — MCP 설정 파일과 설정 화면 (FR-11·13·23, §0의 spec 고침 1)

- `configFile.ts`: `writeMcpConfig`가 방언을 받는다(opencode면 필수 — `agentKind: 'opencode'`에 `dialect: null`이면 던진다).
  `opencodeV2Body`: `mcp.servers[MCP_SERVER_NAME] = { type: 'local', command, environment, codemode: false, timeout: { startup:
  30000 } }`(timeout 모양은 스키마 그대로 — 1단계에서 실제로 받는지 본다). `host.prepare`가 `dialect`를 받아 넘긴다.
- `core/agent`: `checkAuth`·모델 목록이 방언을 받아 v2면 `--standalone`을 붙인다. v2 인증 파서: `No authenticated integrations` →
  `none`, 그 밖에 못 읽으면 `unknown`(로그인된 모양은 1단계에서 재면 더한다). `probeAgents`가 v2면 능력을 판정해
  `AgentProbe.note`에 싣는다(`unverifiable`일 때만 — `전체 허용만 실행됩니다 — 읽기 전용·편집 허용은 2.3.2 이상`).
- `renderer`: `AgentStatusRow`가 `note`를 그린다(`--text-muted`, `role` 없음 — 오류가 아니다). `shared/models.ts`의
  `AgentProbe.note: string | null`은 필수다.
- 테스트: `configFile.test.ts` — v2 본문의 모양, `codemode: false`, 0600, 토큰이 파일에만 / `auth.test.ts` — v2 문구 둘과
  `--standalone` 인자 / `models.test.ts` — v2 인자 / `service.test.ts` — `unverifiable`이면 note, 아니면 null / `AgentStatusRow` 테스트
  — note가 보인다.
- 변이: `codemode: false`를 뺀다 / v2 조회에서 `--standalone`을 뺀다 / note를 늘 null로.

### 7단계 — 파서와 세부 (FR-15~22)

- `opencode.ts`: `toolUseId = callID ?? id ?? partID`, `targetPaths`가 `filePath ?? path`, `TOOL_EFFECTS`에 `shell`·`execute`.
  `execute`의 실패 판정(`metadata.metadata.error === true`).
- `opencode.detail.ts`: 세부의 자리(`metadata.metadata`가 객체면 그것), 편집의 `files[]`(항목 키 `file`), 쓰기(v2 — `overwrite`,
  hunk 없음), 거부 문구 상수 `OPENCODE_V2_DENIED_BY_ASK`. `inputPath`가 `filePath ?? path`.
- `renderer/timeline.ts`: `TOOL_LABELS`에 `shell: { label: '셸', category: 'shell' }`, `execute: { label: '코드 실행', category:
  'other' }`, `subagent: { label: '하위 에이전트', category: 'subagent' }`.
- 테스트: `opencode.parse.test.ts`·`opencode.detail.test.ts`에 1단계 픽스처의 원본 줄로 — 셸(종료 코드 0·3), 검색 둘, 편집(hunk·
  `+1 −1`), 쓰기, 읽기(원문 없음), `execute` 성공·안쪽 실패, 자동 거부 공지, 생각, 오류 줄(`provider.no-route`), 사용량.
  호출 id가 줄마다 다르다(같은 턴의 두 셸이 한 호출로 묶이지 않는다). v1 픽스처 테스트는 손대지 않고 통과.
  `timeline.test.ts`: `shell` 줄이 `bash`와 같은 묶음 문구(`셸 사용됨`)다.
- 변이: `?? id`를 뺀다(v2의 모든 도구 id가 `partID`로 떨어져도 테스트가 구별하는지) / `metadata.metadata`를 안 본다 /
  `execute`의 `error`를 무시한다 / 거부 문구 상수를 한 글자 바꾼다 / `TOOL_LABELS.shell`을 뺀다.

### 8단계 — 가짜 CLI와 e2e (FR-26)

- `fake-opencode.mjs`: `ONE_DESK_FAKE_OPENCODE_VERSION`(없으면 지금처럼 `1.18.30`) — `2.`로 시작하면 `--version`이
  `opencode v<값>`을 찍고, `debug agents --standalone`에 받은 `OPENCODE_CONFIG_CONTENT`의 `agents.build.permissions`를 머리·꼬리
  규칙 사이에 넣어 돌려주고, `api … session.get`에 가짜 세션 id면 exit 0·아니면 exit 1을 낸다. `ONE_DESK_FAKE_SCRIPT=v2`는 1단계
  픽스처 모양의 줄(셸·편집·읽기·생각)을 낸다. **`--agent build`·`--standalone`이 없으면 exit 2로 실패한다** — 가짜 wsl.exe가
  `--`를 거부하는 것과 같은 이유다(진짜와 뜻이 다른 것을 조용히 받아 주지 않는다). 기본 시나리오와 v1 갈래는 안 바뀐다.
- `e2e/opencode-v2.e2e.ts`: 가짜 2.3.2로 첫 턴 + 이은 턴, 대화록의 셸 줄(`종료 코드 3`)·편집 줄(diff)·읽기 묶음, 설정 화면의
  실행 파일 줄. 가짜 2.0.18 흉내(`ONE_DESK_FAKE_OPENCODE_UNVERIFIABLE=1`)로 읽기 전용 턴이 FR-8a 문장으로 실패하고 설정 화면에
  안내가 선다.
- 변이: `buildCommand`에서 `--agent build`를 뺀다(가짜가 exit 2 → e2e 빨강).

### 9단계 — 진짜 CLI (FR-24)

- `core/mcp/realOpencode.test.ts`를 넓힌다. 실행 파일은 `ONE_DESK_REAL_OPENCODE_PATH`(없으면 PATH). 방언은 그 바이너리의
  preflight가 준 것을 쓴다. spec FR-24의 일곱 가지(2.3.2)와 세 가지(2.0.18)를 `describe`로 가른다 — 능력 판정으로 고른다.
  프로젝트 `opencode.json`은 테스트가 임시 폴더에 쓴다.
- 돌리는 명령(둘 다 통과해야 완료):
  ```
  ONE_DESK_REAL_CLI=1 ONE_DESK_REAL_OPENCODE_MODEL=opencode/big-pickle pnpm test realOpencode
  ONE_DESK_REAL_CLI=1 ONE_DESK_REAL_OPENCODE_MODEL=opencode/big-pickle ONE_DESK_REAL_OPENCODE_PATH=<2.0.18 cli> pnpm test realOpencode
  ```
  1.18.30(`…\SST.opencode_…\opencode.exe`)로도 한 번 — 지금 있는 두 테스트가 그대로 통과한다.
- 무료 모델의 한도 때문에 케이스 사이에 쉰다(테스트 안에서 429면 한 번 기다렸다 다시 — 그래도 429면 실패가 아니라 건너뛴 것으로
  적고 완료 증명에 남긴다).
- 변이(진짜 CLI로): `opencodeV2Config`에서 `agents.build`를 뺀다 → 3번 빨강 / `--agent build`를 뺀다 → 4번 빨강.

### 10단계 — 취소·종료와 손으로 보는 것

- 진짜 2.3.2로 one-desk를 띄워(`pnpm dev`가 아니라 `pnpm run pack` 산출물 또는 e2e 드라이버 + `agentPath`) 긴 셸 명령을 시키고
  `실행 중인 턴 멈추기` → `opencode.exe`·그 자식이 남지 않는지, 앱을 끈 뒤에도 남지 않는지 본다(pid). 대화 한 번 뒤 백그라운드
  서비스가 없는지 본다(spec §7).
- 대화록 캡처 둘(라이트·다크 — `emulateMedia`): 셸·편집·읽기 줄이 1.x 대화와 같은 모양인지.

### 11단계 — 문서

- CLAUDE.md(spec §4), `conversation-fixes` spec FR-17에 개정 한 줄, OpenCode 어댑터 설계 §2에 "1.x 방언" 각주,
  `docs/releases/<다음 태그>.md`(2.x 지원 · 2.0.18은 전체 허용만 · 데이터 폴더를 1.x와 같이 쓴다).
- 이 plan에 "달라진 것"과 완료 증명(명령 출력 요약·변이 표·진짜 CLI 결과)을 적는다.

## 3. 변이 표 (2026-11-19 — 돌린 전체는 §6)

| # | 변이 | 잡아야 하는 테스트 | 결과 |
|---|---|---|---|
| 1 | `MIN_SUPPORTED_V2` → `[2,0,0]` | `opencode.version.test` | 잡힘 |
| 2 | major 3 거부 삭제 | `opencode.version.test`, `index.test` | 잡힘 |
| 3 | 방언을 늘 `v1` | `opencode.version.test`, `opencode-v2.e2e` | 잡힘 |
| 4 | `execution.ts`가 `dialect: null` | `execution.test` | 잡힘 |
| 5 | `agents.build` 권한 삭제 | `permission.test`, real #3 | 잡힘 |
| 6 | 편집 허용에 `shell allow` | `permission.test`, real #5 | 잡힘 |
| 7 | MCP 키 리터럴 | `permission.test` | 잡힘 |
| 8 | `--agent build` 삭제 | `opencode.command.test`, e2e, real #4 | 잡힘 |
| 9 | `--standalone` 삭제 | `opencode.command.test`, e2e | 잡힘 |
| 10 | "뒤는 전부 deny" 삭제 | `opencode.verify.test` | 잡힘 |
| 11 | v1 확인을 "ask 없음"으로 | `opencode.verify.test` | 잡힘 |
| 12 | `unverifiable`에서 권한 안 봄 | `opencode.verify.test`, e2e | 잡힘 |
| 13 | 판정 실패를 `unverifiable`로 | `opencode.verify.test` | 잡힘 |
| 14 | 세션 확인 삭제 | `opencode.verify.test` | 잡힘 |
| 15 | `codemode: false` 삭제 | `configFile.test` | 잡힘 |
| 16 | 조회의 `--standalone` 삭제 | `auth.test`, `models.test` | 잡힘 |
| 17 | `?? id` 삭제 | `opencode.parse.test` | 잡힘 |
| 18 | `metadata.metadata` 무시 | `opencode.detail.test` | 잡힘 |
| 19 | `execute`의 `error` 무시 | `opencode.parse.test` | 잡힘 |
| 20 | `TOOL_LABELS.shell` 삭제 | `timeline.test` | 잡힘 |

## 4. 위험

1. **무료 모델의 한도.** 실측과 9단계가 `opencode/big-pickle`에 기댄다. 분당 한도에 두 번 닿았다. 자격 증명이 있으면 다른
   모델로 돌릴 수 있다 — 없으면 케이스를 나눠 돌린다.
2. **`debug agents`의 1.4~1.8초가 OpenCode 턴마다 붙는다**(2.3.2 이상). v1의 `debug config`도 지금 턴마다 돈다 — 같은 자리,
   더 느리다. 캐시하지 않는다(프로젝트 `opencode.json`이 턴 사이에 바뀔 수 있고, 그것을 잡는 것이 이 확인의 일이다).
3. **타입을 넓히는 3단계가 테스트 파일 여럿을 건드린다.** 기계적이지만 넓다 — 그 단계는 동작을 바꾸지 않고 따로 커밋한다.
4. **`OPENCODE_CONFIG_CONTENT`는 환경변수라 agent의 셸 자식에게 보인다.** 권한 규칙뿐이라 비밀은 없지만, 그 자식이 다시
   opencode를 띄우면 같은 규칙이 걸린다(전체 허용의 `* allow` 포함). 받아들인다.
5. **이 장비의 PATH가 2.3.2다.** 작업 중 one-desk의 OpenCode 실행은 2단계가 끝날 때까지 막혀 있다 — 급하면 설정 앱 탭의 CLI 기본
   경로에 1.18.30(`…\SST.opencode_…\opencode.exe`)을 넣는다.

## 5. 완료의 뜻

- `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 통과.
- 9단계의 세 명령 통과(1.18.30 · 2.0.18 · 2.3.2).
- 변이 표 20줄이 전부 "잡힘".
- spec §7의 성공 기준 전부.
- 릴리스(버전 올림·태그)는 이 plan의 범위가 아니다 — 끝난 뒤 따로 묻는다.

## 6. 구현 기록 (2026-11-19)

### 달라진 것

1. **세션 확인은 launch 시점에 이미 아는 세션만 본다** (FR-14). plan은 "이으면 확인한다"였는데, 세션 id는 `beginRun`(슬롯을
   받은 뒤, 동기)에서 정해진다 — 앞 턴이 도는 중에 예약된 턴은 launch 때 세션이 아직 없다. 그래서 `knownSessionOf`가 그때 이미
   남아 있는 세션만 실행 직전 확인에 넘기고, 없으면 건너뛴다(그 세션은 지금 쓰이는 중이라 없을 수 없다). 비동기 확인을
   `beginRun` 뒤에 끼우면 "running인데 manager에는 없는" 틈이 하나 더 생겨 취소가 닿지 않는다.
2. **화면도 `path`를 읽어야 했다.** plan은 "방언은 어댑터와 도구 이름 표 밖으로 나가지 않는다"였는데, 대화록의 한 줄 부제는
   `renderer/timeline.ts`가 도구 입력에서 직접 뽑는다(`file_path`·`filePath`). 2.x의 `path`가 빠져 읽기 줄이 "읽기"뿐이었다 —
   e2e가 찾았다. grep·glob의 `path`(찾는 자리)가 검색어를 가리지 않게 검색어 뒤에 본다.
3. **인증·모델 조회가 방언을 받는다** (`core/agent/auth.ts`·`models.ts`). spec NFR-1의 파일 목록 밖이다 — 2.x의 조회에
   `--standalone`을 붙일 자리가 거기뿐이다. 안내(`statusNote`)의 판정은 어댑터에 남겼다(`AgentAdapter.statusNote`).
4. **방언은 설정 화면으로 나가지 않는다.** `checkAgents`가 preflight 결과를 그대로 IPC로 내보내므로 `dialect`를 떼고 보낸다
   (IPC 모양이 안 바뀐다 — NFR-4).
5. **e2e에서만 잡히던 배선을 통합 테스트로 옮겼다.** `core/index.ts`의 `checkAuth`·`listModels`·`statusNote` 세 줄은 단위
   테스트가 못 본다. 가짜 opencode의 2.x 모드로 core를 통째로 띄우는 테스트 둘(`core/index.test.ts`의 "opencode 2.x")이 본다 —
   e2e는 모델 목록이 비어도 초록이었다(변이 `i-models-dialect`가 살아남았다).
6. **`docs/sdlc/**/probes/**`를 린트에서 뺐다** — 실측 스크립트는 CommonJS다.
7. **1.x의 긍정 확인을 진짜 1.18.30으로 봤다** (`probes/probe10-v1-debug-config.cjs`, 모델 없음): 보낸 열일곱 키가 그대로
   돌아오고, 프로젝트의 `bash: { … }` 객체도 우리 문자열이 덮는다. 우리가 안 보낸 `mytool: ask`는 남아 지금 문장으로 막힌다.

### 단계별 결과

| 단계 | 커밋 | 비고 |
|---|---|---|
| 문서 | `8f9efbe` | intent·spec·plan·probes |
| 2 버전과 방언 | `aba1192` | |
| 3 타입을 흐르게 | `751e29d` | 동작 변화 없음 |
| 4 권한 규칙 | `06fa196` | |
| 5 명령과 실행 직전 확인 | `648f144` | 진짜 1.18.30·2.0.18·2.3.2로 확인(모델 없음) — 아래 |
| 6 MCP 설정·설정 화면 | 둘 (`feat(mcp)`, `c779a19`) | |
| 7 파서와 세부 | `aac7acc` | 픽스처는 진짜 2.0.18·2.3.2의 출력 |
| 8 가짜 CLI와 e2e | `59e522c` | |
| 9 진짜 CLI 테스트 | `5257351` | 2026-11-20에 세 바이너리로 돌렸다 — 아래 |

**진짜 바이너리로 본 실행 직전 확인** (5단계, 모델 호출 없음):

| | 빈 프로젝트 | 프로젝트 `agents.build` allow | 없는 세션 |
|---|---|---|---|
| 1.18.30 | 세 권한 통과 (1.3초) | 거부 — 1.x가 2.x 모양의 설정을 못 읽는다 | (1.x는 보지 않는다) |
| 2.0.18 | 읽기 전용·편집 허용 거부(FR-8a) · 전체 허용 통과 | 같다 | 거부 |
| 2.3.2 | 세 권한 통과 (1.2초) | 세 권한 통과 — 우리 규칙이 뒤에 있다 | 거부 |

### 완료 증명 (모델 없이 되는 것)

- `pnpm test` — 216 파일 · 3,840 통과 · 52 건너뜀(선택 실행).
- `pnpm typecheck` · `pnpm lint` — 오류 0.
- `pnpm test:e2e` — 42 파일 · 92 통과 · 4 건너뜀(선택 실행). `e2e/opencode-v2.e2e.ts` 둘 포함.

### 진짜 CLI 검증 — 2026-11-20에 돌렸다

11-19에는 `opencode/*` 무료 모델이 계정 단위 한도에 걸려 못 돌렸고, 한도가 풀린 11-20 09:49에 `opencode/big-pickle`로 돌렸다.

```
ONE_DESK_REAL_CLI=1 ONE_DESK_REAL_OPENCODE_MODEL=opencode/big-pickle ONE_DESK_REAL_OPENCODE_PATH=<바이너리> pnpm test realOpencode
```

| 바이너리 | 결과 |
|---|---|
| 2.3.2 | 6 통과 — 읽기 전용 넷(빈 프로젝트 · 최상위 permissions · `agents.build.permissions` · `default_agent`), 편집 허용, MCP 직접 호출 |
| 2.0.18 | 4 통과 — 읽기 전용·편집 허용이 실행 전에 막힌다, 전체 허용에서 셸·파일 생성, one-desk MCP 도구 직접 호출 |
| 1.18.30 | 2 통과 — 읽기 전용에서 MCP `list_repos`, 셸은 막힘 |

- **2.0.18은 `OPENCODE_CONFIG` 파일(MCP)과 `codemode: false`를 읽는다** — `one-desk_list_repos`가 직접 불렸다. 다만 전체 허용에서는
  `execute` 도구가 살아 있어(사용자 설정의 다른 codemode 도구용) 모델이 도구를 찾으려고 먼저 부르기도 한다. 그 테스트가
  "`execute`가 없다"를 단언하던 것은 뺐다 — 증명은 직접 불린 도구 줄이다.
- **모델을 부르지 못한 run이 통과로 찍히던 구멍을 막았다.** OpenRouter 모델로 돌렸을 때 provider 인증 401로 끝난 run이 읽기 전용
  넷을 공짜로 통과시켰다("아무 일도 일어나지 않았다"). 한도가 아닌 오류 줄(`{"type":"error"}`)은 이제 실패다.
- **취소**: 도는 2.3.2 run(`--standalone`)을 `taskkill /PID /T /F`로 끊었다 — 도는 동안 opencode 프로세스 2개, 끊은 3초 뒤 0개.
  백그라운드 서비스가 남지 않는다. 테스트 세 벌이 끝난 뒤에도 남은 프로세스는 없었다.
- **못 한 것**: one-desk 앱 화면의 `실행 중인 턴 멈추기`·앱 종료를 진짜 2.x로 눌러 보는 것. 그 길(manager의 `taskkill /T /F`)은
  위에서 같은 명령으로 봤고, 가짜 CLI의 e2e가 화면 쪽을 본다.
- 편집 `files[].status`의 `added`·`deleted`는 이름으로 미루어 받는다(실측은 `modified`뿐). 로그인된 `auth list`의 모양.
- 릴리스 노트(`docs/releases/<태그>.md`)는 버전을 정할 때 쓴다.

### 변이

변이 54개를 돌렸다(단위 44 · 통합 4 · e2e 3 · 배선 3). **처음에 둘이 살아남았고, 테스트를 더해 둘 다 잡았다.**

- `m13` — 확인기의 "판정 실패면 거부" 줄을 지워도 초록이었다. 빈 출력은 뒤의 규칙 판정이 어차피 거부했기 때문이다. 실패한
  명령이 **그럴듯한 목록을 찍은** 경우를 테스트에 더하니 잡혔다(그때는 그 줄만이 막는다).
- `e2e-index-models-dialect` — `core/index.ts`가 모델 조회에 방언을 안 넘겨도 e2e가 초록이었다(목록이 비어도 화면은
  멀쩡하다). 가짜 2.x로 core를 띄우는 통합 테스트를 더해 잡았다.

§3의 표 20줄은 전부 "잡힘"이다. 5·6·8의 "real #n" 칸만 위 한도 때문에 비어 있다 — 단위 테스트와 가짜 CLI(exit 2)는 잡는다.
