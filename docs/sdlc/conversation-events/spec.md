# Spec: 대화가 버리는 데이터를 살린다

- 출처: `intent.md` (승인 위임됨 2026-09-27)
- 선행: `docs/sdlc/conversation-fixes/spec.md` — core·shared 부분(§4의 A~F)은 그것이 `main`에 들어간 상태를
  전제로 쓴다(opencode `error` 이벤트·판정 순서·`onSession`·비동기 `readLog`·seq 병합 `hydrate`).
  `docs/sdlc/conversation-timeline/spec.md` — 렌더러 투영·화면(§4의 G)은 그 투영(`projectTurn`)과 블록이
  들어간 상태를 전제로 쓴다.
- 작성자: 권용현 (Claude가 초안)
- 상태: 초안 (2026-09-27)
- 작성일: 2026-09-27

## 1. 범위

**어댑터가 버리던 것을 이벤트에 싣고, timeline이 만든 자리에 그린다.** 스키마·IPC 채널은 그대로다
(마이그레이션 없음). 로그는 줄 단위 JSON 그대로이고 필드와 종류가 늘 뿐이다.

일곱 조각이다. (A)~(E)는 core, (F)는 core와 렌더러 스토어에 걸치고, (G)는 renderer다.

- **(A) 원본 줄 로그** — stdout 줄을 `raw.jsonl`로 (E1)
- **(B) 이벤트 모델** — `shared/events.ts`의 선택 필드와 새 종류 둘 (E2~E5·E7)
- **(C) 공통 상한** — 필드마다 한 자리에서 자른다 (E2·E3)
- **(D) claude 어댑터** — `tool_use_result`·thinking·`parent_tool_use_id`·`uuid`·system 공지
- **(E) opencode 어댑터** — `--thinking`·reasoning·`state.metadata`·권한 거부
- **(F) 창** — `readLog`와 렌더러 스토어가 같은 크기 규칙을 쓴다
- **(G) 렌더러** — timeline 투영의 새 필드 규칙과 화면 (reasoning·하위 에이전트·공지·출력·줄 번호 diff)

**빠지는 것**

- **지난 대화를 다시 파싱하는 기능**(E1) — 이 기능은 재료(`raw.jsonl`)만 남긴다. 읽는 API도 없다.
- **토큰 단위 스트리밍**(E6) — `--include-partial-messages`를 붙이지 않는다.
- **opencode 하위 세션의 활동**(E4) — `run`이 내보내지 않는다. 부모의 `task` 한 줄만 남는다.
- **되돌리기·분기 UI**(E7) — 메시지 id는 저장만 한다.
- **diff 뷰어**(남은 5단계 과제) — 이 기능은 그 재료(줄 번호 hunk·`before`)를 로그에 남기고, 대화록의
  편집 블록에 줄 번호를 붙이는 데까지다.
- **`--forward-subagent-text`** — 하위 에이전트의 text·thinking은 오지 않는다(§7 우려 7).
- **아래 표(§2-4)의 "버린다" 줄** — `status`·`notification`·`task_*`·`hook_*`·`thinking_tokens`·
  `turn_duration`·`rate_limit_event` 등. 공지는 네 종류로 시작한다.
- **MCP 연결 실패** — 지금처럼 `error` 이벤트다(오류 카드가 맞다). 공지로 옮기지 않는다.
- **읽기·검색·웹 도구 줄을 펼쳐 출력을 보는 것** — 출력은 로그에 남지만(E2) 그 줄은 timeline
  FR-16대로 한 줄로 끝난다(§7 우려 5).
- **권한 요청 카드·`ask`** — 헤드리스 제약 그대로다.

## 2. 실측 — 두 CLI가 이미 보내는 것

**조사 방법과 한계.** 모델을 부르는 실행은 하지 않았다(모델 호출 금지, opencode 무료 경로는
2026-09-21부터 403 — run-info spec §8). 근거는 다섯 가지이고 표마다 적는다.

| 약어 | 근거 |
|---|---|
| 스키마 | claude 2.1.280 바이너리(`claude.exe`)의 SDK 메시지 zod 스키마 문자열 |
| 기록 | 이 장비의 claude 세션 기록 39개(`~/.claude/projects/D--Workspace-one-desk/*.jsonl`) — **스트림이 아니라 CLI가 같은 객체(`toolUseResult`)를 디스크에 적은 것**이다. 키 모양과 크기만 셌고 내용은 보지 않았다 |
| 소스 | opencode `run.ts`(v1.18.27 사본 — conversation-fixes intent가 1.18.30과 바이트 동일로 확인)·`session/processor.ts`·`tool/task.ts` |
| 바이너리 | opencode 1.18.30 바이너리(`opencode.exe`)의 도구 구현 문자열 |
| 픽스처 | `core/runner/adapters/fixtures/*.jsonl` — 과거 실측 스트림 |

**스트림과 기록은 다를 수 있다.** 스트림의 `user` 줄은 `tool_use_result: g.toolUseResult`로
같은 객체를 싣지만(스키마), 기록 쪽에는 저장용으로 줄이는 `stripForStorage`가 있다(Write). 그래서
기록의 크기는 "대략 이 정도"이고, 확정은 이 기능이 남길 `raw.jsonl`로 한다(§7 우려 3).

### 2-1. claude — `user` 줄의 `tool_use_result`

`user` 줄: `{type:'user', message, parent_tool_use_id: string|null, uuid, timestamp, isSynthetic?,
tool_use_result?, tool_result_meta?}`(스키마). **`tool_use_result`는 "모델에게 간 문자열이 아니라
도구의 전체 Output 객체"이고 모양은 도구마다 다르다.** 도구 이름은 같은 줄에 없다 — `tool_use_id`뿐이다.

| 도구 | 모양 | 근거 | 이 기능이 쓰는 것 |
|---|---|---|---|
| Edit | `{filePath, oldString, newString, originalFile: string\|null, structuredPatch: Hunk[], userModified, replaceAll, gitDiff?, staged?}` | 스키마 · 기록 129건 | hunk, `before` |
| Write | `{type: 'create'\|'update', filePath, content, structuredPatch: Hunk[], originalFile: string\|null, gitDiff?, userModified?, staged?}` | 스키마 · 기록 73건(create 69건은 `structuredPatch`가 **빈 배열**) | 종류, hunk, `before` |
| `Hunk` | `{oldStart, oldLines, newStart, newLines, lines: string[]}` — jsdiff 모양, 줄 첫 글자가 ` `·`-`·`+` | 스키마 | 그대로 |
| Bash · PowerShell | `{stdout, stderr, interrupted, isImage?, noOutputExpected?, backgroundTaskId?, timedOutAfterMs?, persistedOutputPath?, returnCodeInterpretation?, …}` — **종료 코드 필드가 없다** | 스키마 · 기록 1,637건 | 중단·시간 초과 |
| 실패한 도구 전부 | 객체가 아니라 **문자열**(`"Error: Exit code 2\n…"`), `content`는 `"Exit code 2\n…"`로 시작 | 기록 67건 전부 | 종료 코드(첫 줄) |
| Grep | `{mode?: 'content'\|'files_with_matches'\|'count', numFiles, filenames[], content?, numLines?, numMatches?, totalFiles?, totalLines?, appliedLimit?, appliedOffset?}` — `durationMs` 없음 | 스키마 · 기록 2건(content 모드) | 개수·단위 |
| Glob | `{durationMs, numFiles, filenames[], truncated, totalMatches?, countIsComplete?}` | 스키마만 — 기록 3건엔 `tool_use_result`가 없었다(**미확인**) | 개수·잘림 |
| Read | `{type: 'text'\|'image'\|…, file: {filePath, content, numLines, startLine, totalLines, …}}` | 스키마 · 기록 76건(image 60) | 쓰지 않는다 |
| Agent · Task(하위 에이전트) | 동기: `{content: [{type:'text', text}], resolvedModel?, totalToolUseCount, totalDurationMs, totalTokens, usage, …}` / 비동기: `{agentId, status, isAsync, outputFile, description, prompt, resolvedModel}` | 스키마(동기) · 기록 2건(비동기) | 도구 수·시간·모델 |
| MCP 도구 | `{content: <MCP content>, …mcpMeta}` | 스키마 | 쓰지 않는다 |

**기록에서 본 크기** (글자 수, p50 / p90 / 최대)

| 값 | p50 | p90 | 최대 | 비고 |
|---|---|---|---|---|
| Bash `content` | 744 | 4,963 | 28,821 | CLI가 약 3만 자에서 끊고 나머지를 파일로 뺀다(`persistedOutputPath`) |
| Edit `originalFile` | 5,699 | 8,799 | 9,993 | 129건 중 45건이 null — **CLI가 큰 원본을 싣지 않는 것으로 보인다**(스트림도 같은지 미확인) *(정정 — 리뷰 2026-09-27: 그 null은 트랜스크립트 writer가 1만 자 넘는 원본을 디스크에 적으며 지운 것이다. 스트림 변환은 그 객체를 그대로 싣고, 스트림의 Edit 원본에는 크기 한계가 없다 — 이 표의 크기는 스트림보다 작다. §9의 2)* |
| Edit hunk 줄 수 | 10 | 33 | 114 | hunk는 대개 1개 |
| Read `content` | 10,545 | 291,136 | 529,980 | 이미지(base64) 포함 |

**thinking 블록** — `assistant` 5,492줄이 **전부 content 블록 하나**였다(블록마다 한 줄). thinking
블록 1,851개 중 **1,800개가 본문이 빈 문자열**이고 서명만 있었다(§7 우려 2). 숨은 플래그
`--thinking-display summarized|omitted|highlights`가 있다(스키마·바이너리). `-p`의 기본값은 **미확인**.

### 2-2. claude — 그 밖의 줄

| 줄 | 필드 | 근거 |
|---|---|---|
| `assistant` | `parent_tool_use_id: string\|null`, `uuid`, `timestamp`, `message.content[]` | 스키마 |
| thinking 블록 | `{type:'thinking', thinking, signature}` · `{type:'redacted_thinking', data}` | 픽스처 4행 · 기록 |
| 하위 에이전트의 줄 | `parent_tool_use_id` = 그 에이전트를 띄운 tool_use id, 메인은 null. **tool_use/tool_result는 기본으로 흐르고** text·thinking은 `--forward-subagent-text`(2.1.211+)가 있어야 온다 | `--help` · 공식 문서(검증 K4) |
| `system/compact_boundary` | `{compact_metadata: {trigger: 'manual'\|'auto', pre_tokens, post_tokens?, duration_ms?}, uuid}` | 스키마 · 기록 1건 |
| `system/api_retry` | `{attempt, max_retries, retry_delay_ms, error_status: number\|null, error, no_response?, uuid}` — `error_status` null은 연결 오류 | 스키마 |
| `system/permission_denied` | `{tool_name, tool_use_id, agent_id?, decision_reason_type?, decision_reason_code?, decision_reason?, message?, uuid}` — **best-effort**(항상 오지 않는다) | 스키마 · 공식 문서(검증 K5) |
| `system/model_fallback` | `{trigger, original_model, fallback_model, content, uuid}` — **`@internal`, "Not yet in the public SDKMessage union"** | 스키마 |
| `system/model_refusal_fallback` | `{trigger: 'refusal', direction, scope?, original_model, fallback_model, …}` | 스키마 |
| `result.permission_denials` | `[{tool_name, tool_use_id, tool_input}]` — **권위 있는 기록** | 스키마 · 픽스처(빈 배열) |

### 2-3. opencode 1.18.30

`run --format json`은 **끝난 part만** 낸다. 도구는 `completed`·`error`일 때 한 번, 하위 세션의 part는
건너뛴다(`part.sessionID !== sessionID`, 소스 `run.ts`:722).

| 줄 / 도구 | 모양 | 근거 |
|---|---|---|
| `tool_use` 성공 | `part.state = {status:'completed', input, output: string, metadata, title, time:{start,end}, attachments?}` | 소스 processor:160-183 |
| `tool_use` 실패 | `part.state = {status:'error', input, error: string, metadata?, time}` — **`output`이 없다** | 소스 processor:186-205 |
| read | `metadata: {preview, truncated, loaded[], display{…}}` | 픽스처 |
| write | `metadata: {diagnostics, filepath, exists: boolean, truncated}` — **이전 내용 없음** | 픽스처 · 바이너리 |
| edit | `metadata: {diagnostics, diff: string, filediff: {file, patch: string, additions, deletions}}` — `patch`는 unified diff(`createTwoFilesPatch`). **`before`·`after`는 없다** *(정정 — 리뷰 2026-09-27: `patch`와 `diff`는 `createTwoFilesPatch`의 출력을 `trimDiff`로 다듬은 값이다. 문맥·추가·삭제 줄 전체의 가장 짧은 앞 공백만큼을 걷어, 줄 번호는 맞지만 줄 본문은 파일과 다르다. §9의 5)* | 바이너리 |
| grep | `metadata: {matches: number, truncated}` — 일치한 **줄** 수, 100에서 잘림. `output`은 `Found N matches…` | 바이너리 |
| glob | `metadata: {count, truncated}` — 파일 수, 100에서 잘림 | 바이너리 |
| bash | `metadata: {output: string(미리보기, 약 3만 자), exit: number\|null, truncated, outputPath?}` | 바이너리 |
| apply_patch | `metadata: {files: [{type, filePath, relativePath, diff, additions?, deletions?}]}` *(정정 — 리뷰 2026-09-27: 1.18.30의 도구 구현은 `{diff, files: [{filePath, relativePath, type: 'add'\|'update'\|'move'\|'delete', patch, additions, deletions, movePath?}], diagnostics}`이다. 파일별 diff는 **`patch`** 키이고(edit처럼 `trimDiff`를 거친다), `move`면 `relativePath`가 새 자리(`movePath`)다)* | 바이너리의 UI 데모 값에서 **추정 — 미확인** → 바이너리의 도구 구현으로 확인 |
| task | `metadata: {parentSessionId, sessionId, model: {modelID, providerID}, background?}` | 소스 `tool/task.ts`:184 |
| 중단된 도구 | `status:'error', error:'Tool execution aborted', metadata.interrupted: true` | 소스 processor:599 |
| 권한 거부 | `status:'error'`, `error`가 `"The user rejected permission to use this specific tool call."`(ask 자동 거부) 또는 `"The user has specified a rule which prevents you from using this specific tool call. …"`(deny 규칙) | 바이너리 |
| `reasoning` 줄 | `{type:'reasoning', timestamp, sessionID, part: {id, messageID, sessionID, type:'reasoning', text, time:{start,end}, metadata?}}` — `metadata`는 provider 서명·암호문. **`--thinking`이 있을 때만 나온다**(`run.ts`:766 `part.type === "reasoning" && part.time?.end && thinking`). 이 플래그는 출력만 가른다 — 비대화형 경로에서 다른 곳에 쓰이지 않는다 | 소스 · `run --help` |
| `error` 줄 | `{type:'error', timestamp, sessionID, error: {name, data: {message}}}` | fixes spec FR-13 |
| 권한 자동 거부 안내 | `! permission requested: … auto-rejecting` — **stderr**다(`UI.println`) | 소스 `ui.ts` |

**intent를 한 곳 고친다.** intent는 "`OpenCode는 before를 뜰 수 없다`도 edit에 한해서는 `filediff`로
풀린다"고 적었지만, 1.18.30의 `filediff`에는 `patch`만 있고 `before`·`after`가 없다(바이너리의 UI
코드가 `filediff.before`를 선택적으로 읽는 것은 다른 버전을 위한 것으로 보인다). **줄 번호 hunk는
풀리고, 파일 전체 원본은 여전히 없다**(§7 우려 12).

### 2-4. 받는 것과 버리는 것

| 원천 | 이 기능 |
|---|---|
| claude `tool_use_result` (위 표의 "쓰는 것") | `tool_result.detail` |
| claude `tool_result.content` | `tool_result.output` |
| claude thinking | `reasoning` (빈 본문·`redacted_thinking`은 버린다) *(§7-A: 빈 본문도 `text: ''`의 `reasoning`이다 — `redacted_thinking`만 버린다)* |
| claude `parent_tool_use_id` · `uuid` | `parentToolUseId` · `messageId` |
| claude `compact_boundary`·`api_retry`·`permission_denied`·`model_fallback`·`model_refusal_fallback` · `result.permission_denials` | `notice` |
| claude `status`·`notification`·`informational`·`task_*`·`hook_*`·`thinking`(@internal)·`thinking_tokens`·`turn_duration`·`post_turn_summary`·`rate_limit_event`·`stream_event`·`prompt_suggestion` | 버린다 (`raw.jsonl`에는 남는다) |
| opencode `state.output` / `state.error` | `tool_result.output` |
| opencode `state.metadata` (위 표) | `tool_result.detail` |
| opencode `reasoning` | `reasoning` (`metadata` 버림) |
| opencode 권한 거부 오류 문구 | `notice` |
| opencode `part.messageID` | 버린다(E7은 claude만 — §7 우려 9) *(§7-A: `messageId`로 싣는다 — text·tool_use·tool_result·reasoning·notice)* |

## 3. 이벤트 모델

`shared/events.ts`에 더한다. **기존 필드는 한 글자도 바꾸지 않는다**(`summary` 포함 — E2).

```ts
/** jsdiff `structuredPatch`의 hunk 모양 그대로. opencode의 unified diff는 어댑터가 이 모양으로 편다 */
export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** 첫 글자가 ' '·'-'·'+'인 줄. `\ No newline at end of file` 줄은 어댑터가 뺀다 */
  lines: string[]
}

export interface EditFileDetail {
  /** CLI가 준 경로 그대로(대개 절대 경로) */
  path: string
  operation: 'edit' | 'create' | 'overwrite' | 'delete'
  /** 새 파일(claude Write create)은 빈 배열이다 — 내용은 tool_use.input에 있다 */
  hunks: PatchHunk[]
  /** 상한(FR-12) 때문에 버린 hunk 줄 수. 0이면 전부다. 잘린 hunk는 머리(oldStart·newStart)만 믿는다 */
  hunksTruncated: number
  /** 자르기 전에 센 추가·삭제 줄 수. 모르면 null */
  added: number | null
  removed: number | null
  /** 바꾸기 전 파일 전체. claude만 준다 */
  before: string | null
  /** before가 없는 이유. 새 파일이라 원래 없으면 null */
  beforeMissing: 'unavailable' | 'too_large' | null
}

/** 도구 결과의 구조화된 세부. CLI 방언은 어댑터가 이 넷으로 접는다 */
export type ToolDetail =
  | {
      kind: 'shell'
      /** 모르면 null — claude는 실패할 때만 알려준다 */
      exitCode: number | null
      interrupted: boolean
      timedOut: boolean
    }
  | {
      kind: 'search'
      count: number
      /** count가 센 것 — claude Grep 기본은 파일, opencode grep은 일치한 줄 */
      unit: 'files' | 'matches' | 'lines'
      /** 도구가 결과를 잘랐다(더 있다) */
      truncated: boolean
    }
  | { kind: 'edit'; files: EditFileDetail[] }
  | {
      kind: 'subagent'
      /** opencode의 하위 세션 id */
      sessionId: string | null
      model: string | null
      toolCount: number | null
      durationMs: number | null
    }

export type NoticeKind = 'compact' | 'retry' | 'permission_denied' | 'model_fallback'

/** 메시지 단위 출처. **값이 있을 때만 싣는다**(FR-7) */
interface Origin {
  /** claude: 이 이벤트를 낳은 하위 에이전트 호출(tool_use id). 메인 스레드면 키가 없다 */
  parentToolUseId?: string
  /** claude: 원본 줄의 uuid. 되돌리기·분기의 재료 — 저장만 한다(E7) */
  messageId?: string
}

export type RunEvent =
  | (Base & { type: 'session'; sessionId: string })
  | (Base & Origin & { type: 'text'; text: string })
  | (Base & Origin & {
      type: 'tool_use'; toolUseId: string; name: string
      effect: ToolEffect; targetPaths: string[]; input: unknown
    })
  | (Base & Origin & {
      type: 'tool_result'; toolUseId: string; ok: boolean
      /** 200자 요약. 지금 그대로다 */
      summary: string
      /** 결과 전문의 **끝부분**(≤ 65,536자). 없으면 옛 로그이거나 결과가 비었다 */
      output?: string
      /** output을 만들며 버린 앞부분 글자 수. 없으면 전부다 */
      outputTruncated?: number
      detail?: ToolDetail
    })
  | (Base & Origin & {
      type: 'reasoning'
      /** 생각 본문. 서명·암호문은 싣지 않는다(E3) */
      text: string
      /** opencode만 준다. claude는 null — 화면이 앞 이벤트로 추정한다(FR-40) */
      startedAt: number | null
      endedAt: number | null
      /** 버린 뒷부분 글자 수 */
      truncated?: number
    })
  | (Base & Origin & {
      type: 'notice'
      kind: NoticeKind
      /** 화면에 그대로 나가는 한 줄. 어댑터가 만든다(FR-18·FR-26) */
      text: string
      /** permission_denied: 막힌 호출. 같은 id의 공지는 화면에 한 번만 선다 */
      toolUseId?: string
    })
  | (Base & { type: 'error'; message: string })
  | (Base & { type: 'usage'; usage: RunUsage })
  | (Base & { type: 'result'; /* 그대로 */ })
  | (Base & { type: 'raw'; line: string })

/** readLog와 렌더러 스토어가 같이 쓰는 창(FR-31·FR-33) */
export const RUN_EVENT_WINDOW = { maxEvents: 2000, maxChars: 8_000_000 } as const

/** 이벤트의 무게 = 로그 한 줄의 길이(`JSON.stringify(event).length`). 두 곳이 같은 자로 잰다 */
export function eventWeight(event: RunEvent): number
```

**IPC·스키마 변경 없음.** `runs.readLog`의 반환 모양은 같다 — 창(FR-33)만 적용된다. `raw.jsonl`을
읽는 채널은 만들지 않는다.

## 4. 기능 요구사항

### (A) 원본 줄 로그 (E1)

- **FR-1.** `RunManager`가 **줄 분할기가 넘긴 stdout 줄을 파싱하기 전에** `logs/<runId>/raw.jsonl`에
  한 줄씩 쓴다. 분할기가 넘긴 문자열 그대로다(끝 공백은 분할기가 이미 걷고, 빈 줄은 넘어오지 않는다).
  **JSON이든 아니든, 어댑터가 버리는 줄이든 쓴다** — 버리는 줄을 남기는 것이 이 파일의 존재 이유다.
- **FR-2.** 경로는 manager의 `rawLogPathFor(runId)` 하나가 정한다(`logPathFor`와 같은 원칙 — 경로
  계산을 두 곳에 두면 조용히 어긋난다). DB에 컬럼을 두지 않는다 — `log_path`와 같은 디렉토리라
  유도된다.
- **FR-3.** **run당 상한 `RAW_LOG_MAX_BYTES = 32 MiB`**(UTF-8 바이트, 개행 포함). 다음 줄을 쓰면 넘는
  순간 그 줄을 쓰지 않고 표식 한 줄 `{"oneDesk":"raw-truncated","limitBytes":33554432,"at":<epoch ms>}`을
  쓴 뒤 이후 줄은 전부 버린다. 표식은 한 번뿐이다. 한 줄이 상한보다 커도 같다.
  **표식에는 `type` 키가 없다** — 두 CLI의 줄은 전부 `type`을 가지므로 나중에 다시 파싱하는 쪽이
  CLI 출력과 헷갈리지 않는다. 상한은 테스트가 작게 줄 수 있는 manager 옵션이다.
- **FR-4.** **쓰기 오류는 run을 죽이지 않는다** — `createLogWriter`와 같은 `ErrorSink` 패턴이다.
  실패하면 한 번 알리고 이후 쓰기를 건너뛰며, `close()`는 실패한 뒤에도 매달리지 않는다(매달리면
  동시 실행 슬롯이 영영 점유된다 — CLAUDE.md). **두 로그는 서로 독립이다** — 한쪽이 실패해도 다른
  쪽은 계속 쓴다. run은 두 writer를 모두 닫은 뒤 결과를 돌려준다.
- **FR-5.** stderr·`preEvents`는 `raw.jsonl`에 쓰지 않는다. E1은 stdout 줄이고, stderr는 실패 이유
  (`errorMessage`)로 이미 남으며 `preEvents`는 프로세스 출력이 아니다.
- **FR-6.** **`readLog`는 `stream.jsonl`(정규화 로그)만 읽는다.** `raw.jsonl`은 화면에도 IPC에도
  나가지 않는다.

### (B) 이벤트 모델 (E2~E5·E7)

- **FR-7.** **새 필드는 값이 있을 때만 싣는다.** null·빈 문자열·0으로 채우지 않는다 — 메인 스레드의
  모든 이벤트에 `"parentToolUseId":null`이 붙으면 로그가 늘기만 하고, 옛 로그와 새 로그의 모양이
  괜히 갈린다. 읽는 쪽은 키가 없으면 "모른다"로 읽는다. 예외는 `reasoning`의 `startedAt`·`endedAt`과
  `ToolDetail`·`EditFileDetail`의 필드로, 이 둘은 새 모양이라 null을 명시한다.
- **FR-8.** 새 종류 `reasoning`·`notice`는 run의 상태·결과·실패 이유·인박스에 영향을 주지 않는다.
  manager는 다른 이벤트처럼 로그에 쓰고 `onEvent`로 내보낼 뿐이다(`lastError`도 건드리지 않는다).
- **FR-9.** `tool_result.summary`는 지금 규칙 그대로 만든다(`summarize()`, 200자). 단 opencode의
  실패한 도구는 `state.error`에서 만든다(FR-25 — 지금은 `""`가 된다).

### (C) 공통 상한 (E2·E3)

- **FR-10.** **상한은 어댑터가 이벤트를 만들 때 한 번 적용한다.** manager·로그·IPC·렌더러는 이미
  잘린 값만 본다. 상수와 함수는 `core/runner/adapters/common.ts`에 둔다 — 그 파일이 이미 "로그 길이
  정책"(`summarize`)의 자리다.

  | 필드 | 상한 | 남기는 쪽 | 넘으면 |
  |---|---|---|---|
  | `tool_result.output` | 65,536자 | **끝부분** — 셸 출력은 끝(테스트 결과·오류)이 중요하다 | `outputTruncated` = 버린 앞부분 글자 수 |
  | `reasoning.text` | 65,536자 | 앞부분 — 읽는 순서대로 | `truncated` = 버린 뒷부분 글자 수 |
  | `detail.files[].hunks` | 결과 하나의 모든 파일을 합쳐 줄 글자 131,072자 | 앞쪽 줄 | 뒤의 줄을 버리고 파일마다 `hunksTruncated` |
  | `detail.files[].before` | 131,072자 | — | **싣지 않는다**(null, `beforeMissing: 'too_large'`) — 잘린 원본은 원본이 아니다 |

  *(다듬음 — 리뷰 반영 2026-09-27: `output`의 잘린 자리가 줄 가운데면 **다음 줄바꿈까지 더 버린다**.
  그러지 않으면 출력의 첫 줄이 앞이 날아간 조각(`se139.test.ts (3 tests)`)이라 위의 "앞부분 N자" 안내와
  함께 깨진 줄로 읽혔다. 더 버린 글자도 `outputTruncated`에 들고, 남긴 끝부분에 줄바꿈이 없으면(한 줄짜리
  긴 출력) 그대로 둔다 — `toolResultText`.)*

- **FR-11.** 글자 수는 `string.length`(UTF-16 코드 유닛)다 — 바이트를 세려면 인코딩을 한 번 더 해야
  한다. 자르는 자리가 서로게이트 쌍 가운데면 한 칸 옮겨 반쪽 글자를 남기지 않는다.
- **FR-12.** hunk 예산은 파일 순서·hunk 순서·줄 순서로 채운다. `added`·`removed`는 **자르기 전에**
  센다(claude는 전체 hunk의 `+`·`-` 줄, opencode는 `filediff.additions`·`deletions`) — 화면의
  `+N −M`이 잘린 값이 되지 않게.

### (D) claude 어댑터

- **FR-13.** **`output`** — `tool_result.content`에서 만든다. 문자열이면 그대로, 배열이면 `text`
  블록의 `text`를 `\n`으로 잇고 `image` 블록은 `[이미지]`, 그 밖의 블록은 `[<type>]`로 둔다(base64가
  로그에 들어가지 않는다). FR-10으로 자르고, 비면 싣지 않는다. **모델이 본 그 글이다** —
  `tool_use_result.stdout`을 따로 싣지 않는다(같은 글이 두 벌 된다).
- **FR-14.** **`detail`은 도구 이름이 아니라 `tool_use_result`의 모양으로 가른다.** `user` 줄에는 도구
  이름이 없고 `parseLine`은 앞 줄을 기억하지 않는다(NFR-3). 모양은 이름보다 튼튼하기도 하다 —
  `Task`/`Agent`, `Bash`/`PowerShell`처럼 이름이 갈려도 모양은 같다. 위에서부터 처음 맞는 것:

  | 모양 | detail |
  |---|---|
  | `structuredPatch` 배열 + `type`이 `create`·`update` (Write) | `edit` — `operation`은 `create`/`overwrite`, `before` = `originalFile`(update인데 null이면 `beforeMissing: 'too_large'` — CLI가 크면 싣지 않는다) |
  | `structuredPatch` 배열 + `oldString` 문자열 (Edit) | `edit` — `operation: 'edit'`, `before` = `originalFile`(null이면 `too_large`) |
  | `stdout` 또는 `stderr` 문자열 + `interrupted` 불리언 (Bash·PowerShell) | `shell` — `exitCode: null`, `interrupted`, `timedOut` = `timedOutAfterMs`가 수 |
  | `filenames` 배열 + `numFiles` 수 + (`mode`가 있거나 `durationMs`가 없음) (Grep) | `search` — `files_with_matches`·없음 → `numFiles`/`files`, `content` → `numMatches ?? numLines`/`matches`·`lines`, `count` → `numMatches ?? numFiles`/`matches`. `truncated` = `appliedLimit`이 수 |
  | `filenames` 배열 + `numFiles` 수 + `durationMs` (Glob) | `search` — `totalMatches ?? numFiles`/`files`, `truncated` |
  | `totalToolUseCount` 수 (동기 하위 에이전트) | `subagent` — `toolCount`, `durationMs` = `totalDurationMs`, `model` = `resolvedModel` |
  | `isAsync` 참 또는 `agentId` 문자열 (비동기 하위 에이전트) | `subagent` — 수치 null, `model` = `resolvedModel` |
  | 그 밖(MCP·Read·문자열) | 없음 |

  **실패한 도구의 `tool_use_result`는 문자열이다**(§2-1). 그래서 `is_error`이고 `content`가
  `Exit code (\d+)`로 시작하면 `{kind:'shell', exitCode: N, interrupted: false, timedOut: false}`를
  싣는다. 값의 타입이 기대와 다르면(수 자리에 문자열 등) 그 detail을 통째로 싣지 않는다 — 반쯤
  맞는 detail은 거짓말을 한다. `oldString`·`newString`·`content`·`filenames`·`stdout`은 싣지 않는다
  (input이나 output과 같은 글이다).

  *(다듬음 — 리뷰 반영 2026-09-27, 2.1.280 바이너리로 확인한 것. 위 표의 해당 칸은 이것으로 읽는다.)*
  - *`timedOutAfterMs`는 시간 초과가 아니다.* 스키마의 설명은 "시간이 다 되어 **자동으로 백그라운드로
    넘겼다**"이고, 그 값은 늘 `backgroundTaskId`·`interrupted: false`와 함께 온다 — 명령은 계속 돈다.
    그것을 `timed_out`으로 그리면 아직 도는 명령이 "시간 초과"로 멈춘 것처럼 보였다. claude에는 셸이
    시간 초과로 **멈췄다**는 필드가 없으므로 claude의 `timedOut`은 늘 거짓이다.
  - *실패한 셸의 중단.* 셸 오류 글은 `Exit code N`, (중단이면) `[Request interrupted by user for tool use]`,
    stderr, stdout을 줄로 이은 것이다. 그래서 **둘째 줄이 그 표식이면** `interrupted: true`다(출력 속의 같은
    글자는 중단이 아니다).
  - *Edit의 `originalFile` null은 `unavailable`이다.* §2-1의 null은 트랜스크립트 writer가 1만 자 넘는
    원본을 디스크에 적으며 지운 것이고, 스트림 변환은 그 객체를 그대로 싣는다. 스트림의 Edit null은 원격
    실행 재구성처럼 원본을 모르는 경로다. Write update의 null은 그대로 `too_large`다(원본이 10MiB를 넘으면
    CLI가 null과 빈 hunk로 싣는다).
  - *Grep의 개수는 총수다.* `numFiles`·`numLines`는 `head_limit`(기본 250)으로 **자른 뒤의** 수이고
    `totalFiles`·`totalLines`가 자르기 전의 총수다. 총수가 있으면 그것을 `count`로, `truncated: false`로
    싣는다(정확한 수라 "이상"이 아니다). 총수가 없는 모양만 자른 뒤의 수와 `appliedLimit`(실제로 잘렸을
    때만 온다)을 쓴다. count 모드에 `numMatches`가 없으면 `numFiles`는 단위 `files`다 — "일치"라고
    부르지 않는다.
  - *수의 모양은 렌더러와 같은 판정이다.* 개수·줄 번호·도구 수는 **음이 아닌 정수**(`shared/events.ts`의
    `isCount`)여야 싣는다 — 어댑터가 유한한 수를 다 받으면 렌더러의 `readDetail`이 그 detail을 통째로 버려,
    로그·IPC에는 실린 것이 화면에서만 말없이 사라졌다. 잰 시간(`totalDurationMs`)은 소수를 반올림하고
    음수면 싣지 않는다. 종료 코드와 시각은 여기 들지 않는다.
  - *읽기 원문 제외(§7-A)는 모양에 기댄다.* 결과 블록이 여럿인 `user` 줄은 `tool_use_result`를 어느
    블록에도 붙이지 않으므로 읽기인지 가를 수 없다 — **그 줄에서는 `output`을 싣지 않는다**(요약만).
    하위 에이전트가 넘긴 결과 줄도 `tool_use_result`를 싣는다(바이너리).
- **FR-15.** **thinking → `reasoning`.** `thinking` 블록의 `thinking`을 FR-10으로 잘라 `text`에 싣는다.
  **`signature`는 정규화 이벤트 어디에도 싣지 않는다**(원본 줄째로는 `raw.jsonl`에 남는다). 본문이 비었거나
  공백뿐이면 이벤트를 만들지 않는다. `redacted_thinking`은 버린다. `startedAt`·`endedAt`은 null이다.
  claudeCode.ts의 "thinking은 버린다" 주석과 테스트는 이 조건으로 고친다(E3).
  *(§7-A가 뒤집었다 — 리뷰가 찾은 문서의 어긋남, 2026-09-27: 본문이 빈 thinking도 `text: ''`의 이벤트다.
  구현은 §7-A를 따른다. 그 결정이 FR-40과 부딪히는 자리는 §9의 1.)*
- **FR-16.** **`parentToolUseId`** — `assistant`·`user` 줄의 `parent_tool_use_id`가 비지 않은 문자열이면
  그 줄에서 나온 `text`·`tool_use`·`reasoning`·`tool_result`에 싣는다(E4).
- **FR-17.** **`messageId`** — 줄의 `uuid`가 비지 않은 문자열이면 그 줄에서 나온 `text`·`tool_use`·
  `reasoning`·`tool_result`·`notice`에 싣는다. `session`·`usage`·`result`에는 싣지 않는다(E7).
- **FR-18.** **system 줄 → `notice`** (init은 지금 그대로). 문구는 어댑터가 만들고 화면은 그대로
  그린다 — 문구의 출처를 하나로 둔다. 수는 `toLocaleString('en-US')`(`153,214`)로 적는다.

  | subtype | kind | 문구 |
  |---|---|---|
  | `compact_boundary` | `compact` | `대화가 압축됨 · 자동 · 153,214 → 12,400 토큰` (`manual`이면 `수동`, `post_tokens`가 없으면 `· 압축 전 153,214 토큰`) |
  | `api_retry` | `retry` | `API 재시도 중 · 2/10번째 · 5초 뒤 · 529` (`error_status` null이면 `· 연결 오류`, 초는 올림) |
  | `permission_denied` | `permission_denied` | `권한 때문에 막힘: Bash` (`toolUseId` = `tool_use_id`) |
  | `model_fallback` · `model_refusal_fallback` | `model_fallback` | `모델 대체: claude-opus-5 → claude-sonnet-5 (과부하)` — 사유: `overloaded` 과부하 · `model_not_found` 모델 없음 · `permission_denied` 접근 권한 없음 · `server_error` 서버 오류 · `model_blocked` 차단됨 · `refusal` 응답 거부 · 그 밖은 원문 |
  | 그 밖 | — | 버린다(§2-4) |

  필수 필드가 없거나 타입이 다르면 공지를 만들지 않는다(파싱 실패로 run을 죽이지 않는다 — `raw`로도
  만들지 않는다. 줄은 JSON으로 읽혔다).
- **FR-19.** **`result.permission_denials` → `notice`**. 항목마다 `permission_denied` 하나(`toolUseId`
  포함). 한 `result` 줄은 `result` → `usage` → `notice…` 순서로 낸다. 같은 호출이 `system/permission_denied`로
  이미 왔을 수 있다 — **어댑터는 거르지 않는다**(한 줄만 본다). 화면이 `toolUseId`로 한 번만 그린다(FR-41).
- **FR-20.** `TOOL_EFFECTS`에 `PowerShell: 'execute'`를 더한다. Windows의 claude는 셸로 PowerShell을
  쓴다(기록 103건) — 지금은 `other`로 떨어진다.

### (E) opencode 어댑터

- **FR-21.** **`buildCommand`가 `--thinking`을 붙인다** — `['run', '--format', 'json', '--thinking', …]`.
  1.18.30 run 루프는 이 플래그가 있을 때만 `reasoning` 줄을 낸다(§2-3). 출력만 바꾼다 — 모델 호출
  인자·권한과 무관하다. 2.x는 fixes FR-17의 버전 게이트가 먼저 막는다.
  *(다듬음 — 리뷰 반영 2026-09-27: `--thinking`은 **1.1.50에서 생겼다**(1.1.49의 `run.ts`에는 없다). 1.0.0부터
  CLI가 yargs `.strict()`라 모르는 옵션이면 도움말을 찍고 exit 1이므로, 그 아래 버전에서는 모든 run이
  시작하자마자 실패한다 — §7-A가 claude의 숨은 플래그를 버린 근거와 같다. 같은 버전 게이트에 **최소 버전
  1.1.50**을 두어 preflight에서 이유를 말하며 막는다(설정 화면의 CLI 상태도 같은 판정이다). 버전을 못 읽으면
  지금처럼 막지 않는다.)*
- **FR-22.** **`reasoning` 줄 → `reasoning`.** `text` = `part.text`(FR-10, 공백뿐이면 이벤트 없음),
  `startedAt` = `part.time.start`, `endedAt` = `part.time.end`(수가 아니면 null). **`part.metadata`는
  버린다** — provider 서명·암호문이다(E3).
  *(리뷰 반영 2026-09-27: 구현이 한동안 §7-A를 opencode에도 넓혀 공백뿐인 reasoning을 빈 본문으로 냈다.
  §7-A는 우려 2 — claude — 의 결정이라 이 FR대로 되돌렸다. OpenAI 계열은 본문 없이 암호문만 오는 reasoning이
  흔해, 내면 턴마다 펼칠 것 없는 생각 줄이 여럿 선다.)*
- **FR-23.** **`output`** — `completed`면 `state.output`, `error`면 `state.error ?? state.output`.
  문자열이 아니면 싣지 않는다. FR-10으로 자른다.
- **FR-24.** **`detail`은 도구 이름으로 가른다**(opencode는 같은 줄에 이름이 있다). `completed`일 때:

  | `part.tool` | detail |
  |---|---|
  | `bash`, `shell` | `shell` — `exitCode` = `metadata.exit`(수가 아니면 null), `interrupted` = `metadata.interrupted === true`, `timedOut: false`(**미확인** — §7 우려 14) |
  | `grep` | `search` — `metadata.matches`/`matches`, `truncated` |
  | `glob` | `search` — `metadata.count`/`files`, `truncated` |
  | `edit` | `edit` — 파일 하나: `path` = `filediff.file ?? input.filePath`, `operation: 'edit'`, hunk = `parseUnifiedDiff(filediff.patch ?? metadata.diff)`, `added`·`removed` = `filediff.additions`·`deletions`, `before: null`, `beforeMissing: 'unavailable'` |
  | `write` | `edit` — `path` = `metadata.filepath ?? input.filePath`, `exists === false`면 `create`(`beforeMissing: null`), 아니면 `overwrite`(`'unavailable'`), hunk 없음 |
  | `apply_patch`, `patch` | `edit` — `metadata.files[]`마다 파일 하나(`type` add → `create`, delete → `delete`, 그 밖 → `edit`, hunk = `parseUnifiedDiff(diff)`). **모양이 미확인이라** 배열이 아니면 detail 없음 |
  | `task` | `subagent` — `sessionId` = `metadata.sessionId`, `model` = `metadata.model.modelID`, `toolCount: null`, `durationMs` = `time.end − time.start` |
  | 그 밖 | 없음 |

  `error`일 때는 `metadata.exit`가 수인 bash만 `shell`을 싣고, `metadata.interrupted`면 `interrupted: true`다.
  `parseUnifiedDiff`는 `@@ -a,b +c,d @@` 머리(개수 생략형 `@@ -1 +1 @@` 포함)와 ` `·`-`·`+` 줄만 읽고
  `Index:`·`===`·`---`·`+++`·`\ No newline` 줄은 건너뛴다. 모양이 깨지면 빈 배열이다(`hunks: []`).
  opencode 전용 방언이라 opencode 쪽에 둔다.

  *(다듬음 — 리뷰 반영 2026-09-27.)*
  - *apply_patch의 파일별 diff는 `patch` 키다*(§2-3 정정). `diff`만 읽던 동안 실제 run의 apply_patch는 늘
    `hunks: []`였다 — 화면에 `+N −M`만 있고 줄이 없는 파일 줄. `patch ?? diff`로 읽고(옛 모양), **diff 글이
    없는 항목이 있으면 detail이 없다**(줄 없는 `+1 −1`은 반쯤 맞는 detail이다). `move`는 새 자리(`movePath`)의
    `edit`이다 — CLI의 `relativePath`도 그렇다.
  - *수의 모양은 claude와 같다*(FR-14 다듬음) — `matches`·`count`·`additions`·`deletions`는 음이 아닌
    정수여야 싣고, task의 걸린 시간은 반올림한다.
- **FR-25.** 실패한 도구의 `summary`를 `state.error`에서 만든다. 지금은 `summarize(undefined)`가
  `""`(따옴표 두 글자)가 된다 — 결함이다.
- **FR-26.** **권한 거부 → `notice`.** `status === 'error'`이고 `state.error`가 아래 문구로 시작하면
  `tool_use`·`tool_result` 뒤에 `permission_denied` 공지를 하나 더 낸다(`toolUseId` = `callID`).

  | `state.error`의 시작 | 문구 |
  |---|---|
  | `The user rejected permission to use this specific tool call` | `권한 때문에 막힘: bash (묻는 권한은 헤드리스에서 자동으로 거부됩니다)` |
  | `The user has specified a rule which prevents you from using this specific tool call` | `권한 때문에 막힘: bash` |

  문구는 상수로 두고 테스트가 고정한다 — CLI의 영어 문장에 기대는 판정이라 버전이 바뀌면 조용히
  빠진다(§7 우려 13).
- **FR-27.** `TOOL_EFFECTS`에 `apply_patch: 'write'`를 더한다(지금은 `other`라 파일을 쓰는데도 쓰기로
  잡히지 않는다).
- **FR-28.** `parentToolUseId`·`messageId`는 싣지 않는다(E4·E7은 claude).
  *(§7-A가 절반을 뒤집었다: `part.messageID`는 `messageId`로 text·tool_use·tool_result·reasoning·notice에
  싣는다 — session·usage·result·error에는 싣지 않는다. `parentToolUseId`는 그대로 싣지 않는다.)*

### (F) 창 — 로그 되살리기와 스토어

- **FR-29.** `RUN_EVENT_WINDOW`와 `eventWeight`를 `shared/events.ts`에 둔다(§3). core의 `readLog`와
  렌더러 스토어가 같은 값을 본다 — 따로 적으면 되살린 턴과 실시간 턴의 모양이 갈린다.
- **FR-30.** **IPC push는 지금 그대로다** — 이벤트마다 전역으로, 새 필드를 빼지 않고 보낸다. 펼친 턴은
  스토어만 보고 그리므로(TL FR-14) 무거운 필드를 따로 불러오는 두 번째 경로를 만들지 않는다. 양은
  FR-10의 상한과 FR-31의 창이 묶는다(§5).
- **FR-31.** **렌더러 스토어**(`renderer/store/runEvents.ts`)는 run마다 **2,000개**(지금)에 더해
  **무게 합 8,000,000자**를 넘지 않게, 넘으면 **가장 오래된 이벤트부터** 버린다. `push`와 `hydrate`
  (fixes FR-19의 seq 병합) 둘 다다. 무게는 이벤트를 넣을 때 한 번 잰다. 이미 본 seq(`seen`)는
  버린 뒤에도 기억한다 — 늦게 온 옛 이벤트가 되살아나지 않게.
- **FR-32.** 테스트용 옵션 `maxPerRun`은 남기고 `maxCharsPerRun`을 더한다.
- **FR-33.** **`readLog`는 창 안의 꼬리만 돌려준다** — 끝에서부터 2,000개·8,000,000자까지, 순서는
  seq 오름차순 그대로. 무게는 줄 길이다(`logWriter`가 쓴 것이 정확히 `JSON.stringify(event)`라 같은
  수다). 깨진 줄은 지금처럼 건너뛴다. **IPC로 넘어가는 양이 창으로 묶인다** — 긴 run의 로그 전체를
  렌더러로 보냈다가 스토어가 버리는 일이 없다.
  *(다듬음 — 리뷰 반영 2026-09-27: **읽는 쪽 비용도 창으로 묶는다.** 파일 전체를 문자열로 읽고 줄 배열을
  만든 뒤 꼬리만 파싱하면, IPC 양은 묶여도 메인 프로세스가 로그 크기의 두 배 가까운 메모리를 순간적으로
  잡고(같은 프로세스에 MCP 서버가 돈다) V8 문자열 한계를 넘는 로그에서는 던졌다. 끝에서부터 64KiB 덩어리로
  거꾸로 읽어 창이 차면 멈춘다 — `core/db/repositories/logTail.ts`. 줄은 바이트 `\n`으로 가르므로 덩어리
  경계가 여러 바이트 글자에 걸려도 온전하다. 깨진 줄이 창의 글자에도 세지 않는다는 것을 테스트로
  고정했다.)*
- **FR-34.** 옛 로그(새 필드·종류가 없는 줄)는 그대로 읽힌다. 모르는 `type`의 줄도 버리지 않고 넘긴다
  (렌더러가 모르는 종류를 무시한다 — 앞으로 종류가 늘어도 되살리기가 깨지지 않는다).

### (G-1) 렌더러 — timeline 투영에 새 필드를 채우는 규칙

timeline spec의 FR 번호를 그대로 부른다(`TL FR-n`). **새 필드가 없으면 전부 TL 규칙 그대로다** —
옛 로그의 턴은 이 기능 전과 같게 보인다.

- **FR-35.** `projectTurn`의 run 입력에 `startedAt`을 더한다(TL FR-1의 네 칸 → 다섯 칸). reasoning
  시간 추정(FR-40)에 쓴다.

- **FR-36. 도구 한 줄(`ToolItem`)의 새 값.**

  | 값 | 규칙 | 없으면 |
  |---|---|---|
  | `output` | `tool_result.output` (`outputSource: 'full'`) | `summary` (`'summary'`, TL FR-16 그대로) |
  | `outputTruncated` | `tool_result.outputTruncated ?? 0` | 0 |
  | `exitCode` | `detail.kind === 'shell'`의 `exitCode` | null |
  | `stopped` | shell의 `timedOut` → `'timed_out'`, `interrupted` → `'interrupted'` | null |
  | `matches` · `matchUnit` · `matchesTruncated` | `detail.kind === 'search'`의 `count`·`unit`·`truncated` | TL FR-5의 `Found N` → `matches = N`, `matchUnit = 'files'`(claude files_with_matches의 출력이다) |
  | `denied` | 같은 `toolUseId`의 `permission_denied` 공지가 턴 안에 있다 | false |
  | `parentToolUseId` | `tool_use.parentToolUseId` | null |
  | `subagent` | `detail.kind === 'subagent'`의 네 값 | null |

- **FR-37. 편집 블록(`EditFile`)의 줄 번호.** 편집 계열 도구의 결과에 `detail.kind === 'edit'`가 있으면
  그 `files[]`로 파일 줄을 만든다(도구 하나가 파일 여럿일 수 있다 — apply_patch). **hunk에서 diff를
  만들고 LCS를 돌리지 않는다**(`renderer/diff.ts`의 `hunksFromPatch`).
  - 줄마다 옛·새 줄 번호를 단다 — `oldStart`·`newStart`에서 시작해 ` `는 둘 다, `-`는 옛만, `+`는 새만
    하나씩 센다. hunk 사이 간격(`다음 oldStart − (앞 oldStart + 앞 oldLines)`)을 `gapBefore`로 둔다.
  - `operation: 'create'`이고 hunk가 비었으면 TL FR-7의 "전부 추가"를 쓰되 **새 줄 번호 1..n을 단다**
    (새 파일의 줄 번호는 안다).
  - `+N −M`은 `detail`의 `added`·`removed`, null이면 hunk에서 센다. 표시 상한 400줄(TL FR-7)은 그대로이고
    `hunksTruncated`를 "… N줄 더"에 더한다.
  - `operation: 'overwrite'`이고 `before`가 있으면 `EditFile.before`로 넘긴다(FR-47). `edit`의 `before`는
    화면에 쓰지 않는다 — hunk로 충분하고, diff 뷰어의 재료로 로그에 남을 뿐이다.
  - `detail`이 없거나 그 파일이 `files[]`에 없으면 TL FR-7 그대로(입력으로 만든 번호 없는 diff).
  - `DiffLine`에 `oldNo?`·`newNo?`, `DiffHunk`에 `oldStart?`·`newStart?`·`gapBefore?`, `EditFile`에
    `numbered`·`operation`·`before`를 더한다. 선택 필드라 TL의 입력 diff는 그대로 컴파일된다.
  - *(다듬음 — 리뷰 반영 2026-09-27)* **같은 파일의 편집을 한 줄로 합칠 때 뒤 편집의 첫 hunk는 간격을
    세지 않는다**(`gapBefore` 없음 → 셈 없는 hunk 경계, TL의 가는 선). 그 첫 hunk의 `gapBefore`는 "파일 맨
    위부터의 줄 수"라 앞 hunk와의 간격이 아니고, 번호도 앞 편집이 반영된 파일 기준이라 간격을 알 수 없다
    — 41~43 hunk 뒤 45에서 시작하는 편집 앞에 `⋯ 44줄`이 섰다. 같은 편집 안의 hunk 사이는 그대로 잰다.
  - *(다듬음 — 리뷰 반영 2026-09-27)* **옛 내용을 모르는 덮어쓰기(hunk 없는 `overwrite`, opencode write)는
    지운 줄 수가 null이다** — 입력으로 만든 "전부 추가" diff에서 세면 늘 −0이라, 100줄을 5줄로 덮어쓴 편집이
    "더하기만 했다"로 읽혔다. `EditFile.removed`는 `number | null`이고 화면은 null이면 `−M`을 적지 않는다.
    합친 파일 줄은 한쪽이라도 모르면 모른다.

- **FR-38. 하위 에이전트.** 종류가 `subagent`인 `tool_use`(TL FR-4 표의 `task`·`agent`)는 활동 묶음에
  들지 않고 **`subagent` 블록 하나**가 된다 — 묶음을 끊는다(tool-error와 같다).
  - `parentToolUseId`가 P인 이벤트는 **P의 카드 안에** 들어간다. 카드 안은 같은 규칙으로 투영한다
    (재귀 — 중첩 에이전트는 카드 안의 카드). 조상을 따라가다 같은 id를 다시 만나면 멈춘다.
  - P의 `tool_use`가 이벤트 목록에 없으면(창 때문에 앞이 잘렸다) 그 이벤트는 **메인에 그린다** — 버리지
    않는다.
  - 카드 값: 호출의 `ToolItem`(부제는 description, 오른쪽에 `subagent_type` — TL FR-16), 자식 블록,
    자식 도구 수·실패 수, `running`(호출이 running이거나 자식 중 running이 있으면).
  - 실패한 하위 에이전트 호출도 카드다(오른쪽에 "실패"). tool-error 줄로 빼지 않는다 — 자식이 한 일이
    카드 안에 있어야 한다.

- **FR-39. 접힌 턴의 값(TL FR-9) 확장.**
  - `summary = { tools, failed, denied, compacted }` — **메인 스레드의 도구만 센다**(카드는 하나로 센다).
    `denied`는 권한 거부 공지의 고유 `toolUseId` 수(+ id 없는 공지 수), `failed`는 실패한 결과 중 거부가
    아닌 것. `compacted`는 `compact` 공지가 하나라도 있으면 참. 넷이 전부 0·거짓이면 null.
  - `current`는 메인 스레드의 결과 없는 마지막 `tool_use`다. 그것이 하위 에이전트면 `currentChild` = 그
    카드 안의 결과 없는 마지막 `tool_use`.
  - `retrying` = run이 `running`이고 메인 스레드의 마지막 이벤트가 `retry` 공지면 그 `text`, 아니면 null.
    *(다듬음 — 리뷰 반영 2026-09-27: **턴의 마지막 이벤트**다 — 스코프를 가리지 않는다. 재시도 공지는 늘 메인
    스코프에 서지만, 하위 에이전트가 도는 동안 메인은 Agent의 결과를 기다리므로 그때의 재시도는 자식의 API
    호출이다(claude 2.1.280은 메인이 아닌 경로의 재시도 대기도 출처 없는 재시도 줄로 알린다 — 바이너리).
    그 뒤에 자식의 이벤트가 오면 호출이 다시 흐르는 것인데, "메인의 마지막"으로 보면 상태 줄이 `하위 에이전트
    … › <자식 도구>` 대신 낡은 재시도 문구에 멈췄다. 병렬 하위 에이전트 둘 중 하나만 재시도 중일 때는 다른
    쪽의 이벤트가 문구를 지우지만, 그 대기는 주기적으로 다시 알려 온다.)*
  - `omitted` = 첫 이벤트의 `seq`(창 때문에 앞이 잘렸으면 0보다 크다).

- **FR-40. `reasoning` 블록** `{ kind: 'reasoning', key, text, durationMs, estimated, truncated }`.
  - `startedAt`·`endedAt`이 둘 다 있으면 `durationMs = endedAt − startedAt`, `estimated: false`(opencode).
  - 아니면 **추정**이다(claude): 이 이벤트의 `at` − 같은 스코프의 바로 앞 이벤트의 `at`(첫 이벤트면
    `run.startedAt`). 음수이거나 기준이 없으면 null. `estimated: true`.
  - text 블록처럼 활동·편집 묶음을 끊는다. TL FR-8의 답 중복 제거는 text 블록만 본다 — reasoning은
    답이 아니다.

- **FR-41. `notice` 블록**(TL의 raw 공지와 같은 종류, `noticeKind`·`count`를 더한다).
  - **`permission_denied`는 `toolUseId`로 한 번만** 그린다(처음 것). 그 id의 `tool_use`가 턴 안에 있으면
    그 도구는 tool-error이고(거부된 호출은 실패로 끝난다) **공지는 그 tool-error 블록 바로 뒤, 같은
    스코프에** 선다. 없으면 공지 자신의 seq 자리(메인)에 선다.
  - **연속된 `retry`는 하나로 합친다**(사이에 다른 블록이 없을 때) — 마지막 것의 `text`, `count` = 합친 수.
  - `compact`·`model_fallback`·모르는 종류는 제 seq 자리(메인)에 따로 선다. 모르는 종류는 `text`만 그린다.
  - 공지는 활동·편집 묶음을 끊는다(TL FR-6 그대로).

- **FR-42. `TOOL_LABELS`(TL FR-4)에 두 줄을 더한다** — `powershell` → 셸/shell, `apply_patch` → 패치/edit.

### (G-2) 렌더러 — 화면

- **FR-43. 셸 한 줄.** 부제 오른쪽에 `exitCode`가 0이 아닌 수면 `종료 코드 N`(`--danger-text`),
  `stopped`면 `중단됨`·`시간 초과`. 펼치면 명령(TL FR-16) 아래 **출력 블록**이다.
  - 평문 `<pre>`, 모노, `white-space: pre-wrap` + `overflow-wrap: anywhere`(가로 스크롤 없음),
    `max-height: 240px` 세로 스크롤(TL 치수 표). **열 때 바닥으로 스크롤한 채 연다** — 남긴 것이
    끝부분이고, 셸에서 보고 싶은 것도 끝이다.
  - `outputTruncated > 0`이면 블록 위에 `앞부분 12,345자는 기록하지 않았습니다`(`--text-muted`).
    `outputSource === 'summary'`면 TL FR-16의 "출력 앞부분만 기록됩니다" 그대로.
  - **ANSI 제어열은 화면에서만 걷는다**(`renderer/ansi.ts`의 `stripAnsi`). 로그는 그대로다.
    *(다듬음 — 리뷰 반영 2026-09-27: **걷기는 선형 시간이다.** OSC·DCS 본문을 `[\s\S]*?`로 두면 끝나지 않은
    시작점마다 입력 끝까지 훑은 뒤 실패해, `ESC ]`를 되풀이한 65,536자 출력에 약 0.6초가 걸렸다 — 도구
    출력은 신뢰할 수 없는 입력이고 펼친 셸 줄은 도는 턴에서 매초 다시 그려진다. 본문은 다음 ESC(OSC는
    BEL도)에서 멈춘다 — 터미널도 문자열 안의 ESC에서 문자열을 끝낸다.)*
- **FR-44. 검색 한 줄의 개수**(TL FR-16의 "(N개 일치)"를 단위별로): `files` → `(파일 N개)`,
  `matches` → `(N개 일치)`, `lines` → `(N줄)`. `matchesTruncated`면 `N개 이상`처럼 "이상"을 붙인다.
- **FR-45. mcp·그 밖 한 줄**을 펼치면 TL FR-16의 입력 JSON 아래에 출력 블록(FR-43과 같은 모양, ANSI
  걷기 없음)을 더한다. 읽기·검색·웹·할 일 줄은 TL 그대로 펼칠 것이 없다.
- **FR-46. 실패한 도구 줄(TL FR-17).** 펼치면 `output`(출력 블록 모양). `denied`면 오른쪽 글자가
  "실패" 대신 `권한 거부`이고, 공지선이 바로 아래에 선다(FR-41).
- **FR-47. 줄 번호 diff**(`numbered`인 파일 줄을 펼쳤을 때).
  - 줄마다 옛 번호 · 새 번호 · 부호 · 본문. 번호 칸은 모노, 오른쪽 정렬, `--text-muted`,
    **`user-select: none`** — 본문을 복사할 때 번호가 딸려 오지 않게. 추가·삭제 바탕은 TL FR-18 그대로.
    *(다듬음 — 리뷰 반영 2026-09-27: 추가·삭제 줄 위의 번호는 `--text-secondary`다. 다크 스킴에서 추가 줄의
    초록 바탕 위 `--text-muted`는 약 3.75:1로 4.5:1에 못 미쳤다 — 캡처는 문맥 줄 위의 번호만 쟀다.
    `renderer/diffContrast.test.ts`가 `index.css`의 토큰으로 두 스킴 · 세 줄 종류를 잰다.)*
  - hunk 사이 구분선에 `⋯ N줄`(`gapBefore`). 첫 hunk가 1줄에서 시작하지 않으면 위에도 선다.
  - `before`가 있는 덮어쓰기는 파일 줄 안에 `이전 내용 보기`/`이전 내용 숨기기` 버튼 → `before`를 출력
    블록 모양(평문, 240px)으로. `create`는 TL의 "새로 씀"에 줄 번호가 붙는다.
  - 번호 없는 diff는 TL FR-18 그대로다.
- **FR-48. 생각 블록.** 접힌 한 줄 버튼 `생각 · 4초`(추정이면 `생각 · 약 4초`, 시간을 모르면 `생각`).
  시간은 TL FR-11의 `formatDuration`. 펼치면 `text`를 **평문**으로(`pre-wrap`, `.75rem`,
  `--text-secondary`) — **마크다운으로 해석하지 않는다**(TL FR-26의 평문 목록에 생각을 더한다).
  `truncated`가 있으면 끝에 `뒷부분 N자는 기록하지 않았습니다`. 열림은 TL FR-15 규칙(블록 key,
  사용자만 연다·닫는다, 상태 전이로 열리지 않는다).
- **FR-49. 하위 에이전트 카드.** 머리 줄 = 라벨 `하위 에이전트` · description · 오른쪽에
  `subagent_type`·상태(running 스피너 / `실패`) · 메타 `도구 12회 · 34초 · <모델>`(`subagent`의 값이
  있으면 그것, 없으면 자식 수로 센 도구 수만). 머리 줄 전체가 토글 버튼이고 `aria-label`이
  `하위 에이전트 <description>`이다(머리 줄의 상태·메타 글자가 이름에 빨려 들어가지 않게). 펼치면:
  1. `input.prompt` 평문(TL FR-16),
  2. 자식 블록 — 같은 `TimelineBlocks`, 12px 들여쓰기 + 왼쪽 1px `--border-faint` 세로선,
  3. 결과 — `output` 출력 블록(평문 — 하위 에이전트의 보고도 도구 출력이다, TL FR-26).
  - 자식도 detail도 없으면(opencode) 자식 자리에 `OpenCode는 하위 에이전트의 활동을 보내지 않습니다`를
    `--text-muted`로. 모르는 것을 빈칸으로 두지 않는다.
  - 열림은 TL FR-15 규칙(key = 호출 id).
- **FR-50. 공지선**(TL FR-19의 모양 — 가운데 한 줄, 양옆 가는 선). `text` 그대로. 글자색은
  `permission_denied`·`model_fallback` → `--warn`, `compact`·`retry` → `--text-muted`. 합친 retry는
  `text`만 보인다(마지막 시도 번호가 이미 들어 있다). 보기 전용이고 live region이 아니다(TL NFR-4).
- **FR-51. 접힌 턴(TL FR-12).**
  - 활동 요약 줄: `도구 7회 · 실패 1 · 권한 거부 1 · 대화 압축됨` — 0인 조각은 빠진다. 도구가 0이어도
    압축·거부가 있으면 그 조각만.
  - 상태 줄: `retrying`이 있으면 도구 자리에 그 문구(`작업 중 · 12초 · API 재시도 중 · 2/10번째 …`).
    `current`가 하위 에이전트면 `하위 에이전트 <description> › <자식 라벨> <자식 부제>`.
- **FR-52. 앞이 잘린 턴.** 펼친 턴에서 `omitted > 0`이면 블록 맨 위에 `앞의 기록 N개는 생략했습니다`
  (`--text-muted`). 창(FR-31·33) 때문에 빠진 것이 화면에서 "없던 일"로 보이면 안 된다.
- **FR-53. 평문 규칙.** `output`·`before`·reasoning `text`·공지 `text`는 전부 React 텍스트 노드로만
  그린다. HTML·마크다운으로 해석하는 길을 만들지 않는다 — 셋 다 신뢰할 수 없는 입력이다(intent 제약).

## 5. 크기·성능

### 5-1. 지금과 추정

| 대상 | 지금(실측) | 이 기능 뒤(추정) | 근거 |
|---|---|---|---|
| 정규화 로그 한 run | 10~66KB(이 장비의 one-desk 로그 7개, p50 12KB). `tool_result` 줄 평균 약 350B(200자 요약) | **약 100KB~1MB**. 가장 큰 로컬 run(도구 44회: Read 21·Edit 8·Write 6)은 Read 출력(p50 약 10K자)·Edit `before`(p50 약 5.7K자)가 더해져 **약 300~500KB** | §2-1 기록의 크기 |
| `tool_result` 한 줄 | ≤ 약 0.5KB | 전형 1~10KB, **최대 약 33만 자**(출력 65,536 + hunk 131,072 + before 131,072) | FR-10 |
| `raw.jsonl` 한 run | (없음) | 정규화 로그의 **2~5배** — 원본 줄이 `content`와 `tool_use_result`를 둘 다 담고, 이미지 Read는 base64가 두 벌. 전형 1~3MB, **상한 32MiB** | FR-3, 기록의 Read 크기(p90 약 38만 자) |
| IPC push | 이벤트마다 전역 push(지금 그대로) | 이벤트당 전형 수 KB, 최대 약 33만 자 | — |
| 렌더러 스토어 | run당 2,000개(무게 상한 없음) | run당 2,000개 **그리고** 800만 자 | FR-31 |
| `readLog` IPC | 로그 전체 | 창 안의 꼬리 — 최대 800만 자 | FR-33 |

### 5-2. 비용

- **어댑터**: 줄마다 하는 일은 JSON에서 필드를 읽고 문자열을 자르는 것뿐이다. `parseUnifiedDiff`는
  patch 길이에 선형이다. 파일·네트워크 접근이 없다.
- **manager**: 줄마다 `raw.jsonl`에 append 한 번(스트림 버퍼링). 상한 판정은 누적 바이트 덧셈이다
  (`Buffer.byteLength`).
- **스토어**: `eventWeight`가 이벤트를 넣을 때 `JSON.stringify` 한 번(33만 자 이벤트에 1ms 안쪽).
  IPC가 이미 같은 크기의 직렬화를 하므로 차수가 같다.
- **투영**: TL NFR-3 그대로(이벤트 수에 선형, `useMemo`). 하위 에이전트 재귀도 이벤트마다 한 번만 방문한다.

## 6. 비기능 요구사항

- **NFR-1.** 마이그레이션·스키마·IPC 채널 변경 없음. `run` 행에 새 컬럼이 없다.
- **NFR-2.** **CLI 방언은 어댑터 밖으로 나가지 않는다.** `tool_use_result`·`structuredPatch`·
  `originalFile`·`filediff`·`parent_tool_use_id`·`compact_boundary`·`api_retry`·`permission_denials`가
  `core/runner/adapters/`(와 그 픽스처, `core/runner/fixtures/`의 가짜 CLI) 밖에 나오면 위반이다
  (run-info NFR-2와 같은 원칙).
- **NFR-3.** **`parseLine`은 한 줄만 본다**(설계 2026-09-06 §7). 그래서 claude의 detail은 모양으로
  가르고(FR-14), 권한 거부 중복은 화면이 거른다(FR-19·41).
  *(다듬음 — 리뷰 반영 2026-09-27: **`parseLine`은 던지지 않는다.** stdout 핸들러 안에서 불려 던지면 메인
  프로세스가 죽는다. JSON으로 읽혔지만 객체가 아닌 줄(`null`·수·배열)은 깨진 줄과 같이 `raw`이고, content
  배열의 객체가 아닌 원소(null 등)는 건너뛴다 — 두 어댑터 다.)*
- **NFR-4.** 경계 셋 그대로 — `core/`는 electron을 모르고, `renderer/`는 core를 모르며, IPC 핸들러는
  얇다. `shared/events.ts`의 `eventWeight`는 순수 함수다.
- **NFR-5.** 헤드리스 제약 그대로 — `ask`를 만들지 않고 `stdin.end()`를 부른다. `--thinking`은 권한과
  무관하다. 판정 규칙(fixes FR-12)도 그대로다 — 새 이벤트는 상태를 정하지 않는다(FR-8).
- **NFR-6.** 색은 `:root` 토큰에서만, 새 색 토큰 없음(`--warn`·`--danger-text`·`--text-muted`·
  `--border-faint`는 이미 있다). 글자 흐림은 `opacity`가 아니라 `--text-muted`(DESIGN.md).
- **NFR-7.** **새 접근성 이름이 기존 셀렉터와 부분 일치로 부딪히지 않는다.** 새 이름: `생각 · …`·
  `생각`, `이전 내용 보기`·`이전 내용 숨기기`, `하위 에이전트 <description>`. 검토: "보기"를 부분
  일치로 잡는 e2e는 없다(`대화창 보이기`는 "보이기"다). 공지·출력 블록은 버튼이 아니다.

## 7. 우려 사항

1. **E1이 run-info spec §7의 문장을 거짓으로 만든다.** 그 절은 `rate_limit_event`(구독 상태·리셋 시각 —
   개인 계정 정보)를 "파싱하지 않는다 — 로그 파일에는 원본 줄이 남지 않는다"고 적었다. `raw.jsonl`에는
   남는다. 이 spec은 E1대로 **모든 줄을 쓴다**. 남기지 않으려면 `raw.jsonl`에 쓰지 않을 `type`의 목록
   (`rate_limit_event` 하나)을 두는 것이 가장 작은 수정이다 — **결정이 필요하다.** 어느 쪽이든 run-info
   spec §7에 각주를 단다(plan 7단계).
2. **claude의 생각은 대부분 본문 없이 온다.** 이 장비의 기록에서 thinking 블록 1,851개 중 1,800개가 빈
   문자열이었다(서명만). `-p`에서도 같다면 claude의 생각 블록은 거의 그려지지 않는다(FR-15가 빈 것을
   버린다). 숨은 플래그 `--thinking-display summarized`가 요약을 싣게 할 수 있지만 **숨은 플래그라
   버전마다 흔들리고**, E3은 플래그를 더하라고 하지 않았다. 빈 생각을 "생각 · N초"(펼칠 것 없음)로라도
   보일지와 함께 **결정이 필요하다.** 이 spec은 둘 다 하지 않는다.
3. **픽스처가 합성이다.** 모델 호출 금지로 스트림을 새로 뜨지 못했다. claude 픽스처는 스키마와 기록의
   모양을, opencode 픽스처는 소스·바이너리의 모양을 옮겨 만든다 — 모양의 출처를 테스트 파일 머리에
   적는다. **스트림은 기록과 다를 수 있다**(Write의 `stripForStorage`, Edit `originalFile`의 약 1만 자
   한계가 스트림에도 있는지). 이 기능이 남길 `raw.jsonl`이 바로 그 확인 재료다 — 사용자가 실제 run을
   한 번씩 돌린 뒤 그 줄로 픽스처를 바꾸는 것을 plan의 후속 항목으로 둔다.
4. **로그가 줄지 않는다.** 로그 디렉토리를 지우는 코드가 지금도 없고(`core/`에 run 로그 삭제 없음), 이
   기능으로 run당 정규화 로그가 약 5~10배, 거기에 `raw.jsonl`이 더해진다(§5-1). 보존 정책(오래된 run의
   `raw.jsonl`부터 지우기 등)은 별도 과제다.
5. **Read 출력이 로그의 대부분이 된다.** E2는 도구를 가리지 않으므로 Read의 결과(파일 내용)도 65,536자까지
   남는다. 그런데 화면(TL FR-16)은 읽기 줄을 펼치지 않는다 — **화면에 안 쓰는 데이터가 가장 크다.** diff
   뷰어·재파싱에 쓸 수 있다는 것이 남기는 이유다. Read만 `output`을 빼려면 E2를 좁혀야 한다.
6. **렌더러 메모리는 run을 넘어 쌓인다.** 스토어는 앱이 켜져 있는 동안 받은 모든 run을 들고 있고(지금도
   run을 비우지 않는다), 창(FR-31)은 run 하나를 묶을 뿐이다. 긴 세션에서 무거운 run이 여럿이면 합이 커진다.
   끝난 run을 비우면 접힌 턴의 활동 요약(TL FR-14)이 같은 세션 안에서 사라지므로 이번에는 두지 않았다.
7. **하위 에이전트의 text·생각은 오지 않는다.** 기본 스트림에는 자식의 tool_use/tool_result만 흐른다(§2-2).
   `--forward-subagent-text`(2.1.211+)를 붙이면 자식의 말과 생각이 카드에 들어오지만 로그·IPC 양이 늘고
   E4는 그것을 정하지 않았다. 또 **하위 에이전트는 전체 허용에서만 뜬다** — 읽기 전용·편집 허용의
   `--tools` 화이트리스트에 `Agent`/`Task`가 없다(`permission.ts`). 카드를 보려면 전체 허용이어야 한다.
8. **E7의 재료가 반쪽이다.** `--rewind-files`는 **사용자 메시지**의 id를 받는데, 우리 지시(stdin)의 메시지는
   스트림에 나오지 않는다(`--replay-user-messages`가 있어야 되돌려 준다). 이 spec이 남기는 것은 assistant·
   도구 결과 줄의 uuid뿐이다. 되돌리기 설계에서 다시 봐야 한다.
9. **opencode의 `part.messageID`를 버린다.** E7이 claude만 적었기 때문이다. 값싸게 실을 수 있고 opencode의
   `/revert`도 메시지 id를 받는다 — 실을지 **결정이 필요하다.**
10. **`model_fallback`은 `-p`에서 안 올 수 있다.** 스키마가 `@internal`이고 "아직 공개 SDKMessage 유니온에
    없다"고 적었다. 오면 받는다(FR-18). 테스트는 합성 줄로만 고정된다.
11. **권한 거부 공지는 로그에 두 번 남는다**(`system/permission_denied` + `result.permission_denials`).
    `parseLine`이 한 줄만 보기 때문이다(NFR-3). 화면은 한 번 그린다(FR-41). manager에서 거르면 로그가
    깔끔해지지만 manager가 이벤트 내용을 판단하는 첫 자리가 된다 — 두지 않았다.
12. **opencode의 before는 여전히 없다**(§2-3). 줄 번호 hunk는 생기지만 파일 전체 원본은 없어서, 설계
    2026-09-06 §10-1의 스냅샷 문제는 edit에서도 **절반만** 풀린다. diff 뷰어 설계가 이것을 다시 다뤄야 한다.
    plan 7단계가 그 절에 각주를 단다.
13. **opencode 권한 거부 판정은 영어 문장에 기댄다**(FR-26). 1.18.x 안에서는 바이너리로 확인했지만 문구가
    바뀌면 공지만 조용히 빠진다(도구 실패 줄은 그대로 남는다). fixes FR-17의 버전 게이트가 2.x를 막는다.
14. **opencode bash의 시간 초과를 모른다.** 바이너리에서 timeout이 `<shell_metadata>` 꼬리로 `output`에
    붙는 것까지는 보이지만 필드로는 안 보인다. `timedOut`은 항상 false이고, 그 꼬리는 출력에 글자로 남는다.
15. **claude 셸의 성공 종료 코드를 모른다.** `tool_use_result`에 종료 코드가 없고 실패할 때만 `Exit code N`이
    온다. `returnCodeInterpretation`(0이 아닌데 오류가 아닌 경우)도 읽지 않는다 — 화면은 성공한 셸에 코드를
    적지 않는다.
16. **TL의 문구 하나를 바꾼다.** TL FR-16은 `Found N`을 "(N개 일치)"로 그리는데, 그 형식은 claude Grep의
    files_with_matches — **파일 수**다(이 장비의 로그에서 Grep 결과 11건 중 `Found N`으로 시작한 것은 2건,
    둘 다 파일 수). FR-44가 `(파일 N개)`로 바로잡는다. timeline이 먼저 들어가면 그 e2e의 글자가 바뀐다.
17. **TL FR-9의 수가 바뀐다.** 지금은 하위 에이전트의 자식 도구가 메인 도구로 섞여 "도구 N회"에 들어간다.
    FR-39가 메인만 센다 — 같은 턴의 요약 수가 이 기능 전후로 다를 수 있다(맞는 쪽으로).
18. **intent가 가리킨 "CLAUDE.md의 thinking 결정"은 CLAUDE.md에 없다.** 그 결정은 `claudeCode.ts`의 주석
    ("thinking은 버린다. signature가 3~5KB라…"), `claudeCode.parse.test.ts`의 "thinking 블록은 버린다", 2단계
    계획의 표(`docs/superpowers/plans/2026-08-08-stage2-agent-execution.md`:48)에 있다. 주석과 테스트를
    고치고, 옛 계획 문서는 기록으로 두며, 새 규칙을 CLAUDE.md에 적는다(plan 7단계).
19. **fixes·timeline과 파일이 겹친다** — `manager.ts`·`opencode.ts`(fixes), `run.ts`의 `readLog`·
    `runEvents.ts`(fixes FR-19), `timeline.ts`·`TimelineBlocks.tsx`·`diff.ts`·`Transcript.tsx`(timeline).
    core 부분은 fixes 병합 뒤, 렌더러 부분은 timeline 병합 뒤에 착수한다(plan).

## 7-A. 우려에 대한 결정 (2026-09-27, 사용자 위임으로 Claude가 택함)

- **`raw.jsonl`에서 `rate_limit_event` 줄은 쓰지 않는다**(우려 1). 개인 구독 정보이고 run-info
  spec §7("로그에 원본 줄이 남지 않는다")과 부딪히는 유일한 type이다. 제외 목록은 그 하나로 두고
  상수로 드러낸다.
- **숨은 플래그 `--thinking-display`를 넘기지 않는다**(우려 2). 숨은 플래그는 버전이 바뀌면
  사라질 수 있고, 모르는 옵션이면 CLI가 시작부터 거부해 **모든 run이 실패한다.** 본문이 빈 생각
  블록은 펼칠 것 없는 "생각 · N초" 한 줄로 보인다(시간은 이벤트 시각으로 잰다). *(2026-09-27 §9-1 결정으로
  뒤집혔다 — 본문이 빈 claude thinking은 이벤트를 만들지 않는다.)*
- **읽기(read) 도구의 원문 출력은 싣지 않는다**(우려 5). 요약과 세부(줄 수 등)만 둔다 — 로그에서
  가장 큰 몫인데 화면(timeline FR-16)이 쓰지 않는다.
- **opencode의 `part.messageID`도 싣는다**(우려 9). 비용이 작고 되돌리기·분기의 재료가 대칭이 된다.
- **`--forward-subagent-text`를 붙이지 않는다**(우려 7). 하위 에이전트 카드에는 도구만 들어간다.
  말과 생각까지 싣는 것은 로그 크기 정책과 함께 `conversation-next`에서 본다.
- **로그 보존 정책은 이 기능이 아니다**(우려 4). `conversation-next`의 후속 항목으로 둔다.
- **E7 재료가 반쪽인 것은 받아들인다**(우려 8) — 되돌리기 spec이 사용자 메시지 uuid를 얻는 길
  (`--replay-user-messages`)과 함께 다룬다.
- **timeline의 "(N개 일치)"는 "(파일 N개)"로 바꾼다**(우려 16) — claude Grep의 기본 출력은 파일 수다.

## 8. 검증

**단위** (새 파일은 †)

- `core/runner/adapters/common.test.ts` † — FR-10·11: 끝부분 65,536자와 `outputTruncated`, 앞부분과
  `truncated`, 서로게이트 경계, 상한 이하면 필드가 없음(FR-7), hunk 예산이 파일을 넘어 이어지고
  `added`·`removed`가 자르기 전 값, `before` 상한에서 null + `too_large`.
- `core/runner/adapters/claudeCode.detail.test.ts` † — FR-14 표의 행마다: Edit·Write create(빈 hunk)·Write
  update·update인데 원본 null·Bash·PowerShell·`timedOutAfterMs`·Grep 세 모드·`appliedLimit`·Glob·동기/비동기
  Agent·MCP·Read(없음)·실패 문자열 + `Exit code 2`·타입이 어긋난 수(없음).
- `core/runner/adapters/claudeCode.parse.test.ts` — **"thinking 블록은 버린다"를 고친다**: thinking →
  reasoning이고 이벤트를 JSON으로 만들어도 `signature` 글자가 없다, 빈 thinking·`redacted_thinking`은 이벤트
  없음. FR-13 출력(배열·이미지·빈 것). FR-16·17: 값이 있으면 싣고 **메인 스레드의 이벤트에는 키 자체가
  없다**(`'parentToolUseId' in e === false`). FR-18 공지 넷의 문구(자동/수동·post 없음·연결 오류·사유 표),
  필수 필드가 없으면 공지 없음, 버리는 subtype. FR-19 순서(`result` → `usage` → `notice`). **옛 줄 호환**:
  `fixtures/claude-stream.jsonl`의 thinking 줄 밖의 줄은 이 기능 전과 같은 이벤트를 낸다(스냅샷).
- `core/runner/adapters/opencode.detail.test.ts` † — FR-24 표의 행마다, `parseUnifiedDiff`(여러 hunk·개수
  생략형·머리 줄·`\ No newline`·깨진 입력 → `[]`).
- `core/runner/adapters/opencode.parse.test.ts` — FR-22(시각, `metadata`가 이벤트에 없음), FR-23·25(실패의
  출력·요약이 `state.error`), FR-26 두 문구 → 공지, 다른 오류 문구 → 공지 없음. 기존 실측 픽스처는 `read`·
  `write`에서 detail만 늘고 나머지 이벤트는 같다.
- `core/runner/adapters/opencode.command.test.ts` — FR-21: `--thinking`이 `--format json` 바로 뒤에 있다.
- `core/runner/logWriter.test.ts` — 원본 writer: 상한에서 표식 한 번과 이후 버림, 한 줄이 상한보다 큰 경우,
  열기 실패가 `onError`로 가고 `close()`가 매달리지 않음.
- `core/runner/manager.test.ts` — FR-1: 가짜 CLI(`withScript`, Windows에서도 도는 `node <스크립트>`)가 낸
  모든 줄이 순서대로 `raw.jsonl`에 있다 — **깨진 줄과 어댑터가 버리는 줄(`rate_limit_event`) 포함**,
  `stream.jsonl`에는 `signature`가 없고 `raw.jsonl`에는 있다. FR-3 작은 상한. FR-4 원본 로그를 못 열어도
  run은 끝나고 정규화 로그는 온전하다.
  *(§7-A에 맞춰 고침: 어댑터가 버리는 줄의 예는 `system/status`이고, `rate_limit_event`는 **빠지는지**를 본다.
  run 종료가 원본 writer를 닫는지는 `createRawLogWriter`를 감싸 close가 끝났는지로 본다 — Windows에서도
  닫지 않은 fs 스트림이 `rmSync`를 막지 않아 임시 디렉토리 정리로는 드러나지 않는다.)*
- `shared/events.test.ts` † — `eventWeight`가 `logWriter`가 쓴 줄 길이와 같다.
  *(자리를 옮김: 실제 `createLogWriter`와 대조하는 테스트는 `core/db/repositories/run.test.ts`의 "글자 한계는
  logWriter가 쓴 줄의 길이로 잰다 — eventWeight와 같은 수다"다. `shared/`는 renderer 타입 검사에도 걸려 core의
  node 모듈을 import할 수 없다. `shared/events.test.ts`는 무게·`isCount`의 정의를 본다.)*
- `core/db/repositories/run.test.ts` — FR-33: 꼬리 창(개수·글자 두 한계), 순서, 깨진 줄. FR-34: 이 기능 전
  모양의 줄만 있는 로그와 모르는 `type`의 줄을 그대로 읽는다. `raw.jsonl`이 옆에 있어도 결과가 같다(FR-6).
- `renderer/store/runEvents.test.ts` — FR-31: 글자 예산으로 앞을 버림(`push`·`hydrate` 둘 다), 버린 seq가
  다시 push돼도 들어오지 않음.
- `renderer/timeline.test.ts` — FR-36 표의 행마다 "있으면 / 없으면". FR-37: 번호 매기기(` `·`-`·`+` 섞인
  hunk), `gapBefore`, create 1..n, `added` 우선, 파일 여럿. FR-38: 자식이 카드 안으로, 중첩, 부모 없는 자식은
  메인, 순환 방지, 실패한 에이전트도 카드. FR-39: 메인만 센다·`denied`와 `failed`가 겹치지 않음·`compacted`·
  `currentChild`·`retrying`·`omitted`. FR-40: 정확/추정/기준 없음. FR-41: 거부 공지 한 번·tool-error 바로 뒤·
  자식 스코프, 연속 retry 합치기와 사이에 블록이 있으면 안 합침. **옛 로그 호환**: TL의 기존 테스트가 고치지
  않고 통과한다(요약 모양이 넓어진 단언만 고친다).
- `renderer/diff.test.ts` — `hunksFromPatch`. `renderer/ansi.test.ts` † — 색·커서·OSC 제어열.
- `renderer/components/Transcript.test.tsx`(또는 TL이 만든 블록 테스트) — FR-43 출력 블록이 열릴 때 바닥
  (`scrollHeight`를 `defineProperty`로 세운다)·잘림 안내·ANSI 없음, FR-44 단위별 글자, FR-46 `권한 거부`,
  FR-47 번호 칸의 `user-select`·`⋯ N줄`·이전 내용 토글, **FR-48 `**굵게**`가 글자 그대로**(마크다운 아님)·
  `생각 · 약 4초`·열림이 상태 전이로 바뀌지 않음, FR-49 자식 블록·opencode 안내, FR-50 문구 그대로,
  FR-51 요약 줄과 상태 줄, FR-52 생략 안내.

**회귀 확인** — 구현 전에 망가뜨려 빨개지는지 본다(CLAUDE.md 컨벤션).

- 어댑터가 `signature`를 싣게 바꾸면 "signature 글자가 없다"가 빨개진다.
- `output`을 앞부분으로 자르게 바꾸면 끝부분 테스트가 빨개진다.
- 메인 스레드에 `parentToolUseId: null`을 넣으면 FR-7 테스트가 빨개진다.
- `buildCommand`에서 `--thinking`을 빼면 명령 테스트와 **e2e opencode 생각 단언**이 빨개진다(가짜
  opencode가 플래그가 있을 때만 reasoning을 낸다 — 실제 run 루프와 같게).
- manager가 원본 줄을 `parseLine` **뒤에**, 파싱에 성공한 줄만 쓰게 바꾸면 "깨진 줄도 남는다"가 빨개진다.
- 권한 거부 공지 중복 제거를 빼면 "한 번만"이, 자식을 메인에 그리면 "메인만 센다"가 빨개진다.
- 생각 블록을 `Markdown`으로 그리면 "글자 그대로"가 빨개진다.

**e2e** — 가짜 CLI에 `ONE_DESK_FAKE_SCRIPT=events`를 더한다(TL plan의 `timeline` 스크립트와 같은 방식, 기본
시나리오는 건드리지 않는다).

- `e2e/events.e2e.ts` † — claude: thinking(서명 4KB) · Bash(7만 자 출력, 끝에 `PASS`) · Grep(`numFiles: 3`) ·
  Edit(`oldStart: 41`) · Write 덮어쓰기(`originalFile`) · `api_retry` · Agent + 자식 Read(`parent_tool_use_id`) ·
  거부된 Bash(`system/permission_denied` + `result.permission_denials`) · `compact_boundary` · JSON이 아닌 줄.
  단언: 접힌 턴 요약 `권한 거부 1 · 대화 압축됨`, 펼치면 `생각 · 약` 줄과 그 본문, 셸 출력에 `PASS`와 잘림 안내,
  `(파일 3개)`, 편집 줄을 펼치면 `41`, `이전 내용 보기`, `API 재시도 중 · 2/10번째`, `권한 때문에 막힘: Bash`가
  **정확히 하나**, 카드 `하위 에이전트 …`를 펼치면 자식 `읽기`. 로그: `<dataDir>/logs/<runId>/raw.jsonl`의 줄
  수가 가짜 CLI가 낸 줄 수와 같고 `signature`가 있으며, `stream.jsonl`에는 없다.
- 같은 파일, opencode: `launchApp({ agentPath: fake-opencode.mjs })`로 OpenCode를 골라 reasoning(`생각 · 2초`,
  정확한 시간) · edit `filediff`(줄 번호) · grep(`12개 일치`) · bash `exit: 1`(`종료 코드 1`) · 권한 거부 문구 →
  공지, 카드 안내 문구(task).
- 기존 e2e 전부 초록 — 기본 시나리오를 바꾸지 않았으므로 깨질 것은 TL의 `(N개 일치)` 단언 정도다(§7 우려 16).

**화면 캡처** — TL spec §7의 절차 그대로(임시 `e2e/zz-events-capture.e2e.ts`, 커밋하지 않음, 라이트·다크).
장면 여섯: 생각 블록 열림 · 셸 출력 열림(바닥, 잘림 안내) · 줄 번호 diff와 이전 내용 · 하위 에이전트 카드
열림(자식 둘) · 공지 셋(재시도·압축·거부) · 접힌 턴의 요약·재시도 상태 줄.

**grep**

- NFR-2: `grep -rnE "tool_use_result|structuredPatch|originalFile|filediff|parent_tool_use_id|compact_boundary|api_retry|permission_denials" core shared renderer electron --include=*.ts --include=*.tsx | grep -v "core/runner/adapters/\|core/runner/fixtures/"` — 출력 없음
- `grep -rn "from 'electron'" core/` · `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- `grep -rn "dangerouslySetInnerHTML" renderer/` — 출력 없음(FR-53)

**명령** — `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` 전부 초록.

## 9. 리뷰가 남긴 과제

2026-09-27 구현 리뷰(파서·크기와 보안·화면과 테스트 렌즈, 지적 25건)를 처리한 뒤 남은 것이다. 고친 것은
해당 FR·표의 "다듬음 — 리뷰 반영"·"정정"에 적었다. 여기 남은 것은 **이 spec의 결정(§7-A·FR-3·FR-10·FR-30·
FR-40)을 뒤집거나 새로 정해야 하는 것**이라 코드에서 임의로 고르지 않았다.

1. **claude의 빈 생각이 묶음을 끊고 창을 차지한다** (§7-A × FR-40, FR-31·33). §7-A는 본문이 빈 thinking도
   "생각 · N초" 한 줄로 보이게 했고(FR-15를 뒤집었다), FR-40은 모든 reasoning이 text처럼 활동·편집 묶음을
   끊게 했다 — FR-40은 FR-15("빈 thinking은 이벤트 없음")를 전제로 쓰였다. 둘을 합치면 도구 호출 사이마다
   빈 생각이 끼는 보통의 claude 턴(기록의 thinking 1,851개 중 1,800개가 빈 본문)이 `생각 · 1초 / 1 읽기
   사용됨 / 생각 · 1초 / 1 Grep 사용됨 …`으로 조각나고 같은 파일의 편집도 한 블록으로 모이지 않는다(재현:
   `[thinking '' → Read a → thinking '' → Read b → thinking '' → Grep]`이 `reasoning | activity(1) | reasoning |
   activity(1) | reasoning | activity(1)` — 이 기능 전에는 `3 읽기, Grep 사용됨` 한 줄). 같은 이벤트가 run당
   2,000개 창의 약 1/3과 이벤트마다 IPC push 하나를 먹어, 창 안에 남는 도구 이력이 짧아진다(이 기능 전에는
   thinking이 칸을 차지하지 않았다). 안: (가) 본문이 빈 생각은 묶음을 끊지 않고 묶음 라벨에 접는다(`3 읽기,
   Grep 사용됨 · 생각 3번`), (나) 빈 생각은 개수 창에서 빼거나 앞 이벤트에 접는다, (다) §7-A를 되돌려 빈
   생각은 이벤트를 만들지 않는다(생각한 흔적은 사라진다). (가)와 (나)는 함께 고를 수 있다.
   **결정(2026-09-27, 사용자 위임으로 Claude가 택함): (다).** 본문이 빈(공백뿐인) claude thinking은 이벤트를
   만들지 않는다 — FR-15의 원래 문장으로 돌아간다. 빈 생각 줄은 담는 정보가 "생각했다"뿐인데 보통의 claude
   턴을 조각내고 창을 먹는다. (가)·(나)는 FR-40·FR-31을 함께 고쳐야 하는 큰 변경이라 고르지 않았다.
   본문이 있는 생각은 그대로 "생각 · 약 N초" 블록이다. `claudeCode.parse.test.ts`의 "본문이 빈 thinking은
   이벤트를 내지 않는다"가 고정한다.
2. **Edit의 `before`가 화면이 쓰지 않는데 로그·IPC·스토어 창을 차지한다** (FR-10·FR-30·FR-37, §5-1). §7-A는
   읽기 출력을 "화면이 쓰지 않는다"는 이유로 뺐는데 Edit의 `before`(≤131,072자)는 FR-37대로 화면에 쓰지
   않으면서 매 편집마다 이벤트째로 IPC push되고 800만 자 스토어 창에 든다 — 130K자 파일을 60번쯤 편집하면
   앞선 도구 줄이 전부 "앞의 기록 N개는 생략했습니다"로 밀려난다. 게다가 §2-1의 크기(p50 5.7K)는 트랜스크립트
   writer가 1만 자에서 지운 저장본의 것이라 스트림에서는 과소평가다(스트림의 Edit 원본에는 크기 한계가 없다 —
   FR-14 다듬음). 또 상한은 `string.length`로 재는데 창의 무게는 JSON 길이라, 따옴표·백슬래시는 2배, 제어
   문자는 6배로 불어나 이벤트 하나가 §5-1의 "최대 약 33만 자"를 크게 넘을 수 있다(`before`가 전부 제어
   문자면 약 79만 자). 안: (가) Edit의 `before`는 `raw.jsonl`에만 남기고 이벤트에 싣지 않는다(diff 뷰어가
   원본 줄에서 다시 읽는다), (나) 창의 무게에서 `before`를 뺀다, (다) 상한을 JSON 길이로 잰다.
3. **`raw.jsonl`이 에이전트가 읽은 파일 원문을 평문으로 무기한 남긴다** (E1, FR-5, §7 우려 1·4). 제외 목록은
   `rate_limit_event` 하나뿐이라, claude `user` 줄의 `content`·`tool_use_result.file.content`(Read가 연
   `.env`·자격 증명 파일 전문, 이미지·PDF는 base64가 두 벌), Write/Edit의 원본·내용, thinking의 서명,
   opencode reasoning의 provider 암호문이 `userData/logs/<runId>/raw.jsonl`에 그대로 쌓이고 지우는 코드가
   없다. `stream.jsonl`에서는 읽기 원문과 서명을 일부러 뺐지만 원본 줄에는 남는다. §7 우려 1은 개인 정보로
   rate_limit 하나만 다뤘다. **사용자에게 알리고** 보존 정책(`conversation-next`)의 우선순위를 올려야 한다.
   안: (가) 원본 줄에서도 읽기 결과의 파일 내용을 걷어 쓴다(재파싱 재료가 줄어든다), (나) 보존 기간이 지난
   run의 `raw.jsonl`부터 지운다, (다) 설정에 원본 줄 로그 끄기.
4. **`raw.jsonl` 상한에 닿으면 마지막 `result`·`usage`까지 버려진다** (FR-3). 무거운 줄은 대개 도구 결과
   한두 줄(이미지 Read는 base64가 두 벌, 기록의 Read p90 약 38만 자)이라 큰 이미지 몇 장이면 run 중간에
   32MiB에 닿고, 그 뒤의 assistant 줄과 최종 `result`(usage·permission_denials)가 모두 사라진다. 이 파일의
   존재 이유가 "지난 대화를 다시 파싱하는 재료"라 꼬리가 없으면 그 run은 재구성할 수 없다. 안: (가) 상한을
   넘는 줄만 건너뛰고 표식에 건너뛴 수를 적는다(뒤 줄은 계속 쓴다), (나) `result` 줄을 위한 여유를 남긴다,
   (다) 한 줄의 상한을 따로 둔다.
5. **opencode의 hunk 줄 본문은 공통 들여쓰기가 걷힌 것이다** (§2-3 정정, FR-24, §7 우려 12). 1.18.30은 edit·
   apply_patch의 `patch`를 `trimDiff`로 다듬어 보낸다 — 줄 번호는 맞지만 본문이 파일과 달라, 깊게 들여쓴
   코드가 대화록에서 왼쪽으로 당겨져 보인다(OpenCode 자신의 화면도 그렇다). 걷은 폭은 어디에도 없어 되돌릴
   수 없다. 대화록에는 해가 작지만, `PatchHunk`를 diff 뷰어의 원본 재료로 쓰면 원본 들여쓰기를 잃는다.
   안: (가) `EditFileDetail`에 "본문이 다듬어졌다" 표식을 둔다, (나) edit은 입력의 `oldString`과 hunk의 `-`
   줄을 맞춰 걷은 폭을 추정한다(깨지기 쉽다), (다) diff 뷰어 설계가 opencode는 hunk를 표시용으로만 쓴다고
   정한다(원본은 어차피 없다 — 우려 12).
