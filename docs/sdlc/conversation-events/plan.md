# Plan: 대화가 버리는 데이터를 살린다

- 출처: `intent.md`, `spec.md`
- 선행: `docs/sdlc/conversation-fixes/` — **1~4단계는 그것이 `main`에 들어간 뒤 착수한다.**
  `docs/sdlc/conversation-timeline/` — **5~7단계는 그것이 `main`에 들어간 뒤 착수한다.**
- 작성자: 권용현 (Claude가 초안)
- 상태: 초안 (2026-09-27)
- 작성일: 2026-09-27

## spec에서 다듬은 것

spec의 결정을 뒤집지 않고 모양만 맞춘다.

1. **단계 순서는 "어댑터 → manager/로그 → shared → 렌더러 투영 → 렌더러 화면 → 문서"다.** 다만 이벤트
   **타입**(`shared/events.ts`의 유니온 확장)은 1단계에서 먼저 넣는다 — 어댑터가 `RunEventInit`을 돌려주므로
   타입 없이는 컴파일되지 않는다. 3단계의 "shared"는 크기 규칙(`RUN_EVENT_WINDOW`·`eventWeight`)과 그것을
   쓰는 `readLog`·스토어다. 어댑터는 claude·opencode를 따로 한 단계씩 둔다(7단계).

2. **착수 시점과 기준선.** fixes가 `manager.ts`(판정·`onSession`)·`opencode.ts`(`error` 줄·버전 게이트)·
   `run.ts`의 `readLog`(비동기)·`runEvents.ts`의 `hydrate`(seq 병합)를 먼저 고친다(spec §7 우려 19). fixes가
   병합된 `main`에서 브랜치를 따고 `pnpm test` 통과 수를 기준선으로 적는다. timeline이 늦어지면 **1~4단계만
   먼저 병합할 수 있다** — core·shared·스토어만 바뀌고 화면은 그대로다(새 이벤트 종류는 TL 투영이 모르는
   종류로 무시한다). 그때도 기존 화면은 깨지지 않아야 한다(4단계 완료 확인).

3. **이름을 여기서 정한다.**
   - core: `core/runner/adapters/common.ts`에 `OUTPUT_MAX_CHARS`(65,536)·`REASONING_MAX_CHARS`(65,536)·
     `HUNKS_MAX_CHARS`(131,072)·`BEFORE_MAX_CHARS`(131,072), `keepTail()`·`keepHead()`·`capEditFiles()`·
     `toolResultText()`. claude 모양 판정은 `claudeCode.detail.ts`(`claudeToolDetail()`), opencode는
     `opencode.detail.ts`(`opencodeToolDetail()`·`parseUnifiedDiff()`) — 어댑터 파일이 이미 270~310줄이라
     떼어 둔다. 공지 문구는 각 detail 파일 옆의 순수 함수(`claudeNotice()`·`opencodeDeniedNotice()`).
   - 원본 로그: `core/runner/logWriter.ts`에 `createRawLogWriter(path, maxBytes, onError)`,
     `RAW_LOG_MAX_BYTES`(32 MiB). manager에 `rawLogPathFor()`와 옵션 `rawLogMaxBytes?`(테스트용).
   - shared: `shared/events.ts`에 `PatchHunk`·`EditFileDetail`·`ToolDetail`·`NoticeKind`·`RUN_EVENT_WINDOW`·
     `eventWeight()`.
   - renderer: `renderer/diff.ts`에 `hunksFromPatch()`, 새 `renderer/ansi.ts`(`stripAnsi()`).
   - 클래스: `.tl-reasoning`·`.tl-reasoning-body`·`.tl-output`(출력 블록 공용)·`.tl-output-note`(잘림
     안내)·`.tl-diff-no`(번호 칸)·`.tl-diff-gap`·`.tl-subagent`·`.tl-subagent-head`·`.tl-subagent-children`·
     `.tl-subagent-note`·`.tl-notice-warn`(거부·대체). TL이 만든 `.tl-tool`·`.tl-notice`·`.tl-edit`·`.tl-file`·
     `.tl-diff`는 이름을 지킨다.
   - 픽스처: `core/runner/adapters/fixtures/claude-events.jsonl`·`opencode-events.jsonl` — **합성**이다(spec
     §7 우려 3). JSONL에는 주석을 못 달므로 모양의 출처(스키마·기록·소스·바이너리)는 테스트 파일 머리에 적는다.
   - 가짜 CLI: `ONE_DESK_FAKE_SCRIPT=events` — `fake-claude.mjs`·`fake-opencode.mjs` 둘 다. 기본 시나리오와
     TL의 `timeline` 스크립트는 건드리지 않는다.

4. **한 줄에서 나오는 이벤트의 순서를 여기서 못박는다.** claude `assistant` 줄 → 블록 순서대로(`reasoning`·
   `text`·`tool_use`), `user` 줄 → `tool_result`(블록 순서), `result` 줄 → `result` → `usage` → `notice…`
   (spec FR-19), `system` 줄 → `notice` 하나 또는 없음. opencode `tool_use` 줄 → `tool_use` → `tool_result` →
   (거부면) `notice`. 테스트가 이 순서를 고정한다 — seq는 manager가 붙이므로 순서가 곧 화면 순서다.

5. **"thinking을 버린다"의 자리.** intent는 CLAUDE.md라고 했지만 실제로는 `claudeCode.ts`의 주석·
   `claudeCode.parse.test.ts`의 테스트·2단계 계획의 표에 있다(spec §7 우려 18). 주석과 테스트는 1단계에서
   고치고, 옛 계획 문서는 기록으로 둔다. 새 규칙은 7단계에서 CLAUDE.md에 적는다.

6. **가짜 opencode는 `--thinking`이 있을 때만 reasoning 줄을 낸다** — 실제 run 루프(`run.ts`:766)와 같게.
   그래야 `buildCommand`에서 플래그를 빼는 변이를 e2e가 잡는다(CLAUDE.md "배선도 검증 대상이다").

7. **e2e는 단계마다 그 단계가 깬 파일만 돌린다.** `pnpm build` 뒤 `pnpm vitest run --config
   vitest.e2e.config.ts e2e/<파일>`. **`pnpm dev`를 끄고 돌린다**(CLAUDE.md — 같은 `out/`을 쓴다). 전체
   `pnpm test:e2e`는 마지막 단계에서.

8. **모델을 부르는 실행은 하지 않는다.** 실측이 필요한 것(스트림의 `originalFile` 한계, `-p`의 thinking 본문,
   `model_fallback`이 오는지)은 **사용자가 실제 run을 한 번씩 돌린 뒤** 그 run의 `raw.jsonl`에서 확인하고
   픽스처를 바꾼다 — 완료 증명의 후속 항목이다.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `shared/events.ts` | 수정 | 선택 필드·`reasoning`·`notice`·detail 타입(1단계), 창·무게(4단계) |
| `shared/events.test.ts` | 신규 | `eventWeight` |
| `core/runner/adapters/common.ts`·`common.test.ts`† | 수정/신규 | 상한 넷과 함수 (FR-10~12) |
| `core/runner/adapters/claudeCode.ts` | 수정 | output·detail·reasoning·출처·공지·PowerShell (FR-13~20) |
| `core/runner/adapters/claudeCode.detail.ts`·`.test.ts` | 신규 | 모양 판정·공지 문구 |
| `core/runner/adapters/claudeCode.parse.test.ts` | 수정 | thinking 테스트 고침, 새 줄들, 옛 줄 스냅샷 |
| `core/runner/adapters/opencode.ts` | 수정 | `--thinking`·reasoning·output·detail·거부 공지·apply_patch (FR-21~28) |
| `core/runner/adapters/opencode.detail.ts`·`.test.ts` | 신규 | 도구별 detail·`parseUnifiedDiff`·거부 문구 |
| `core/runner/adapters/opencode.parse.test.ts`·`opencode.command.test.ts` | 수정 | 새 줄들, `--thinking` |
| `core/runner/adapters/fixtures/claude-events.jsonl`·`opencode-events.jsonl` | 신규 | 합성 픽스처 |
| `core/runner/logWriter.ts`·`.test.ts` | 수정 | `createRawLogWriter` (FR-3·4) |
| `core/runner/manager.ts`·`.test.ts` | 수정 | 원본 줄 기록, `rawLogPathFor`, 두 writer 닫기 (FR-1~5) |
| `core/db/repositories/run.ts`·`.test.ts` | 수정 | `readLog` 꼬리 창 (FR-33·34) |
| `core/runner/fixtures/fake-claude.mjs`·`fake-opencode.mjs` | 수정 | `ONE_DESK_FAKE_SCRIPT=events`, opencode `--thinking` 조건 |
| `core/runner/fixtures.test.ts` | 수정 | 두 스크립트, `--thinking` 조건 |
| `renderer/store/runEvents.ts`·`.test.ts` | 수정 | 글자 예산 (FR-31·32) |
| `renderer/timeline.ts`·`.test.ts` | 수정 | FR-35~42 |
| `renderer/diff.ts`·`.test.ts` | 수정 | `hunksFromPatch`, 번호·간격 필드 |
| `renderer/ansi.ts`·`.test.ts` | 신규 | `stripAnsi` |
| `renderer/components/TimelineBlocks.tsx` | 수정 | 출력 블록·번호 diff·생각·카드·공지 (FR-43~50·52) |
| `renderer/components/Transcript.tsx`·`.test.tsx` | 수정 | 접힌 턴 요약·상태 줄 (FR-51) |
| `renderer/index.css` | 수정 | 위 클래스 |
| `e2e/events.e2e.ts` | 신규 | spec §8 |
| `e2e/timeline.e2e.ts` | 수정 | `(N개 일치)` → `(파일 N개)` (spec §7 우려 16) — 있으면 |
| `e2e/zz-events-capture.e2e.ts` | 임시 | 캡처 — **커밋하지 않는다** |
| `CLAUDE.md` | 수정 | 현재 상태·함정 |
| `docs/superpowers/specs/2026-08-07-one-desk-design.md` | 수정 | 로그 디렉토리 그림에 `raw.jsonl` 한 줄 |
| `docs/superpowers/specs/2026-09-06-opencode-adapter-design.md` | 수정 | §10-1 각주(edit은 hunk만, before 없음) |
| `docs/sdlc/run-info/spec.md` | 수정 | §7 각주(원본 줄 로그 — spec §7 우려 1의 결정에 따라) |

**건드리지 않는 것**: `drizzle/`·`core/db/schema.ts`(마이그레이션 없음) · `shared/models.ts`·`client.ts`·
`channels.ts` · `electron/ipc/*` · preload · `core/execution.ts`·`core/index.ts`(manager 옵션은 기본값을 쓴다) ·
`core/runner/permission.ts`(fixes의 것) · `renderer/App.tsx` · `Dock.tsx`·`RunPanel.tsx`·`ConversationHeader.tsx`
(TL의 것) · `Markdown.tsx`(생각·출력은 마크다운을 타지 않는다).

## 작업 순서

각 단계는 **실패하는 테스트를 먼저 쓰고** 구현한다. 회귀 테스트는 대상을 잠시 망가뜨려 빨개지는지 본다
(CLAUDE.md). 단계 끝마다 `pnpm typecheck` + 그 단계의 단위 테스트, 화면이 바뀐 단계는 깬 e2e 파일까지.

### 1. 이벤트 타입·공통 상한·claude 어댑터

`shared/events.ts`의 유니온 확장(창·무게는 4단계), `common.ts`의 상한, `claudeCode.detail.ts`,
`claudeCode.ts`의 `user`·`assistant`·`system`·`result` 분기, `TOOL_EFFECTS`의 PowerShell,
`claude-events.jsonl`.

- 먼저 쓸 테스트: `common.test.ts`(spec §8), `claudeCode.detail.test.ts`(FR-14 표의 행마다),
  `claudeCode.parse.test.ts`의 FR-13·15~19. **옛 줄 호환 스냅샷을 가장 먼저 찍는다** — 구현 전의 어댑터로
  `claude-stream.jsonl`(thinking 줄 제외)을 파싱한 결과를 테스트에 적어 두고, 구현 뒤에도 같아야 한다
  (`at`은 비교에서 뺀다).
- 합성 픽스처의 줄: thinking(서명 4KB)·빈 thinking·`redacted_thinking` / Edit·Write create·Write update·
  Bash·PowerShell 성공 / 실패 Bash(`tool_use_result` 문자열, `content` `Exit code 2\n…`) / Grep 세 모드·Glob /
  Agent 동기·비동기와 `parent_tool_use_id`가 달린 자식 두 줄 / MCP 배열 content(text+image) / system 넷 +
  `status`(버림) / `permission_denials` 두 개인 result. 줄마다 `uuid`.
- 깨질 수 있는 기존 테스트:
  - `claudeCode.parse.test.ts` "thinking 블록은 버린다" — 고친다(thinking → reasoning, 서명 없음).
  - 같은 파일의 "관심 없는 줄은 빈 배열을 반환한다"·"rate_limit_event는…" — 쓰는 줄이 새로 받는 subtype이면
    바꾼다(버리는 subtype으로).
  - 픽스처 4행을 쓰는 테스트 중 **이벤트 수를 세는 것** — reasoning 하나가 는다.
- 깨질 수 있는 e2e: 없다(가짜 CLI의 기본 시나리오에 thinking·system 공지가 없다).
- 완료 확인: typecheck 초록. 서명을 싣게 바꾸면 "서명 글자가 없다"가, `keepTail`을 앞부분으로 바꾸면 끝부분
  테스트가, 메인 스레드에 `parentToolUseId: null`을 넣으면 FR-7 테스트가, 모양 판정의 Write/Edit 순서를 뒤집으면
  "Write update는 overwrite다"가 빨개진다. NFR-2 grep이 어댑터 밖에서 출력 없음.

### 2. opencode 어댑터

`opencode.detail.ts`(`parseUnifiedDiff` 포함), `opencode.ts`의 `buildCommand`(`--thinking`)·`reasoning`
분기·`tool_use` 분기(output·summary·detail·거부 공지), `TOOL_EFFECTS`의 apply_patch, `opencode-events.jsonl`,
`fake-opencode.mjs`의 `--thinking` 조건과 `events` 스크립트.

- 먼저 쓸 테스트: `opencode.detail.test.ts`(FR-24 표, 유닛 diff 경계), `opencode.parse.test.ts`의 FR-22·23·25·26,
  `opencode.command.test.ts`의 FR-21, `fixtures.test.ts`의 "가짜 opencode는 `--thinking`이 있을 때만 reasoning을
  낸다".
- 합성 픽스처의 줄: reasoning(서명 metadata 포함)·공백뿐인 reasoning / bash completed `exit: 1`·error
  `interrupted` / grep·glob / edit `filediff.patch`(hunk 둘, `\ No newline` 포함) / write `exists: false`·`true` /
  apply_patch `files[]` / task / 권한 거부 두 문구 / 다른 오류 문구. 기존 실측 픽스처(`opencode-stream.jsonl`)는
  그대로 두고, read·write 줄에서 **detail만 늘고 나머지는 같다**를 스냅샷으로 고정한다.
- 깨질 수 있는 기존 테스트:
  - `opencode.parse.test.ts` "실패한 도구는 ok=false다" — `state.error`가 없고 `output`만 있는 줄이다. FR-23의
    `state.error ?? state.output`로 그대로 통과해야 한다(돌려서 확인).
  - `opencode.command.test.ts`에서 인자 배열 전체를 `toEqual`로 보는 곳 — `--thinking`이 끼어든다.
  - `fixtures.test.ts`의 "직접 실행하면 opencode 형식 NDJSON을 낸다" — 기본 출력은 그대로여야 한다.
- 깨질 수 있는 e2e: 없다(e2e는 기본으로 가짜 claude를 쓴다). `opencode-real`은 선택 실행 — 플래그가 1.18.30에
  있으므로 통과해야 한다(사용자가 돌릴 때).
- 완료 확인: `--thinking`을 빼면 명령 테스트와 fixtures 테스트가, 거부 문구 상수를 바꾸면 공지 테스트가,
  `part.metadata`를 reasoning에 실으면 "서명 없음"이 빨개진다.

### 3. manager — 원본 줄 로그

`createRawLogWriter`, manager의 `rawLogPathFor`·줄 기록(파싱 전)·두 writer 닫기·옵션 `rawLogMaxBytes`.

- 먼저 쓸 테스트: `logWriter.test.ts`(상한 표식 한 번·큰 한 줄·열기 실패·close), `manager.test.ts`(spec §8 —
  fixes가 만든 `withScript` 도우미를 쓴다. `node <스크립트>`로 띄우므로 **Windows에서도 실제로 돈다**; 깨진 줄·
  `rate_limit_event`·서명이 든 줄을 섞는다).
- 확인할 것: 줄 분할기가 `\r\n`의 `\r`을 걷으므로 `raw.jsonl`은 CLI가 CRLF로 써도 LF다 — 테스트에 적는다.
- 깨질 수 있는 기존 테스트: `manager.test.ts`에서 로그 디렉토리의 파일 목록을 세는 곳(있다면), "로그 파일을
  열지 못해도 run은 끝나고…" — 같은 디렉토리의 두 번째 writer가 **오류를 한 번 더** `onError`로 보낼 수 있다.
  기대 호출 수를 "적어도 한 번"으로 보는지 확인한다.
- 깨질 수 있는 e2e: 없다.
- 완료 확인: 원본 기록을 `parseLine` 뒤로 옮기고 파싱에 성공한 줄만 쓰게 하면 "깨진 줄도 남는다"가, 표식의
  한 번 가드를 빼면 "표식은 한 번"이, run 종료에서 원본 writer를 닫지 않으면(Windows는 열린 파일을 못 지운다 —
  CLAUDE.md) 임시 디렉토리 정리가 빨개진다.

### 4. shared 창 — `readLog` 꼬리와 스토어 예산

`RUN_EVENT_WINDOW`·`eventWeight`, `run.ts`의 `readLog`(fixes의 비동기 위에), `runEvents.ts`의 `push`·
`hydrate`(fixes의 seq 병합 위에)와 `maxCharsPerRun`.

- 먼저 쓸 테스트: `shared/events.test.ts`, `run.test.ts`의 FR-33·34·6, `runEvents.test.ts`의 FR-31.
  **옛 로그 픽스처**: 이 기능 전 모양의 줄만 든 `stream.jsonl`을 테스트가 만들어 읽는다(필드 없는 줄).
- `shared/`의 테스트는 core 프로젝트의 include(`shared/**/*.test.ts`)에 이미 걸린다 — 새 파일이 **실제로 도는지**
  실행 수로 확인한다(CLAUDE.md의 함정).
- 깨질 수 있는 기존 테스트: `runEvents.test.ts`의 `maxPerRun` 테스트(옵션 이름을 지키므로 그대로여야 한다),
  `run.test.ts`의 `readLog` 셋(창보다 작은 로그라 그대로).
- 깨질 수 있는 e2e: 없다. **timeline이 아직 없으면 여기서 멈추고 병합할 수 있다** — 그때 core-loop·conversation
  e2e를 한 번 돌려 지금 화면(`RunLog`)이 새 종류를 만나도 깨지지 않는지 본다(모르는 `type`은 그리지 않아야 한다).
- 완료 확인: `maxChars`를 무한으로 두면 스토어 예산 테스트가, `readLog`가 앞에서부터 자르면 꼬리 테스트가
  빨개진다.

### 5. 렌더러 투영

`renderer/timeline.ts`(FR-35~42), `renderer/diff.ts`의 `hunksFromPatch`, `renderer/ansi.ts`.
**화면은 아직 바꾸지 않는다** — 투영만 넓힌다.

- 먼저 쓸 테스트: spec §8의 `timeline`·`diff`·`ansi`. **TL의 기존 `timeline.test.ts`를 먼저 그대로 돌려 둔다** —
  새 필드가 없는 이벤트의 결과가 같다는 것이 옛 로그 호환의 증명이다. 요약 모양이 `{tools, failed}` →
  `{tools, failed, denied, compacted}`로 넓어진 단언만 고친다.
- `projectTurn`의 입력에 `startedAt`이 더해진다 — 부르는 곳(`Transcript`의 `Turn`)이 run을 그대로 넘기면
  typecheck가 통과한다. 테스트 도우미의 run 모양에 `startedAt`을 더한다.
- 깨질 수 있는 기존 테스트: `timeline.test.ts`의 요약 단언, `matches`를 보는 단언(`matchUnit`이 더해진다),
  하위 에이전트가 들어간 묶음 테스트가 있으면(카드로 빠진다 — spec §7 우려 17).
- 깨질 수 있는 e2e: 없다(화면은 아직 그대로).
- 완료 확인: 거부 공지 중복 제거를 빼면 "한 번만"이, 자식을 메인 스코프에 두면 "메인만 센다"가, reasoning
  추정의 기준을 늘 `run.startedAt`으로 바꾸면 "앞 이벤트부터 잰다"가, `hunksFromPatch`의 `-` 줄이 새 번호를
  세게 바꾸면 번호 테스트가 빨개진다.

### 6. 렌더러 화면과 e2e

`TimelineBlocks.tsx`(출력 블록·번호 diff·이전 내용·생각·카드·공지·생략 안내), `Transcript.tsx`(접힌 턴 요약·
상태 줄), `index.css`, 가짜 claude의 `events` 스크립트, `e2e/events.e2e.ts`.

- 먼저 쓸 테스트: spec §8의 컴포넌트 단언(FR-43~52). jsdom에서 "열 때 바닥"은 `scrollHeight`·`clientHeight`를
  `defineProperty`로 세워 `scrollTop`을 본다. 번호 칸의 `user-select: none`은 클래스로 확인한다(jsdom은 CSS를
  계산하지 않는다 — 실제로 복사에서 빠지는지는 캡처 단계에서 손으로 본다).
- 가짜 claude `events` 스크립트: spec §8 e2e의 순서대로, 사이마다 `ONE_DESK_FAKE_STEP_MS`(TL과 같은 변수).
  마지막에 JSON이 아닌 줄 하나. 출력 7만 자는 스크립트 안에서 만든다(파일에 박지 않는다).
- `e2e/events.e2e.ts`: 턴을 **펼친 뒤** 단언한다(접힌 턴에는 블록이 없다 — TL FR-12). `권한 때문에 막힘: Bash`는
  `toHaveCount(1)`. 로그 확인은 `session.dataDir`의 `logs/` 아래 유일한 디렉토리를 찾는다. opencode 쪽은
  `launchApp({ agentPath: <fake-opencode.mjs> })`로 새 세션을 띄우고 실행 패널에서 OpenCode를 고른다.
- 깨질 수 있는 기존 테스트: `Transcript.test.tsx`의 요약 줄 글자(0인 조각이 빠지므로 그대로여야 한다),
  TL 블록 테스트의 `(N개 일치)`(→ 단위별 글자).
- 깨질 수 있는 e2e: `timeline.e2e.ts`의 `(3개 일치)`(TL 스크립트의 Grep은 `Found 3 files` — 이제
  `(파일 3개)`), core-loop·conversation(기본 시나리오 — 그대로여야 한다). 돌려서 확인한다.
- 완료 확인: typecheck·lint, 위 테스트, e2e events·timeline·core-loop·conversation. 생각 블록을 `Markdown`으로
  그리면 "글자 그대로"가, 출력 블록에서 `stripAnsi`를 빼면 ANSI 테스트가, `buildCommand`의 `--thinking`을 빼면
  e2e의 opencode 생각 단언이 빨개진다.

### 7. 캡처·문서·전체 검증

- `e2e/zz-events-capture.e2e.ts`로 라이트·다크 여섯 장면씩(spec §8 "화면 캡처"). 볼 것: 다크에서 흰 채로 남은
  칸, 번호 칸과 본문의 정렬, 출력 블록의 가로 넘침, 카드 안 들여쓰기와 세로선, 공지 글자색 대비(4.5:1),
  번호를 빼고 복사되는지(손으로 한 번). 고칠 것이 나오면 고치고 다시 찍는다. 끝나면 zz 파일을 지운다.
- `CLAUDE.md` — 현재 상태 한 절, 그리고 함정:
  (1) **새 이벤트 필드는 값이 있을 때만 싣는다** — null로 채우지 말 것,
  (2) **claude의 `tool_use_result`에는 도구 이름이 없고 실패하면 문자열이다** — detail은 모양으로 가르고
  종료 코드는 `content`의 `Exit code N`에서 읽는다,
  (3) **opencode의 reasoning은 `--thinking` 없이는 오지 않는다**, 1.18.30의 `filediff`에는 `before`가 없다,
  (4) **thinking은 텍스트만 저장한다 — 서명은 정규화 로그에 싣지 않는다**(옛 "thinking은 버린다"를 대신한다),
  (5) **`raw.jsonl`은 재파싱 재료다** — `readLog`는 읽지 않고, 32MiB에서 `type` 없는 표식 한 줄로 끝난다,
  (6) **상한은 `common.ts` 한 자리** — 어댑터 밖에서 다시 자르지 말 것,
  (7) **권한 거부 공지는 로그에 두 번 올 수 있다**(system + result) — 화면이 `toolUseId`로 한 번만 그린다,
  (8) **`readLog`와 스토어는 `RUN_EVENT_WINDOW` 하나를 같이 본다**,
  (9) claude의 thinking은 대부분 본문 없이 온다(기록 1,851개 중 1,800개) — 생각 블록이 안 보이는 것은 결함이
  아닐 수 있다.
- 설계 문서 각주 셋(변경 파일 표) — run-info §7은 spec §7 우려 1의 결정대로 적는다.
- 전체: `pnpm test`·`pnpm typecheck`·`pnpm lint`·`pnpm test:e2e`, spec §8의 grep.

## 리스크

- **fixes·timeline과 같은 파일을 연달아 고친다**(다듬은 것 2). 병합 전에 시작하면 `manager.ts`·`opencode.ts`·
  `timeline.ts`·`TimelineBlocks.tsx`에서 충돌이 크게 난다. 1~4단계와 5~7단계 사이에 timeline 병합을 기다릴 수 있다.
- **합성 픽스처가 실제와 다를 수 있다**(spec §7 우려 3). 어댑터는 모든 필드를 방어적으로 읽고(타입이 다르면
  detail·공지를 통째로 버린다), 실제 `raw.jsonl`이 생기면 그 줄로 바꾼다. 특히 claude가 `-p`에서 thinking 블록과
  다른 블록을 한 줄에 싣는 경우(기존 픽스처 4행이 그렇다) reasoning 시간 추정이 0에 가까워진다 — "약"으로
  표시하는 이유다.
- **Windows의 가짜 CLI 함정.** 단위 테스트에서 `ONE_DESK_AGENT_PATH`만 세운 run은 spawn조차 안 되어 `raw.jsonl`이
  비어 있다(CLAUDE.md). 원본 로그 테스트는 전부 `executable: process.execPath` + 스크립트 인자(`withScript`)로 띄운다.
  e2e는 `ONE_DESK_AGENT_LAUNCHER`가 물려 두 플랫폼에서 같다.
- **Windows의 열린 파일.** writer가 하나 늘었다 — run 종료 경로와 오류 경로 모두에서 닫히지 않으면 테스트의
  `rmSync`가 Windows에서만 `EBUSY`로 죽는다(v0.2.0 릴리스가 이렇게 깨졌다). 3단계 완료 확인이 그것을 본다.
- **Playwright의 부분 일치.** 새 이름(`생각 · …`·`이전 내용 보기`·`하위 에이전트 …`)은 spec NFR-7로 대조했지만
  단계마다 e2e를 실제로 돌려 확인한다. RTL은 전체 일치라 단위 테스트는 초록인 채로 넘어간다(CLAUDE.md).
- **큰 출력의 렌더링.** 65,536자 `<pre>`가 여러 개 열리면 레이아웃이 무거울 수 있다 — 출력 블록은 펼칠 때만
  DOM에 만든다(열림 state가 거짓이면 그리지 않는다). 캡처 단계에서 7만 자 시나리오로 스크롤이 끊기는지 본다.
- **CRLF.** 도구가 파일을 CRLF로 다시 써 diff가 부푼 적이 있다(lifecycle plan). 커밋 전에 `git diff --stat`이 이
  작업의 크기와 맞는지 본다. 픽스처 JSONL은 LF다.

## 완료 증명

7단계(마지막 검증, 2026-09-27)에서 채웠다. 명령은 전부 저장소 루트에서 돌렸다 — 확인할 때 사용자의
`pnpm dev`(`electron-vite dev`)는 떠 있지 않았으므로(프로세스 명령줄로 두 번 확인) `pnpm test:e2e`도 저장소에서
돌렸다. 저장소를 건드리지 않아야 하는 것 — 기준선 측정·변이·캡처 — 은 scratchpad의 사본에서 돌렸다(아래 각 항목).
git 상태를 바꾸는 명령과 모델을 부르는 CLI는 쓰지 않았다.

- [x] 기준선(fixes 병합 직후)의 `pnpm test` 통과 수와 이 작업 뒤의 수
  - **최종(7단계, `pnpm test`)**: 파일 104 통과 · 1 건너뜀(105), 테스트 **2,104 통과** · 31 건너뜀(2,135), 25.1초.
    기준선에서 **+367**, 파일 98 → 105(+7 — 새 테스트 파일 일곱: `common.test`·`claudeCode.detail.test`·
    `opencode.detail.test`·`logTail.test`·`shared/events.test`·`ansi.test`·`diffContrast.test`). 건너뛴 파일이 2 → 1인 것은
    `core/runner/fixtures.test.ts`다 — 기준선에서는 셋 다 POSIX 전용이라 Windows에서 통째로 건너뛰었고, 이제 `node <스크립트>`로
    띄우는 `events` 블록이 Windows에서도 돌아 9 통과 · 9 건너뜀이다. 새 파일이 **실제로 도는지** JSON 리포터
    (`vitest run --reporter=json`)로 셌다 —
    `shared/events.test.ts` 5 · `common.test` 24 · `claudeCode.detail.test` 71 · `opencode.detail.test` 37 · `logTail.test` 4 ·
    `ansi.test` 9 · `diffContrast.test` 6, 전부 통과. 통째로 건너뛰는 파일은 `core/mcp/realCli.test.ts`(1) 하나다.
  - **기준선(`e6592e4`, fixes·timeline 병합 뒤의 HEAD)**: 파일 96 통과 · 2 건너뜀(98), 테스트 **1,737 통과** · 31 건너뜀.
    `git stash`를 쓰지 않으려고 `git archive HEAD`를 scratchpad에 풀고 `node_modules`만 접합점으로 이어 `npx vitest run`을
    돌렸다(끝나고 접합점만 `rmdir`). 1단계가 뺄셈으로 적은 1,737과 같다.
  - 1단계 뒤 1,864(+127), 6단계 뒤(리뷰 전) 2,069, 리뷰 반영 뒤(지적 25건 — 19 고침 · 6 미룸) 2,104. 7단계는 코드를 바꾸지
    않았다(문서만).
- [x] `pnpm typecheck` · `pnpm lint` 오류 0 — 7단계: `pnpm typecheck`(`tsc --build --force`) exit 0, `pnpm lint`(`eslint .`)
  exit 0, 출력 없음.
- [x] `pnpm test:e2e` — 파일 수, 새 파일 `events` 포함
  - **7단계 — 전체 `pnpm test:e2e` 두 번**(저장소에서, `electron-vite build` 포함): 두 번 다 **파일 22 통과 · 2 건너뜀(24),
    테스트 41 통과 · 2 건너뜀(43)**, 119.62초 · 119.57초. 새 `e2e/events.e2e.ts`(claude·opencode 두 테스트)와 글자를 바꾼
    `timeline.e2e.ts`가 들어 있다. 건너뛴 둘은 `opencode-real`·`slash-real`이다 — `ONE_DESK_REAL_CLI=1`과 진짜 CLI 경로가
    있어야 돌고 돌리면 실제 모델을 부르므로 돌리지 않았다. 실패·재시도·플레이키 0건(두 로그에 `×`·`Error:`·`Unhandled` 없음).
  - 6단계: `events`·`timeline`만 돌렸다(초록). core-loop·conversation은 기본 시나리오를 바꾸지 않아 이 전체 실행이 처음이다 — 초록.
- [x] NFR-2 grep — 어댑터 밖에서 CLI 방언 이름 출력 없음. spec §8의 명령 그대로(`core shared renderer electron`, `*.ts`·`*.tsx`,
  `core/runner/adapters/`·`core/runner/fixtures/` 제외) — **출력 없음**. 4~6단계가 걸려 있다고 적은
  `manager.test.ts:578`의 `parent_tool_use_id`는 리뷰 반영에서 리터럴을 뺐다. 덧붙여 run-info의 금지 grep(`rate_limit`, 테스트
  밖)은 이제 셋을 찾는다 — 제외 상수 `RAW_LOG_EXCLUDED_TYPES`(`logWriter.ts`:80)와 그것을 설명하는 주석 둘(`logWriter.ts`:76,
  `manager.ts`:292). 파싱이 아니라 제외다(run-info spec §7 각주).
- [x] `grep -rn "from 'electron'" core/` · `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [x] `grep -rn "dangerouslySetInnerHTML" renderer/` — 출력 없음(`rehype-raw`를 함께 찾아도 없음)
- [x] 옛 줄 호환 스냅샷(claude·opencode 실측 픽스처)이 구현 전후로 같다 — `claudeCode.parse.test`·`opencode.parse.test`의
  `옛 줄 호환 — 구현 전 어댑터의 출력`(구현 전 어댑터로 `claude-stream.jsonl`·`opencode-stream.jsonl`을 파싱한 결과를 적어
  둔 것, `at` 제외)이 초록이다. 더해지는 것은 claude는 도구 결과의 `output`뿐, opencode는 메시지 id와 write의 출력·detail뿐이고
  읽기는 원문이 없다(§7-A). 이 스냅샷이 살아 있는 단언이라는 것은 아래 M3가 보인다(메인에 `parentToolUseId: null`을 넣으면
  "옛 줄에 붙는 새 필드는 도구 결과의 output뿐이다"가 빨개진다). 렌더러 쪽 옛 로그 호환은 TL의 `timeline.test`가 고치지 않고
  통과하는 것(요약 모양이 넓어진 단언만 고쳤다 — 5단계)과 `run.test`의 FR-34 테스트다.
- [x] 변이 검증 — spec §8 "회귀 확인"의 일곱과 단계별 완료 확인에 적은 것. 7단계가 **저장소가 아니라 scratchpad의 작업 트리
  사본**(`git ls-files -co --exclude-standard`, `node_modules` 접합점)에서 다시 돌렸다. 변이마다 대상 글이 정확히 한 번 있는지
  확인하고 바꾼 뒤 그 테스트 파일들만 돌리고 되돌렸다(끝나고 사본의 원본 열 파일이 저장소와 바이트 단위로 같음을 `cmp`로
  확인). 변이 전 기준: 대상 파일 묶음 552 통과 · 9 건너뜀. **열일곱 전부 빨개졌다.**

  | # | 변이 | 결과 |
  |---|---|---|
  | M1 | claude thinking의 `signature`를 reasoning에 싣는다 | 2 실패 — "본문을 싣고 서명은 어디에도 싣지 않는다" 외 1 |
  | M2 | `toolResultText`가 앞부분을 남긴다(`keepTail` → `keepHead`) | 3 실패 — common·claude·opencode의 끝부분 테스트 |
  | M3 | 메인 스레드 이벤트에 `parentToolUseId: null` | 3 실패 — "메인 스레드의 이벤트에는 parentToolUseId 키 자체가 없다"·옛 줄 호환 외 1 |
  | M4 | opencode `buildCommand`에서 `--thinking`을 뺀다 | 단위 3 실패(명령 테스트 · fixtures 둘) + **e2e**: 사본에서 다시 빌드해 `events.e2e`를 돌리면 opencode 테스트가 `생각 · 2초` 버튼을 30초 기다리다 실패(`events.e2e.ts`:175), claude 테스트는 통과 |
  | M5 | manager가 원본 줄을 `parseLine` 뒤에, 이벤트가 된 줄만 쓴다 | 1 실패 — "stdout 줄을 파싱하기 전에 … 깨진 줄과 어댑터가 버리는 줄도 (FR-1)" |
  | M6 | 권한 거부 공지 중복 제거를 뺀다 | 4 실패 — "권한 거부는 그 도구의 실패 줄 바로 뒤에 한 번만 선다 — system과 result가 둘 다 알려도" 외 3 |
  | M7 | 하위 에이전트의 자식을 메인 스코프에 둔다 | 12 실패 — "요약은 메인 스레드의 도구만 센다 — 카드는 하나로 센다" 외 11 |
  | M8 | 생각 본문을 `Markdown`으로 그린다 | 1 실패 — "…펼치면 본문을 마크다운이 아니라 글자 그대로 보인다" |
  | S2a | opencode 거부 문구 상수를 바꾼다 | 5 실패 |
  | S2b | opencode reasoning에 `part.metadata`를 싣는다 | 2 실패 — "part.metadata(provider 서명·암호문)는 어디에도 싣지 않는다" 외 1 |
  | S3a | 원본 로그 표식의 한 번 가드를 뺀다 | 2 실패 — 표식 한 번·큰 한 줄 |
  | S3b | run 종료에서 원본 writer를 닫지 않는다 | 1 실패 — "돌려준 순간 원본 로그는 닫혀 있다 — 정상 종료와 spawn 실패 둘 다"(`createRawLogWriter`를 감싼 close 기록) |
  | S4a | 스토어의 글자 예산을 무한으로 | 8 실패(`runEvents.test`) |
  | S5a | 생각 시간 추정의 기준을 늘 스코프 시작(메인은 `run.startedAt`)으로 | 1 실패 — "claude는 같은 스코프의 바로 앞 이벤트부터 잰다 — 추정이다" |
  | S5b | `hunksFromPatch`의 `-` 줄이 새 번호도 센다 | 3 실패(`diff.test`·`timeline.test`) |
  | S6a | 셸 출력 블록에서 `stripAnsi`를 뺀다 | 2 실패(`Transcript.test`) |

  **빨개질 수 없던 둘**(단계에서 이미 밝힌 것): 1단계의 "모양 판정의 Write/Edit 순서를 뒤집으면 'Write update는
  overwrite다'가 빨개진다"는 성립하지 않는다 — FR-14의 Edit 모양이 `structuredPatch` + `oldString` 문자열이고 Write 결과에는
  `oldString`이 없어 두 모양이 겹치지 않는다(순서가 결과를 바꾸지 않으므로 변이가 아니다). 3단계의 "원본 writer를 닫지
  않으면 임시 디렉토리 정리가 빨개진다"도 Windows 11에서 성립하지 않는다 — libuv가 `FILE_SHARE_DELETE`로 열어 닫지 않은
  `WriteStream`이 `rmSync`를 막지 않는다(7단계가 따로 실측: 열린 스트림이 있는 디렉토리를 `rmSync`하면 성공하고 디렉토리가
  사라진다). 그래서 3단계가 close 기록으로 바꿨고 S3b가 그것으로 빨개진다(CLAUDE.md의 Windows 핸들 항목에 적었다). 4단계의
  "`readLog`가 앞에서부터 자르면 꼬리 테스트가 빨개진다"는 리뷰 반영이 `logTail.ts`로 옮기며 대상을 되돌려 확인했고 7단계는
  다시 돌리지 않았다.
- [x] e2e run 하나의 `stream.jsonl`·`raw.jsonl` 크기(§5-1의 추정과 대조)
  - **claude `events` e2e run**(6단계가 e2e 데이터 디렉토리에서 잰 것): `stream.jsonl` 79,797 B(25줄) · `raw.jsonl` 164,537 B(23줄).
    7단계가 같은 가짜 CLI 출력을 실제 어댑터로 다시 파싱해 잰 값(`tsx` 스크립트, 경로 길이만 다르다): `stream` 78,430 B(25줄) ·
    `raw` 164,209 B(23줄), 가장 큰 줄은 `tool_result` 71,845 B(7만 자 셸 출력의 끝 65,536자 + 요약·세부).
  - **opencode `events`**(7단계, 같은 방법): `stream` 4,495 B(16줄) · `raw` 5,395 B(9줄), 가장 큰 줄 580 B.
  - **§5-1과 대조.** 원본 줄 로그가 정규화 로그의 **2.1배**(claude) — 추정 2~5배의 아래 끝이다. 이 시나리오는 Read가 한 번(자식,
    짧다)이고 이미지가 없어서다. 셸 출력 7만 자 원문과 4KB 서명이 원본 줄에만 두 벌·한 벌 더 있다. `tool_result` 한 줄 최대는
    FR-10의 출력 상한이 정한 대로 약 7만 자이고 추정의 "최대 약 33만 자"(출력 + hunk + before)에 들어간다. **실제 run의 크기
    (추정 100KB~1MB)는 확인하지 못했다** — 모델을 부르는 실행을 하지 않았다(아래 후속 항목).
- [x] 라이트·다크 캡처 여섯 장면씩 — 본 것과 고친 것. 임시 `e2e/zz-events-capture.e2e.ts`를 **저장소가 아니라 위 사본에만**
  두고(그래서 지울 것도 없다) 사본에서 빌드해 돌렸다. 1440×900, 도크 최대화, `ONE_DESK_FAKE_STEP_MS=1500`. 장면 일곱 × 두 스킴:
  생각 열림 · 셸 출력 열림 · 줄 번호 diff와 이전 내용 · 하위 에이전트 카드 열림 · 공지 셋 · 접힌 턴의 재시도 상태 줄(도는 중,
  `작업 중 · 15초 · API 재시도 중 · 2/10번째 · 5초 뒤 · 529`) · 끝난 접힌 턴의 요약(`도구 6회 · 권한 거부 1 · 대화 압축됨`).
  - 다크에서 흰 채로 남은 칸 없음. 번호 칸 둘과 부호·본문이 줄마다 맞고, `⋯ 40줄`이 첫 hunk 위에 선다.
  - 셸 출력 블록은 가로로 넘치지 않는다(`scrollWidth` = `clientWidth` = 844). 열 때 바닥이고 `앞부분 4,510자는 기록하지
    않았습니다`가 위에 선다.
  - **번호를 빼고 복사되는가** — 손 대신 auth.ts diff 전체를 `Range`로 고른 선택의 글을 읽었다: `export function
    isExpired(token) {\n  return now > token.expiresAt\n  return now >= token.expiresAt\n}` — 번호 칸·`⋯ 40줄`·부호가 빠진다.
  - 계산된 글자색의 대비(WCAG): 공지 `--text-muted` 5.30(라이트)·6.70(다크), 공지 `--warn` 5.02·5.39, 번호 칸(문맥 줄)
    4.82·5.57, 생각 본문 7.73·8.33 — 전부 4.5 이상. 추가·삭제 줄 위의 번호는 `diffContrast.test`가 토큰으로 잰다.
  - 본 것 둘, 고치지 않았다: (1) 카드 안의 왼쪽 세로선(`--border-faint`, spec FR-49가 정한 토큰)은 두 스킴 다 거의 안 보인다 —
    들여쓰기(12px)로 자식이 갈리긴 한다. 토큰을 바꾸는 것은 spec의 결정이라 두었다. (2) 대화록을 위로 올려 둔 채 바닥 근처의
    공지를 보면 `최신으로 이동` 알약(TL)이 그 줄을 가린다 — 첫 캡처가 그랬고, 바닥으로 내려 다시 찍었다. TL의 기존 동작이다.
- [x] CLAUDE.md·설계 문서 각주 셋
  - `CLAUDE.md` — 현재 상태에 이 기능 한 절, "남은 5단계 과제" 문장에 diff 뷰어의 재료, 함정 열 항목(원본 줄 로그와 제외 type ·
    필드별 상한과 잘림 표식 · 값이 있을 때만 싣기 · `parentToolUseId`와 카드 · `tool_use_result`는 모양으로 가르고 실패는 문자열 ·
    셸 종료 코드는 `content`에서만 · opencode `filediff`에 `before` 없음 · 생각은 텍스트만(빈 본문) · `RUN_EVENT_WINDOW` 한 값 ·
    권한 거부 두 번), 낡은 서술 셋을 사실대로(투영 항목의 "셸 출력은 200자 요약뿐" · 로그 되살리기의 "병합에는 상한을 걸지
    않는다" · 바닥 따라가기의 "run당 2,000개"), Windows 핸들 항목에 fs 스트림의 예외, 문서 표에 `docs/sdlc/conversation-events/`.
    "thinking을 의도적으로 버린다"는 CLAUDE.md에 없었다(spec §7 우려 18) — 새 생각 항목이 옛 결정을 대신한다고 적었다.
  - 각주 셋 — `docs/superpowers/specs/2026-09-06-opencode-adapter-design.md` §10-1(2026-09-27 정정: edit은 hunk만 오고
    `before`·`after`는 없다, `trimDiff`), `docs/superpowers/specs/2026-08-07-one-desk-design.md`의 로그 디렉토리 그림(`raw.jsonl`
    한 줄과 주), `docs/sdlc/run-info/spec.md` §7(`rate_limit_event`는 원본 줄 로그에서도 빠진다 — 그 문장은 그대로 참이다).
  - 곁들인 것: `docs/sdlc/conversation-timeline/spec.md` 우려 3과 `docs/superpowers/specs/2026-08-07-implementation-notes.md`의
    thinking 줄에 이 기능이 채웠다는 한 줄, 이 spec의 §2-4 표 두 칸·FR-28·§8의 두 항목(manager의 버리는 줄 예, `eventWeight`
    대조 테스트의 자리)에 §7-A와 구현대로 고친 주.
- [ ] (후속, 사용자 실행) 실제 claude·opencode run 한 번씩의 `raw.jsonl`로 확인: 스트림의 `originalFile` 한계,
      `-p`의 thinking 본문 유무, thinking이 따로 한 줄로 오는지 — 합성 픽스처를 그 줄로 바꾼다. opencode는 apply_patch
      `files[]`·reasoning `metadata`의 모양과 `--thinking`이 1.18.30에서 실제로 통과하는지(`opencode-real.e2e`)도 함께 본다.
- [ ] (후속, 결정 필요) spec §9의 다섯 — 특히 **§9의 3: `raw.jsonl`이 agent가 읽은 파일 원문(`.env` 같은 것)·생각 서명·
      opencode reasoning 암호문을 평문으로 무기한 남긴다.** 지우는 코드가 없다. 사용자에게 알리고 보존 정책
      (`conversation-next`)의 우선순위를 정해야 한다.
