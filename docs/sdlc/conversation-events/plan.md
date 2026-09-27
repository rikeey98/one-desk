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

(구현 후 채운다)

- [ ] 기준선(fixes 병합 직후)의 `pnpm test` 통과 수와 이 작업 뒤의 수
- [ ] `pnpm typecheck` · `pnpm lint` 오류 0
- [ ] `pnpm test:e2e` — 파일 수, 새 파일 `events` 포함
- [ ] NFR-2 grep — 어댑터 밖에서 CLI 방언 이름 출력 없음
- [ ] `grep -rn "from 'electron'" core/` · `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [ ] `grep -rn "dangerouslySetInnerHTML" renderer/` — 출력 없음
- [ ] 옛 줄 호환 스냅샷(claude·opencode 실측 픽스처)이 구현 전후로 같다
- [ ] 변이 검증 — spec §8 "회귀 확인"의 일곱과 단계별 완료 확인에 적은 것, 각각 몇 개가 빨개졌는지
- [ ] e2e run 하나의 `stream.jsonl`·`raw.jsonl` 크기(§5-1의 추정과 대조)
- [ ] 라이트·다크 캡처 여섯 장면씩 — 본 것과 고친 것
- [ ] CLAUDE.md·설계 문서 각주 셋
- [ ] (후속, 사용자 실행) 실제 claude·opencode run 한 번씩의 `raw.jsonl`로 확인: 스트림의 `originalFile` 한계,
      `-p`의 thinking 본문 유무, thinking이 따로 한 줄로 오는지 — 합성 픽스처를 그 줄로 바꾼다
